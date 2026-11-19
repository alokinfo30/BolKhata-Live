import React, { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  MessageSquare,
  Send,
  Users,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  buildReceiptNumber,
  buildSmsShareUrl,
  buildStoreNotificationMessage,
  buildUpiUriForReceipt,
  buildWhatsAppShareUrl,
  downloadReceiptHtml,
  formatInrPlain,
  getChannelDisplayLabel,
} from '../utils/receiptUtils';
import type {
  CreateReceiptNotifyInput,
  DispatchedReceiptResult,
} from '../services/firestoreOps';
import type {
  Customer,
  LedgerTransaction,
  NotificationChannel,
} from '../types';

export interface ReceiptModalRequest {
  mode: 'single' | 'broadcast';
  customerId?: string;
  transactionId?: string;
}

interface ReceiptNotificationModalProps {
  request: ReceiptModalRequest;
  customers: Customer[];
  transactions: LedgerTransaction[];
  onCreateSingle: (input: CreateReceiptNotifyInput) => Promise<DispatchedReceiptResult | null>;
  onBroadcastAll: (input: {
    customers: Customer[];
    transactions: LedgerTransaction[];
    channel: NotificationChannel;
    note?: string;
    upiVpa?: string;
    storeName?: string;
  }) => Promise<{ dispatchedCount: number; results: DispatchedReceiptResult[] }>;
  onClose: () => void;
}

function getSavedMerchantSettings(): { upiVpa: string; storeName: string } {
  try {
    return {
      upiVpa: localStorage.getItem('bolkhata_upi_vpa') || 'bolkhata.store@okaxis',
      storeName: localStorage.getItem('bolkhata_merchant_name') || 'BolKhata Wholesale',
    };
  } catch {
    return {
      upiVpa: 'bolkhata.store@okaxis',
      storeName: 'BolKhata Wholesale',
    };
  }
}

