import type {
  Customer,
  CustomerComplaint,
  DeliveryRecord,
  InventoryItem,
  LedgerTransaction,
  OperationalReportOrderRow,
  OperationalReportSnapshot,
} from '../types';

export type NormalizedReportPeriod = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'all';

export interface ResolvedTimeframe {
  period: NormalizedReportPeriod;
  periodLabel: string;
  dateRangeLabel: string;
  startMs: number;
  endMs: number;
}

function getTimestampMillis(ts: unknown): number | null {
  if (!ts) return null;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof ts === 'object' && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (typeof ts === 'object' && 'seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
    return (ts as { seconds: number }).seconds * 1000;
  }
  return null;
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function resolveReportTimeframe(rawPeriod?: string, now = new Date()): ResolvedTimeframe {
  const normalized = String(rawPeriod || 'today')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (
    normalized === 'yesterday' ||
    normalized === 'kal' ||
    normalized === 'kal_ka' ||
    normalized === 'previous_day' ||
    normalized === 'last_day'
  ) {
    const startY = new Date(startOfToday);
    startY.setDate(startY.getDate() - 1);
    const endY = new Date(startOfToday.getTime() - 1);
    return {
      period: 'yesterday',
      periodLabel: 'Yesterday (Kal)',
      dateRangeLabel: formatDateShort(startY),
      startMs: startY.getTime(),
      endMs: endY.getTime(),
    };
  }

  if (
    normalized === 'last_7_days' ||
    normalized === '7_days' ||
    normalized === 'week' ||
    normalized === 'weekly' ||
    normalized === 'this_week' ||
    normalized === 'hafta' ||
    normalized === 'is_hafte'
  ) {
    const startW = new Date(startOfToday);
    startW.setDate(startW.getDate() - 6);
    return {
      period: 'last_7_days',
      periodLabel: 'Last 7 Days',
      dateRangeLabel: `${formatDateShort(startW)} – ${formatDateShort(startOfToday)}`,
      startMs: startW.getTime(),
      endMs: endOfToday.getTime(),
    };
  }

  if (
    normalized === 'last_30_days' ||
    normalized === '30_days' ||
    normalized === 'month' ||
    normalized === 'monthly' ||
    normalized === 'this_month' ||
    normalized === 'mahina'
  ) {
    const startM = new Date(startOfToday);
    startM.setDate(startM.getDate() - 29);
    return {
      period: 'last_30_days',
      periodLabel: 'Last 30 Days',
      dateRangeLabel: `${formatDateShort(startM)} – ${formatDateShort(startOfToday)}`,
      startMs: startM.getTime(),
      endMs: endOfToday.getTime(),
    };
  }

  if (normalized === 'all' || normalized === 'all_time' || normalized === 'total') {
    return {
      period: 'all',
      periodLabel: 'All Recorded History',
      dateRangeLabel: 'All Time',
      startMs: 0,
      endMs: endOfToday.getTime(),
    };
  }

  return {
    period: 'today',
    periodLabel: 'Today (Aaj)',
    dateRangeLabel: formatDateShort(startOfToday),
    startMs: startOfToday.getTime(),
    endMs: endOfToday.getTime(),
  };
}

export function buildComplaintTicketNumber(date = new Date(), suffix?: string): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const token = (suffix || Math.random().toString(36).slice(2, 6))
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 6)
    .padEnd(4, '0');
  return `CMP-${yyyy}${mm}${dd}-${token}`;
}

