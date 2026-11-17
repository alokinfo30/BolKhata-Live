import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Timestamp } from 'firebase/firestore';
import type {
  AgentTraceItem,
  ApprovalRequest,
  LatencySamplePoint,
  LedgerTransaction,
} from '../types';

interface PerformanceViewProps {
  transactions: LedgerTransaction[];
  approvals: ApprovalRequest[];
  traces: AgentTraceItem[];
  latencyHistory: LatencySamplePoint[];
  avgLatencyMs: number | null;
}

function getMillis(ts: unknown): number {
  if (
    ts &&
    typeof ts === 'object' &&
    'toMillis' in ts &&
    typeof (ts as Timestamp).toMillis === 'function'
  ) {
    return (ts as Timestamp).toMillis();
  }
  return 0;
}

function formatInr(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatShortTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-IN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const PerformanceView: React.FC<PerformanceViewProps> = ({
  transactions,
  approvals,
  traces,
  latencyHistory,
  avgLatencyMs,
}) => {
  const metrics = useMemo(() => {
    const completed = transactions.filter((t) => t.status === 'COMPLETED');
    const undone = transactions.filter((t) => t.status === 'UNDONE');
    const humanApprovedTxs = completed.filter((t) => t.note?.startsWith('Owner Override'));
    const autonomousTxs = completed.filter((t) => !t.note?.startsWith('Owner Override'));

    const approvedHitlCount = Math.max(
      humanApprovedTxs.length,
      approvals.filter((a) => a.status === 'APPROVED').length
    );
    const pendingHitlCount = approvals.filter((a) => a.status === 'PENDING').length;
    const rejectedHitlCount = approvals.filter((a) => a.status === 'REJECTED').length;

    const totalVolumeInr = completed.reduce((sum, t) => sum + (t.total_amount || 0), 0);
    const autonomousVolumeInr = autonomousTxs.reduce((sum, t) => sum + (t.total_amount || 0), 0);
    const hitlGuardedInr = approvals.reduce((sum, a) => sum + (a.total_amount || 0), 0);

    // Combine persisted trace latencies and live session voice latencies chronologically
    const traceSamples = traces
      .filter((tr) => typeof tr.latency_ms === 'number' && tr.latency_ms > 0)
      .map((tr) => {
        const ms = getMillis(tr.createdAt);
        return {
          timestamp: ms,
          timeLabel: formatShortTime(ms),
          latencyMs: tr.latency_ms,
          source: 'Tool' as const,
          label: tr.title,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    const liveVoiceSamples = latencyHistory.map((pt) => ({
      timestamp: pt.timestamp,
      timeLabel: pt.timeLabel,
      latencyMs: pt.latencyMs,
      source: pt.source,
      label: 'Voice Turn',
    }));

    const mergedLatency = [...traceSamples, ...liveVoiceSamples]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-30);

    let runningSum = 0;
    const latencyChartData = mergedLatency.map((item, idx) => {
      runningSum += item.latencyMs;
      return {
        ...item,
        indexLabel: item.timeLabel !== '—' ? item.timeLabel : `#${idx + 1}`,
        rollingAvgMs: Math.round(runningSum / (idx + 1)),
      };
    });

    const overallAvgLatency =
      avgLatencyMs !== null
        ? avgLatencyMs
        : latencyChartData.length > 0
        ? Math.round(
            latencyChartData.reduce((s, d) => s + d.latencyMs, 0) / latencyChartData.length
          )
        : null;

    const p95Latency =
      latencyChartData.length > 0
        ? [...latencyChartData].sort((a, b) => a.latencyMs - b.latencyMs)[
            Math.min(latencyChartData.length - 1, Math.floor(latencyChartData.length * 0.95))
          ].latencyMs
        : null;

    // Outcome breakdown bar chart data
    const outcomeChartData = [
      {
        category: 'Autonomous',
        count: autonomousTxs.length,
        volumeInr: autonomousVolumeInr,
        color: '#1d4ed8',
      },
      {
        category: 'Human-Approved',
        count: approvedHitlCount,
        volumeInr: humanApprovedTxs.reduce((s, t) => s + (t.total_amount || 0), 0),
        color: '#047857',
      },
      {
        category: 'Pending HITL',
        count: pendingHitlCount,
        volumeInr: approvals
          .filter((a) => a.status === 'PENDING')
          .reduce((s, a) => s + (a.total_amount || 0), 0),
        color: '#b45309',
      },
      {
        category: 'Rejected',
        count: rejectedHitlCount,
        volumeInr: approvals
          .filter((a) => a.status === 'REJECTED')
          .reduce((s, a) => s + (a.total_amount || 0), 0),
        color: '#b91c1c',
      },
      {
        category: 'Voice Undone',
        count: undone.length,
        volumeInr: undone.reduce((s, t) => s + (t.total_amount || 0), 0),
        color: '#475569',
      },
    ];

    // Chronological transaction throughput (last 16 transactions)
    const txChronological = [...transactions]
      .sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt))
      .slice(-16)
      .map((tx, idx) => {
        const isHitl = Boolean(tx.note?.startsWith('Owner Override'));
        const ms = getMillis(tx.createdAt);
        return {
          label: ms ? formatShortTime(ms).slice(0, 5) : `TX-${idx + 1}`,
          customer: tx.customer_name,
          autonomousInr: tx.status === 'COMPLETED' && !isHitl ? tx.total_amount : 0,
          humanApprovedInr: tx.status === 'COMPLETED' && isHitl ? tx.total_amount : 0,
          undoneInr: tx.status === 'UNDONE' ? tx.total_amount : 0,
          totalInr: tx.total_amount,
        };
      });

    const totalProcessed = transactions.length;
    const autonomousSharePct =
      completed.length > 0 ? Math.round((autonomousTxs.length / completed.length) * 100) : 0;

    // Conservative Indian wholesale counter ROI unit economics
    const timeSavedMins = Number((completed.length * 1.8).toFixed(1));
    const laborValueSavedInr = completed.length * 42;
    const estAiCostInr = Number((completed.length * 0.6).toFixed(2));
    const netSavingsInr = Math.max(0, Math.round(laborValueSavedInr - estAiCostInr));

    return {
      totalProcessed,
      completedCount: completed.length,
      autonomousCount: autonomousTxs.length,
      approvedHitlCount,
      pendingHitlCount,
      rejectedHitlCount,
      undoneCount: undone.length,
      totalVolumeInr,
      hitlGuardedInr,
      autonomousSharePct,
      overallAvgLatency,
      p95Latency,
      latencySampleCount: latencyChartData.length,
      latencyChartData,
      outcomeChartData,
      txChronological,
      timeSavedMins,
      laborValueSavedInr,
      estAiCostInr,
      netSavingsInr,
    };
  }, [approvals, avgLatencyMs, latencyHistory, traces, transactions]);

  return (
    <div className="space-y-6">
      {/* KPI ROI Header Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-slate-500">Avg Response Latency</div>
          <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.overallAvgLatency !== null ? `${metrics.overallAvgLatency} ms` : '—'}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {metrics.p95Latency !== null
              ? `P95: ${metrics.p95Latency} ms · ${metrics.latencySampleCount} samples`
              : 'Start a voice turn to capture live telemetry'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-slate-500">Total Transactions Processed</div>
          <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.totalProcessed}
          </div>
          <div className="text-xs text-slate-500">
            {metrics.completedCount} completed · {formatInr(metrics.totalVolumeInr)} billed
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-slate-500">Autonomous vs Human-Approved</div>
          <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.autonomousCount}{' '}
            <span className="text-slate-400 text-lg font-normal">/</span>{' '}
            <span className="text-emerald-700">{metrics.approvedHitlCount}</span>
          </div>
          <div className="text-xs text-slate-500">
            {metrics.autonomousSharePct}% autonomous straight-through rate
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-slate-500">Net Operational ROI</div>
          <div className="font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {formatInr(metrics.netSavingsInr)}
          </div>
          <div className="text-xs text-slate-500">
            {metrics.timeSavedMins} min saved · {formatInr(metrics.hitlGuardedInr)} HITL guarded
          </div>
        </div>
      </div>

      {/* Primary Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Latency Over Time (Area + Rolling Average Line) */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Response Latency Over Time
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Voice turn &amp; Firestore tool execution latency (ms) with rolling average trendline
              </p>
            </div>
            <div className="text-xs font-mono text-slate-600 tabular-nums">
              {metrics.overallAvgLatency !== null
                ? `Mean ${metrics.overallAvgLatency} ms`
                : 'Awaiting samples'}
            </div>
          </div>

          {metrics.latencyChartData.length === 0 ? (
            <div className="h-72 border border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center text-center px-6">
              <p className="text-sm font-medium text-slate-700">No latency telemetry recorded yet</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                Run a Hinglish voice command in the Counter tab to plot live end-to-end audio and
                tool latency samples here.
              </p>
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={metrics.latencyChartData}
                  margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1d4ed8" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="indexLabel"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    unit=" ms"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    width={62}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#e2e8f0',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(value: unknown, name: unknown) => [
                      `${value} ms`,
                      name === 'latencyMs' ? 'Turn Latency' : 'Rolling Average',
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '12px' }}
                    formatter={(val) =>
                      val === 'latencyMs' ? 'Measured Latency (ms)' : 'Rolling Avg (ms)'
                    }
                  />
                  {metrics.overallAvgLatency !== null && (
                    <ReferenceLine
                      y={metrics.overallAvgLatency}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="latencyMs"
                    stroke="#1d4ed8"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#latencyFill)"
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rollingAvgMs"
                    stroke="#047857"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Successful Autonomous vs Human-Approved Transactions Breakdown */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Autonomous vs. Human-Approved Mix
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Live count of straight-through executions, HITL overrides, and rollbacks
            </p>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={metrics.outcomeChartData}
                margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value: unknown, _name: unknown, item: { payload?: { volumeInr?: number } }) => [
                    `${value} tx (${formatInr(item?.payload?.volumeInr ?? 0)})`,
                    'Transactions',
                  ]}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {metrics.outcomeChartData.map((entry) => (
                    <Cell key={entry.category} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Transaction Throughput & ROI Accounting Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Transaction Value Stream (Autonomous vs. HITL)
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Chronological INR volume across recent counter transactions
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              Last {metrics.txChronological.length} entries
            </span>
          </div>

          {metrics.txChronological.length === 0 ? (
            <div className="h-64 border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-xs text-slate-500">
              No transactions recorded yet in Firestore.
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={metrics.txChronological}
                  margin={{ top: 10, right: 12, left: 6, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `₹${Math.round(Number(v) / 1000)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#e2e8f0',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(value: unknown, name: unknown) => [
                      formatInr(Number(value)),
                      name === 'autonomousInr'
                        ? 'Autonomous'
                        : name === 'humanApprovedInr'
                        ? 'Human-Approved'
                        : 'Undone',
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '12px' }}
                    formatter={(val) =>
                      val === 'autonomousInr'
                        ? 'Autonomous'
                        : val === 'humanApprovedInr'
                        ? 'Human-Approved (HITL)'
                        : 'Voice Undone'
                    }
                  />
                  <Bar
                    dataKey="autonomousInr"
                    stackId="tx"
                    fill="#1d4ed8"
                    radius={[0, 0, 0, 0]}
                    maxBarSize={36}
                  />
                  <Bar
                    dataKey="humanApprovedInr"
                    stackId="tx"
                    fill="#047857"
                    radius={[0, 0, 0, 0]}
                    maxBarSize={36}
                  />
                  <Bar
                    dataKey="undoneInr"
                    stackId="tx"
                    fill="#94a3b8"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Agent ROI & Unit Economics Ledger */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Counter ROI &amp; Risk Guardrails
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Real-time unit economics computed from live ledger &amp; approval outcomes
            </p>
          </div>

          <div className="divide-y divide-slate-100 text-sm">
            <div className="py-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-slate-900">Autonomous Counter Throughput</div>
                <div className="text-xs text-slate-500">
                  Zero manual keyboard entry required
                </div>
              </div>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {metrics.autonomousCount} tx
              </span>
            </div>

            <div className="py-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-slate-900">HITL Policy Interventions</div>
                <div className="text-xs text-slate-500">
                  {metrics.approvedHitlCount} approved · {metrics.rejectedHitlCount} rejected ·{' '}
                  {metrics.pendingHitlCount} waiting
                </div>
              </div>
              <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                {formatInr(metrics.hitlGuardedInr)}
              </span>
            </div>

            <div className="py-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-slate-900">Manual Billing Time Saved</div>
                <div className="text-xs text-slate-500">
                  ~1.8 min saved per voice-logged parchi/khata entry
                </div>
              </div>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {metrics.timeSavedMins} min
              </span>
            </div>

            <div className="py-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-slate-900">Gross Labor Value vs. AI Compute</div>
                <div className="text-xs text-slate-500">
                  ₹42/tx clerk value vs. ~₹0.60/tx Gemini Live cost
                </div>
              </div>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatInr(metrics.laborValueSavedInr)} / ₹{metrics.estAiCostInr}
              </span>
            </div>

            <div className="pt-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-slate-900">Net Counter ROI Value</div>
                <div className="text-xs text-slate-500">
                  {metrics.undoneCount} voice-undone entries safely rolled back
                </div>
              </div>
              <span className="font-mono text-lg font-bold text-emerald-700 tabular-nums">
                +{formatInr(metrics.netSavingsInr)}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
