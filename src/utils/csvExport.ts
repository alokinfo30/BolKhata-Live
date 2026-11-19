import type { Customer, LedgerTransaction } from '../types';
import { extractTimestampMs } from './analytics';

const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const FORMULA_TRIGGER_RE = /^[\s\t\r\n]*[=+\-@|]/;

/**
 * Neutralizes CSV/Spreadsheet Formula Injection (OWASP CWE-1236) and strips unsafe control chars.
 * Prefixes dangerous leading characters (=, +, -, @, |, tab, CR) with a single quote so Excel,
 * LibreOffice Calc, and Google Sheets treat the value strictly as literal text.
 */
export function sanitizeCsvTextCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const cleaned = raw.replace(CONTROL_CHARS_RE, '');
  if (!cleaned) return '';

  if (
    FORMULA_TRIGGER_RE.test(cleaned) ||
    cleaned.startsWith('\t') ||
    cleaned.startsWith('\r')
  ) {
    return `'${cleaned}`;
  }
  return cleaned;
}

/**
 * Formats a finite numeric CSV cell safely without triggering spreadsheet formulas.
 */
export function sanitizeCsvNumberCell(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return String(Math.round(num * 100) / 100);
}

/**
 * RFC-4180 field quoting for CSV output.
 */
export function escapeCsvField(cell: string): string {
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function formatCsvRow(cells: string[]): string {
  return cells.map(escapeCsvField).join(',');
}

export interface CustomerLedgerExportOptions {
  includeBom?: boolean;
}

/**
 * Builds a hardened, RFC-4180 compliant Customer Khata Ledger CSV enriched with
 * per-customer completed transaction counts, Udhaar issued, Jama collected, and last activity.
 */
export function buildCustomerLedgerCsv(
  customers: Customer[],
  transactions: LedgerTransaction[] = [],
  options: CustomerLedgerExportOptions = {}
): string {
  const txStatsByCustomer = new Map<
    string,
    {
      completedCount: number;
      udhaarTotal: number;
      jamaTotal: number;
      lastActivityMs: number;
    }
  >();

  for (const tx of transactions) {
    if (!tx || tx.status !== 'COMPLETED' || !tx.customer_id) continue;
    const prev = txStatsByCustomer.get(tx.customer_id) ?? {
      completedCount: 0,
      udhaarTotal: 0,
      jamaTotal: 0,
      lastActivityMs: 0,
    };
    const amt = Number.isFinite(Number(tx.total_amount)) ? Math.max(0, Number(tx.total_amount)) : 0;
    prev.completedCount += 1;
    if (tx.type === 'UDHAAR') prev.udhaarTotal += amt;
    if (tx.type === 'JAMA') prev.jamaTotal += amt;
    const ms = extractTimestampMs(tx.createdAt);
    if (ms > prev.lastActivityMs) prev.lastActivityMs = ms;
    txStatsByCustomer.set(tx.customer_id, prev);
  }

  const headers = [
    'Customer ID',
    'Customer Name',
    'Phone',
    'Market / Location',
    'Current Udhaar (INR)',
    'Credit Limit (INR)',
    'Available Credit (INR)',
    'Credit Utilization (%)',
    'Credit Status',
    'Completed Transactions',
    'Total Udhaar Issued (INR)',
    'Total Jama Collected (INR)',
    'Last Activity (ISO)',
  ];

  const lines: string[] = [formatCsvRow(headers)];

  for (const cust of customers) {
    const balance = Number.isFinite(Number(cust.current_udhaar_balance))
      ? Math.max(0, Number(cust.current_udhaar_balance))
      : 0;
    const limit = Number.isFinite(Number(cust.credit_limit))
      ? Math.max(0, Number(cust.credit_limit))
      : 0;
    const availableCredit = Math.max(0, limit - balance);
    const utilizationPct =
      limit > 0 ? Math.round((balance / limit) * 1000) / 10 : 0;
    const status =
      balance > limit
        ? 'OVER_LIMIT'
        : utilizationPct >= 80
        ? 'NEAR_LIMIT'
        : 'HEALTHY';

    const stats = txStatsByCustomer.get(cust.id);
    const updatedMs = Math.max(
      stats?.lastActivityMs ?? 0,
      extractTimestampMs(cust.updatedAt)
    );
    const lastActivityIso = updatedMs > 0 ? new Date(updatedMs).toISOString() : '';

    lines.push(
      formatCsvRow([
        sanitizeCsvTextCell(cust.id),
        sanitizeCsvTextCell(cust.name),
        sanitizeCsvTextCell(cust.phone),
        sanitizeCsvTextCell(cust.location),
        sanitizeCsvNumberCell(balance),
        sanitizeCsvNumberCell(limit),
        sanitizeCsvNumberCell(availableCredit),
        sanitizeCsvNumberCell(utilizationPct),
        sanitizeCsvTextCell(status),
        sanitizeCsvNumberCell(stats?.completedCount ?? 0),
        sanitizeCsvNumberCell(stats?.udhaarTotal ?? 0),
        sanitizeCsvNumberCell(stats?.jamaTotal ?? 0),
        sanitizeCsvTextCell(lastActivityIso),
      ])
    );
  }

  const csvBody = lines.join('\r\n');
  return options.includeBom === false ? csvBody : `\uFEFF${csvBody}`;
}

export function buildSafeCsvFilename(prefix = 'bolkhata-customer-ledger', date: Date = new Date()): string {
  const safePrefix = prefix
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'export';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${safePrefix}-${yyyy}-${mm}-${dd}.csv`;
}

export function triggerCsvDownload(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
}