export const ReceiptNotificationModal: React.FC<ReceiptNotificationModalProps> = ({
  request,
  customers,
  transactions,
  onCreateSingle,
  onBroadcastAll,
  onClose,
}) => {
  const [{ upiVpa, storeName }] = useState(() => getSavedMerchantSettings());
  const [mode, setMode] = useState<'single' | 'broadcast'>(request.mode);

  // Single store state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    request.customerId || customers[0]?.id || ''
  );
  const [selectedTxId, setSelectedTxId] = useState<string>(request.transactionId || '');
  const [channel, setChannel] = useState<NotificationChannel>(
    request.mode === 'broadcast' ? 'BROADCAST' : 'WHATSAPP'
  );
  const [note, setNote] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [previewReceiptNo] = useState(() => buildReceiptNumber());

  // Broadcast state
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(
    () => new Set(customers.map((c) => c.id))
  );

  // Dispatch state
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dispatchedResults, setDispatchedResults] = useState<DispatchedReceiptResult[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const customerCompletedTxs = useMemo(
    () =>
      transactions.filter(
        (t) => t.customer_id === selectedCustomerId && t.status === 'COMPLETED'
      ),
    [transactions, selectedCustomerId]
  );

  const selectedTx = useMemo(() => {
    if (!selectedTxId) return null;
    return customerCompletedTxs.find((t) => t.id === selectedTxId) || null;
  }, [customerCompletedTxs, selectedTxId]);

  useEffect(() => {
    if (!selectedCustomer) {
      setCustomMessage('');
      return;
    }
    const itemName = selectedTx?.item_name || 'Khata Balance Statement';
    const qty = selectedTx?.qty ?? 0;
    const unit = selectedTx?.unit || 'statement';
    const totalAmount = selectedTx
      ? selectedTx.total_amount
      : selectedCustomer.current_udhaar_balance;
    const prevBal = selectedTx
      ? selectedTx.previous_balance
      : selectedCustomer.current_udhaar_balance;

    setCustomMessage(
      buildStoreNotificationMessage({
        receiptNumber: previewReceiptNo,
        storeName,
        customerName: selectedCustomer.name,
        itemName,
        qty,
        unit,
        totalAmount,
        txType: selectedTx?.type ?? 'UDHAAR',
        previousBalance: prevBal,
        newBalance: selectedCustomer.current_udhaar_balance,
        upiVpa,
        note: note.trim() || selectedTx?.note || undefined,
      })
    );
  }, [selectedCustomer, selectedTx, note, previewReceiptNo, storeName, upiVpa]);

  const previewAmount = selectedTx
    ? selectedTx.total_amount
    : selectedCustomer?.current_udhaar_balance ?? 0;

  const previewUpiUri = useMemo(() => {
    if (!selectedCustomer) return '';
    return buildUpiUriForReceipt({
      upiVpa,
      merchantName: storeName,
      amount:
        selectedCustomer.current_udhaar_balance > 0
          ? selectedCustomer.current_udhaar_balance
          : previewAmount,
      note: `${previewReceiptNo} ${selectedCustomer.name}`,
    });
  }, [selectedCustomer, upiVpa, storeName, previewAmount, previewReceiptNo]);

  const toggleStoreSelection = (id: string) => {
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId((cur) => (cur === key ? null : cur)), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleDispatchSingle = async () => {
    if (!selectedCustomer) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await onCreateSingle({
        customer: selectedCustomer,
        transaction: selectedTx,
        channel,
        customMessage: customMessage.trim(),
        note: note.trim() || undefined,
        upiVpa,
        storeName,
      });
      if (res) {
        setDispatchedResults([res]);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to create receipt and log notification.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDispatchBroadcast = async () => {
    const targets = customers.filter((c) => selectedStoreIds.has(c.id));
    if (targets.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await onBroadcastAll({
        customers: targets,
        transactions,
        channel,
        note: note.trim() || undefined,
        upiVpa,
        storeName,
      });
      setDispatchedResults(res.results);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to create receipts and notify selected stores.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create Receipt and Notify Store or Trader"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 inline-flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-700" />
              Digital Receipt (Parchi) & Store Notifications
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Issue verified Firestore receipts and dispatch WhatsApp, SMS, or Ledger notifications
              to individual or all stores
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode('single');
                if (channel === 'BROADCAST') setChannel('WHATSAPP');
                setDispatchedResults([]);
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'single'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Single Store / Trader
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('broadcast');
                setChannel('BROADCAST');
                setDispatchedResults([]);
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'broadcast'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              All Stores / Traders ({customers.length})
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>Channel:</span>
            {(
              (mode === 'broadcast'
                ? ['BROADCAST', 'WHATSAPP', 'SMS']
                : ['WHATSAPP', 'SMS', 'IN_APP']) as NotificationChannel[]
            ).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannel(ch)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  channel === ch
                    ? 'bg-blue-700 border-blue-700 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {getChannelDisplayLabel(ch)}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {errorMsg}
            </div>
          )}

          {dispatchedResults.length > 0 ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-sm font-semibold text-emerald-950">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>
                    Created {dispatchedResults.length}{' '}
                    {dispatchedResults.length === 1 ? 'digital Parchi' : 'digital Parchis'} &
                    logged store{' '}
                    {dispatchedResults.length === 1 ? 'notification' : 'notifications'} in
                    Firestore.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDispatchedResults([])}
                  className="text-xs font-medium text-emerald-800 underline underline-offset-2"
                >
                  Create Another
                </button>
              </div>

              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                {dispatchedResults.map(({ receipt, notification }) => {
                  const waUrl = buildWhatsAppShareUrl(
                    receipt.customer_phone,
                    notification.message
                  );
                  const smsUrl = buildSmsShareUrl(
                    receipt.customer_phone,
                    notification.message
                  );
                  return (
                    <div
                      key={receipt.id}
                      className="p-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-blue-800">
                            {receipt.receipt_number}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-900">
                            {receipt.customer_name}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-600">
                            {receipt.customer_phone}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600">
                          {receipt.qty > 0
                            ? `${receipt.qty} ${receipt.unit} ${receipt.item_name}`
                            : receipt.item_name}{' '}
                          <span aria-hidden="true">·</span> Amount{' '}
                          <strong className="font-mono text-slate-900 tabular-nums">
                            {formatInrPlain(receipt.total_amount)}
                          </strong>{' '}
                          <span aria-hidden="true">·</span> Udhaar Bal{' '}
                          <strong className="font-mono text-slate-900 tabular-nums">
                            {formatInrPlain(receipt.new_balance)}
                          </strong>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => downloadReceiptHtml(receipt, storeName)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Parchi (.html)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyText(notification.id, notification.message)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
                        >
                          {copiedId === notification.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedId === notification.id ? 'Copied' : 'Copy'}
                        </button>
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 whitespace-nowrap"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          WhatsApp
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <a
                          href={smsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 whitespace-nowrap"
                        >
                          <Send className="w-3.5 h-3.5" />
                          SMS
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : mode === 'single' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left: Controls & Message */}
              <div className="lg:col-span-7 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Store / Trader Account
                    </label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => {
                        setSelectedCustomerId(e.target.value);
                        setSelectedTxId('');
                      }}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    >
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({formatInrPlain(c.current_udhaar_balance)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Receipt Basis
                    </label>
                    <select
                      value={selectedTxId}
                      onChange={(e) => setSelectedTxId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    >
                      <option value="">Current Khata Balance Statement</option>
                      {customerCompletedTxs.slice(0, 15).map((tx) => (
                        <option key={tx.id} value={tx.id}>
                          {tx.tx_id} · {tx.qty > 0 ? `${tx.qty} ${tx.unit} ` : ''}
                          {tx.item_name} ({formatInrPlain(tx.total_amount)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Optional Note on Receipt
                  </label>
                  <input
                    type="text"
                    maxLength={250}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g., Kripya agle 3 din mein UPI par payment bhej dein"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-700">
                      Store / Trader Notification Message (Hinglish)
                    </label>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {customMessage.length}/1000
                    </span>
                  </div>
                  <textarea
                    rows={7}
                    maxLength={1000}
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700 leading-relaxed"
                  />
                </div>
              </div>

              {/* Right: Live Digital Parchi Preview */}
              <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
                  <div>
                    <div className="font-display text-sm font-bold text-slate-900">
                      {storeName}
                    </div>
                    <div className="text-[11px] text-slate-500">Digital Parchi Preview</div>
                  </div>
                  <div className="text-right font-mono text-[11px] text-slate-700">
                    <div className="font-semibold text-blue-800">{previewReceiptNo}</div>
                    <div>{selectedTx?.type ?? 'STATEMENT'}</div>
                  </div>
                </div>

                {selectedCustomer ? (
                  <>
                    <div className="text-xs space-y-1">
                      <div className="font-semibold text-slate-900">
                        {selectedCustomer.name}
                      </div>
                      <div className="text-slate-600">
                        {selectedCustomer.phone} · {selectedCustomer.location}
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1.5 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500">Entry</span>
                        <span className="font-medium text-slate-900 text-right">
                          {selectedTx
                            ? selectedTx.qty > 0
                              ? `${selectedTx.qty} ${selectedTx.unit} ${selectedTx.item_name}`
                              : selectedTx.item_name
                            : 'Khata Balance Statement'}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500">Amount</span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {formatInrPlain(previewAmount)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 border-t border-slate-100 pt-1.5">
                        <span className="text-slate-500">Current Udhaar</span>
                        <span className="font-mono font-bold text-blue-800 tabular-nums">
                          {formatInrPlain(selectedCustomer.current_udhaar_balance)}
                        </span>
                      </div>
                    </div>

                    {previewUpiUri && (
                      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg p-3">
                        <QRCodeSVG
                          value={previewUpiUri}
                          size={72}
                          level="M"
                          bgColor="#ffffff"
                          fgColor="#0f172a"
                        />
                        <div className="text-[11px] text-slate-600 space-y-0.5 min-w-0">
                          <div className="font-semibold text-slate-800">
                            UPI Payment QR Included
                          </div>
                          <div className="font-mono truncate">{upiVpa}</div>
                          <div>Scan to settle balance</div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Select a store or trader account.</p>
                )}
              </div>
            </div>
          ) : (
            /* Broadcast Mode */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-600">
                  Select which stores/traders should receive a freshly generated digital Parchi &
                  personalized Khata balance notification:
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedStoreIds(new Set(customers.map((c) => c.id)))}
                    className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                  >
                    Select All ({customers.length})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStoreIds(
                        new Set(
                          customers
                            .filter((c) => c.current_udhaar_balance > 0)
                            .map((c) => c.id)
                        )
                      )
                    }
                    className="px-2.5 py-1 font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100"
                  >
                    With Udhaar Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStoreIds(new Set())}
                    className="px-2.5 py-1 font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Broadcast Note (included on every store&rsquo;s Parchi & notification)
                </label>
                <input
                  type="text"
                  maxLength={250}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g., Weekly Khata Parchi update — UPI QR se payment kar sakte hain"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2 px-4 w-10">Send</th>
                      <th className="py-2 px-3">Store / Trader</th>
                      <th className="py-2 px-3">Phone & Market</th>
                      <th className="py-2 px-4 text-right">Current Udhaar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customers.map((cust) => {
                      const checked = selectedStoreIds.has(cust.id);
                      return (
                        <tr
                          key={cust.id}
                          onClick={() => toggleStoreSelection(cust.id)}
                          className="hover:bg-slate-50 cursor-pointer"
                        >
                          <td className="py-2.5 px-4">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleStoreSelection(cust.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {cust.name}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {cust.phone} · {cust.location}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                            {formatInrPlain(cust.current_udhaar_balance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {mode === 'single'
              ? 'Persists receipt & notification record to Firestore with strict owner isolation.'
              : `${selectedStoreIds.size} of ${customers.length} stores selected for individualized Parchis.`}
          </span>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              Close
            </button>

            {dispatchedResults.length === 0 && (
              <button
                type="button"
                disabled={
                  busy ||
                  (mode === 'single' ? !selectedCustomer : selectedStoreIds.size === 0)
                }
                onClick={
                  mode === 'single' ? handleDispatchSingle : handleDispatchBroadcast
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <BellRing className="w-3.5 h-3.5" />
                {busy
                  ? 'Creating & Dispatching...'
                  : mode === 'single'
                  ? 'Create Receipt & Notify Store'
                  : `Create Receipts & Notify ${selectedStoreIds.size} Stores`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
