import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_VOICE_COMMANDS_CATALOG,
  computeOperationalImpact,
  getContextualAutoSuggestions,
} from '../src/utils/voiceSuggestions';
import type {
  ApprovalRequest,
  Customer,
  CustomerComplaint,
  DeliveryRecord,
  InventoryItem,
  LedgerTransaction,
  Receipt,
  RestockOrder,
} from '../src/types';

describe('Context-Aware Voice Auto-Suggest & Impact Metrics', () => {
  const customers: Customer[] = [
    {
      id: 'c1',
      ownerId: 'u1',
      name: 'Sharma General Store',
      phone: '+919876543210',
      location: 'Chandni Chowk',
      current_udhaar_balance: 15000,
      credit_limit: 50000,
    },
  ];

  const inventory: InventoryItem[] = [
    {
      id: 'i1',
      ownerId: 'u1',
      sku: 'RICE_25KG',
      name: 'Basmati Rice 25kg',
      unit: 'bori',
      aliases: ['chawal'],
      stock_qty: 4,
      unit_price: 2200,
      reorder_threshold: 10,
      supplier_name: 'Punjab Agro',
    },
  ];

  const approvals: ApprovalRequest[] = [
    {
      id: 'a1',
      ownerId: 'u1',
      approval_id: 'APR-1',
      customer_id: 'c1',
      customer_name: 'Verma Traders',
      item_sku: 'OIL_15L',
      item_name: 'Refined Oil 15L',
      unit: 'peti',
      qty: 50,
      total_amount: 90000,
      tx_type: 'UDHAAR',
      reason: 'Exceeds ₹50,000 limit',
      status: 'PENDING',
      approved_by: '',
    },
  ];

  const deliveries: DeliveryRecord[] = [
    {
      id: 'd1',
      ownerId: 'u1',
      delivery_id: 'del_1',
      customer_id: '',
      customer_name: 'Rahul',
      order_summary: '10 bori Basmati Rice',
      status: 'PENDING',
      note: 'Evening run',
    },
  ];

  const complaints: CustomerComplaint[] = [
    {
      id: 'cmp1',
      ownerId: 'u1',
      ticket_number: 'CMP-20260515-AAAA',
      customer_id: 'c1',
      customer_name: 'Sharma General Store',
      category: 'QUALITY',
      severity: 'HIGH',
      description: 'Torn sack',
      status: 'OPEN',
      resolution_note: '',
    },
  ];

  const transactions: LedgerTransaction[] = [
    {
      id: 't1',
      ownerId: 'u1',
      tx_id: 'tx_1',
      customer_id: 'c1',
      customer_name: 'Sharma General Store',
      item_sku: 'RICE_25KG',
      item_name: 'Basmati Rice 25kg',
      unit: 'bori',
      qty: 5,
      unit_price: 2200,
      total_amount: 11000,
      type: 'UDHAAR',
      status: 'COMPLETED',
      previous_balance: 4000,
      previous_stock: 9,
      note: 'Counter sale',
    },
    {
      id: 't2',
      ownerId: 'u1',
      tx_id: 'tx_2',
      customer_id: 'c1',
      customer_name: 'Sharma General Store',
      item_sku: 'RICE_25KG',
      item_name: 'Basmati Rice 25kg',
      unit: 'bori',
      qty: 2,
      unit_price: 2200,
      total_amount: 4400,
      type: 'UDHAAR',
      status: 'UNDONE',
      previous_balance: 15000,
      previous_stock: 4,
      note: 'Rolled back',
    },
  ];

  const restocks: RestockOrder[] = [
    {
      id: 'r1',
      ownerId: 'u1',
      po_number: 'PO-101',
      item_sku: 'RICE_25KG',
      item_name: 'Basmati Rice 25kg',
      supplier_name: 'Punjab Agro',
      order_qty: 25,
      unit: 'bori',
      estimated_cost: 55000,
      reason: 'Low stock auto-reorder',
      status: 'ORDERED',
    },
  ];

  const receipts: Receipt[] = [
    {
      id: 'rc1',
      ownerId: 'u1',
      receipt_number: 'RCP-1001',
      tx_id: 'tx_1',
      customer_id: 'c1',
      customer_name: 'Sharma General Store',
      customer_phone: '+919876543210',
      customer_location: 'Chandni Chowk',
      item_name: 'Basmati Rice 25kg',
      qty: 5,
      unit: 'bori',
      unit_price: 2200,
      total_amount: 11000,
      tx_type: 'UDHAAR',
      previous_balance: 4000,
      new_balance: 15000,
      note: 'Digital parchi',
      upi_uri: 'upi://pay',
      status: 'SENT',
    },
  ];

  it('includes Hinglish, Hindi, English, and regional voice command examples covering all core tools', () => {
    const langs = new Set(AVAILABLE_VOICE_COMMANDS_CATALOG.map((c) => c.language));
    expect(langs.has('hinglish')).toBe(true);
    expect(langs.has('hindi')).toBe(true);
    expect(langs.has('english')).toBe(true);
    expect(langs.has('regional')).toBe(true);

    const commands = AVAILABLE_VOICE_COMMANDS_CATALOG.map((c) => c.command);
    expect(commands).toContain('Aaj ki sales ka summary batao.');
    expect(commands).toContain('Rahul ki delivery pending mark kar do.');
    expect(commands).toContain('Kal ke orders ka report bana do.');
    expect(commands).toContain('Is customer ki complaint register karo.');
  });

  it('adapts Auto-Suggest output to the active tab and live alerts', () => {
    const khataSuggestions = getContextualAutoSuggestions({
      activeTab: 'khata',
      recentUserInputs: [],
      customers,
      inventory,
      approvals,
      deliveries,
      complaints,
      transactions,
    });
    expect(khataSuggestions[0].command).toContain('Basmati Rice 25kg');
    expect(khataSuggestions[0].contextHint).toContain('Low stock alert');

    const approvalSuggestions = getContextualAutoSuggestions({
      activeTab: 'approvals',
      recentUserInputs: [],
      customers,
      inventory,
      approvals,
      deliveries,
      complaints,
      transactions,
    });
    expect(approvalSuggestions[0].command).toContain('Verma Traders');
  });

  it('adapts Auto-Suggest follow-ups from recent user command history and filters by typed query', () => {
    const followUps = getContextualAutoSuggestions({
      activeTab: 'counter',
      recentUserInputs: ['Aaj ki sales ka summary batao.'],
      customers,
      inventory,
      approvals,
      deliveries,
      complaints,
      transactions,
    });
    expect(followUps[0].source).toBe('history');
    expect(followUps[0].command).toContain('Kal ke orders');

    const filtered = getContextualAutoSuggestions({
      activeTab: 'counter',
      currentQuery: 'rahul delivery',
      recentUserInputs: [],
      customers,
      inventory,
      approvals,
      deliveries,
      complaints,
      transactions,
    });
    expect(filtered[0].command.toLowerCase()).toContain('rahul');
  });

  it('calculates verifiable operational impact strictly from real collection counts', () => {
    const impact = computeOperationalImpact({
      transactions,
      approvals,
      restocks,
      deliveries,
      complaints,
      receipts,
    });

    // 1 completed tx + 1 restock + 1 delivery + 1 complaint + 1 receipt = 5 tasks
    expect(impact.completedTasksCount).toBe(5);
    expect(impact.estimatedMinutesSaved).toBe(10);
    // 1 HITL guard + 1 undo recovery + 1 auto-restock = 3
    expect(impact.errorsPreventedOrRecovered).toBe(3);
    expect(impact.hitlGuardsTriggered).toBe(1);
    expect(impact.undoRecoveries).toBe(1);
    expect(impact.autoRestocksTriggered).toBe(1);
  });
});
