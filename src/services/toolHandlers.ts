import {
  checkBusinessPolicy,
  createReceiptAndNotifyByVoice,
  createSupplierRestock,
  executeLedgerAndInventoryTx,
  logAgentTrace,
  lookupCustomerAndStock,
  requestHumanApproval,
  undoLastTransaction,
} from './firestoreOps';
import type { TxType } from '../types';

export async function executeBackendTool(
  ownerId: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const tStart = performance.now();
  let result: Record<string, unknown> = {};

  try {
    if (name === 'lookup_customer_and_stock') {
      result = await lookupCustomerAndStock(ownerId, {
        customer_name: args.customer_name as string | undefined,
        item_name: args.item_name as string | undefined,
      });
      const ms = Math.round(performance.now() - tStart);
      const custFound = result.found_customer as {
        name?: string;
        current_udhaar_balance?: number;
      } | null;
      const itemFound = result.found_item as {
        name?: string;
        stock_qty?: number;
        unit?: string;
      } | null;
      await logAgentTrace(
        ownerId,
        sessionId,
        'TOOL_CALL',
        `lookup_customer_and_stock() -> ${ms}ms`,
        `${
          custFound
            ? `${custFound.name} (Bal ₹${custFound.current_udhaar_balance})`
            : 'No customer'
        } · ${
          itemFound
            ? `${itemFound.name} (${itemFound.stock_qty} ${itemFound.unit})`
            : 'No item'
        }`,
        ms
      );
    } else if (name === 'check_business_policy') {
      result = await checkBusinessPolicy(ownerId, {
        customer_id: String(args.customer_id || ''),
        item_sku: args.item_sku as string | undefined,
        qty: Number(args.qty ?? 0),
        total_amount: Number(args.total_amount ?? 0),
        tx_type: String(args.tx_type || 'UDHAAR').toUpperCase() as TxType,
      });
      const ms = Math.round(performance.now() - tStart);
      const violations = (result.violations as string[]) || [];
      await logAgentTrace(
        ownerId,
        sessionId,
        'POLICY_CHECK',
        result.policy_passed
          ? `Policy Verified -> ${ms}ms`
          : `Policy Exception Flagged -> ${ms}ms`,
        violations.length > 0
          ? violations.join(' ')
          : `Projected Udhaar ₹${result.projected_udhaar_balance} within ₹${result.credit_limit} limit`,
        ms
      );
    } else if (name === 'request_human_approval') {
      result = await requestHumanApproval(ownerId, {
        customer_id: String(args.customer_id || ''),
        customer_name: String(args.customer_name || ''),
        item_sku: String(args.item_sku || ''),
        item_name: String(args.item_name || ''),
        unit: (args.unit as string | undefined) || 'peti',
        qty: Number(args.qty ?? 0),
        total_amount: Number(args.total_amount ?? 0),
        tx_type: String(args.tx_type || 'UDHAAR').toUpperCase() as TxType,
        reason: String(args.reason || 'Credit/value limit exceeded'),
      });
      const ms = Math.round(performance.now() - tStart);
      await logAgentTrace(
        ownerId,
        sessionId,
        'HITL_PAUSE',
        `HITL Paused: Waiting for Owner Approval`,
        `${args.customer_name} · ₹${Number(args.total_amount || 0).toLocaleString('en-IN')} · ${args.reason}`,
        ms
      );
    } else if (name === 'execute_ledger_and_inventory_tx') {
      result = await executeLedgerAndInventoryTx(ownerId, {
        customer_id: String(args.customer_id || ''),
        item_sku: args.item_sku as string | undefined,
        qty: Number(args.qty ?? 0),
        total_amount: Number(args.total_amount ?? 0),
        tx_type: String(args.tx_type || 'UDHAAR').toUpperCase() as TxType,
        user_confirmed: Boolean(args.user_confirmed),
        note: args.note as string | undefined,
      });
      const ms = Math.round(performance.now() - tStart);
      if (result.executed) {
        await logAgentTrace(
          ownerId,
          sessionId,
          'EXECUTED',
          `Ledger & Stock Updated -> ${ms}ms`,
          `${result.customer_name} · ${result.qty} ${result.unit} ${result.item_name} · New Bal ₹${result.new_balance} · Rem Stock ${result.remaining_stock}`,
          ms
        );
      } else {
        await logAgentTrace(
          ownerId,
          sessionId,
          'ERROR',
          `Transaction Guard Blocked`,
          String(result.error || 'Confirmation or policy guard prevented write'),
          ms
        );
      }
    } else if (name === 'create_supplier_restock') {
      result = await createSupplierRestock(ownerId, {
        item_sku: String(args.item_sku || ''),
        item_name: args.item_name as string | undefined,
        order_qty: args.order_qty ? Number(args.order_qty) : undefined,
        reason: String(args.reason || 'Below reorder threshold'),
      });
      const ms = Math.round(performance.now() - tStart);
      await logAgentTrace(
        ownerId,
        sessionId,
        'RESTOCK',
        `Auto Restock ${result.po_number} Created -> ${ms}ms`,
        `${result.order_qty} ${result.unit} from ${result.supplier_name} (Est ₹${result.estimated_cost})`,
        ms
      );
    } else if (name === 'undo_last_transaction') {
      result = await undoLastTransaction(ownerId, args.reason as string | undefined);
      const ms = Math.round(performance.now() - tStart);
      await logAgentTrace(
        ownerId,
        sessionId,
        'UNDO',
        result.undone ? `Voice Undo Executed -> ${ms}ms` : 'No Entry to Undo',
        result.undone
          ? `Rolled back ${result.customer_name} (${result.item_name}). Restored Bal ₹${result.restored_balance}, Stock ${result.restored_stock}`
          : String(result.message || ''),
        ms
      );
    } else if (name === 'create_receipt_and_notify_store') {
      result = await createReceiptAndNotifyByVoice(ownerId, {
        customer_name: args.customer_name as string | undefined,
        notify_all_stores: Boolean(args.notify_all_stores),
        channel: args.channel as string | undefined,
        note: args.note as string | undefined,
      });
      const ms = Math.round(performance.now() - tStart);
      await logAgentTrace(
        ownerId,
        sessionId,
        result.ok ? 'EXECUTED' : 'ERROR',
        result.ok
          ? result.mode === 'ALL_STORES'
            ? `Receipts & Notifications Sent to ${result.dispatched_count} Stores -> ${ms}ms`
            : `Receipt ${result.receipt_number} Sent -> ${ms}ms`
          : 'Receipt Dispatch Failed',
        result.ok
          ? result.mode === 'ALL_STORES'
            ? `Created digital Parchis and dispatched store notifications across ${result.dispatched_count} accounts.`
            : `${result.customer_name} (${result.customer_phone}) · Channel ${result.channel} · Bal ₹${result.new_balance}`
          : String(result.error || 'Could not dispatch store receipt'),
        ms
      );
    }
  } catch (err) {
    result = { error: err instanceof Error ? err.message : 'Tool execution error' };
    await logAgentTrace(
      ownerId,
      sessionId,
      'ERROR',
      `Tool Error: ${name}`,
      String(result.error),
      Math.round(performance.now() - tStart)
    );
  }

  return result;
}