export function buildSalesAndOrdersReport(params: {
  period?: string;
  transactions: LedgerTransaction[];
  customers: Customer[];
  inventory: InventoryItem[];
  deliveries: DeliveryRecord[];
  complaints: CustomerComplaint[];
  now?: Date;
}): OperationalReportSnapshot {
  const now = params.now ?? new Date();
  const tf = resolveReportTimeframe(params.period, now);

  const inRangeTxs = params.transactions.filter((tx) => {
    const ms = getTimestampMillis(tx.createdAt);
    if (ms === null) {
      return tf.period === 'today' || tf.period === 'all';
    }
    return ms >= tf.startMs && ms <= tf.endMs;
  });

  const completed = inRangeTxs.filter((tx) => tx.status === 'COMPLETED');
  const undone = inRangeTxs.filter((tx) => tx.status === 'UNDONE');

  let udhaarIssued = 0;
  let jamaCollected = 0;
  let cashSales = 0;

  const itemTotals = new Map<
    string,
    { item_name: string; qty: number; unit: string; total_inr: number }
  >();

  const orders: OperationalReportOrderRow[] = completed.map((tx) => {
    const amount = Math.max(0, Number(tx.total_amount) || 0);
    if (tx.type === 'UDHAAR') udhaarIssued += amount;
    else if (tx.type === 'JAMA') jamaCollected += amount;
    else if (tx.type === 'CASH_SALE') cashSales += amount;

    if (tx.type !== 'JAMA') {
      const key = tx.item_name || tx.item_sku || 'Counter Item';
      const existing = itemTotals.get(key) ?? {
        item_name: key,
        qty: 0,
        unit: tx.unit || 'units',
        total_inr: 0,
      };
      existing.qty += Math.max(0, Number(tx.qty) || 0);
      existing.total_inr += amount;
      itemTotals.set(key, existing);
    }

    const ms = getTimestampMillis(tx.createdAt);
    const timeLabel = ms
      ? new Date(ms).toLocaleTimeString('en-IN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

    return {
      tx_id: tx.tx_id,
      customer_name: tx.customer_name,
      item_summary: tx.qty > 0 ? `${tx.qty} ${tx.unit} ${tx.item_name}` : tx.item_name,
      type: tx.type,
      total_amount: amount,
      time_label: timeLabel,
    };
  });

  const totalSales = udhaarIssued + cashSales;
  const outstandingUdhaarTotal = params.customers.reduce(
    (sum, c) => sum + Math.max(0, Number(c.current_udhaar_balance) || 0),
    0
  );
  const pendingDeliveriesCount = params.deliveries.filter(
    (d) => d.status === 'PENDING' || d.status === 'OUT_FOR_DELIVERY'
  ).length;
  const openComplaintsCount = params.complaints.filter((c) => c.status !== 'RESOLVED').length;
  const lowStockSkusCount = params.inventory.filter(
    (i) => i.stock_qty < i.reorder_threshold
  ).length;

  const topItems = Array.from(itemTotals.values())
    .sort((a, b) => b.total_inr - a.total_inr)
    .slice(0, 5);

  const periodHindi =
    tf.period === 'today'
      ? 'Aaj'
      : tf.period === 'yesterday'
      ? 'Kal'
      : tf.period === 'last_7_days'
      ? 'Pichle 7 din mein'
      : tf.period === 'last_30_days'
      ? 'Pichle 30 din mein'
      : 'Ab tak';

  const spokenSummary =
    completed.length === 0
      ? `${periodHindi} (${tf.dateRangeLabel}) koi completed order record nahi hua hai. Kul outstanding Udhaar ₹${outstandingUdhaarTotal.toLocaleString(
          'en-IN'
        )} hai, ${pendingDeliveriesCount} deliveries pending aur ${openComplaintsCount} complaints open hain.`
      : `${periodHindi} (${tf.dateRangeLabel}) kul ${completed.length} entries hui hain: total sales ₹${totalSales.toLocaleString(
          'en-IN'
        )} (Udhaar ₹${udhaarIssued.toLocaleString('en-IN')}, Cash ₹${cashSales.toLocaleString(
          'en-IN'
        )}) aur Jama collection ₹${jamaCollected.toLocaleString(
          'en-IN'
        )}. Abhi ${pendingDeliveriesCount} deliveries pending aur ${openComplaintsCount} complaints open hain.`;

  return {
    period: tf.period,
    period_label: tf.periodLabel,
    date_range_label: tf.dateRangeLabel,
    generated_at: now.toLocaleString('en-IN'),
    completed_orders_count: completed.length,
    undone_orders_count: undone.length,
    total_sales_inr: totalSales,
    udhaar_issued_inr: udhaarIssued,
    jama_collected_inr: jamaCollected,
    cash_sales_inr: cashSales,
    outstanding_udhaar_total_inr: outstandingUdhaarTotal,
    pending_deliveries_count: pendingDeliveriesCount,
    open_complaints_count: openComplaintsCount,
    low_stock_skus_count: lowStockSkusCount,
    top_items: topItems,
    orders: orders.slice(0, 50),
    spoken_summary_hinglish: spokenSummary,
  };
}

export function formatOperationalReportText(report: OperationalReportSnapshot): string {
  const lines = [
    `BOLKHATA LIVE — SALES & ORDERS REPORT`,
    `Period: ${report.period_label} (${report.date_range_label})`,
    `Generated: ${report.generated_at}`,
    `--------------------------------------------------`,
    `Completed Entries: ${report.completed_orders_count} (Undone: ${report.undone_orders_count})`,
    `Total Sales (Udhaar + Cash): ₹${report.total_sales_inr.toLocaleString('en-IN')}`,
    `  - Udhaar Issued: ₹${report.udhaar_issued_inr.toLocaleString('en-IN')}`,
    `  - Cash Sales:    ₹${report.cash_sales_inr.toLocaleString('en-IN')}`,
    `Jama Collections Received:   ₹${report.jama_collected_inr.toLocaleString('en-IN')}`,
    `Total Outstanding Khata:     ₹${report.outstanding_udhaar_total_inr.toLocaleString('en-IN')}`,
    `Pending Deliveries: ${report.pending_deliveries_count} | Open Complaints: ${report.open_complaints_count} | Low Stock SKUs: ${report.low_stock_skus_count}`,
  ];

  if (report.orders.length > 0) {
    lines.push('', 'ORDER / LEDGER BREAKDOWN:');
    for (const o of report.orders) {
      lines.push(
        `  [${o.time_label}] ${o.tx_id} | ${o.customer_name} | ${o.item_summary} | ${o.type} | ₹${o.total_amount.toLocaleString(
          'en-IN'
        )}`
      );
    }
  } else {
    lines.push('', 'No completed orders recorded in this period.');
  }

  return lines.join('\n');
}

export function downloadOperationalReport(report: OperationalReportSnapshot): void {
  const text = formatOperationalReportText(report);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safePeriod = report.period.replace(/[^a-z0-9_-]/gi, '_');
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `bolkhata-report-${safePeriod}.txt`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
