import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Edit3,
  Mic,
  MicOff,
  MoreHorizontal,
  PackageCheck,
  QrCode,
  RotateCcw,
  Search,
  Send,
  Server,
  ShieldAlert,
  Volume2,
  X,
} from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { VoiceWaveform } from './VoiceWaveform';
import {
  getConfiguredBackendUrl,
  setConfiguredBackendUrl,
} from '../services/backendConfig';
import type {
  ActiveBillPreview,
  AgentTraceItem,
  ApprovalRequest,
  Customer,
  InventoryItem,
  LedgerTransaction,
  PersistedVoiceTranscript,
  TranscriptMessage,
} from '../types';

interface CounterWorkspaceProps {
  isConnecting: boolean;
  isConnected: boolean;
  isMuted: boolean;
  setIsMuted: (val: boolean) => void;
  isAgentSpeaking: boolean;
  micLevel: number;
  latencyMs: number | null;
  avgLatencyMs: number | null;
  liveTranscripts: TranscriptMessage[];
  persistedTranscripts: PersistedVoiceTranscript[];
  voiceError: string | null;
  micUnavailable?: boolean;
  textOnlyMode?: boolean;
  audioInputs?: { deviceId: string; label: string }[];
  selectedMicId?: string;
  onSelectMicId?: (id: string) => void;
  onStartVoice: () => void;
  onStartTextOnlyVoice?: () => void;
  onStopVoice: () => void;
  onFlushPlayback: () => void;
  onSendTextTurn: (text: string) => void;
  approvals: ApprovalRequest[];
  onResolveApproval: (approval: ApprovalRequest, decision: 'APPROVED' | 'REJECTED') => Promise<void>;
  resolvingId: string | null;
  traces: AgentTraceItem[];
  transactions: LedgerTransaction[];
  inventory: InventoryItem[];
  customers: Customer[];
  activeBillPreview: ActiveBillPreview | null;
  onRecordJamaPayment: (customer: Customer, amount: number) => Promise<void>;
  onQuickLookup?: (
    customerQuery?: string,
    itemQuery?: string
  ) => Promise<Record<string, unknown> | null>;
  onManualUndo: () => Promise<void>;
  undoBusy: boolean;
}

const DEMO_PROMPTS = [
  'Sharma General Store ke khate mein 15 bori Basmati chawal udhaar likh do, check karo stock kitna hai.',
  'Haan, confirm kar do.',
  'Ab Verma Traders ko 50 peti refined oil udhaar pe bhej do.',
  'Galti ho gayi, pichli entry cancel karo.',
];

