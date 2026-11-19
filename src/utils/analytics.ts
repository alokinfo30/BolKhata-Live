import type { LedgerTransaction } from '../types';

export interface DailyVolumePoint {
  dateKey: string;
  dateLabel: string;
  volumeInr: number;
  udhaarInr: number;
  jamaInr: number;
  cashSaleInr: number;
  txCount: number;
}

export interface DailyVolume30Summary {
  series: DailyVolumePoint[];
  totalVolumeInr: number;
  totalTxCount: number;
  activeDays: number;
  dailyAvgInr: number;
  peakDay: DailyVolumePoint | null;
}

export function extractTimestampMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
    return ts;
  }
  if (ts instanceof Date) {
    const ms = ts.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  if (typeof ts === 'object') {
    const rec = ts as {
      toMillis?: () => number;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof rec.toMillis === 'function') {
      const ms = rec.toMillis();
      return Number.isFinite(ms) && ms > 0 ? ms : 0;
    }
    const secs =
      typeof rec.seconds === 'number'
        ? rec.seconds
        : typeof rec._seconds === 'number'
        ? rec._seconds
        : NaN;
    if (Number.isFinite(secs) && secs > 0) {
      return Math.round(secs * 1000);
    }
  }
  return 0;
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatShortDateLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

/**
 * Computes daily completed transaction volume over a contiguous N-day window
 * (default 30 days) ending on `referenceDate` (inclusive).
 * Excludes UNDONE / PENDING_APPROVAL transactions and non-finite/negative amounts.
 */
export function buildDailyTransactionVolumeSeries(
  transactions: Pick<LedgerTransaction, 'createdAt' | 'status' | 'type' | 'total_amount'>[],
  days = 30,
  referenceDate: Date = new Date()
): DailyVolume30Summary {
  const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
  const endDay = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );

  const buckets = new Map<string, DailyVolumePoint>();
  const orderedKeys: string[] = [];

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const d = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - offset);
    const key = toLocalDateKey(d);
    orderedKeys.push(key);
    buckets.set(key, {
      dateKey: key,
      dateLabel: formatShortDateLabel(d),
      volumeInr: 0,
      udhaarInr: 0,
      jamaInr: 0,
      cashSaleInr: 0,
      txCount: 0,
    });
  }

  for (const tx of transactions) {
    if (!tx || tx.status !== 'COMPLETED') continue;
    const rawAmount = Number(tx.total_amount);
    if (!Number.isFinite(rawAmount) || rawAmount < 0) continue;

    const ms = extractTimestampMs(tx.createdAt);
    if (ms <= 0) continue;

    const txDate = new Date(ms);
    const key = toLocalDateKey(txDate);
    const bucket = buckets.get(key);
    if (!bucket) continue;

    const amount = Math.round(rawAmount * 100) / 100;
    bucket.volumeInr = Math.round((bucket.volumeInr + amount) * 100) / 100;
    bucket.txCount += 1;

    if (tx.type === 'UDHAAR') {
      bucket.udhaarInr = Math.round((bucket.udhaarInr + amount) * 100) / 100;
    } else if (tx.type === 'JAMA') {
      bucket.jamaInr = Math.round((bucket.jamaInr + amount) * 100) / 100;
    } else if (tx.type === 'CASH_SALE') {
      bucket.cashSaleInr = Math.round((bucket.cashSaleInr + amount) * 100) / 100;
    }
  }

  const series = orderedKeys.map((k) => buckets.get(k)!);
  let totalVolumeInr = 0;
  let totalTxCount = 0;
  let activeDays = 0;
  let peakDay: DailyVolumePoint | null = null;

  for (const pt of series) {
    totalVolumeInr = Math.round((totalVolumeInr + pt.volumeInr) * 100) / 100;
    totalTxCount += pt.txCount;
    if (pt.txCount > 0) activeDays += 1;
    if (pt.volumeInr > 0 && (!peakDay || pt.volumeInr > peakDay.volumeInr)) {
      peakDay = pt;
    }
  }

  const dailyAvgInr = Math.round(totalVolumeInr / safeDays);

  return {
    series,
    totalVolumeInr,
    totalTxCount,
    activeDays,
    dailyAvgInr,
    peakDay,
  };
}
