import { useCallback, useEffect, useRef, useState } from 'react';
import { logAgentTrace, logVoiceTranscript } from '../services/firestoreOps';
import { GeminiLiveClient } from '../services/geminiLiveClient';
import type {
  ActiveBillPreview,
  Customer,
  InventoryItem,
  LatencySamplePoint,
  TranscriptMessage,
} from '../types';

interface UseGeminiLiveVoiceOptions {
  ownerId: string | null;
  customers: Customer[];
  inventory: InventoryItem[];
}

export function useGeminiLiveVoice({
  ownerId,
  customers,
  inventory,
}: UseGeminiLiveVoiceOptions) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [latencySamples, setLatencySamples] = useState<number[]>([]);
  const [latencyHistory, setLatencyHistory] = useState<LatencySamplePoint[]>([]);
  const [activeBillPreview, setActiveBillPreview] = useState<ActiveBillPreview | null>(null);
  const [liveTranscripts, setLiveTranscripts] = useState<TranscriptMessage[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const ownerIdRef = useRef(ownerId);
  ownerIdRef.current = ownerId;
  const customersRef = useRef(customers);
  customersRef.current = customers;
  const inventoryRef = useRef(inventory);
  inventoryRef.current = inventory;
  const sessionIdRef = useRef<string>(`sess_${Date.now()}`);

  const pendingUserRef = useRef<string>('');
  const pendingAgentRef = useRef<string>('');

  const appendLiveTranscript = useCallback(
    (role: 'user' | 'agent' | 'system', text: string) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      setLiveTranscripts((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && Date.now() - last.timestamp < 5000) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            text: `${last.text} ${cleaned}`.replace(/\s+/g, ' ').trim(),
            timestamp: Date.now(),
          };
          return updated;
        }
        return [
          ...prev.slice(-20),
          {
            id: `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role,
            text: cleaned,
            timestamp: Date.now(),
          },
        ];
      });
    },
    []
  );

  const flushPendingTurns = useCallback(() => {
    const uid = ownerIdRef.current;
    const sess = sessionIdRef.current;
    const uText = pendingUserRef.current.trim();
    const aText = pendingAgentRef.current.trim();

    if (uText && uid) {
      pendingUserRef.current = '';
      void logVoiceTranscript(uid, sess, 'user', uText);
    }
    if (aText && uid) {
      pendingAgentRef.current = '';
      void logVoiceTranscript(uid, sess, 'agent', aText);
    }
    if (uText || aText) {
      setLiveTranscripts([]);
    }
  }, []);

  const stopSession = useCallback(() => {
    flushPendingTurns();
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setIsAgentSpeaking(false);
    setMicLevel(0);
  }, [flushPendingTurns]);

  const startSession = useCallback(async () => {
    if (!ownerIdRef.current || isConnecting || isConnected) return;
    setVoiceError(null);
    setIsConnecting(true);
    sessionIdRef.current = `sess_${Date.now()}`;
    pendingUserRef.current = '';
    pendingAgentRef.current = '';
    setLiveTranscripts([]);

    const client = new GeminiLiveClient({
      onSessionReady: () => {
        setIsConnecting(false);
        setIsConnected(true);
        const uid = ownerIdRef.current;
        if (uid) {
          void logVoiceTranscript(
            uid,
            sessionIdRef.current,
            'system',
            'Counter voice channel connected (16kHz PCM).'
          );
        }
      },
      onSessionClosed: () => {
        flushPendingTurns();
        setIsConnected(false);
        setIsConnecting(false);
      },
      onInputTranscript: (text) => {
        const uid = ownerIdRef.current;
        if (pendingAgentRef.current.trim() && uid) {
          const aText = pendingAgentRef.current.trim();
          pendingAgentRef.current = '';
          void logVoiceTranscript(uid, sessionIdRef.current, 'agent', aText);
        }
        pendingUserRef.current = `${pendingUserRef.current} ${text}`.trim();
        appendLiveTranscript('user', text);
      },
      onOutputTranscript: (text) => {
        const uid = ownerIdRef.current;
        if (pendingUserRef.current.trim() && uid) {
          const uText = pendingUserRef.current.trim();
          pendingUserRef.current = '';
          void logVoiceTranscript(uid, sessionIdRef.current, 'user', uText);
          setLiveTranscripts((prev) => prev.filter((m) => m.role !== 'user'));
        }
        pendingAgentRef.current = `${pendingAgentRef.current} ${text}`.trim();
        appendLiveTranscript('agent', text);
      },
      onTurnComplete: () => {
        flushPendingTurns();
      },
      onInterrupted: () => {
        flushPendingTurns();
        if (ownerIdRef.current) {
          void logAgentTrace(
            ownerIdRef.current,
            sessionIdRef.current,
            'VOICE_INTENT',
            'Barge-In Interrupt Handled',
            'User spoke mid-sentence; audio buffer flushed for immediate correction.',
            0
          );
        }
      },
      onLatencySample: (ms) => {
        setLatencyMs(ms);
        setLatencySamples((prev) => [...prev.slice(-19), ms]);
        const now = Date.now();
        setLatencyHistory((prev) => [
          ...prev.slice(-39),
          {
            timestamp: now,
            timeLabel: new Date(now).toLocaleTimeString('en-IN', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            latencyMs: ms,
            source: 'Voice',
          },
        ]);
      },
      onMicLevel: (rms) => setMicLevel(rms),
      onAgentSpeakingChange: (speaking) => setIsAgentSpeaking(speaking),
      onBillPreview: (bill) => setActiveBillPreview(bill),
      onError: (message) => {
        setVoiceError(message);
        setIsConnecting(false);
      },
    });

    clientRef.current = client;
    client.setMuted(isMuted);

    const catalogSummary = [
      'CUSTOMERS: ' +
        customersRef.current
          .map(
            (c) =>
              `${c.name} (Bal: ₹${c.current_udhaar_balance}, Limit: ₹${c.credit_limit})`
          )
          .join('; '),
      'INVENTORY: ' +
        inventoryRef.current
          .map(
            (i) =>
              `${i.name} [SKU:${i.sku}, Aliases:${i.aliases.join('/')}, Unit:${i.unit}, Rate:₹${i.unit_price}, Stock:${i.stock_qty}, Reorder<${i.reorder_threshold}]`
          )
          .join('; '),
    ].join('\n');

    try {
      await client.connect(ownerIdRef.current, sessionIdRef.current, catalogSummary);
    } catch (err) {
      setVoiceError(
        err instanceof Error
          ? err.message
          : 'Microphone access denied or audio device unavailable.'
      );
      stopSession();
    }
  }, [
    appendLiveTranscript,
    flushPendingTurns,
    isConnected,
    isConnecting,
    isMuted,
    stopSession,
  ]);

  const handleSetMuted = useCallback((val: boolean) => {
    setIsMuted(val);
    clientRef.current?.setMuted(val);
  }, []);

  const flushPlayback = useCallback(() => {
    clientRef.current?.flushPlayback();
  }, []);

  const sendTextTurn = useCallback((text: string) => {
    const cleaned = text.trim();
    if (!cleaned || !clientRef.current) return;
    clientRef.current.sendTextTurn(cleaned);
    if (ownerIdRef.current) {
      void logVoiceTranscript(ownerIdRef.current, sessionIdRef.current, 'user', cleaned);
      void logAgentTrace(
        ownerIdRef.current,
        sessionIdRef.current,
        'VOICE_INTENT',
        'Counter Command Captured',
        cleaned,
        0
      );
    }
  }, []);

  const notifyHitlResolution = useCallback(
    (
      approval: Parameters<GeminiLiveClient['notifyHitlResolution']>[0],
      status: 'APPROVED' | 'REJECTED',
      restockPo?: string
    ) => {
      clientRef.current?.notifyHitlResolution(approval, status, restockPo);
    },
    []
  );

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, [stopSession]);

  const avgLatencyMs =
    latencySamples.length > 0
      ? Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)
      : null;

  return {
    isConnecting,
    isConnected,
    isMuted,
    setIsMuted: handleSetMuted,
    isAgentSpeaking,
    micLevel,
    latencyMs,
    avgLatencyMs,
    latencyHistory,
    activeBillPreview,
    setActiveBillPreview,
    liveTranscripts,
    voiceError,
    startSession,
    stopSession,
    sendTextTurn,
    notifyHitlResolution,
    flushPlayback,
  };
}
