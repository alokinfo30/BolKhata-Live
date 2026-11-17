import React, { useState } from 'react';
import { Copy, Check, MessageSquare, Sparkles, Star } from 'lucide-react';
import { getApiUrl } from '../services/backendConfig';
import type {
  AgentTraceItem,
  ApprovalRequest,
  Customer,
  InsightsReport,
  InventoryItem,
  LedgerTransaction,
  RestockOrder,
  SentimentLog,
} from '../types';

interface InsightsAuditViewProps {
  customers: Customer[];
  inventory: InventoryItem[];
  transactions: LedgerTransaction[];
  approvals: ApprovalRequest[];
  restocks: RestockOrder[];
  traces: AgentTraceItem[];
  sentimentLogs: SentimentLog[];
  avgLatencyMs: number | null;
  onSubmitSentiment: (rating: number, comment: string) => Promise<void>;
}

function formatInr(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

export const InsightsAuditView: React.FC<InsightsAuditViewProps> = ({
  customers,
  inventory,
  transactions,
  approvals,
  restocks,
  traces,
  sentimentLogs,
  avgLatencyMs,
  onSubmitSentiment,
}) => {
  const [report, setReport] = useState<InsightsReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [rating, setRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const completedTxs = transactions.filter((t) => t.status === 'COMPLETED');
  const blockedOrFlagged = approvals.length + traces.filter((t) => t.step_type === 'POLICY_CHECK' && t.detail.includes('exceed')).length;
  const timeSavedMinutes = Math.round(completedTxs.length * 1.8);
  const estSavingsInr = Math.round(completedTxs.length * 42);

  const posCount = sentimentLogs.filter((s) => s.sentiment === 'POSITIVE').length;
  const neuCount = sentimentLogs.filter((s) => s.sentiment === 'NEUTRAL').length;
  const friCount = sentimentLogs.filter((s) => s.sentiment === 'FRICTION').length;

  const handleGenerateInsights = async () => {
    setLoadingReport(true);
    setReportError(null);
    try {
      const res = await fetch(getApiUrl('/api/insights/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customers,
          inventory,
          transactions,
          restocks,
          approvals,
          sentimentLogs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate insights');
      }
      setReport(data as InsightsReport);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Unable to generate insights');
    } finally {
      setLoadingReport(false);
    }
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackComment.trim()) return;
    setSubmittingFeedback(true);
    setFeedbackError(null);
    try {
      await onSubmitSentiment(rating, feedbackComment.trim());
      setFeedbackComment('');
      setRating(5);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Failed to log feedback');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Live Unit Economics & KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-slate-500">Automated Entries</div>
          <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {completedTxs.length}
          </div>
          <div className="text-xs text-slate-500">
            {transactions.filter((t) => t.status === 'UNDONE').length} rolled back via voice undo
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-slate-500">Avg Voice Latency</div>
          <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {avgLatencyMs !== null ? `${avgLatencyMs} ms` : '—'}
          </div>
          <div className="text-xs text-slate-500">Native audio-to-audio WebSocket</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-slate-500">Policy Exceptions Caught</div>
          <div className="font-mono text-2xl font-bold text-amber-700 tabular-nums">
            {blockedOrFlagged}
          </div>
          <div className="text-xs text-slate-500">Credit & high-value HITL safeguards</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-slate-500">Est. Counter Savings</div>
          <div className="font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {formatInr(estSavingsInr)}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            ~{timeSavedMinutes} min manual ledger time saved
          </div>
        </div>
      </div>

      {/* Gemini 4 Hydrogen Structured Multi-Channel Outputs */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Multi-Channel Operations Digest
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Synthesized in real time from live Firestore ledger, stock, and feedback records
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerateInsights}
            disabled={loadingReport}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {loadingReport ? 'Synthesizing Live Data...' : 'Generate Multi-Channel Outputs'}
          </button>
        </div>

        {reportError && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
            {reportError}
          </div>
        )}

        {!report ? (
          <div className="border border-dashed border-slate-200 rounded-lg p-8 text-center">
            <p className="text-sm font-medium text-slate-700">
              Ready to draft WhatsApp payment reminders, supplier POs, and EOD summary
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Click Generate Multi-Channel Outputs to run structured JSON synthesis over your live Firestore counter state.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Card 1: WhatsApp Customer Reminder */}
            <div className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-emerald-700">
                    WhatsApp Udhaar Reminder
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy('whatsapp', report.whatsapp_reminder.message_hinglish)
                    }
                    className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
                  >
                    {copiedKey === 'whatsapp' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedKey === 'whatsapp' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {report.whatsapp_reminder.customer_name} ·{' '}
                  <span className="font-mono text-xs font-normal text-slate-500">
                    {report.whatsapp_reminder.phone}
                  </span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3">
                  {report.whatsapp_reminder.message_hinglish}
                </p>
              </div>
            </div>

            {/* Card 2: English Distributor Purchase Order */}
            <div className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-blue-700">
                    Distributor Purchase Order
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('po', report.distributor_po.body_english)}
                    className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
                  >
                    {copiedKey === 'po' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedKey === 'po' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {report.distributor_po.supplier_name}
                </div>
                <div className="text-xs font-medium text-slate-600">
                  Subject: {report.distributor_po.subject}
                </div>
                <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-line">
                  {report.distributor_po.body_english}
                </p>
              </div>
            </div>

            {/* Card 3: Owner EOD Summary */}
            <div className="border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="text-xs font-semibold text-slate-700">
                Owner End-of-Day Summary
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {report.eod_summary.headline}
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <div className="text-slate-500">Volume</div>
                  <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                    {formatInr(report.eod_summary.total_volume_inr)}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <div className="text-slate-500">Udhaar</div>
                  <div className="font-mono font-semibold text-amber-700 tabular-nums mt-0.5">
                    {formatInr(report.eod_summary.credit_issued_inr)}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <div className="text-slate-500">Jama</div>
                  <div className="font-mono font-semibold text-emerald-700 tabular-nums mt-0.5">
                    {formatInr(report.eod_summary.collections_inr)}
                  </div>
                </div>
              </div>
              {report.eod_summary.risk_alerts.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-xs font-semibold text-red-700">Risk Alerts</div>
                  <ul className="text-xs text-slate-700 space-y-1 list-disc list-inside">
                    {report.eod_summary.risk_alerts.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Real-Time User Feedback & Sentiment Tracker (Turn 5) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Real-Time Counter Operator Sentiment Tracker
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live operator feedback analyzed by Gemini 4 Hydrogen and persisted in Firestore
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
            <span className="text-emerald-700 font-semibold">Positive: {posCount}</span>
            <span className="text-slate-600">Neutral: {neuCount}</span>
            <span className="text-red-700 font-semibold">Friction: {friCount}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Feedback Submission Form */}
          <form
            onSubmit={handleFeedbackSubmit}
            className="lg:col-span-5 border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50/50"
          >
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 block">
                Counter Experience Rating
              </label>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className={`p-1.5 rounded-md border transition-colors ${
                      rating >= star
                        ? 'bg-amber-50 border-amber-300 text-amber-600'
                        : 'bg-white border-slate-200 text-slate-300'
                    }`}
                    aria-label={`Rate ${star} out of 5`}
                  >
                    <Star className="w-4 h-4 fill-current" />
                  </button>
                ))}
                <span className="font-mono text-xs text-slate-600 ml-2 tabular-nums">
                  {rating}/5
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="sentiment-comment"
                className="text-xs font-medium text-slate-700 block"
              >
                Operator Feedback (Hinglish or English)
              </label>
              <textarea
                id="sentiment-comment"
                rows={3}
                required
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                placeholder="e.g. Hinglish interruption aur Basmati bori lookup bahut fast tha, par noisy background mein..."
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-700"
              />
            </div>

            {feedbackError && (
              <div className="text-xs text-red-700">{feedbackError}</div>
            )}

            <button
              type="submit"
              disabled={submittingFeedback || !feedbackComment.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              {submittingFeedback ? 'Analyzing Sentiment...' : 'Submit & Analyze Feedback'}
            </button>
          </form>

          {/* Live Sentiment Stream */}
          <div className="lg:col-span-7 space-y-3">
            {report?.sentiment_digest && (
              <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 text-xs space-y-1">
                <div className="font-semibold text-slate-900">
                  AI Sentiment Digest · Overall: {report.sentiment_digest.overall_mood}
                </div>
                <p className="text-slate-600">
                  Praise: {report.sentiment_digest.top_praise} · Friction:{' '}
                  {report.sentiment_digest.top_friction_point}
                </p>
              </div>
            )}

            {sentimentLogs.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-lg p-8 text-center">
                <p className="text-sm font-medium text-slate-700">No operator feedback logged yet</p>
                <p className="text-xs text-slate-500 mt-1">
                  Submit counter feedback on the left to classify sentiment in real time.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {sentimentLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="p-4 bg-white space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`font-semibold ${
                          log.sentiment === 'POSITIVE'
                            ? 'text-emerald-700'
                            : log.sentiment === 'FRICTION'
                            ? 'text-red-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {log.sentiment} · {log.category}
                      </span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {log.rating}/5 · {log.source}
                      </span>
                    </div>
                    <p className="text-sm text-slate-900">{log.comment}</p>
                    {log.ai_summary && (
                      <p className="text-xs text-slate-500">Summary: {log.ai_summary}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