function formatInr(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatTranscriptTime(createdAt: unknown, fallbackMs?: number): string {
  let ms = fallbackMs ?? Date.now();
  if (
    createdAt &&
    typeof createdAt === 'object' &&
    'toMillis' in createdAt &&
    typeof (createdAt as Timestamp).toMillis === 'function'
  ) {
    ms = (createdAt as Timestamp).toMillis();
  }
  return new Date(ms).toLocaleTimeString('en-IN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface DetectedToken {
  text: string;
  kind: 'amount' | 'item' | 'customer';
  numericValue?: string;
}

function detectMessageEntities(
  text: string,
  inventory: InventoryItem[],
  customers: Customer[]
): {
  segments: Array<{ text: string; token?: DetectedToken }>;
  firstAmount: string;
  firstItem: string;
  firstCustomer: string;
} {
  const itemTerms = Array.from(
    new Set(
      inventory
        .flatMap((i) => [i.name, i.sku, ...i.aliases])
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
    )
  ).sort((a, b) => b.length - a.length);

  const custTerms = Array.from(
    new Set(customers.map((c) => c.name.trim()).filter((t) => t.length >= 3))
  ).sort((a, b) => b.length - a.length);

  const amountPattern =
    '(?:₹|Rs\\.?\\s*)[\\d,]+(?:\\.\\d{1,2})?|\\b[\\d,]+\\s*(?:rupees?|INR|bori|peti|tin|bags?|kg)\\b';

  const parts: string[] = [amountPattern];
  if (custTerms.length > 0) {
    parts.push(custTerms.map(escapeRegExp).join('|'));
  }
  if (itemTerms.length > 0) {
    parts.push(itemTerms.map(escapeRegExp).join('|'));
  }

  const regex = new RegExp(`(${parts.join('|')})`, 'gi');
  const segments: Array<{ text: string; token?: DetectedToken }> = [];
  let lastIdx = 0;
  let firstAmount = '';
  let firstItem = '';
  let firstCustomer = '';

  for (const match of text.matchAll(regex)) {
    const idx = match.index ?? 0;
    if (idx > lastIdx) {
      segments.push({ text: text.slice(lastIdx, idx) });
    }
    const matched = match[0];
    const lower = matched.toLowerCase();

    const matchedCust = custTerms.find((c) => c.toLowerCase() === lower);
    const matchedItem = itemTerms.find((it) => it.toLowerCase() === lower);

    let token: DetectedToken;
    if (matchedCust) {
      token = { text: matched, kind: 'customer' };
      if (!firstCustomer) firstCustomer = matched;
    } else if (matchedItem) {
      token = { text: matched, kind: 'item' };
      if (!firstItem) firstItem = matched;
    } else {
      const digits = matched.replace(/[^\d.]/g, '');
      token = { text: matched, kind: 'amount', numericValue: digits };
      if (!firstAmount && digits) firstAmount = digits;
    }

    segments.push({ text: matched, token });
    lastIdx = idx + matched.length;
  }

  if (lastIdx < text.length) {
    segments.push({ text: text.slice(lastIdx) });
  }

  return { segments, firstAmount, firstItem, firstCustomer };
}

export const CounterWorkspace: React.FC<CounterWorkspaceProps> = ({
  isConnecting,
  isConnected,
  isMuted,
  setIsMuted,
  isAgentSpeaking,
  micLevel,
  latencyMs,
  avgLatencyMs,
  liveTranscripts,
  persistedTranscripts,
  voiceError,
  micUnavailable = false,
  textOnlyMode = false,
  audioInputs = [],
  selectedMicId = '',
  onSelectMicId,
  onStartVoice,
  onStartTextOnlyVoice,
  onStopVoice,
  onFlushPlayback,
  onSendTextTurn,
  approvals,
  onResolveApproval,
  resolvingId,
  traces,
  transactions,
  inventory,
  customers,
  activeBillPreview,
  onRecordJamaPayment,
  onQuickLookup,
  onManualUndo,
  undoBusy,
}) => {
  const [commandInput, setCommandInput] = useState('');
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const [quickMenuMsgId, setQuickMenuMsgId] = useState<string | null>(null);
  const [quickActionTab, setQuickActionTab] = useState<'lookup' | 'correct'>('lookup');
  const [quickCustomerQuery, setQuickCustomerQuery] = useState('');
  const [quickItemQuery, setQuickItemQuery] = useState('');
  const [quickCorrectionValue, setQuickCorrectionValue] = useState('');
  const [quickLookupBusy, setQuickLookupBusy] = useState(false);
  const [quickLookupSummary, setQuickLookupSummary] = useState<string | null>(null);

  const [backendUrlInput, setBackendUrlInput] = useState(() => getConfiguredBackendUrl());
  const [backendUrlSaved, setBackendUrlSaved] = useState(false);

  const [upiVpa, setUpiVpa] = useState<string>(() => {
    try {
      return localStorage.getItem('bolkhata_upi_vpa') || 'bolkhata.store@okaxis';
    } catch {
      return 'bolkhata.store@okaxis';
    }
  });
  const [merchantName, setMerchantName] = useState<string>(() => {
    try {
      return localStorage.getItem('bolkhata_merchant_name') || 'BolKhata Wholesale';
    } catch {
      return 'BolKhata Wholesale';
    }
  });
  const [editingUpi, setEditingUpi] = useState(false);
  const [qrCustomerId, setQrCustomerId] = useState('');
  const [qrAmount, setQrAmount] = useState('');
  const [qrNote, setQrNote] = useState('');
  const [qrStageLabel, setQrStageLabel] = useState<string>('READY');
  const [qrCopied, setQrCopied] = useState(false);
  const [qrPayingBusy, setQrPayingBusy] = useState(false);
  const [qrPaidNotice, setQrPaidNotice] = useState<string | null>(null);

  const combinedTranscripts = [
    ...persistedTranscripts.map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      timeLabel: formatTranscriptTime(t.createdAt),
      isLiveStreaming: false,
    })),
    ...liveTranscripts.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      timeLabel: formatTranscriptTime(undefined, m.timestamp),
      isLiveStreaming: true,
    })),
  ];

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [combinedTranscripts.length]);

  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING');
  const lowStockItems = inventory.filter((i) => i.stock_qty < i.reorder_threshold);
  const completedTxs = transactions.filter((t) => t.status === 'COMPLETED');

  // Sync UPI QR code amount & bill metadata automatically on active voice read-back or confirmation
  useEffect(() => {
    if (activeBillPreview && activeBillPreview.totalAmount > 0) {
      setQrCustomerId(activeBillPreview.customerId || '');
      setQrAmount(String(activeBillPreview.totalAmount));
      setQrNote(
        `${activeBillPreview.customerName} - ${
          activeBillPreview.qty > 0
            ? `${activeBillPreview.qty} ${activeBillPreview.unit} ${activeBillPreview.itemName}`
            : activeBillPreview.itemName
        }`
      );
      setQrStageLabel(activeBillPreview.status);
      setQrPaidNotice(null);
    }
  }, [activeBillPreview]);

  // Fallback to latest completed transaction if no live read-back preview is active yet
  useEffect(() => {
    if (!activeBillPreview && !qrAmount && completedTxs.length > 0) {
      const latest = completedTxs[0];
      if (latest.total_amount > 0) {
        setQrCustomerId(latest.customer_id);
        setQrAmount(String(latest.total_amount));
        setQrNote(
          `${latest.customer_name} - ${
            latest.qty > 0 ? `${latest.qty} ${latest.unit} ${latest.item_name}` : latest.item_name
          }`
        );
        setQrStageLabel('LATEST TX');
      }
    }
  }, [activeBillPreview, completedTxs, qrAmount]);

  const parsedQrAmount = Math.max(0, Number(qrAmount) || 0);
  const selectedQrCustomer = customers.find((c) => c.id === qrCustomerId) || null;
  const cleanVpa = upiVpa.trim() || 'bolkhata.store@okaxis';
  const cleanMerchant = merchantName.trim() || 'BolKhata Wholesale';
  const cleanNote = (qrNote.trim() || 'BolKhata Counter Bill').slice(0, 80);
  const upiUri =
    parsedQrAmount > 0
      ? `upi://pay?pa=${encodeURIComponent(cleanVpa)}&pn=${encodeURIComponent(
          cleanMerchant
        )}&am=${parsedQrAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(cleanNote)}`
      : `upi://pay?pa=${encodeURIComponent(cleanVpa)}&pn=${encodeURIComponent(
          cleanMerchant
        )}&cu=INR&tn=${encodeURIComponent(cleanNote)}`;

  const handleSaveUpiSettings = () => {
    try {
      localStorage.setItem('bolkhata_upi_vpa', cleanVpa);
      localStorage.setItem('bolkhata_merchant_name', cleanMerchant);
    } catch {
      // ignore storage issues
    }
    setEditingUpi(false);
  };

  const handleCopyUpiUri = async () => {
    try {
      await navigator.clipboard.writeText(upiUri);
      setQrCopied(true);
      setTimeout(() => setQrCopied(false), 1800);
    } catch {
      // ignore clipboard issues
    }
  };

  const handleMarkUpiPaid = async () => {
    if (!selectedQrCustomer || parsedQrAmount <= 0) return;
    setQrPayingBusy(true);
    setQrPaidNotice(null);
    try {
      await onRecordJamaPayment(selectedQrCustomer, parsedQrAmount);
      setQrPaidNotice(
        `Logged ${formatInr(parsedQrAmount)} UPI Jama for ${selectedQrCustomer.name}.`
      );
    } finally {
      setQrPayingBusy(false);
    }
  };

  const openQuickAction = (
    msgId: string,
    opts?: {
      tab?: 'lookup' | 'correct';
      customerQuery?: string;
      itemQuery?: string;
      correctionValue?: string;
    }
  ) => {
    setQuickMenuMsgId(msgId);
    setQuickActionTab(opts?.tab ?? 'lookup');
    setQuickCustomerQuery(opts?.customerQuery ?? '');
    setQuickItemQuery(opts?.itemQuery ?? '');
    setQuickCorrectionValue(opts?.correctionValue ?? '');
    setQuickLookupSummary(null);
  };

  const handleRunQuickLookup = async () => {
    const cust = quickCustomerQuery.trim();
    const item = quickItemQuery.trim();
    if (!cust && !item) return;

    setQuickLookupBusy(true);
    setQuickLookupSummary(null);
    try {
      if (onQuickLookup) {
        const res = await onQuickLookup(cust || undefined, item || undefined);
        const fc = res?.found_customer as
          | { name?: string; current_udhaar_balance?: number; credit_limit?: number }
          | null
          | undefined;
        const fi = res?.found_item as
          | { name?: string; stock_qty?: number; unit?: string; unit_price?: number }
          | null
          | undefined;

        const parts: string[] = [];
        if (fc?.name) {
          parts.push(
            `${fc.name}: Bal ${formatInr(fc.current_udhaar_balance ?? 0)} / Limit ${formatInr(
              fc.credit_limit ?? 0
            )}`
          );
        }
        if (fi?.name) {
          parts.push(
            `${fi.name}: ${fi.stock_qty ?? 0} ${fi.unit || 'units'} @ ${formatInr(
              fi.unit_price ?? 0
            )}`
          );
        }
        setQuickLookupSummary(
          parts.length > 0
            ? parts.join(' · ')
            : 'No exact Khata/SKU match found — try refining the name.'
        );
      }
      if (isConnected) {
        onSendTextTurn(
          `Re-check lookup details for ${[cust, item].filter(Boolean).join(' and ')} and confirm exact rate/stock.`
        );
      }
    } finally {
      setQuickLookupBusy(false);
    }
  };

  const handleSendQuickCorrection = () => {
    const val = quickCorrectionValue.trim();
    if (!val) return;
    const correctionPrompt = quickItemQuery.trim()
      ? `Correction: ${quickItemQuery.trim()} ka amount/quantity ${val} kar do.`
      : `Correction: Amount/quantity ko ${val} update karke dobara verify karo.`;

    if (isConnected) {
      onSendTextTurn(correctionPrompt);
      setQuickMenuMsgId(null);
    } else {
      setCommandInput(correctionPrompt);
      setQuickLookupSummary(
        'Correction drafted in command box — click Start Counter Voice to send.'
      );
    }
  };

  const handleSaveBackendUrl = () => {
    const saved = setConfiguredBackendUrl(backendUrlInput);
    setBackendUrlInput(saved);
    setBackendUrlSaved(true);
    setTimeout(() => setBackendUrlSaved(false), 2000);
  };

  const handleSubmitCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || !isConnected) return;
    onSendTextTurn(commandInput);
    setCommandInput('');
  };

  return (
    <div className="space-y-6">
      {/* Workspace Telemetry Bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                isConnected
                  ? 'bg-emerald-600'
                  : isConnecting
                  ? 'bg-amber-500'
                  : 'bg-slate-300'
              }`}
              aria-hidden="true"
            />
            <span className="font-medium text-slate-900">
              {isConnected
                ? isAgentSpeaking
                  ? 'BolKhata Speaking'
                  : textOnlyMode
                  ? 'Counter Connected (Text + Speaker Mode)'
                  : isMuted
                  ? 'Counter Connected (Mic Muted)'
                  : 'Counter Listening (Hinglish)'
                : isConnecting
                ? 'Connecting Audio Channel...'
                : 'Voice Channel Standby'}
            </span>
          </div>

          <span className="text-slate-300" aria-hidden="true">
            /
          </span>

          <div className="flex items-center gap-2 text-slate-600">
            <span>Last Response Latency:</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {latencyMs !== null ? `${latencyMs} ms` : '—'}
            </span>
          </div>

          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>

          <div className="flex items-center gap-2 text-slate-600">
            <span>Session Avg:</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {avgLatencyMs !== null ? `${avgLatencyMs} ms` : '—'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span>
            Pending Approvals:{' '}
            <strong
              className={`font-mono tabular-nums ${
                pendingApprovals.length > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {pendingApprovals.length}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Low Stock Alerts:{' '}
            <strong
              className={`font-mono tabular-nums ${
                lowStockItems.length > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {lowStockItems.length}
            </strong>
          </span>
        </div>
      </div>

      {/* Main 2-Column Operations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Live Voice Console + HITL Approvals */}
        <div className="lg:col-span-7 space-y-6">
          {/* Voice Counter Card */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  01. Live Counter Voice Agent
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Gemini Native Audio · 16kHz PCM Mic Capture · Instant Barge-In Support
                </p>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                {isConnected && (
                  <>
                    {!textOnlyMode && (
                      <button
                        type="button"
                        onClick={() => setIsMuted(!isMuted)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                          isMuted
                            ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                        {isMuted ? 'Unmute Mic' : 'Mute Mic'}
                      </button>
                    )}

                    {isAgentSpeaking && (
                      <button
                        type="button"
                        onClick={onFlushPlayback}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        Interrupt
                      </button>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={isConnected ? onStopVoice : onStartVoice}
                  disabled={isConnecting}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    isConnected
                      ? 'bg-red-700 text-white hover:bg-red-800'
                      : 'bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60'
                  }`}
                >
                  {isConnected ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  {isConnecting
                    ? 'Connecting...'
                    : isConnected
                    ? 'Stop Session'
                    : 'Start Counter Voice'}
                </button>
              </div>
            </div>

            {voiceError && (
              <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
                  <span>{voiceError}</span>
                </div>
                {(voiceError.includes('/ws/live') || voiceError.includes('WebSocket')) && (
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    <Server className="w-3.5 h-3.5 text-red-700 shrink-0" />
                    <input
                      type="url"
                      value={backendUrlInput}
                      onChange={(e) => setBackendUrlInput(e.target.value)}
                      placeholder="https://your-cloud-run-backend.run.app"
                      className="flex-1 min-w-[220px] px-2.5 py-1.5 text-xs font-mono bg-white border border-red-200 rounded-md text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={handleSaveBackendUrl}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap"
                    >
                      {backendUrlSaved ? 'Saved' : 'Save Backend URL'}
                    </button>
                  </div>
                )}
                {(micUnavailable || audioInputs.length > 0) && !isConnected && (
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    {audioInputs.length > 0 && onSelectMicId && (
                      <select
                        value={selectedMicId}
                        onChange={(e) => onSelectMicId(e.target.value)}
                        className="px-2.5 py-1.5 text-xs bg-white border border-red-200 rounded-md text-slate-800"
                      >
                        <option value="">Auto-detect Microphone</option>
                        {audioInputs.map((dev) => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {onStartTextOnlyVoice && (
                      <button
                        type="button"
                        onClick={onStartTextOnlyVoice}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        Use Text + Voice Output
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
              <VoiceWaveform
                isConnected={isConnected}
                isMuted={isMuted}
                micLevel={micLevel}
                isAgentSpeaking={isAgentSpeaking}
              />
            </div>

            {/* Persistent Scrollable Voice Transcript Feed with Quick Action Context Menu */}
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
              <div className="px-4 py-2 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  Recent Voice Command Transcripts
                </span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  Click item/amount or Quick Action · {persistedTranscripts.length} saved
                </span>
              </div>

              <div className="h-80 overflow-y-auto p-4 space-y-3">
                {combinedTranscripts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-4">
                    <p className="text-sm font-medium text-slate-700">
                      Counter Voice Transcript Ready
                    </p>
                    <p className="text-xs text-slate-500 mt-1 max-w-md">
                      Click Start Counter Voice and speak naturally in Hinglish — e.g.
                      &ldquo;Sharma General Store ke khate mein 15 bori Basmati chawal udhaar likh do.&rdquo;
                    </p>
                  </div>
                ) : (
                  combinedTranscripts.map((msg) => {
                    const detected =
                      msg.role !== 'system'
                        ? detectMessageEntities(msg.text, inventory, customers)
                        : null;
                    const menuOpen = quickMenuMsgId === msg.id;

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${
                          msg.role === 'user'
                            ? 'items-end'
                            : msg.role === 'system'
                            ? 'items-center'
                            : 'items-start'
                        }`}
                      >
                        {msg.role === 'system' ? (
                          <span className="text-[11px] font-mono text-slate-500 py-1 tabular-nums">
                            [{msg.timeLabel}] {msg.text}
                          </span>
                        ) : (
                          <div
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openQuickAction(msg.id, {
                                tab: detected?.firstAmount ? 'correct' : 'lookup',
                                customerQuery: detected?.firstCustomer || '',
                                itemQuery: detected?.firstItem || '',
                                correctionValue: detected?.firstAmount || '',
                              });
                            }}
                            className={`max-w-[90%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                              msg.role === 'user'
                                ? 'bg-blue-700 text-white'
                                : 'bg-white border border-slate-200 text-slate-900'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-4 text-[11px] opacity-85 mb-1">
                              <span className="font-medium">
                                {msg.role === 'user' ? 'Counter Operator' : 'BolKhata Agent'}
                                {msg.isLiveStreaming ? ' (live)' : ''}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono tabular-nums">{msg.timeLabel}</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    menuOpen
                                      ? setQuickMenuMsgId(null)
                                      : openQuickAction(msg.id, {
                                          tab: detected?.firstAmount ? 'correct' : 'lookup',
                                          customerQuery: detected?.firstCustomer || '',
                                          itemQuery: detected?.firstItem || '',
                                          correctionValue: detected?.firstAmount || '',
                                        })
                                  }
                                  title="Open Quick Action menu"
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                    msg.role === 'user'
                                      ? 'bg-blue-800/70 text-white hover:bg-blue-900'
                                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                  }`}
                                >
                                  <MoreHorizontal className="w-3 h-3" />
                                  Quick Action
                                </button>
                              </div>
                            </div>

                            <p>
                              {detected
                                ? detected.segments.map((seg, idx) =>
                                    seg.token ? (
                                      <button
                                        key={idx}
                                        type="button"
                                        title={
                                          seg.token.kind === 'amount'
                                            ? 'Click to correct amount or update UPI QR'
                                            : 'Click to re-run Khata / Stock lookup'
                                        }
                                        onClick={() => {
                                          if (seg.token?.kind === 'amount') {
                                            openQuickAction(msg.id, {
                                              tab: 'correct',
                                              customerQuery: detected.firstCustomer,
                                              itemQuery: detected.firstItem,
                                              correctionValue:
                                                seg.token.numericValue || seg.token.text,
                                            });
                                          } else if (seg.token?.kind === 'item') {
                                            openQuickAction(msg.id, {
                                              tab: 'lookup',
                                              customerQuery: detected.firstCustomer,
                                              itemQuery: seg.token.text,
                                              correctionValue: detected.firstAmount,
                                            });
                                          } else if (seg.token?.kind === 'customer') {
                                            openQuickAction(msg.id, {
                                              tab: 'lookup',
                                              customerQuery: seg.token.text,
                                              itemQuery: detected.firstItem,
                                              correctionValue: detected.firstAmount,
                                            });
                                          }
                                        }}
                                        className={`underline decoration-dotted underline-offset-2 font-semibold cursor-pointer rounded px-0.5 transition-colors ${
                                          msg.role === 'user'
                                            ? 'hover:bg-blue-600 text-white'
                                            : 'hover:bg-blue-50 text-blue-800'
                                        }`}
                                      >
                                        {seg.text}
                                      </button>
                                    ) : (
                                      <React.Fragment key={idx}>{seg.text}</React.Fragment>
                                    )
                                  )
                                : msg.text}
                            </p>

                            {/* Inline Quick Action Context Menu */}
                            {menuOpen && (
                              <div className="mt-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 space-y-2.5 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setQuickActionTab('lookup')}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium ${
                                        quickActionTab === 'lookup'
                                          ? 'bg-slate-900 text-white'
                                          : 'bg-white border border-slate-200 text-slate-700'
                                      }`}
                                    >
                                      <Search className="w-3 h-3" />
                                      Re-run Lookup
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setQuickActionTab('correct')}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium ${
                                        quickActionTab === 'correct'
                                          ? 'bg-slate-900 text-white'
                                          : 'bg-white border border-slate-200 text-slate-700'
                                      }`}
                                    >
                                      <Edit3 className="w-3 h-3" />
                                      Correct Amount/Qty
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setQuickMenuMsgId(null)}
                                    className="p-1 text-slate-500 hover:text-slate-800"
                                    aria-label="Close Quick Action menu"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {quickActionTab === 'lookup' ? (
                                  <div className="space-y-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <input
                                        type="text"
                                        value={quickCustomerQuery}
                                        onChange={(e) => setQuickCustomerQuery(e.target.value)}
                                        placeholder="Customer name (optional)"
                                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs"
                                      />
                                      <input
                                        type="text"
                                        value={quickItemQuery}
                                        onChange={(e) => setQuickItemQuery(e.target.value)}
                                        placeholder="Item / Hinglish alias"
                                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs"
                                      />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        disabled={
                                          quickLookupBusy ||
                                          (!quickCustomerQuery.trim() && !quickItemQuery.trim())
                                        }
                                        onClick={handleRunQuickLookup}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-blue-700 rounded hover:bg-blue-800 disabled:opacity-40"
                                      >
                                        <Search className="w-3 h-3" />
                                        {quickLookupBusy ? 'Checking...' : 'Run Lookup Now'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCommandInput(msg.text);
                                          setQuickMenuMsgId(null);
                                        }}
                                        className="px-2.5 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                      >
                                        Draft in Input
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <input
                                        type="text"
                                        value={quickCorrectionValue}
                                        onChange={(e) => setQuickCorrectionValue(e.target.value)}
                                        placeholder="Corrected amount or qty (e.g. 20 bori or 18000)"
                                        className="flex-1 min-w-[180px] px-2.5 py-1.5 bg-white border border-slate-200 rounded font-mono text-xs"
                                      />
                                      <button
                                        type="button"
                                        disabled={!quickCorrectionValue.trim()}
                                        onClick={handleSendQuickCorrection}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-blue-700 rounded hover:bg-blue-800 disabled:opacity-40"
                                      >
                                        <Send className="w-3 h-3" />
                                        Send Correction
                                      </button>
                                      {Number(quickCorrectionValue.replace(/[^\d.]/g, '')) > 0 && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const amt = quickCorrectionValue.replace(/[^\d.]/g, '');
                                            setQrAmount(amt);
                                            setQrStageLabel('TRANSCRIPT BILL');
                                            setQuickLookupSummary(
                                              `Updated UPI QR amount to ₹${Number(amt).toLocaleString(
                                                'en-IN'
                                              )}.`
                                            );
                                          }}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                                        >
                                          <QrCode className="w-3 h-3" />
                                          Set UPI QR
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {quickLookupSummary && (
                                  <div className="p-2 rounded bg-white border border-slate-200 font-mono text-[11px] text-slate-800">
                                    {quickLookupSummary}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>

            {/* Hybrid Hinglish Command Input + Quick Demo Prompts */}
            <div className="space-y-3 pt-1">
              <form onSubmit={handleSubmitCommand} className="flex items-center gap-2">
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  disabled={!isConnected}
                  placeholder={
                    isConnected
                      ? 'Optional typed Hinglish command or correction...'
                      : 'Start Counter Voice to enable live voice & hybrid commands'
                  }
                  className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-700 disabled:bg-slate-50"
                />
                <button
                  type="submit"
                  disabled={!isConnected || !commandInput.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </button>
              </form>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500 mr-1">Demo Turns:</span>
                {DEMO_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={!isConnected}
                    onClick={() => onSendTextTurn(prompt)}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors text-left truncate max-w-[260px]"
                    title={prompt}
                  >
                    Turn {idx + 1}: {prompt}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Human-in-the-Loop (HITL) Manager Approval Panel */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  02. Owner Approval Queue (HITL)
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Live Firestore sync · Credit limit breaches and orders above ₹50,000 pause here
                </p>
              </div>
              <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
                {pendingApprovals.length} pending
              </span>
            </div>

            {pendingApprovals.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-lg p-5 text-center">
                <p className="text-sm font-medium text-slate-700">No pending policy overrides</p>
                <p className="text-xs text-slate-500 mt-1">
                  High-value orders or credit-limit breaches triggered by voice appear here in real time.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.map((apr) => {
                  const busy = resolvingId === apr.id;
                  return (
                    <div
                      key={apr.id}
                      className="border border-amber-300 bg-amber-50/60 rounded-lg p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                            <ShieldAlert className="w-4 h-4 text-amber-700" />
                            <span>OWNER OVERRIDE REQUIRED</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{apr.approval_id}</span>
                          </div>
                          <h3 className="text-base font-semibold text-slate-900">
                            {apr.customer_name} — {apr.qty} {apr.unit} {apr.item_name}
                          </h3>
                          <p className="text-xs text-slate-700">{apr.reason}</p>
                        </div>

                        <div className="text-right">
                          <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                            {formatInr(apr.total_amount)}
                          </div>
                          <div className="text-xs text-slate-500">{apr.tx_type}</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2.5 pt-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onResolveApproval(apr, 'REJECTED')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onResolveApproval(apr, 'APPROVED')}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {busy ? 'Executing...' : 'Approve & Execute'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Agent Execution Trace + Recent Counter Ledger & Stock Watch */}
        <div className="lg:col-span-5 space-y-6">
          {/* Real-Time Agent Execution Trace */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  03. Agent Execution Trace
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Real-time tool orchestration and policy steps
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {traces.length} events
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto pr-1 space-y-3">
              {traces.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  Start a voice turn to watch live tool calls, policy checks, and ledger commits here.
                </p>
              ) : (
                traces.slice(0, 14).map((trace) => {
                  const tone =
                    trace.step_type === 'HITL_PAUSE'
                      ? 'text-amber-800 border-amber-200 bg-amber-50/40'
                      : trace.step_type === 'ERROR'
                      ? 'text-red-800 border-red-200 bg-red-50/40'
                      : trace.step_type === 'EXECUTED' || trace.step_type === 'RESTOCK'
                      ? 'text-emerald-800 border-emerald-200 bg-emerald-50/40'
                      : trace.step_type === 'UNDO'
                      ? 'text-slate-800 border-slate-300 bg-slate-100/70'
                      : 'text-slate-800 border-slate-200 bg-white';

                  return (
                    <div
                      key={trace.id}
                      className={`border rounded-lg px-3.5 py-2.5 space-y-1 ${tone}`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                        <span className="truncate">{trace.title}</span>
                        {trace.latency_ms > 0 && (
                          <span className="font-mono text-[11px] tabular-nums shrink-0">
                            {trace.latency_ms} ms
                          </span>
                        )}
                      </div>
                      <p className="text-xs opacity-85 leading-snug">{trace.detail}</p>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Recent Counter Transactions & Quick Undo */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  04. Live Counter Ledger
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Atomic Khata writes with instant voice or manual rollback
                </p>
              </div>
              <button
                type="button"
                disabled={completedTxs.length === 0 || undoBusy}
                onClick={onManualUndo}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {undoBusy ? 'Undoing...' : 'Undo Last'}
              </button>
            </div>

            {transactions.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No transactions logged yet in this counter session.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {transactions.slice(0, 5).map((tx) => (
                  <div
                    key={tx.id}
                    className={`py-2.5 flex items-center justify-between gap-3 ${
                      tx.status === 'UNDONE' ? 'opacity-50 line-through' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {tx.customer_name}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {tx.qty > 0 ? `${tx.qty} ${tx.unit} ${tx.item_name}` : tx.item_name}{' '}
                        <span aria-hidden="true">·</span> {tx.type}{' '}
                        <span aria-hidden="true">·</span> {tx.status}
                      </div>
                    </div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                      {formatInr(tx.total_amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Low Stock Watchlist */}
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Stock Threshold Watch</span>
                <span className="font-mono text-slate-500 tabular-nums">
                  {inventory.length} SKUs
                </span>
              </div>
              <div className="space-y-1.5">
                {inventory.slice(0, 4).map((item) => {
                  const isLow = item.stock_qty < item.reorder_threshold;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between text-xs py-1"
                    >
                      <span className="text-slate-700 truncate pr-2">{item.name}</span>
                      <span
                        className={`font-mono font-semibold tabular-nums shrink-0 inline-flex items-center gap-1 ${
                          isLow ? 'text-amber-700' : 'text-slate-900'
                        }`}
                      >
                        {isLow && <AlertTriangle className="w-3 h-3" />}
                        {item.stock_qty} {item.unit}
                      </span>
                    </div>
                  );
                })}
              </div>
              {lowStockItems.length === 0 && (
                <div className="text-xs text-emerald-700 flex items-center gap-1.5 pt-1">
                  <PackageCheck className="w-3.5 h-3.5" />
                  All SKUs above reorder threshold.
                </div>
              )}
            </div>
          </section>

          {/* Dynamic UPI Payment QR Generator (Synced to Voice Read-Back) */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 inline-flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-blue-700" />
                  05. Dynamic UPI Payment QR
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Auto-updates from voice transaction read-back · Scan via GPay, PhonePe, Paytm
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUpi(!editingUpi)}
                className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
              >
                {editingUpi ? 'Close VPA' : 'Edit UPI ID'}
              </button>
            </div>

            {editingUpi && (
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Merchant UPI VPA
                    </label>
                    <input
                      type="text"
                      value={upiVpa}
                      onChange={(e) => setUpiVpa(e.target.value)}
                      placeholder="shopname@okaxis"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Store Payee Name
                    </label>
                    <input
                      type="text"
                      value={merchantName}
                      onChange={(e) => setMerchantName(e.target.value)}
                      placeholder="BolKhata Wholesale"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-700"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveUpiSettings}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
                  >
                    Save Merchant UPI
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <div className="p-3 bg-white border border-slate-200 rounded-xl shrink-0">
                <QRCodeSVG
                  value={upiUri}
                  size={148}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#0f172a"
                />
              </div>

              <div className="flex-1 w-full space-y-3 min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span
                    className={`font-mono font-semibold ${
                      qrStageLabel === 'READBACK'
                        ? 'text-blue-700'
                        : qrStageLabel === 'PENDING_APPROVAL'
                        ? 'text-amber-700'
                        : qrStageLabel === 'CONFIRMED'
                        ? 'text-emerald-700'
                        : 'text-slate-600'
                    }`}
                  >
                    {qrStageLabel.replace('_', ' ')}
                  </span>
                  <span className="font-mono text-slate-500 truncate">{cleanVpa}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Customer Khata
                    </label>
                    <select
                      value={qrCustomerId}
                      onChange={(e) => {
                        const cid = e.target.value;
                        setQrCustomerId(cid);
                        setQrStageLabel('MANUAL BILL');
                        setQrPaidNotice(null);
                        const cust = customers.find((c) => c.id === cid);
                        if (cust && !qrAmount && cust.current_udhaar_balance > 0) {
                          setQrAmount(String(cust.current_udhaar_balance));
                          setQrNote(`${cust.name} - Udhaar Settlement`);
                        }
                      }}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-blue-700"
                    >
                      <option value="">Walk-in / Cash Customer</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Bill Amount (INR)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={qrAmount}
                      onChange={(e) => {
                        setQrAmount(e.target.value);
                        setQrStageLabel('CUSTOM AMOUNT');
                        setQrPaidNotice(null);
                      }}
                      placeholder="0"
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-semibold bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-blue-700 tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    UPI Payment Note
                  </label>
                  <input
                    type="text"
                    value={qrNote}
                    onChange={(e) => setQrNote(e.target.value)}
                    placeholder="Order reference or item details"
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyUpiUri}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    {qrCopied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                    {qrCopied ? 'UPI Link Copied' : 'Copy UPI Link'}
                  </button>

                  {selectedQrCustomer && parsedQrAmount > 0 && (
                    <button
                      type="button"
                      disabled={qrPayingBusy}
                      onClick={handleMarkUpiPaid}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {qrPayingBusy
                        ? 'Logging Jama...'
                        : `Mark ${formatInr(parsedQrAmount)} Paid`}
                    </button>
                  )}
                </div>

                {qrPaidNotice && (
                  <p className="text-xs font-medium text-emerald-700">{qrPaidNotice}</p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
