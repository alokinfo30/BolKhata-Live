import { describe, expect, it } from 'vitest';
import {
  buildCustomerLedgerCsv,
  buildSafeCsvFilename,
  escapeCsvField,
  sanitizeCsvNumberCell,
  sanitizeCsvTextCell,
} from '../src/utils/csvExport';
import type { Customer, LedgerTransaction } from '../src/types';

describe('Hardened CSV Export Security & RFC-4180 Formatting', () => {
  it('neutralizes OWASP CWE-1236 CSV formula injection payloads', () => {
    const vectors = [
      '=cmd|\' /C calc\'!A0',
      '+2+3+cmd|\' /C calc\'!A0',
      '-2+3+cmd|\' /C calc\'!A0',
      '@SUM(1+1)*cmd|\' /C calc\'!A0',
      '|calc',
      '   =HYPERLINK("http://evil.example","Click")',
      '\t=1+1',
      '\r=1+1',
    ];

    for (const payload of vectors) {
      const sanitized = sanitizeCsvTextCell(payload);
      expect(sanitized.startsWith("'")).toBe(true);
    }
  });

  it('strips ASCII control characters including NUL bytes while preserving Unicode Hindi/INR', () => {
    expect(sanitizeCsvTextCell('Sharma\x00 Store\x07')).toBe('Sharma Store');
    expect(sanitizeCsvTextCell('शर्मा जनरल स्टोर ₹500')).toBe('शर्मा जनरल स्टोर ₹500');
  });

  it('properly quotes RFC-4180 fields containing commas, quotes, and newlines', () => {
    expect(escapeCsvField('Sadar Bazaar, Delhi')).toBe('"Sadar Bazaar, Delhi"');
    expect(escapeCsvField('He said "Confirm"')).toBe('"He said ""Confirm"""');
    expect(escapeCsvField('Line1\nLine2')).toBe('"Line1\nLine2"');
    expect(escapeCsvField('PlainStore')).toBe('PlainStore');
  });

  it('sanitizes non-finite numbers to 0', () => {
    expect(sanitizeCsvNumberCell(14500.456)).toBe('14500.46');
    expect(sanitizeCsvNumberCell(Number.NaN)).toBe('0');
    expect(sanitizeCsvNumberCell(Infinity)).toBe('0');
    expect(sanitizeCsvNumberCell('bad')).toBe('0');
  });

  it('builds a full Customer Khata Ledger CSV with BOM, formula neutralization, and transaction stats', () => {
    const customers: Customer[] = [
      {
        id: 'cust_sharma',
        ownerId: 'owner_1',
        name: 'Sharma, "Best" Store',
        phone: '+91 98112 40120',
        location: 'Sadar Bazaar, Delhi',
        current_udhaar_balance: 52000,
        credit_limit: 50000,
        updatedAt: { toMillis: () => Date.UTC(2026, 10, 18, 10, 0, 0) },
      },
      {
        id: 'cust_evil',
        ownerId: 'owner_1',
        name: '=HYPERLINK("https://evil.test","Free")',
        phone: '9811000000',
        location: '@SUM(A1:A9)',
        current_udhaar_balance: 10000,
        credit_limit: 50000,
      },
    ];

    const txs: LedgerTransaction[] = [
      {
        id: 'tx1',
        ownerId: 'owner_1',
        tx_id: 'TX-1',
        customer_id: 'cust_sharma',
        customer_name: 'Sharma, "Best" Store',
        item_sku: 'SKU-1',
        item_name: 'Basmati',
        unit: 'bori',
        qty: 10,
        unit_price: 2000,
        total_amount: 20000,
        type: 'UDHAAR',
        status: 'COMPLETED',
        previous_balance: 32000,
        previous_stock: 50,
        note: 'Confirmed',
        createdAt: { toMillis: () => Date.UTC(2026, 10, 18, 11, 0, 0) },
      },
      {
        id: 'tx2',
        ownerId: 'owner_1',
        tx_id: 'TX-2',
        customer_id: 'cust_sharma',
        customer_name: 'Sharma, "Best" Store',
        item_sku: 'PAYMENT_JAMA',
        item_name: 'Jama',
        unit: 'INR',
        qty: 0,
        unit_price: 5000,
        total_amount: 5000,
        type: 'JAMA',
        status: 'COMPLETED',
        previous_balance: 57000,
        previous_stock: 0,
        note: 'UPI',
        createdAt: { toMillis: () => Date.UTC(2026, 10, 18, 12, 0, 0) },
      },
      {
        id: 'tx3',
        ownerId: 'owner_1',
        tx_id: 'TX-3',
        customer_id: 'cust_sharma',
        customer_name: 'Sharma, "Best" Store',
        item_sku: 'SKU-1',
        item_name: 'Basmati',
        unit: 'bori',
        qty: 5,
        unit_price: 2000,
        total_amount: 10000,
        type: 'UDHAAR',
        status: 'UNDONE',
        previous_balance: 52000,
        previous_stock: 40,
        note: 'Rolled back',
        createdAt: { toMillis: () => Date.UTC(2026, 10, 18, 13, 0, 0) },
      },
    ];

    const csv = buildCustomerLedgerCsv(customers, txs);
    expect(csv.startsWith('\uFEFF')).toBe(true);

    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Customer ID,Customer Name,Phone,Market / Location');

    // Row 1: Sharma — escaped quotes, neutralized +91 phone, OVER_LIMIT status, UNDONE excluded
    expect(lines[1]).toContain('"Sharma, ""Best"" Store"');
    expect(lines[1]).toContain("'+91 98112 40120");
    expect(lines[1]).toContain('52000,50000,0,104,OVER_LIMIT,2,20000,5000,2026-11-18T12:00:00.000Z');

    // Row 2: Formula injection neutralized with leading apostrophe
    expect(lines[2]).toContain(`"'=HYPERLINK(""https://evil.test"",""Free"")"`);
    expect(lines[2]).toContain("'@SUM(A1:A9)");
    expect(lines[2]).toContain('10000,50000,40000,20,HEALTHY,0,0,0,');
  });

  it('generates safe filenames free of path traversal characters', () => {
    const fname = buildSafeCsvFilename('../../../etc/passwd!!', new Date(2026, 10, 18));
    expect(fname).toBe('etc-passwd-2026-11-18.csv');
    expect(fname).not.toContain('..');
    expect(fname).not.toContain('/');
  });
});
