import type { NotificationChannel, Receipt, TxType } from '../types';

export function buildReceiptNumber(date = new Date(), suffix?: string): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const token = (suffix || Math.random().toString(36).slice(2, 6))
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 6)
    .padEnd(4, '0');
  return `RCPT-${yyyy}${mm}${dd}-${token}`;
}

export function sanitizePhoneForChannel(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }
  return '';
}

export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeUpiUri(uri: string | undefined | null): string {
  const trimmed = String(uri ?? '').trim();
  if (!trimmed) return '';
  if (!/^upi:\/\/pay\?/i.test(trimmed)) {
    return '';
  }
  // Reject control characters or script-injection attempts
  if (/[\r\n\t<>'"]/.test(trimmed)) {
    return '';
  }
  return trimmed.slice(0, 400);
}

export function buildUpiUriForReceipt(params: {
  upiVpa: string;
  merchantName: string;
  amount: number;
  note: string;
}): string {
  const vpa = params.upiVpa.trim() || 'bolkhata.store@okaxis';
  const merchant = params.merchantName.trim() || 'BolKhata Wholesale';
  const note = (params.note.trim() || 'BolKhata Receipt').slice(0, 80);
  const amount = Math.max(0, Number(params.amount) || 0);

  const uri =
    amount > 0
      ? `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(
          merchant
        )}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`
      : `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(
          merchant
        )}&cu=INR&tn=${encodeURIComponent(note)}`;

  return sanitizeUpiUri(uri);
}

export function formatInrPlain(amount: number): string {
  return `₹${Math.max(0, Number(amount) || 0).toLocaleString('en-IN')}`;
}

export interface ReceiptMessageParams {
  receiptNumber: string;
  storeName: string;
  customerName: string;
  itemName: string;
  qty: number;
  unit: string;
  totalAmount: number;
  txType: TxType;
  previousBalance: number;
  newBalance: number;
  upiVpa?: string;
  note?: string;
}

export function buildStoreNotificationMessage(params: ReceiptMessageParams): string {
  const store = (params.storeName || 'BolKhata Wholesale').trim().slice(0, 80);
  const customer = params.customerName.trim().slice(0, 120);
  const qtyLine =
    params.qty > 0
      ? `${params.qty} ${params.unit} ${params.itemName}`
      : params.itemName;

  const actionLabel =
    params.txType === 'JAMA'
      ? 'Jama (Payment Received)'
      : params.txType === 'CASH_SALE'
      ? 'Cash Bill'
      : 'Udhaar Entry';

  const lines = [
    `Namaste ${customer} ji,`,
    `${store} ki taraf se aapki digital Parchi (${params.receiptNumber}):`,
    `• Vivaran: ${qtyLine} (${actionLabel})`,
    `• Bill / Rashi: ${formatInrPlain(params.totalAmount)}`,
    `• Pichla Udhaar: ${formatInrPlain(params.previousBalance)} -> Naya Udhaar: ${formatInrPlain(params.newBalance)}`,
  ];

  if (params.note && params.note.trim()) {
    lines.push(`• Note: ${params.note.trim().slice(0, 180)}`);
  }

  if (params.newBalance > 0 && params.upiVpa && params.upiVpa.trim()) {
    lines.push(`• UPI Payment ID: ${params.upiVpa.trim()}`);
  }

  lines.push('Dhanyavaad! — BolKhata Live');
  return lines.join('\n').slice(0, 1000);
}

export function buildReceiptTextSummary(receipt: Pick<
  Receipt,
  | 'receipt_number'
  | 'customer_name'
  | 'customer_phone'
  | 'customer_location'
  | 'item_name'
  | 'qty'
  | 'unit'
  | 'total_amount'
  | 'tx_type'
  | 'previous_balance'
  | 'new_balance'
  | 'note'
>, storeName = 'BolKhata Wholesale'): string {
  const itemDesc =
    receipt.qty > 0 ? `${receipt.qty} ${receipt.unit} ${receipt.item_name}` : receipt.item_name;
  return [
    `${storeName} — DIGITAL PARCHI`,
    `Receipt No: ${receipt.receipt_number}`,
    `Store / Trader: ${receipt.customer_name} (${receipt.customer_location})`,
    `Phone: ${receipt.customer_phone}`,
    `Entry: ${itemDesc} [${receipt.tx_type}]`,
    `Amount: ${formatInrPlain(receipt.total_amount)}`,
    `Previous Udhaar: ${formatInrPlain(receipt.previous_balance)}`,
    `Current Udhaar Balance: ${formatInrPlain(receipt.new_balance)}`,
    receipt.note ? `Note: ${receipt.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildWhatsAppShareUrl(phone: string, message: string): string {
  const cleanPhone = sanitizePhoneForChannel(phone);
  const encodedText = encodeURIComponent(message.slice(0, 1000));
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

export function buildSmsShareUrl(phone: string, message: string): string {
  const cleanPhone = sanitizePhoneForChannel(phone);
  const encodedBody = encodeURIComponent(message.slice(0, 1000));
  if (cleanPhone) {
    return `sms:+${cleanPhone}?body=${encodedBody}`;
  }
  return `sms:?body=${encodedBody}`;
}

export function getChannelDisplayLabel(channel: NotificationChannel): string {
  switch (channel) {
    case 'WHATSAPP':
      return 'WhatsApp';
    case 'SMS':
      return 'SMS';
    case 'BROADCAST':
      return 'All-Store Broadcast';
    case 'IN_APP':
    default:
      return 'In-App Ledger Log';
  }
}

export function buildPrintableReceiptHtml(
  receipt: Pick<
    Receipt,
    | 'receipt_number'
    | 'tx_id'
    | 'customer_name'
    | 'customer_phone'
    | 'customer_location'
    | 'item_name'
    | 'qty'
    | 'unit'
    | 'unit_price'
    | 'total_amount'
    | 'tx_type'
    | 'previous_balance'
    | 'new_balance'
    | 'upi_uri'
    | 'note'
    | 'status'
  >,
  storeName = 'BolKhata Wholesale',
  issuedDateStr = new Date().toLocaleString('en-IN')
): string {
  const safeStore = escapeHtml(storeName);
  const safeReceiptNo = escapeHtml(receipt.receipt_number);
  const safeTxId = escapeHtml(receipt.tx_id);
  const safeCustomer = escapeHtml(receipt.customer_name);
  const safePhone = escapeHtml(receipt.customer_phone);
  const safeLocation = escapeHtml(receipt.customer_location);
  const safeItem = escapeHtml(receipt.item_name);
  const safeUnit = escapeHtml(receipt.unit);
  const safeType = escapeHtml(receipt.tx_type);
  const safeStatus = escapeHtml(receipt.status);
  const safeNote = escapeHtml(receipt.note);
  const safeDate = escapeHtml(issuedDateStr);
  const safeUpi = escapeHtml(sanitizeUpiUri(receipt.upi_uri));

  const qtyCell = receipt.qty > 0 ? `${escapeHtml(receipt.qty)} ${safeUnit}` : 'Statement';
  const rateCell =
    receipt.unit_price > 0 ? `${escapeHtml(formatInrPlain(receipt.unit_price))}/${safeUnit}` : '—';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Parchi ${safeReceiptNo} — ${safeStore}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #f8fafc; margin: 0; padding: 24px; }
    .sheet { max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 28px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
    .brand { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
    .sub { font-size: 12px; color: #64748b; margin-top: 4px; }
    .meta { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #334155; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; font-size: 13px; }
    .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { background: #f8fafc; font-size: 11px; text-transform: uppercase; color: #475569; }
    .num { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .totals { margin-top: 16px; border-top: 2px solid #0f172a; padding-top: 12px; font-size: 13px; }
    .row { display: flex; justify-content: space-between; padding: 4px 0; }
    .row.grand { font-size: 16px; font-weight: 700; padding-top: 8px; }
    .note { margin-top: 16px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; color: #334155; }
    .footer { margin-top: 24px; font-size: 11px; color: #64748b; text-align: center; }
    @media print { body { background: #fff; padding: 0; } .sheet { border: none; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="brand">${safeStore}</div>
        <div class="sub">Digital Counter Receipt (Parchi) · ${safeType} · ${safeStatus}</div>
      </div>
      <div class="meta">
        <div><strong>${safeReceiptNo}</strong></div>
        <div>TX: ${safeTxId}</div>
        <div>${safeDate}</div>
      </div>
    </div>
    <div class="grid">
      <div>
        <div class="label">Store / Trader</div>
        <div><strong>${safeCustomer}</strong></div>
        <div>${safeLocation}</div>
      </div>
      <div>
        <div class="label">Contact</div>
        <div>${safePhone}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Qty</th>
          <th class="num">Rate</th>
          <th class="num">Amount (INR)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${safeItem}</td>
          <td class="num">${qtyCell}</td>
          <td class="num">${rateCell}</td>
          <td class="num">${escapeHtml(formatInrPlain(receipt.total_amount))}</td>
        </tr>
      </tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Previous Udhaar Balance</span><span class="num">${escapeHtml(formatInrPlain(receipt.previous_balance))}</span></div>
      <div class="row"><span>Current Entry (${safeType})</span><span class="num">${escapeHtml(formatInrPlain(receipt.total_amount))}</span></div>
      <div class="row grand"><span>Updated Udhaar Balance</span><span class="num">${escapeHtml(formatInrPlain(receipt.new_balance))}</span></div>
    </div>
    ${safeNote ? `<div class="note"><strong>Note:</strong> ${safeNote}</div>` : ''}
    ${safeUpi ? `<div class="note"><strong>UPI Payment URI:</strong> <code>${safeUpi}</code></div>` : ''}
    <div class="footer">Generated via BolKhata Live · Verified Digital Khata Parchi</div>
  </div>
</body>
</html>`;
}

export function buildSafeReceiptFilename(receiptNumber: string): string {
  const clean = receiptNumber.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'parchi';
  return `${clean.toLowerCase()}.html`;
}

export function downloadReceiptHtml(
  receipt: Pick<
    Receipt,
    | 'receipt_number'
    | 'tx_id'
    | 'customer_name'
    | 'customer_phone'
    | 'customer_location'
    | 'item_name'
    | 'qty'
    | 'unit'
    | 'unit_price'
    | 'total_amount'
    | 'tx_type'
    | 'previous_balance'
    | 'new_balance'
    | 'upi_uri'
    | 'note'
    | 'status'
  >,
  storeName = 'BolKhata Wholesale'
): void {
  const html = buildPrintableReceiptHtml(receipt, storeName);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildSafeReceiptFilename(receipt.receipt_number);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
