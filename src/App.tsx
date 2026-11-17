import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import { AlertTriangle } from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from './firebase';
import {
  executeLedgerAndInventoryTx,
  logAgentTrace,
  logSentimentFeedback,
  resolveApproval,
  seedShopDataIfEmpty,
  undoLastTransaction,
  updateRestockStatus,
} from './services/firestoreOps';
import { useGeminiLiveVoice } from './hooks/useGeminiLiveVoice';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CounterWorkspace } from './components/CounterWorkspace';
import { KhataInventoryView } from './components/KhataInventoryView';
import { ApprovalsHistoryView } from './components/ApprovalsHistoryView';
import { PerformanceView } from './components/PerformanceView';
import { InsightsAuditView } from './components/InsightsAuditView';
import type {
  AgentTraceItem,
  ApprovalRequest,
  Customer,
  InventoryItem,
  LedgerTransaction,
  PersistedVoiceTranscript,
  RestockOrder,
  SentimentLabel,
  SentimentLog,
} from './types';

type ActiveTab = 'counter' | 'khata' | 'approvals' | 'performance' | 'insights';

function getMillis(ts: unknown): number {
  if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as Timestamp).toMillis === 'function') {
    return (ts as Timestamp).toMillis();
  }
  return 0;
}

function sortByCreatedDesc<T extends { createdAt?: unknown }>(items: T[]): T[] {
  return [...items].sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
}

function BolKhataApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [unauthorizedHost, setUnauthorizedHost] = useState<string | null>(null);
  const [offlineWarning, setOfflineWarning] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('counter');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [restocks, setRestocks] = useState<RestockOrder[]>([]);
  const [traces, setTraces] = useState<AgentTraceItem[]>([]);
  const [sentimentLogs, setSentimentLogs] = useState<SentimentLog[]>([]);
  const [persistedTranscripts, setPersistedTranscripts] = useState<PersistedVoiceTranscript[]>([]);

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const prevApprovalStatusesRef = useRef<Map<string, string>>(new Map());
  const locallyHandledApprovalsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    void testFirestoreConnection().then((ok) => {
      if (!ok) setOfflineWarning(true);
    });

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        await seedShopDataIfEmpty(u.uid);
      } else {
        setCustomers([]);
        setInventory([]);
        setTransactions([]);
        setApprovals([]);
        setRestocks([]);
        setTraces([]);
        setSentimentLogs([]);
        setPersistedTranscripts([]);
      }
    });
    return () => unsub();
  }, []);

  const voice = useGeminiLiveVoice({
    ownerId: user?.uid ?? null,
    customers,
    inventory,
  });

  const notifyHitlRef = useRef(voice.notifyHitlResolution);
  notifyHitlRef.current = voice.notifyHitlResolution;

  useEffect(() => {
    if (!authReady || !user) return;
    const uid = user.uid;

    const unsubCust = onSnapshot(
      query(collection(db, 'customers'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Customer, 'id'>),
        }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setCustomers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'customers')
    );

    const unsubInv = onSnapshot(
      query(collection(db, 'inventory'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<InventoryItem, 'id'>),
        }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setInventory(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'inventory')
    );

    const unsubTx = onSnapshot(
      query(collection(db, 'transactions'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<LedgerTransaction, 'id'>),
        }));
        setTransactions(sortByCreatedDesc(list));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
    );

    const unsubApr = onSnapshot(
      query(collection(db, 'approvals'), where('ownerId', '==', uid)),
      (snap) => {
        const list = sortByCreatedDesc(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ApprovalRequest, 'id'>),
          }))
        );

        // Detect cross-tab HITL approval changes
        const prevMap = prevApprovalStatusesRef.current;
        for (const apr of list) {
          const prevStatus = prevMap.get(apr.id);
          if (
            prevStatus === 'PENDING' &&
            (apr.status === 'APPROVED' || apr.status === 'REJECTED') &&
            !locallyHandledApprovalsRef.current.has(apr.id)
          ) {
            notifyHitlRef.current(apr, apr.status);
          }
          prevMap.set(apr.id, apr.status);
        }

        setApprovals(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'approvals')
    );

    const unsubRestocks = onSnapshot(
      query(collection(db, 'restocks'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<RestockOrder, 'id'>),
        }));
        setRestocks(sortByCreatedDesc(list));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'restocks')
    );

    const unsubTraces = onSnapshot(
      query(collection(db, 'agent_traces'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AgentTraceItem, 'id'>),
        }));
        setTraces(sortByCreatedDesc(list));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'agent_traces')
    );

    const unsubSentiment = onSnapshot(
      query(collection(db, 'sentiment_logs'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<SentimentLog, 'id'>),
        }));
        setSentimentLogs(sortByCreatedDesc(list));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'sentiment_logs')
    );

    const unsubTranscripts = onSnapshot(
      query(collection(db, 'voice_transcripts'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PersistedVoiceTranscript, 'id'>),
        }));
        list.sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt));
        setPersistedTranscripts(list.slice(-60));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'voice_transcripts')
    );

    return () => {
      unsubCust();
      unsubInv();
      unsubTx();
      unsubApr();
      unsubRestocks();
      unsubTraces();
      unsubSentiment();
      unsubTranscripts();
    };
  }, [authReady, user]);

  const handleSignIn = async () => {
    if (signingIn) return;
    setAuthError(null);
    setUnauthorizedHost(null);
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code || '')
          : '';
      const message = err instanceof Error ? err.message : 'Google Sign-In failed';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // User dismissed or superseded the sign-in popup; no error banner needed.
      } else if (message.includes('auth/unauthorized-domain') || code === 'auth/unauthorized-domain') {
        const host = window.location.hostname || 'boalkhata.netlify.app';
        setUnauthorizedHost(host);
        setAuthError(
          `Domain "${host}" is not in Firebase Auth Authorized domains yet. Add "${host}" (domain only, without https://) in Firebase Console → Authentication → Settings → Authorized domains for project "numeric-dolphin-bds98".`
        );
      } else {
        setAuthError(message);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    voice.stopSession();
    await signOut(auth);
  };

  const handleResolveApproval = async (
    approval: ApprovalRequest,
    decision: 'APPROVED' | 'REJECTED'
  ) => {
    if (!user) return;
    setResolvingId(approval.id);
    locallyHandledApprovalsRef.current.add(approval.id);
    try {
      const res = await resolveApproval(
        user.uid,
        approval,
        decision,
        user.displayName || user.email || 'Store Owner'
      );
      if (res.ok) {
        await logAgentTrace(
          user.uid,
          'hitl_override',
          decision === 'APPROVED' ? 'EXECUTED' : 'ERROR',
          decision === 'APPROVED'
            ? `Owner Approved -> Ledger Updated${res.restockPo ? ` + ${res.restockPo}` : ''}`
            : `Owner Rejected Override`,
          `${approval.customer_name} · ${approval.qty} ${approval.unit} ${approval.item_name} (₹${approval.total_amount.toLocaleString('en-IN')})`,
          0
        );
        voice.notifyHitlResolution(approval, decision, res.restockPo);
      }
    } finally {
      setResolvingId(null);
    }
  };

  const handleManualUndo = async () => {
    if (!user) return;
    setUndoBusy(true);
    try {
      const res = await undoLastTransaction(user.uid, 'Manual rollback from counter');
      if (res.undone) {
        await logAgentTrace(
          user.uid,
          'manual_undo',
          'UNDO',
          'Counter Entry Rolled Back',
          `Restored ${res.customer_name} balance to ₹${res.restored_balance} and stock to ${res.restored_stock}`,
          0
        );
      }
    } finally {
      setUndoBusy(false);
    }
  };

  const handleRecordJamaPayment = async (customer: Customer, amount: number) => {
    if (!user) return;
    const res = await executeLedgerAndInventoryTx(user.uid, {
      customer_id: customer.id,
      item_sku: 'PAYMENT_JAMA',
      qty: 0,
      total_amount: amount,
      tx_type: 'JAMA',
      user_confirmed: true,
      note: 'Jama collection logged via Khata sheet',
    });
    if (res.executed) {
      await logAgentTrace(
        user.uid,
        'khata_jama',
        'EXECUTED',
        'Jama Payment Recorded',
        `${customer.name} paid ₹${amount.toLocaleString('en-IN')} · New Bal ₹${res.new_balance}`,
        0
      );
    }
  };

  const handleSubmitSentiment = async (rating: number, comment: string) => {
    if (!user) return;
    const res = await fetch('/api/sentiment/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, comment }),
    });
    const data = (await res.json()) as {
      sentiment?: SentimentLabel;
      category?: string;
      ai_summary?: string;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Sentiment classification failed');
    }
    await logSentimentFeedback(user.uid, {
      rating,
      sentiment: data.sentiment || 'POSITIVE',
      category: data.category || 'Counter Operations',
      comment,
      ai_summary: data.ai_summary || '',
      source: 'UI',
    });
  };

  const pendingApprovalsCount = approvals.filter((a) => a.status === 'PENDING').length;
  const lowStockCount = inventory.filter((i) => i.stock_qty < i.reorder_threshold).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-6 py-3.5 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark (Single Text Element) */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('counter');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            BolKhata Live
          </a>

          {/* Zone 2: 4 Clean Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('counter')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'counter'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Counter
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('khata')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'khata'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Khata & Stock
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('approvals')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'approvals'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Approvals{pendingApprovalsCount > 0 ? ` (${pendingApprovalsCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('performance')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'performance'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Performance
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('insights')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'insights'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Insights & Audit
            </button>
          </nav>

          {/* Zone 3: Low-Stock Notification Badge + Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            {user && (
              <button
                type="button"
                onClick={() => {
                  setLowStockOnly(true);
                  setActiveTab('khata');
                }}
                title="Filter Khata & Stock to items below reorder threshold"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  lowStockCount > 0
                    ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Low Stock</span>
                <span className="font-mono tabular-nums">{lowStockCount}</span>
              </button>
            )}

            {user ? (
              <button
                type="button"
                onClick={() => (voice.isConnected ? voice.stopSession() : void voice.startSession())}
                disabled={voice.isConnecting}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  voice.isConnected
                    ? 'bg-red-700 text-white hover:bg-red-800'
                    : 'bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60'
                }`}
              >
                {voice.isConnecting
                  ? 'Connecting...'
                  : voice.isConnected
                  ? 'End Voice'
                  : 'Start Voice'}
              </button>
            ) : (
              <button
                type="button"
                disabled={signingIn}
                onClick={handleSignIn}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              >
                {signingIn ? 'Signing In...' : 'Sign In'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Nav Bar (compact, below header) */}
      {user && (
        <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
          {(
            [
              ['counter', 'Counter'],
              ['khata', 'Khata & Stock'],
              ['approvals', `Approvals (${pendingApprovalsCount})`],
              ['performance', 'Performance'],
              ['insights', 'Insights & Audit'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                activeTab === id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 space-y-6">
        {offlineWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
            Firestore appears offline. Check network connectivity or Firebase project configuration.
          </div>
        )}

        {!authReady ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
            Initializing BolKhata Live counter session...
          </div>
        ) : !user ? (
          <div className="max-w-3xl mx-auto py-12">
            <div className="bg-white border border-slate-200 rounded-xl p-8 md:p-10 space-y-6">
              <div className="space-y-3">
                <p className="text-xs font-medium text-blue-700">
                  Hinglish Native Audio · Live Firestore Khata & Stock
                </p>
                <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 text-balance">
                  Voice-First Wholesale Counter & Udhaar Operations
                </h1>
                <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
                  Manage live customer credit ledgers, godown inventory, credit-limit approvals,
                  and automated distributor restocks using natural Hinglish voice commands with
                  sub-second barge-in support.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="border border-slate-200 rounded-lg p-4 space-y-1">
                  <div className="text-sm font-semibold text-slate-900">
                    Read-Back Safety
                  </div>
                  <p className="text-xs text-slate-600">
                    Confirms customer, bori/peti count, and Rupee amount before every ledger write.
                  </p>
                </div>
                <div className="border border-slate-200 rounded-lg p-4 space-y-1">
                  <div className="text-sm font-semibold text-slate-900">
                    HITL Credit Guard
                  </div>
                  <p className="text-xs text-slate-600">
                    Pauses bills above ₹50,000 or credit breaches for live owner approval.
                  </p>
                </div>
                <div className="border border-slate-200 rounded-lg p-4 space-y-1">
                  <div className="text-sm font-semibold text-slate-900">
                    One-Command Undo
                  </div>
                  <p className="text-xs text-slate-600">
                    Atomic Firestore rollback restores balance and stock on &ldquo;galti ho gayi&rdquo;.
                  </p>
                </div>
              </div>

              {authError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-2">
                  <div>{authError}</div>
                  {unauthorizedHost && (
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <span className="font-mono bg-white px-2 py-0.5 rounded border border-red-200 text-red-900">
                        {unauthorizedHost}
                      </span>
                      <a
                        href="https://console.firebase.google.com/project/numeric-dolphin-bds98/authentication/settings"
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800"
                      >
                        Open Firebase Auth Settings
                      </a>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={signingIn}
                  onClick={handleSignIn}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors"
                >
                  {signingIn ? 'Opening Google Sign-In...' : 'Sign in with Google to Open Counter'}
                </button>
                <span className="text-xs text-slate-500">
                  Authenticated counter data is isolated to your store account.
                </span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Store Account Strip */}
            <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
              <div>
                Store Counter: <strong className="text-slate-800">{user.displayName || user.email}</strong>{' '}
                <span aria-hidden="true">·</span> {customers.length} Khata Accounts{' '}
                <span aria-hidden="true">·</span> {inventory.length} Stock SKUs
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-slate-600 hover:text-slate-900 underline underline-offset-2"
              >
                Sign out
              </button>
            </div>

            {activeTab === 'counter' && (
              <CounterWorkspace
                isConnecting={voice.isConnecting}
                isConnected={voice.isConnected}
                isMuted={voice.isMuted}
                setIsMuted={voice.setIsMuted}
                isAgentSpeaking={voice.isAgentSpeaking}
                micLevel={voice.micLevel}
                latencyMs={voice.latencyMs}
                avgLatencyMs={voice.avgLatencyMs}
                liveTranscripts={voice.liveTranscripts}
                persistedTranscripts={persistedTranscripts}
                voiceError={voice.voiceError}
                micUnavailable={voice.micUnavailable}
                textOnlyMode={voice.textOnlyMode}
                audioInputs={voice.audioInputs}
                selectedMicId={voice.selectedMicId}
                onSelectMicId={voice.setSelectedMicId}
                onStartVoice={() => void voice.startSession()}
                onStartTextOnlyVoice={() => void voice.startSession({ textOnly: true })}
                onStopVoice={voice.stopSession}
                onFlushPlayback={voice.flushPlayback}
                onSendTextTurn={voice.sendTextTurn}
                approvals={approvals}
                onResolveApproval={handleResolveApproval}
                resolvingId={resolvingId}
                traces={traces}
                transactions={transactions}
                inventory={inventory}
                customers={customers}
                activeBillPreview={voice.activeBillPreview}
                onRecordJamaPayment={handleRecordJamaPayment}
                onManualUndo={handleManualUndo}
                undoBusy={undoBusy}
              />
            )}

            {activeTab === 'khata' && (
              <KhataInventoryView
                customers={customers}
                inventory={inventory}
                transactions={transactions}
                restocks={restocks}
                lowStockOnly={lowStockOnly}
                onToggleLowStockOnly={setLowStockOnly}
                onRecordJamaPayment={handleRecordJamaPayment}
                onMarkRestockReceived={async (id) => {
                  await updateRestockStatus(id, 'RECEIVED');
                }}
              />
            )}

            {activeTab === 'approvals' && (
              <ApprovalsHistoryView
                approvals={approvals}
                onResolveApproval={handleResolveApproval}
                resolvingId={resolvingId}
              />
            )}

            {activeTab === 'performance' && (
              <PerformanceView
                transactions={transactions}
                approvals={approvals}
                traces={traces}
                latencyHistory={voice.latencyHistory}
                avgLatencyMs={voice.avgLatencyMs}
              />
            )}

            {activeTab === 'insights' && (
              <InsightsAuditView
                customers={customers}
                inventory={inventory}
                transactions={transactions}
                approvals={approvals}
                restocks={restocks}
                traces={traces}
                sentimentLogs={sentimentLogs}
                avgLatencyMs={voice.avgLatencyMs}
                onSubmitSentiment={handleSubmitSentiment}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BolKhataApp />
    </ErrorBoundary>
  );
}
