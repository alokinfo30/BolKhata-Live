import { describe, expect, it } from 'vitest';
import {
  buildComplaintTicketNumber,
  buildSalesAndOrdersReport,
  formatOperationalReportText,
  resolveReportTimeframe,
} from '../src/utils/operationsReports';
import type {
  Customer,
  CustomerComplaint,
  DeliveryRecord,
  InventoryItem,
  LedgerTransaction,
} from '../src/types';

function makeMockTimestamp(date: Date) {
  return { toMillis: () => date.getTime() } as unknown as LedgerTransaction['createdAt'];
}

describe('Operational Reports & Hinglish Timeframe Utilities', () => {
  const fixedNow = new Date(2026, 4, 15, 14, 30, 0); // 15 May 2026, 2:30 PM
  const todayMorning = new Date(2026, 4, 15, 10, 15, 0);
  const yesterdayAfternoon = new Date(2026, 4, 14, 16, 45, 0);

  const sampleCustomers: Customer[] = [
    {
      id: 'cust_sharma',
      ownerId: 'u1',
      name: 'Sharma General Store',
      phone: '+919876543210',
      location: 'Chandni Chowk',
      current_udhaar_balance: 18500,
      credit_limit: 50000,
    },
    {
      id: 'cust_verma',
      ownerId: 'u1',
      name: 'Verma Traders',
      phone: '+919876543211',
      location: 'Sadar Bazar',
      current_udhaar_balance: 42000,
      credit_limit: 50000,
    },
  ];

  const sampleInventory: InventoryItem[] = [
    {
      id: 'inv_rice',
      ownerId: 'u1',
      sku: 'RICE_25KG',
      name: 'Basmati Rice 25kg',
      unit: 'bori',
      aliases: ['chawal', 'rice'],
      stock_qty: 8,
      unit_price: 2200,
      reorder_threshold: 10,
      supplier_name: 'Punjab Agro Mills',
    },
  ];

  const sampleDeliveries: DeliveryRecord[] = [
    {
      id: 'del_1',
      ownerId: 'u1',
      delivery_id: 'del_1',
      customer_id: '',
      customer_name: 'Rahul',
      order_summary: '10 bori Basmati Rice',
      status: 'PENDING',
      note: 'Evening dispatch',
    },
    {
      id: 'del_2',
      ownerId: 'u1',
      delivery_id: 'del_2',
      customer_id: 'cust_sharma',
      customer_name: 'Sharma General Store',
      order_summary: '5 peti Refined Oil',
      status: 'DELIVERED',
      note: 'Completed',
    },
  ];

  const sampleComplaints: CustomerComplaint[] = [
    {
      id: 'cmp_1',
      ownerId: 'u1',
      ticket_number: 'CMP-20260515-ABCD',
      customer_id: 'cust_verma',
      customer_name: 'Verma Traders',
      category: 'QUALITY',
      severity: 'HIGH',
      description: '2 bori torn packaging',
      status: 'OPEN',
      resolution_note: '',
    },
    {
      id: 'cmp_2',
      ownerId: 'u1',
      ticket_number: 'CMP-20260514-EFGH',
      customer_id: 'cust_sharma',
      customer_name: 'Sharma General Store',
      category: 'BILLING',
      severity: 'LOW',
      description: 'Rate clarified',
      status: 'RESOLVED',
      resolution_note: 'Adjusted in Khata',
    },
  ];

  const sampleTransactions: LedgerTransaction[] = [
    {
      id: 'tx_1',
      ownerId: 'u1',
      tx_id: 'tx_1',
      customer_id: 'cust_sharma',
      customer_name: 'Sharma General Store',
      item_sku: 'RICE_25KG',
      item_name: 'Basmati Rice 25kg',
      qty: 5,
      unit: 'bori',
      unit_price: 2200,
      total_amount: 11000,
      type: 'UDHAAR',
      status: 'COMPLETED',
      previous_balance: 7500,
      previous_stock: 13,
      note: 'Today Udhaar',
      createdAt: makeMockTimestamp(todayMorning),
    },
    {
      id: 'tx_2',
      ownerId: 'u1',
      tx_id: 'tx_2',
      customer_id: 'cust_sharma',
      customer_name: 'Sharma General Store',
      item_sku: 'PAYMENT_JAMA',
      item_name: 'Jama Payment',
      qty: 0,
      unit: 'INR',
      unit_price: 0,
      total_amount: 5000,
      type: 'JAMA',
      status: 'COMPLETED',
      previous_balance: 23500,
      previous_stock: 0,
      note: 'Cash received',
      createdAt: makeMockTimestamp(todayMorning),
    },
    {
      id: 'tx_3',
      ownerId: 'u1',
      tx_id: 'tx_3',
      customer_id: 'cust_verma',
      customer_name: 'Verma Traders',
      item_sku: 'RICE_25KG',
      item_name: 'Basmati Rice 25kg',
      qty: 2,
      unit: 'bori',
      unit_price: 2200,
      total_amount: 4400,
      type: 'UDHAAR',
      status: 'UNDONE',
      previous_balance: 42000,
      previous_stock: 10,
      note: 'Cancelled entry',
      createdAt: makeMockTimestamp(todayMorning),
    },
    {
      id: 'tx_4',
      ownerId: 'u1',
      tx_id: 'tx_4',
      customer_id: 'cust_verma',
      customer_name: 'Verma Traders',
      item_sku: 'OIL_15L',
      item_name: 'Refined Oil 15L',
      qty: 10,
      unit: 'peti',
      unit_price: 1800,
      total_amount: 18000,
      type: 'CASH_SALE',
      status: 'COMPLETED',
      previous_balance: 42000,
      previous_stock: 30,
      note: 'Yesterday cash order',
      createdAt: makeMockTimestamp(yesterdayAfternoon),
    },
  ];

  it('resolves Hinglish and English report timeframes accurately', () => {
    expect(resolveReportTimeframe('aaj', fixedNow).period).toBe('today');
    expect(resolveReportTimeframe('kal', fixedNow).period).toBe('yesterday');
    expect(resolveReportTimeframe('yesterday', fixedNow).period).toBe('yesterday');
    expect(resolveReportTimeframe('hafta', fixedNow).period).toBe('last_7_days');
    expect(resolveReportTimeframe('mahina', fixedNow).period).toBe('last_30_days');
    expect(resolveReportTimeframe('all', fixedNow).period).toBe('all');
  });

  it('computes today sales summary excluding undone entries and counting pending ops', () => {
    const report = buildSalesAndOrdersReport({
      period: 'aaj',
      transactions: sampleTransactions,
      customers: sampleCustomers,
      inventory: sampleInventory,
      deliveries: sampleDeliveries,
      complaints: sampleComplaints,
      now: fixedNow,
    });

    expect(report.period).toBe('today');
    expect(report.completed_orders_count).toBe(2);
    expect(report.undone_orders_count).toBe(1);
    expect(report.udhaar_issued_inr).toBe(11000);
    expect(report.jama_collected_inr).toBe(5000);
    expect(report.cash_sales_inr).toBe(0);
    expect(report.total_sales_inr).toBe(11000);
    expect(report.outstanding_udhaar_total_inr).toBe(60500);
    expect(report.pending_deliveries_count).toBe(1);
    expect(report.open_complaints_count).toBe(1);
    expect(report.low_stock_skus_count).toBe(1);
    expect(report.spoken_summary_hinglish).toContain('Aaj');
    expect(report.spoken_summary_hinglish).toContain('11,000');
  });

  it('filters yesterday (kal) orders cleanly without leaking today transactions', () => {
    const report = buildSalesAndOrdersReport({
      period: 'kal',
      transactions: sampleTransactions,
      customers: sampleCustomers,
      inventory: sampleInventory,
      deliveries: sampleDeliveries,
      complaints: sampleComplaints,
      now: fixedNow,
    });

    expect(report.period).toBe('yesterday');
    expect(report.completed_orders_count).toBe(1);
    expect(report.cash_sales_inr).toBe(18000);
    expect(report.total_sales_inr).toBe(18000);
    expect(report.orders).toHaveLength(1);
    expect(report.orders[0].customer_name).toBe('Verma Traders');
    expect(report.spoken_summary_hinglish).toContain('Kal');
  });

  it('formats complaint ticket numbers and plain-text reports deterministically', () => {
    const ticket = buildComplaintTicketNumber(fixedNow, 'x9k2');
    expect(ticket).toBe('CMP-20260515-X9K2');

    const report = buildSalesAndOrdersReport({
      period: 'yesterday',
      transactions: sampleTransactions,
      customers: sampleCustomers,
      inventory: sampleInventory,
      deliveries: sampleDeliveries,
      complaints: sampleComplaints,
      now: fixedNow,
    });
    const txt = formatOperationalReportText(report);
    expect(txt).toContain('BOLKHATA LIVE — SALES & ORDERS REPORT');
    expect(txt).toContain('Verma Traders');
    expect(txt).toContain('18,000');
  });
});
