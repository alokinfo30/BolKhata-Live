import { executeBackendTool } from './toolHandlers';
import type { ActiveBillPreview, ApprovalRequest, TxType } from '../types';

const WORKLET_CODE = `
class BolKhataPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._chunkSize = 1024;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;
    const channel = input[0];
    const ratio = sampleRate / 16000;

    if (Math.abs(ratio - 1) < 0.01) {
      for (let i = 0; i < channel.length; i++) {
        const s = Math.max(-1, Math.min(1, channel[i]));
        this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    } else {
      const outLen = Math.floor(channel.length / ratio);
      for (let i = 0; i < outLen; i++) {
        const idx = Math.min(channel.length - 1, Math.floor(i * ratio));
        const s = Math.max(-1, Math.min(1, channel[idx]));
        this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    }

    while (this._buffer.length >= this._chunkSize) {
      const slice = this._buffer.splice(0, this._chunkSize);
      const int16 = new Int16Array(slice);
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }
    return true;
  }
}
registerProcessor('bolkhata-pcm-processor', BolKhataPcmProcessor);
`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export interface AudioInputOption {
  deviceId: string;
  label: string;
}

export async function listAudioInputDevices(): Promise<AudioInputOption[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId)
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${idx + 1}`,
      }));
  } catch {
    return [];
  }
}

async function createAudioContextSafe(targetSampleRate: number): Promise<AudioContext> {
  try {
    const ctx = new AudioContext({ sampleRate: targetSampleRate });
    await ctx.resume();
    return ctx;
  } catch {
    const fallbackCtx = new AudioContext();
    await fallbackCtx.resume();
    return fallbackCtx;
  }
}

async function acquireMicrophoneStream(preferredDeviceId?: string): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Microphone capture is not supported in this browser context (requires HTTPS or localhost).'
    );
  }

  const attempts: MediaStreamConstraints[] = [];

  if (preferredDeviceId) {
    attempts.push({
      audio: {
        deviceId: { exact: preferredDeviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    attempts.push({
      audio: { deviceId: { exact: preferredDeviceId } },
    });
  }

  attempts.push({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  attempts.push({ audio: true });

  let lastError: unknown = null;

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error(
          'Microphone permission was denied. Allow mic access in your browser site settings and retry.'
        );
      }
    }
  }

  // Enumerate all available audio inputs and try each specific device in case the default device was removed or stale
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== preferredDeviceId)
      .sort((a, b) => {
        const aDefault = a.deviceId === 'default' || a.deviceId === 'communications' ? 1 : 0;
        const bDefault = b.deviceId === 'default' || b.deviceId === 'communications' ? 1 : 0;
        return aDefault - bDefault;
      });

    for (const dev of audioInputs) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: dev.deviceId } },
        });
      } catch (err) {
        lastError = err;
      }
    }
  } catch {
    // ignore enumerateDevices failure
  }

  const rawMsg = lastError instanceof Error ? lastError.message : String(lastError || '');
  if (rawMsg.toLowerCase().includes('device was removed') || rawMsg.toLowerCase().includes('not found')) {
    throw new Error(
      'Microphone unavailable ("Device was removed"). Reconnect your mic/headset or use Text + Voice Output mode below.'
    );
  }
  throw new Error(
    rawMsg || 'No working microphone device was detected. You can still use Text + Voice Output mode.'
  );
}

export interface GeminiLiveClientCallbacks {
  onSessionReady: () => void;
  onSessionClosed: () => void;
  onInputTranscript: (text: string) => void;
  onOutputTranscript: (text: string) => void;
  onTurnComplete: () => void;
  onInterrupted: () => void;
  onLatencySample: (ms: number) => void;
  onMicLevel: (rms: number) => void;
  onAgentSpeakingChange: (speaking: boolean) => void;
  onBillPreview?: (bill: ActiveBillPreview) => void;
  onError: (message: string) => void;
}

/**
 * Production WebSocket Audio Streaming & Barge-In Engine.
 * Streams 16kHz PCM mic capture over secure server-bridged /ws/live WebSocket
 * (keeping GEMINI_API_KEY strictly on backend), plays 24kHz PCM responses gaplessly,
 * and handles instant mid-sentence barge-in interruption + live Firestore tool calls.
 */
export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rafLevelId = 0;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private turnT0: number | null = null;
  private lastVoiceActiveMs = 0;
  private wasUserSpeaking = false;
  private muted = false;
  private ownerId = '';
  private sessionId = '';
  private callbacks: GeminiLiveClientCallbacks;

  constructor(callbacks: GeminiLiveClientCallbacks) {
    this.callbacks = callbacks;
  }

  setMuted(val: boolean): void {
    this.muted = val;
    if (val) {
      this.callbacks.onMicLevel(0);
    }
  }

  async connect(
    ownerId: string,
    sessionId: string,
    catalogContext: string,
    options?: { textOnly?: boolean; deviceId?: string }
  ): Promise<void> {
    this.ownerId = ownerId;
    this.sessionId = sessionId;

    const textOnly = Boolean(options?.textOnly);

    const outputCtx = await createAudioContextSafe(24000);
    this.outputCtx = outputCtx;
    this.nextStartTime = outputCtx.currentTime;

    if (!textOnly) {
      let stream: MediaStream;
      try {
        stream = await acquireMicrophoneStream(options?.deviceId);
      } catch (micErr) {
        outputCtx.close().catch(() => {});
        this.outputCtx = null;
        throw micErr;
      }
      this.stream = stream;

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          this.muted = true;
          this.callbacks.onMicLevel(0);
          this.callbacks.onError(
            'Active microphone was disconnected. Session stays open in Text + Voice Output mode.'
          );
        };
      }

      const inputCtx = await createAudioContextSafe(16000);
      this.inputCtx = inputCtx;

      const blobUrl = URL.createObjectURL(
        new Blob([WORKLET_CODE], { type: 'application/javascript' })
      );
      await inputCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const source = inputCtx.createMediaStreamSource(stream);
      const analyser = inputCtx.createAnalyser();
      analyser.fftSize = 256;
      this.analyser = analyser;

      const workletNode = new AudioWorkletNode(inputCtx, 'bolkhata-pcm-processor');
      this.workletNode = workletNode;

      const silentGain = inputCtx.createGain();
      silentGain.gain.value = 0;

      source.connect(analyser);
      analyser.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(inputCtx.destination);

      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (this.muted || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        this.ws.send(
          JSON.stringify({
            type: 'audio',
            data: arrayBufferToBase64(e.data),
          })
        );
      };

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const tickLevel = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) {
          const v = (freqData[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / freqData.length);
        this.callbacks.onMicLevel(this.muted ? 0 : rms);

        const now = performance.now();
        if (!this.muted && rms > 0.045) {
          this.wasUserSpeaking = true;
          this.lastVoiceActiveMs = now;
        } else if (this.wasUserSpeaking && now - this.lastVoiceActiveMs > 350) {
          this.wasUserSpeaking = false;
          this.turnT0 = now;
        }

        this.rafLevelId = requestAnimationFrame(tickLevel);
      };
      this.rafLevelId = requestAnimationFrame(tickLevel);
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'start_session',
          catalogContext,
        })
      );
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as {
        type: string;
        data?: string;
        text?: string;
        id?: string;
        name?: string;
        args?: Record<string, unknown>;
        message?: string;
      };

      if (msg.type === 'session_ready') {
        this.callbacks.onSessionReady();
      } else if (msg.type === 'audio' && msg.data) {
        this.scheduleOutputAudio(msg.data);
      } else if (msg.type === 'interrupted') {
        this.flushPlayback();
        this.callbacks.onInterrupted();
      } else if (msg.type === 'input_transcript' && msg.text) {
        this.callbacks.onInputTranscript(msg.text);
      } else if (msg.type === 'output_transcript' && msg.text) {
        this.callbacks.onOutputTranscript(msg.text);
      } else if (msg.type === 'turn_complete') {
        this.callbacks.onTurnComplete();
      } else if (msg.type === 'tool_call' && msg.id && msg.name) {
        void this.dispatchToolCall(msg.id, msg.name, msg.args || {});
      } else if (msg.type === 'error') {
        this.callbacks.onError(msg.message || 'Live voice connection error');
      } else if (msg.type === 'session_closed') {
        this.callbacks.onSessionClosed();
      }
    };

    ws.onerror = () => {
      this.callbacks.onError('WebSocket connection to counter voice server failed.');
      this.disconnect();
    };

    ws.onclose = () => {
      this.callbacks.onSessionClosed();
    };
  }

  private lastLookupCustomer: { id: string; name: string } | null = null;
  private lastLookupItem: { sku: string; name: string; unit: string } | null = null;

  private async dispatchToolCall(
    id: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<void> {
    if (!this.ownerId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const response = await executeBackendTool(this.ownerId, this.sessionId, name, args);

    if (name === 'lookup_customer_and_stock') {
      const fc = response.found_customer as { customer_id?: string; name?: string } | null;
      const fi = response.found_item as { sku?: string; name?: string; unit?: string } | null;
      if (fc?.customer_id && fc?.name) {
        this.lastLookupCustomer = { id: fc.customer_id, name: fc.name };
      }
      if (fi?.sku && fi?.name) {
        this.lastLookupItem = { sku: fi.sku, name: fi.name, unit: fi.unit || 'units' };
      }
    } else if (name === 'check_business_policy' && this.callbacks.onBillPreview) {
      const totalAmount = Number(args.total_amount ?? 0);
      if (totalAmount > 0 && this.lastLookupCustomer) {
        this.callbacks.onBillPreview({
          customerId: String(args.customer_id || this.lastLookupCustomer.id),
          customerName: this.lastLookupCustomer.name,
          itemName: this.lastLookupItem?.name || String(args.item_sku || 'Wholesale Order'),
          qty: Number(args.qty ?? 0),
          unit: this.lastLookupItem?.unit || 'units',
          totalAmount,
          txType: String(args.tx_type || 'UDHAAR').toUpperCase() as TxType,
          status: response.requires_human_approval ? 'PENDING_APPROVAL' : 'READBACK',
          updatedAt: Date.now(),
        });
      }
    } else if (name === 'request_human_approval' && this.callbacks.onBillPreview) {
      this.callbacks.onBillPreview({
        customerId: String(args.customer_id || ''),
        customerName: String(args.customer_name || 'Customer'),
        itemName: String(args.item_name || 'Wholesale Order'),
        qty: Number(args.qty ?? 0),
        unit: String(args.unit || 'units'),
        totalAmount: Number(args.total_amount ?? 0),
        txType: String(args.tx_type || 'UDHAAR').toUpperCase() as TxType,
        status: 'PENDING_APPROVAL',
        updatedAt: Date.now(),
      });
    } else if (
      name === 'execute_ledger_and_inventory_tx' &&
      response.executed &&
      this.callbacks.onBillPreview
    ) {
      this.callbacks.onBillPreview({
        customerId: String(args.customer_id || ''),
        customerName: String(response.customer_name || this.lastLookupCustomer?.name || 'Customer'),
        itemName: String(response.item_name || 'Wholesale Order'),
        qty: Number(response.qty ?? 0),
        unit: String(response.unit || 'units'),
        totalAmount: Number(args.total_amount ?? 0),
        txType: String(args.tx_type || 'UDHAAR').toUpperCase() as TxType,
        status: 'CONFIRMED',
        updatedAt: Date.now(),
      });
    }

    this.turnT0 = performance.now();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'tool_result',
          id,
          name,
          response,
        })
      );
    }
  }

  private scheduleOutputAudio(base64Pcm: string): void {
    const ctx = this.outputCtx;
    if (!ctx) return;

    if (this.turnT0 !== null) {
      const elapsed = Math.round(performance.now() - this.turnT0);
      if (elapsed > 30 && elapsed < 15000) {
        this.callbacks.onLatencySample(elapsed);
      }
      this.turnT0 = null;
    }

    const int16 = base64ToInt16(base64Pcm);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.015, this.nextStartTime);
    this.activeSources.add(src);
    src.onended = () => {
      this.activeSources.delete(src);
      if (this.activeSources.size === 0) {
        this.callbacks.onAgentSpeakingChange(false);
      }
    };
    src.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.callbacks.onAgentSpeakingChange(true);
  }

  flushPlayback(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // ignore already stopped
      }
    }
    this.activeSources.clear();
    if (this.outputCtx) {
      this.nextStartTime = this.outputCtx.currentTime;
    } else {
      this.nextStartTime = 0;
    }
    this.callbacks.onAgentSpeakingChange(false);
  }

  sendTextTurn(text: string): void {
    const cleaned = text.trim();
    if (!cleaned || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.turnT0 = performance.now();
    this.ws.send(JSON.stringify({ type: 'text_turn', text: cleaned }));
  }

  notifyHitlResolution(
    approval: ApprovalRequest,
    status: 'APPROVED' | 'REJECTED',
    restockPo?: string
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.turnT0 = performance.now();
    this.ws.send(
      JSON.stringify({
        type: 'hitl_resolution',
        approval: {
          approval_id: approval.approval_id,
          customer_name: approval.customer_name,
          item_name: approval.item_name,
          unit: approval.unit,
          qty: approval.qty,
          total_amount: approval.total_amount,
          status,
          restock_po: restockPo,
        },
      })
    );
  }

  disconnect(): void {
    cancelAnimationFrame(this.rafLevelId);
    this.flushPlayback();

    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch {
        // ignore
      }
      this.workletNode = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.inputCtx) {
      this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }
    if (this.outputCtx) {
      this.outputCtx.close().catch(() => {});
      this.outputCtx = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.analyser = null;
    this.callbacks.onMicLevel(0);
  }
}
