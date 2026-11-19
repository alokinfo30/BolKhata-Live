import { describe, expect, it } from 'vitest';
import {
  buildPrintableReceiptHtml,
  buildReceiptNumber,
  buildReceiptTextSummary,
  buildSafeReceiptFilename,
  buildSmsShareUrl,
  buildStoreNotificationMessage,
  buildUpiUriForReceipt,
  buildWhatsAppShareUrl,
  escapeHtml,
  sanitizePhoneForChannel,
  sanitizeUpiUri,
} from '../src/utils/receiptUtils';

describe('Receipt & Store Notification Security & Formatting Suite', () => {
  it('generates valid bounded receipt numbers', () => {
    const fixedDate = new Date('2026-05-10T10:00:00Z');
    const rcpt = buildReceiptNumber(fixedDate, 'a9b2');
    expect(rcpt).toBe('RCPT-20260510-A9B2');
    expect(rcpt.length).toBeGreaterThanOrEqual(2);
    expect(rcpt.length).toBeLessThanOrEqual(40);
  });

  it('normalizes 10-digit Indian and E.164 phone numbers and rejects invalid ones', () => {
    expect(sanitizePhoneForChannel('98112 40120')).toBe('919811240120');
    expect(sanitizePhoneForChannel('+91-98204-77819')).toBe('919820477819');
    expect(sanitizePhoneForChannel('abc')).toBe('');
    expect(sanitizePhoneForChannel('12345')).toBe('');
  });

  it('blocks malicious URI schemes in UPI links while allowing valid upi://pay URIs', () => {
    expect(sanitizeUpiUri('javascript:alert(1)')).toBe('');
    expect(sanitizeUpiUri('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(sanitizeUpiUri('upi://pay?pa=shop@okaxis&am=100\n<script>')).toBe('');

    const valid = buildUpiUriForReceipt({
      upiVpa: 'bolkhata.store@okaxis',
      merchantName: 'BolKhata Wholesale',
      amount: 14500,
      note: 'RCPT-20260510-A9B2 Sharma General Store',
    });
    expect(valid.startsWith('upi://pay?')).toBe(true);
    expect(valid).toContain('am=14500.00');
    expect(valid).toContain('cu=INR');
  });

  it('escapes HTML & neutralizes XSS payloads in printable receipt HTML', () => {
    expect(escapeHtml(`<script>alert("xss")</script>'&`)).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&#39;&amp;'
    );

    const html = buildPrintableReceiptHtml(
      {
        receipt_number: 'RCPT-20260510-XSS1',
        tx_id: 'tx_123',
        customer_name: '<img src=x onerror=alert(1)> Sharma Store',
        customer_phone: '+91 98112 40120',
        customer_location: '<b>Sadar Bazaar</b>',
        item_name: 'Basmati <script>evil()</script>',
        qty: 15,
        unit: 'bori',
        unit_price: 1200,
        total_amount: 18000,
        tx_type: 'UDHAAR',
        previous_balance: 14500,
        new_balance: 32500,
        upi_uri: 'javascript:alert(1)',
        note: '"><script>alert(2)</script>',
        status: 'SENT',
      },
      'BolKhata <Wholesale>',
      '10/05/2026'
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; Sharma Store');
    expect(html).toContain('BolKhata &lt;Wholesale&gt;');
  });

  it('builds bounded Hinglish store notification messages and safe WhatsApp/SMS share URLs', () => {
    const msg = buildStoreNotificationMessage({
      receiptNumber: 'RCPT-20260510-001A',
      storeName: 'BolKhata Wholesale',
      customerName: 'Sharma General Store',
      itemName: 'Basmati Chawal (25kg)',
      qty: 15,
      unit: 'bori',
      totalAmount: 18000,
      txType: 'UDHAAR',
      previousBalance: 14500,
      newBalance: 32500,
      upiVpa: 'bolkhata.store@okaxis',
      note: 'Weekly order dispatched',
    });

    expect(msg.length).toBeLessThanOrEqual(1000);
    expect(msg).toContain('Sharma General Store');
    expect(msg).toContain('RCPT-20260510-001A');
    expect(msg).toContain('15 bori Basmati Chawal (25kg)');
    expect(msg).toContain('bolkhata.store@okaxis');

    const waUrl = buildWhatsAppShareUrl('+91 98112 40120', msg);
    expect(waUrl.startsWith('https://wa.me/919811240120?text=')).toBe(true);

    const smsUrl = buildSmsShareUrl('+91 98112 40120', msg);
    expect(smsUrl.startsWith('sms:+919811240120?body=')).toBe(true);
  });

  it('builds readable text summary and sanitized filenames', () => {
    const summary = buildReceiptTextSummary({
      receipt_number: 'RCPT-20260510-7777',
      customer_name: 'Verma Traders',
      customer_phone: '+91 98204 77819',
      customer_location: 'Vashi APMC',
      item_name: 'Fortune Refined Oil (15L)',
      qty: 10,
      unit: 'peti',
      total_amount: 18000,
      tx_type: 'UDHAAR',
      previous_balance: 18000,
      new_balance: 36000,
      note: 'Counter delivery',
    });
    expect(summary).toContain('RCPT-20260510-7777');
    expect(summary).toContain('Verma Traders');
    expect(buildSafeReceiptFilename('RCPT-2026/../../evil')).toBe('rcpt-2026_______evil.html');
  });
});
