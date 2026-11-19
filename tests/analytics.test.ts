import { describe, expect, it } from 'vitest';
import {
  buildDailyTransactionVolumeSeries,
  extractTimestampMs,
  toLocalDateKey,
} from '../src/utils/analytics';

describe('Daily Transaction Volume (Last 30 Days) Analytics', () => {
  const refDate = new Date(2026, 10, 18, 15, 30, 0); // 18 Nov 2026

  it('produces exactly 30 contiguous calendar days ending on referenceDate', () => {
    const result = buildDailyTransactionVolumeSeries([], 30, refDate);
    expect(result.series).toHaveLength(30);
    expect(result.series[0].dateKey).toBe('2026-10-20');
    expect(result.series[29].dateKey).toBe('2026-11-18');
    expect(result.totalVolumeInr).toBe(0);
    expect(result.totalTxCount).toBe(0);
    expect(result.activeDays).toBe(0);
    expect(result.dailyAvgInr).toBe(0);
    expect(result.peakDay).toBeNull();
  });

  it('aggregates multiple COMPLETED transactions on the same day and splits UDHAAR/JAMA/CASH_SALE', () => {
    const dayToday = new Date(2026, 10, 18, 10, 0, 0);
    const dayFiveAgo = new Date(2026, 10, 13, 12, 0, 0);

    const txs = [
      {
        createdAt: { toMillis: () => dayToday.getTime() },
        status: 'COMPLETED' as const,
        type: 'UDHAAR' as const,
        total_amount: 12000,
      },
      {
        createdAt: { toMillis: () => dayToday.getTime() + 60_000 },
        status: 'COMPLETED' as const,
        type: 'JAMA' as const,
        total_amount: 5000,
      },
      {
        createdAt: { toMillis: () => dayFiveAgo.getTime() },
        status: 'COMPLETED' as const,
        type: 'CASH_SALE' as const,
        total_amount: 25000,
      },
    ];

    const result = buildDailyTransactionVolumeSeries(txs, 30, refDate);
    expect(result.totalVolumeInr).toBe(42000);
    expect(result.totalTxCount).toBe(3);
    expect(result.activeDays).toBe(2);
    expect(result.dailyAvgInr).toBe(Math.round(42000 / 30));
    expect(result.peakDay?.dateKey).toBe(toLocalDateKey(dayFiveAgo));
    expect(result.peakDay?.volumeInr).toBe(25000);

    const todayBucket = result.series.find((p) => p.dateKey === '2026-11-18');
    expect(todayBucket).toMatchObject({
      volumeInr: 17000,
      udhaarInr: 12000,
      jamaInr: 5000,
      cashSaleInr: 0,
      txCount: 2,
    });
  });

  it('excludes UNDONE, PENDING_APPROVAL, transactions older than 30 days, and invalid amounts', () => {
    const todayMs = new Date(2026, 10, 18, 9, 0, 0).getTime();
    const olderThan30Ms = new Date(2026, 9, 10, 9, 0, 0).getTime(); // 39 days ago

    const txs = [
      {
        createdAt: todayMs,
        status: 'COMPLETED' as const,
        type: 'UDHAAR' as const,
        total_amount: 10000,
      },
      {
        createdAt: todayMs,
        status: 'UNDONE' as const,
        type: 'UDHAAR' as const,
        total_amount: 99999,
      },
      {
        createdAt: todayMs,
        status: 'PENDING_APPROVAL' as const,
        type: 'UDHAAR' as const,
        total_amount: 75000,
      },
      {
        createdAt: olderThan30Ms,
        status: 'COMPLETED' as const,
        type: 'UDHAAR' as const,
        total_amount: 55000,
      },
      {
        createdAt: todayMs,
        status: 'COMPLETED' as const,
        type: 'UDHAAR' as const,
        total_amount: -500,
      },
      {
        createdAt: todayMs,
        status: 'COMPLETED' as const,
        type: 'UDHAAR' as const,
        total_amount: Number.NaN,
      },
    ];

    const result = buildDailyTransactionVolumeSeries(txs, 30, refDate);
    expect(result.totalVolumeInr).toBe(10000);
    expect(result.totalTxCount).toBe(1);
    expect(result.activeDays).toBe(1);
  });

  it('parses Firestore Timestamp shapes, ISO strings, epoch numbers, and rejects malformed dates', () => {
    const epoch = Date.UTC(2026, 10, 18, 8, 0, 0);
    expect(extractTimestampMs(epoch)).toBe(epoch);
    expect(extractTimestampMs(new Date(epoch))).toBe(epoch);
    expect(extractTimestampMs(new Date(epoch).toISOString())).toBe(epoch);
    expect(extractTimestampMs({ toMillis: () => epoch })).toBe(epoch);
    expect(extractTimestampMs({ seconds: Math.floor(epoch / 1000) })).toBe(
      Math.floor(epoch / 1000) * 1000
    );
    expect(extractTimestampMs(null)).toBe(0);
    expect(extractTimestampMs('not-a-date')).toBe(0);
    expect(extractTimestampMs(-100)).toBe(0);
  });
});
