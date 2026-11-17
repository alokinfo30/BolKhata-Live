import React, { useState } from 'react';
import { Check, Search } from 'lucide-react';
import type {
  Customer,
  InventoryItem,
  LedgerTransaction,
  RestockOrder,
} from '../types';

interface KhataInventoryViewProps {
  customers: Customer[];
  inventory: InventoryItem[];
  transactions: LedgerTransaction[];
  restocks: RestockOrder[];
  lowStockOnly: boolean;
  onToggleLowStockOnly: (val: boolean) => void;
  onRecordJamaPayment: (customer: Customer, amount: number) => Promise<void>;
  onMarkRestockReceived: (restockId: string) => Promise<void>;
}

function formatInr(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

export const KhataInventoryView: React.FC<KhataInventoryViewProps> = ({
  customers,
  inventory,
  transactions,
  restocks,
  lowStockOnly,
  onToggleLowStockOnly,
  onRecordJamaPayment,
  onMarkRestockReceived,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [txFilter, setTxFilter] = useState<'ALL' | 'UDHAAR' | 'JAMA' | 'UNDONE'>('ALL');
  const [jamaCustomer, setJamaCustomer] = useState<Customer | null>(null);
  const [jamaAmount, setJamaAmount] = useState('');
  const [jamaBusy, setJamaBusy] = useState(false);

  const q = searchQuery.trim().toLowerCase();

  const filteredCustomers = customers.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.location.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q)
  );

  const lowStockCount = inventory.filter((i) => i.stock_qty < i.reorder_threshold).length;

  const filteredInventory = inventory.filter((i) => {
    if (lowStockOnly && i.stock_qty >= i.reorder_threshold) return false;
    return (
      !q ||
      i.name.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q) ||
      i.aliases.some((a) => a.toLowerCase().includes(q))
    );
  });

  const filteredTransactions = transactions.filter((t) => {
    if (txFilter === 'UNDONE' && t.status !== 'UNDONE') return false;
    if (txFilter === 'UDHAAR' && t.type !== 'UDHAAR') return false;
    if (txFilter === 'JAMA' && t.type !== 'JAMA') return false;
    if (!q) return true;
    return (
      t.customer_name.toLowerCase().includes(q) ||
      t.item_name.toLowerCase().includes(q) ||
      t.tx_id.toLowerCase().includes(q)
    );
  });

  const handleJamaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jamaCustomer) return;
    const amt = Number(jamaAmount);
    if (!amt || amt <= 0) return;
    setJamaBusy(true);
    try {
      await onRecordJamaPayment(jamaCustomer, amt);
      setJamaCustomer(null);
      setJamaAmount('');
    } finally {
      setJamaBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter customers, SKUs, Hinglish aliases, or transactions..."
            className="w-full pl-9 pr-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-700"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['ALL', 'UDHAAR', 'JAMA', 'UNDONE'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setTxFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                txFilter === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'ALL' ? 'All Entries' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Inline Jama Payment Form */}
      {jamaCustomer && (
        <form
          onSubmit={handleJamaSubmit}
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="text-sm text-emerald-950">
            Recording <strong>Jama (Payment Received)</strong> for{' '}
            <strong>{jamaCustomer.name}</strong> · Current Udhaar:{' '}
            <span className="font-mono font-semibold tabular-nums">
              {formatInr(jamaCustomer.current_udhaar_balance)}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <input
              type="number"
              min={1}
              required
              value={jamaAmount}
              onChange={(e) => setJamaAmount(e.target.value)}
              placeholder="Amount (₹)"
              className="w-36 px-3 py-1.5 text-sm font-mono bg-white border border-emerald-300 rounded-lg focus:outline-none"
            />
            <button
              type="submit"
              disabled={jamaBusy}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {jamaBusy ? 'Saving...' : 'Confirm Jama'}
            </button>
            <button
              type="button"
              onClick={() => setJamaCustomer(null)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Customer Khata Ledger Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Customer Khata & Credit Limits
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live Firestore balances · Credit utilization monitored before every Udhaar write
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredCustomers.length} accounts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <th className="py-2.5 px-6">Trader / Store</th>
                <th className="py-2.5 px-4">Phone & Market</th>
                <th className="py-2.5 px-4 text-right">Current Udhaar</th>
                <th className="py-2.5 px-4 text-right">Credit Limit</th>
                <th className="py-2.5 px-4">Utilization</th>
                <th className="py-2.5 px-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.map((cust) => {
                const ratio =
                  cust.credit_limit > 0
                    ? Math.min(100, Math.round((cust.current_udhaar_balance / cust.credit_limit) * 100))
                    : 0;
                const overLimit = cust.current_udhaar_balance > cust.credit_limit;
                return (
                  <tr key={cust.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-6 font-medium text-slate-900">{cust.name}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {cust.phone} <span aria-hidden="true">·</span> {cust.location}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono font-semibold tabular-nums ${
                        overLimit ? 'text-red-700' : 'text-slate-900'
                      }`}
                    >
                      {formatInr(cust.current_udhaar_balance)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600 tabular-nums">
                      {formatInr(cust.credit_limit)}
                    </td>
                    <td className="py-3 px-4 w-44">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              overLimit
                                ? 'bg-red-600'
                                : ratio >= 80
                                ? 'bg-amber-600'
                                : 'bg-blue-700'
                            }`}
                            style={{ width: `${ratio}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs text-slate-600 tabular-nums w-10 text-right">
                          {ratio}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-6 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setJamaCustomer(cust);
                          setJamaAmount('');
                        }}
                        className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors whitespace-nowrap"
                      >
                        Log Jama
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Live Inventory & Auto-Restock POs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Live Godown Inventory
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Hinglish voice aliases mapped directly to SKU counts
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onToggleLowStockOnly(!lowStockOnly)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  lowStockOnly
                    ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Below Reorder ({lowStockCount})
              </button>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {filteredInventory.length} items
              </span>
            </div>
          </div>

          {lowStockOnly && (
            <div className="px-6 py-2.5 bg-amber-50/70 border-b border-amber-200 flex items-center justify-between gap-3 text-xs text-amber-900">
              <span>
                Filtered to items currently below their reorder threshold ({filteredInventory.length} matching).
              </span>
              <button
                type="button"
                onClick={() => onToggleLowStockOnly(false)}
                className="font-semibold underline underline-offset-2 hover:text-amber-950 whitespace-nowrap shrink-0"
              >
                Show All SKUs
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-6">Product & Aliases</th>
                  <th className="py-2.5 px-4 text-right">Rate</th>
                  <th className="py-2.5 px-4 text-right">Stock</th>
                  <th className="py-2.5 px-6 text-right">Reorder At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-xs text-slate-500">
                      {lowStockOnly
                        ? 'All inventory items are currently at or above their reorder threshold.'
                        : 'No inventory items match your search.'}
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map((item) => {
                    const isLow = item.stock_qty < item.reorder_threshold;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-6">
                          <div className="font-medium text-slate-900">{item.name}</div>
                          <div className="text-xs text-slate-500">
                            <span className="font-mono">{item.sku}</span> · {item.aliases.join(' / ')}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-900 tabular-nums">
                          {formatInr(item.unit_price)}/{item.unit}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-semibold tabular-nums ${
                            isLow ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {item.stock_qty} {item.unit}
                        </td>
                      <td className="py-3 px-6 text-right font-mono text-xs text-slate-500 tabular-nums">
                        &lt; {item.reorder_threshold} {item.unit}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Supplier Restock Purchase Orders */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Distributor Restock POs
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Auto-triggered when stock falls below threshold
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {restocks.length} orders
            </span>
          </div>

          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {restocks.length === 0 ? (
              <p className="text-xs text-slate-500 p-6 text-center">
                No distributor restock POs triggered yet.
              </p>
            ) : (
              restocks.map((po) => (
                <div key={po.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {po.po_number} · {po.status}
                    </span>
                    <span className="font-mono text-xs text-slate-700 tabular-nums">
                      Est {formatInr(po.estimated_cost)}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-slate-900">
                    {po.order_qty} {po.unit} {po.item_name}
                  </div>
                  <div className="text-xs text-slate-500">
                    Supplier: {po.supplier_name} · {po.reason}
                  </div>
                  {po.status === 'ORDERED' && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => onMarkRestockReceived(po.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100"
                      >
                        <Check className="w-3 h-3" />
                        Mark Received
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Full Transaction Audit Log */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Transaction Audit Ledger
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredTransactions.length} records
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <th className="py-2.5 px-6">TX ID</th>
                <th className="py-2.5 px-4">Customer</th>
                <th className="py-2.5 px-4">Item & Qty</th>
                <th className="py-2.5 px-4">Type / Status</th>
                <th className="py-2.5 px-6 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                    No matching transactions recorded yet.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className={`hover:bg-slate-50/70 ${
                      tx.status === 'UNDONE' ? 'opacity-50 line-through' : ''
                    }`}
                  >
                    <td className="py-3 px-6 font-mono text-xs text-slate-600">{tx.tx_id}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">{tx.customer_name}</td>
                    <td className="py-3 px-4 text-slate-700">
                      {tx.qty > 0 ? `${tx.qty} ${tx.unit} ${tx.item_name}` : tx.item_name}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {tx.type} <span aria-hidden="true">·</span> {tx.status}
                    </td>
                    <td className="py-3 px-6 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatInr(tx.total_amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
