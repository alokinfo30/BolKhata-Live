import React, { useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';
import type { ApprovalRequest } from '../types';

interface ApprovalsHistoryViewProps {
  approvals: ApprovalRequest[];
  onResolveApproval: (approval: ApprovalRequest, decision: 'APPROVED' | 'REJECTED') => Promise<void>;
  resolvingId: string | null;
}

function formatInr(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

export const ApprovalsHistoryView: React.FC<ApprovalsHistoryViewProps> = ({
  approvals,
  onResolveApproval,
  resolvingId,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');

  const filtered = approvals.filter((a) => filter === 'ALL' || a.status === filter);
  const pendingCount = approvals.filter((a) => a.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Manager Override & Exception Desk
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time Human-in-the-Loop approvals across all connected owner sessions
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filter === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'PENDING' ? `Pending (${pendingCount})` : tab}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-slate-700">No approval records matching filter</p>
          <p className="text-xs text-slate-500 mt-1">
            Whenever a voice order exceeds ₹50,000 or breaches a customer&apos;s credit limit, it pauses here for review.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((apr) => {
            const isPending = apr.status === 'PENDING';
            const busy = resolvingId === apr.id;
            return (
              <div
                key={apr.id}
                className={`border rounded-xl p-5 space-y-4 ${
                  isPending
                    ? 'bg-amber-50/50 border-amber-300'
                    : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                      {isPending && <ShieldAlert className="w-4 h-4 text-amber-700" />}
                      <span
                        className={
                          apr.status === 'APPROVED'
                            ? 'text-emerald-700 font-semibold'
                            : apr.status === 'REJECTED'
                            ? 'text-red-700 font-semibold'
                            : 'text-amber-800 font-semibold'
                        }
                      >
                        {apr.status}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{apr.approval_id}</span>
                    </div>
                    <h3 className="text-base font-semibold text-slate-900">
                      {apr.customer_name}
                    </h3>
                    <p className="text-sm text-slate-700">
                      {apr.qty} {apr.unit} {apr.item_name} ({apr.tx_type})
                    </p>
                  </div>

                  <div className="font-mono text-lg font-bold text-slate-900 tabular-nums shrink-0">
                    {formatInr(apr.total_amount)}
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">{apr.reason}</p>

                {isPending ? (
                  <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-amber-200">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onResolveApproval(apr, 'REJECTED')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onResolveApproval(apr, 'APPROVED')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {busy ? 'Executing...' : 'Approve & Execute'}
                    </button>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-slate-100 text-xs text-slate-500">
                    Reviewed by {apr.approved_by || 'Store Owner'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
