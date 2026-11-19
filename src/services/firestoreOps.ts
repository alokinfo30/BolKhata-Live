import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  buildReceiptNumber,
  buildStoreNotificationMessage,
  buildUpiUriForReceipt,
  sanitizeUpiUri,
} from '../utils/receiptUtils';
import type {
  ApprovalRequest,
  Customer,
  InventoryItem,
  LedgerTransaction,
  NotificationChannel,
  NotificationStatus,
  Receipt,
  RestockOrder,
  SentimentLabel,
  StoreNotification,
  TraceStepType,
  TxType,
} from '../types';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function clampStr(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const s = (val ?? fallback).trim();
  return s.slice(0, maxLen);
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function seedShopDataIfEmpty(ownerId: string): Promise<void> {
  try {
    const custSnap = await getDocs(
      query(collection(db, 'customers'), where('ownerId', '==', ownerId), limit(1))
    );
    const invSnap = await getDocs(
      query(collection(db, 'inventory'), where('ownerId', '==', ownerId), limit(1))
    );

    if (!custSnap.empty && !invSnap.empty) {
      return;
    }

    const batch = writeBatch(db);
    const now = serverTimestamp();

    if (custSnap.empty) {
      const seedCustomers = [
        {
          id: `cust_${ownerId.slice(0, 8)}_sharma`,
          name: 'Sharma General Store',
          phone: '+91 98112 40120',
          location: 'Sadar Bazaar, Delhi',
          current_udhaar_balance: 14500,
          credit_limit: 60000,
        },
        {
          id: `cust_${ownerId.slice(0, 8)}_verma`,
          name: 'Verma Traders',
          phone: '+91 98204 77819',
          location: 'Vashi APMC, Navi Mumbai',
          current_udhaar_balance: 18000,
          credit_limit: 50000,
        },
        {
          id: `cust_${ownerId.slice(0, 8)}_ramesh`,
          name: 'Ramesh Traders',
          phone: '+91 98731 55201',
          location: 'Khari Baoli, Old Delhi',
          current_udhaar_balance: 42000,
          credit_limit: 50000,
        },
        {
          id: `cust_${ownerId.slice(0, 8)}_gupta`,
          name: 'Gupta Kirana Mart',
          phone: '+91 99104 33890',
          location: 'Laxmi Nagar, Delhi',
          current_udhaar_balance: 9200,
          credit_limit: 40000,
        },
        {
          id: `cust_${ownerId.slice(0, 8)}_patel`,
          name: 'Patel Provision Store',
          phone: '+91 97250 11234',
          location: 'Kalupur Market, Ahmedabad',
          current_udhaar_balance: 21000,
          credit_limit: 45000,
        },
      ];

      for (const c of seedCustomers) {
        const ref = doc(db, 'customers', c.id);
        batch.set(ref, {
          ownerId,
          name: c.name,
          phone: c.phone,
          location: c.location,
          current_udhaar_balance: c.current_udhaar_balance,
          credit_limit: c.credit_limit,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (invSnap.empty) {
      const seedInventory = [
        {
          id: `inv_${ownerId.slice(0, 8)}_basmati`,
          sku: 'SKU-BASMATI-25',
          name: 'Basmati Chawal (25kg)',
          unit: 'bori',
          aliases: ['basmati', 'chawal', 'rice', 'basmati chawal', 'basmati rice'],
          stock_qty: 18,
          unit_price: 1200,
          reorder_threshold: 8,
          supplier_name: 'KRBL Agro Distributors',
        },
        {
          id: `inv_${ownerId.slice(0, 8)}_oil`,
          sku: 'SKU-FORTUNE-OIL',
          name: 'Fortune Refined Oil (15L)',
          unit: 'peti',
          aliases: ['fortune', 'oil', 'refined oil', 'fortune oil', 'tel', 'refined'],
          stock_qty: 60,
          unit_price: 1800,
          reorder_threshold: 15,
          supplier_name: 'Adani Wilmar Depot',
        },
        {
          id: `inv_${ownerId.slice(0, 8)}_atta`,
          sku: 'SKU-ATTA-10',
          name: 'Aashirvaad Chakki Atta (10kg)',
          unit: 'bori',
          aliases: ['atta', 'flour', 'aashirvaad', 'gehu', 'wheat flour'],
          stock_qty: 42,
          unit_price: 420,
          reorder_threshold: 12,
          supplier_name: 'ITC Wholesale Hub',
        },
        {
          id: `inv_${ownerId.slice(0, 8)}_cheeni`,
          sku: 'SKU-CHEENI-50',
          name: 'Madhur Pure Sugar (50kg)',
          unit: 'bori',
          aliases: ['cheeni', 'sugar', 'shakkar', 'madhur'],
          stock_qty: 28,
          unit_price: 2150,
          reorder_threshold: 10,
          supplier_name: 'Simbhaoli Sugar Mills',
        },
        {
          id: `inv_${ownerId.slice(0, 8)}_dal`,
          sku: 'SKU-TOOR-30',
          name: 'Desi Toor Dal (30kg)',
          unit: 'bori',
          aliases: ['toor', 'dal', 'arhar', 'toor dal'],
          stock_qty: 5,
          unit_price: 4100,
          reorder_threshold: 6,
          supplier_name: 'Nafed Pulses Depot',
        },
        {
          id: `inv_${ownerId.slice(0, 8)}_salt`,
          sku: 'SKU-NAMAK-25',
          name: 'Tata Iodized Salt (25kg)',
          unit: 'bori',
          aliases: ['salt', 'namak', 'tata namak', 'tata salt'],
          stock_qty: 55,
          unit_price: 540,
          reorder_threshold: 15,
          supplier_name: 'Tata Consumer Wholesale',
        },
      ];

      for (const item of seedInventory) {
        const ref = doc(db, 'inventory', item.id);
        batch.set(ref, {
          ownerId,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          aliases: item.aliases,
          stock_qty: item.stock_qty,
          unit_price: item.unit_price,
          reorder_threshold: item.reorder_threshold,
          supplier_name: item.supplier_name,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'customers/inventory seed');
  }
}

export async function logAgentTrace(
  ownerId: string,
  sessionId: string,
  stepType: TraceStepType,
  title: string,
  detail: string,
  latencyMs = 0
): Promise<void> {
  const id = makeSafeId('trace');
  try {
    await setDoc(doc(db, 'agent_traces', id), {
      ownerId,
      session_id: clampStr(sessionId, 64, 'live_session'),
      step_type: stepType,
      title: clampStr(title, 160, 'Agent Step'),
      detail: clampStr(detail, 500, ''),
      latency_ms: Math.max(0, Math.round(latencyMs)),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `agent_traces/${id}`);
  }
}

export async function lookupCustomerAndStock(
  ownerId: string,
  args: { customer_name?: string; item_name?: string }
): Promise<Record<string, unknown>> {
  let matchedCustomer: Customer | null = null;
  let matchedItem: InventoryItem | null = null;
  let allCustomerNames: string[] = [];
  let allItemNames: string[] = [];

  try {
    const custSnap = await getDocs(
      query(collection(db, 'customers'), where('ownerId', '==', ownerId))
    );
    const customers = custSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) }));
    allCustomerNames = customers.map((c) => c.name);

    if (args.customer_name) {
      const q = normalizeText(args.customer_name);
      matchedCustomer =
        customers.find((c) => normalizeText(c.name) === q) ||
        customers.find((c) => normalizeText(c.name).includes(q) || q.includes(normalizeText(c.name))) ||
        customers.find((c) => {
          const words = q.split(' ').filter((w) => w.length > 2);
          return words.some((w) => normalizeText(c.name).includes(w));
        }) ||
        null;
    }

    const invSnap = await getDocs(
      query(collection(db, 'inventory'), where('ownerId', '==', ownerId))
    );
    const items = invSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryItem, 'id'>) }));
    allItemNames = items.map((i) => i.name);

    if (args.item_name) {
      const q = normalizeText(args.item_name);
      matchedItem =
        items.find(
          (i) =>
            normalizeText(i.name) === q ||
            normalizeText(i.sku) === q ||
            i.aliases.some((a) => normalizeText(a) === q)
        ) ||
        items.find(
          (i) =>
            normalizeText(i.name).includes(q) ||
            q.includes(normalizeText(i.name)) ||
            i.aliases.some((a) => q.includes(normalizeText(a)) || normalizeText(a).includes(q))
        ) ||
        items.find((i) => {
          const words = q.split(' ').filter((w) => w.length > 2);
          return words.some(
            (w) =>
              normalizeText(i.name).includes(w) ||
              i.aliases.some((a) => normalizeText(a).includes(w))
          );
        }) ||
        null;
    }

    return {
      found_customer: matchedCustomer
        ? {
            customer_id: matchedCustomer.id,
            name: matchedCustomer.name,
            phone: matchedCustomer.phone,
            location: matchedCustomer.location,
            current_udhaar_balance: matchedCustomer.current_udhaar_balance,
            credit_limit: matchedCustomer.credit_limit,
            available_credit: Math.max(
              0,
              matchedCustomer.credit_limit - matchedCustomer.current_udhaar_balance
            ),
          }
        : null,
      found_item: matchedItem
        ? {
            item_id: matchedItem.id,
            sku: matchedItem.sku,
            name: matchedItem.name,
            unit: matchedItem.unit,
            stock_qty: matchedItem.stock_qty,
            unit_price: matchedItem.unit_price,
            reorder_threshold: matchedItem.reorder_threshold,
            supplier_name: matchedItem.supplier_name,
          }
        : null,
      available_customers_hint: matchedCustomer ? undefined : allCustomerNames,
      available_items_hint: matchedItem ? undefined : allItemNames,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'customers/inventory lookup');
  }
}

export async function checkBusinessPolicy(
  ownerId: string,
  args: {
    customer_id: string;
    item_sku?: string;
    qty?: number;
    total_amount: number;
    tx_type: TxType;
  }
): Promise<Record<string, unknown>> {
  try {
    const custSnap = await getDocs(
      query(collection(db, 'customers'), where('ownerId', '==', ownerId))
    );
    const custDoc = custSnap.docs.find((d) => d.id === args.customer_id);
    if (!custDoc) {
      return { allowed: false, reason: 'Customer account not found in Khata.' };
    }
    const cust = custDoc.data() as Customer;

    let item: (InventoryItem & { id: string }) | null = null;
    if (args.item_sku && args.tx_type !== 'JAMA') {
      const invSnap = await getDocs(
        query(collection(db, 'inventory'), where('ownerId', '==', ownerId))
      );
      const found = invSnap.docs.find((d) => (d.data() as InventoryItem).sku === args.item_sku);
      if (found) {
        item = { id: found.id, ...(found.data() as Omit<InventoryItem, 'id'>) };
      }
    }

    const qty = Number(args.qty ?? 0);
    const totalAmount = Number(args.total_amount ?? 0);

    // Check recent duplicate in last 5 minutes
    const recentSnap = await getDocs(
      query(collection(db, 'transactions'), where('ownerId', '==', ownerId))
    );
    const fiveMinAgoMs = Date.now() - 5 * 60 * 1000;
    const duplicate = recentSnap.docs.find((d) => {
      const tx = d.data() as LedgerTransaction & { createdAt?: Timestamp };
      const createdMs = tx.createdAt?.toMillis ? tx.createdAt.toMillis() : 0;
      return (
        tx.status === 'COMPLETED' &&
        tx.customer_id === args.customer_id &&
        tx.item_sku === (args.item_sku || 'PAYMENT_JAMA') &&
        tx.qty === qty &&
        tx.type === args.tx_type &&
        createdMs >= fiveMinAgoMs
      );
    });

    const violations: string[] = [];
    let requiresHumanApproval = false;
    let insufficientStock = false;

    if (args.tx_type === 'UDHAAR') {
      const projectedBalance = cust.current_udhaar_balance + totalAmount;
      if (projectedBalance > cust.credit_limit) {
        requiresHumanApproval = true;
        violations.push(
          `Credit limit breach: projected udhaar ₹${projectedBalance.toLocaleString('en-IN')} exceeds ₹${cust.credit_limit.toLocaleString('en-IN')} limit.`
        );
      }
    }

    if (totalAmount > 50000 && args.tx_type !== 'JAMA') {
      requiresHumanApproval = true;
      violations.push(
        `High-value order: single order ₹${totalAmount.toLocaleString('en-IN')} exceeds ₹50,000 counter limit.`
      );
    }

    if (item && qty > item.stock_qty) {
      insufficientStock = true;
      violations.push(
        `Insufficient stock: requested ${qty} ${item.unit}, available ${item.stock_qty} ${item.unit}.`
      );
    }

    const remainingStock = item ? Math.max(0, item.stock_qty - qty) : null;
    const willTriggerAutoRestock =
      item !== null && remainingStock !== null && remainingStock < item.reorder_threshold;

    return {
      policy_passed: !requiresHumanApproval && !insufficientStock,
      requires_human_approval: requiresHumanApproval,
      insufficient_stock: insufficientStock,
      duplicate_detected: Boolean(duplicate),
      duplicate_warning: duplicate
        ? `An identical entry for ${cust.name} (${qty} ${item?.unit ?? 'units'}) was logged within the last 5 minutes.`
        : null,
      projected_udhaar_balance:
        args.tx_type === 'UDHAAR'
          ? cust.current_udhaar_balance + totalAmount
          : args.tx_type === 'JAMA'
          ? Math.max(0, cust.current_udhaar_balance - totalAmount)
          : cust.current_udhaar_balance,
      credit_limit: cust.credit_limit,
      available_stock: item?.stock_qty ?? null,
      remaining_stock_after_sale: remainingStock,
      will_trigger_auto_restock: willTriggerAutoRestock,
      violations,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'policy_check');
  }
}

export async function requestHumanApproval(
  ownerId: string,
  args: {
    customer_id: string;
    customer_name: string;
    item_sku: string;
    item_name: string;
    unit?: string;
    qty: number;
    total_amount: number;
    tx_type: TxType;
    reason: string;
  }
): Promise<Record<string, unknown>> {
  const approvalId = makeSafeId('apr');
  try {
    await setDoc(doc(db, 'approvals', approvalId), {
      ownerId,
      approval_id: approvalId,
      customer_id: args.customer_id,
      customer_name: clampStr(args.customer_name, 120),
      item_sku: clampStr(args.item_sku, 64, 'UNKNOWN'),
      item_name: clampStr(args.item_name, 140),
      unit: clampStr(args.unit, 32, 'peti'),
      qty: Math.max(0, Number(args.qty)),
      total_amount: Math.max(0, Number(args.total_amount)),
      tx_type: args.tx_type,
      reason: clampStr(args.reason, 300, 'Policy override requested'),
      status: 'PENDING',
      approved_by: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      status: 'PENDING_OWNER_APPROVAL',
      approval_id: approvalId,
      message: `Manager approval card ${approvalId} is now live on screen. Wait for owner action.`,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `approvals/${approvalId}`);
  }
}

export async function createSupplierRestock(
  ownerId: string,
  args: {
    item_sku: string;
    item_name?: string;
    order_qty?: number;
    reason: string;
  }
): Promise<Record<string, unknown>> {
  const restockId = makeSafeId('po');
  const poNumber = `PO-${Math.floor(400 + (Date.now() % 600))}`;
  try {
    const invSnap = await getDocs(
      query(collection(db, 'inventory'), where('ownerId', '==', ownerId))
    );
    const invDoc = invSnap.docs.find((d) => (d.data() as InventoryItem).sku === args.item_sku);
    const item = invDoc?.data() as InventoryItem | undefined;

    const orderQty = Math.max(
      1,
      Number(args.order_qty || (item ? item.reorder_threshold * 3 : 25))
    );
    const unitPrice = item?.unit_price ?? 1000;
    const estimatedCost = Math.round(orderQty * unitPrice * 0.85);

    await setDoc(doc(db, 'restocks', restockId), {
      ownerId,
      po_number: poNumber,
      item_sku: clampStr(args.item_sku, 64),
      item_name: clampStr(args.item_name || item?.name, 140, args.item_sku),
      supplier_name: clampStr(item?.supplier_name, 120, 'Regional Wholesale Distributor'),
      order_qty: orderQty,
      unit: clampStr(item?.unit, 32, 'units'),
      estimated_cost: estimatedCost,
      reason: clampStr(args.reason, 240, 'Stock dropped below reorder threshold'),
      status: 'ORDERED',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      status: 'RESTOCK_ORDERED',
      po_number: poNumber,
      restock_id: restockId,
      supplier_name: item?.supplier_name ?? 'Regional Wholesale Distributor',
      order_qty: orderQty,
      unit: item?.unit ?? 'units',
      estimated_cost: estimatedCost,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `restocks/${restockId}`);
  }
}

export async function executeLedgerAndInventoryTx(
  ownerId: string,
  args: {
    customer_id: string;
    item_sku?: string;
    qty?: number;
    total_amount: number;
    tx_type: TxType;
    user_confirmed: boolean;
    note?: string;
    bypass_policy_for_approval?: boolean;
  }
): Promise<Record<string, unknown>> {
  if (!args.user_confirmed) {
    return {
      executed: false,
      error: 'Read-back confirmation required. Ask the user "Kya main confirm karun?" first.',
    };
  }

  const txId = makeSafeId('tx');
  const qty = Math.max(0, Number(args.qty ?? 0));
  const totalAmount = Math.max(0, Number(args.total_amount ?? 0));

  try {
    const custRef = doc(db, 'customers', args.customer_id);
    let invRef = null as ReturnType<typeof doc> | null;
    let invDataInitial: InventoryItem | null = null;

    if (args.tx_type !== 'JAMA' && args.item_sku) {
      const invSnap = await getDocs(
        query(collection(db, 'inventory'), where('ownerId', '==', ownerId))
      );
      const found = invSnap.docs.find((d) => (d.data() as InventoryItem).sku === args.item_sku);
      if (!found) {
        return { executed: false, error: `Item SKU ${args.item_sku} not found.` };
      }
      invRef = doc(db, 'inventory', found.id);
      invDataInitial = found.data() as InventoryItem;
    }

    const result = await runTransaction(db, async (transaction) => {
      const custSnap = await transaction.get(custRef);
      if (!custSnap.exists()) {
        throw new Error('Customer record does not exist.');
      }
      const customer = custSnap.data() as Customer;
      const prevBalance = customer.current_udhaar_balance;

      let prevStock = 0;
      let newStock = 0;
      let itemName = 'Udhaar Jama Payment';
      let itemSku = args.item_sku || 'PAYMENT_JAMA';
      let unit = 'payment';
      let unitPrice = 0;
      let reorderThreshold = 0;

      if (invRef) {
        const invSnap = await transaction.get(invRef);
        if (!invSnap.exists()) {
          throw new Error('Inventory item does not exist.');
        }
        const inv = invSnap.data() as InventoryItem;
        prevStock = inv.stock_qty;
        if (qty > prevStock) {
          throw new Error(`Insufficient stock: only ${prevStock} ${inv.unit} remaining.`);
        }
        newStock = prevStock - qty;
        itemName = inv.name;
        itemSku = inv.sku;
        unit = inv.unit;
        unitPrice = inv.unit_price;
        reorderThreshold = inv.reorder_threshold;
      }

      let newBalance = prevBalance;
      if (args.tx_type === 'UDHAAR') {
        newBalance = prevBalance + totalAmount;
        if (!args.bypass_policy_for_approval && (newBalance > customer.credit_limit || totalAmount > 50000)) {
          throw new Error('Policy violation: requires human manager approval.');
        }
      } else if (args.tx_type === 'JAMA') {
        newBalance = Math.max(0, prevBalance - totalAmount);
      }

      const now = serverTimestamp();

      if (args.tx_type !== 'CASH_SALE') {
        transaction.update(custRef, {
          current_udhaar_balance: newBalance,
          updatedAt: now,
        });
      }

      if (invRef && qty > 0) {
        transaction.update(invRef, {
          stock_qty: newStock,
          updatedAt: now,
        });
      }

      transaction.set(doc(db, 'transactions', txId), {
        ownerId,
        tx_id: txId,
        customer_id: args.customer_id,
        customer_name: clampStr(customer.name, 120),
        item_sku: clampStr(itemSku, 64),
        item_name: clampStr(itemName, 140),
        unit: clampStr(unit, 32),
        qty,
        unit_price: unitPrice,
        total_amount: totalAmount,
        type: args.tx_type,
        status: 'COMPLETED',
        previous_balance: prevBalance,
        previous_stock: prevStock,
        note: clampStr(args.note, 300, 'Logged via BolKhata Live Voice'),
        createdAt: now,
        updatedAt: now,
      });

      return {
        executed: true,
        tx_id: txId,
        customer_name: customer.name,
        previous_balance: prevBalance,
        new_balance: newBalance,
        item_sku: itemSku,
        item_name: itemName,
        unit,
        qty,
        previous_stock: prevStock,
        remaining_stock: newStock,
        reorder_threshold: reorderThreshold,
        below_reorder_threshold: invRef !== null && newStock < reorderThreshold,
        supplier_name: invDataInitial?.supplier_name ?? null,
      };
    });

    return result;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Insufficient stock') || error.message.includes('Policy violation'))) {
      return { executed: false, error: error.message };
    }
    handleFirestoreError(error, OperationType.WRITE, `transactions/${txId}`);
  }
}

export async function undoLastTransaction(
  ownerId: string,
  reason?: string
): Promise<Record<string, unknown>> {
  let targetDocId = 'undo';
  try {
    const snap = await getDocs(
      query(collection(db, 'transactions'), where('ownerId', '==', ownerId))
    );
    const sortedDocs = [...snap.docs].sort((a, b) => {
      const ta = (a.data() as { createdAt?: Timestamp }).createdAt?.toMillis?.() ?? 0;
      const tb = (b.data() as { createdAt?: Timestamp }).createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
    const targetDoc = sortedDocs.find((d) => (d.data() as LedgerTransaction).status === 'COMPLETED');
    if (!targetDoc) {
      return { undone: false, message: 'No completed transaction found to undo.' };
    }

    targetDocId = targetDoc.id;
    const initialTx = targetDoc.data() as LedgerTransaction;
    const custRef = doc(db, 'customers', initialTx.customer_id);
    const invSnap =
      initialTx.type !== 'JAMA' && initialTx.item_sku !== 'PAYMENT_JAMA'
        ? await getDocs(query(collection(db, 'inventory'), where('ownerId', '==', ownerId)))
        : null;
    const invDoc = invSnap?.docs.find((d) => (d.data() as InventoryItem).sku === initialTx.item_sku);
    const invRef = invDoc ? doc(db, 'inventory', invDoc.id) : null;

    const undoneSummary = await runTransaction(db, async (transaction) => {
      // Perform all reads strictly before any writes inside the transaction
      const txSnap = await transaction.get(targetDoc.ref);
      const custSnap = await transaction.get(custRef);
      const invTxSnap = invRef ? await transaction.get(invRef) : null;

      if (!txSnap.exists()) {
        throw new Error('Transaction already undone.');
      }
      const liveTx = txSnap.data() as LedgerTransaction;
      if (liveTx.status !== 'COMPLETED') {
        throw new Error('Transaction already undone.');
      }

      const restoredBalance = Math.max(0, Number(liveTx.previous_balance) || 0);
      const restoredStock = Math.max(0, Number(liveTx.previous_stock) || 0);
      const now = serverTimestamp();

      if (
        liveTx.type !== 'CASH_SALE' &&
        custSnap.exists() &&
        (custSnap.data() as Customer).ownerId === ownerId
      ) {
        transaction.update(custRef, {
          current_udhaar_balance: restoredBalance,
          updatedAt: now,
        });
      }

      if (
        invRef &&
        invTxSnap?.exists() &&
        (invTxSnap.data() as InventoryItem).ownerId === ownerId &&
        Number(liveTx.qty) > 0
      ) {
        transaction.update(invRef, {
          stock_qty: restoredStock,
          updatedAt: now,
        });
      }

      transaction.update(targetDoc.ref, {
        status: 'UNDONE',
        updatedAt: now,
      });

      return {
        tx_id: liveTx.tx_id,
        customer_name: liveTx.customer_name,
        item_name: liveTx.item_name,
        restored_balance: restoredBalance,
        restored_stock: restoredStock,
      };
    });

    return {
      undone: true,
      ...undoneSummary,
      reason: reason || 'Voice undo requested',
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'Transaction already undone.') {
      return { undone: false, message: 'Latest transaction was already undone.' };
    }
    handleFirestoreError(error, OperationType.UPDATE, `transactions/${targetDocId}`);
  }
}

export async function resolveApproval(
  ownerId: string,
  approval: ApprovalRequest,
  decision: 'APPROVED' | 'REJECTED',
  approverName: string
): Promise<{ ok: boolean; restockPo?: string; error?: string }> {
  try {
    const approvalRef = doc(db, 'approvals', approval.id);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(approvalRef);
      if (!snap.exists()) throw new Error('Approval request not found.');
      const cur = snap.data() as ApprovalRequest;
      if (cur.status !== 'PENDING') {
        throw new Error(`Approval already ${cur.status}.`);
      }
      transaction.update(approvalRef, {
        status: decision,
        approved_by: clampStr(approverName, 120, 'Store Owner'),
        updatedAt: serverTimestamp(),
      });
    });

    if (decision === 'APPROVED') {
      const txRes = await executeLedgerAndInventoryTx(ownerId, {
        customer_id: approval.customer_id,
        item_sku: approval.item_sku,
        qty: approval.qty,
        total_amount: approval.total_amount,
        tx_type: approval.tx_type,
        user_confirmed: true,
        note: `Owner Override (${approverName}) · ${approval.approval_id}`,
        bypass_policy_for_approval: true,
      });

      if (!txRes.executed) {
        return { ok: false, error: String(txRes.error || 'Failed to execute approved order') };
      }

      let restockPo: string | undefined;
      if (txRes.below_reorder_threshold) {
        const restockRes = await createSupplierRestock(ownerId, {
          item_sku: approval.item_sku,
          item_name: approval.item_name,
          reason: `Auto-reorder after approved order ${approval.approval_id} dropped stock to ${txRes.remaining_stock}`,
        });
        restockPo = String(restockRes.po_number || '');
      }
      return { ok: true, restockPo };
    }

    return { ok: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `approvals/${approval.id}`);
  }
}

export async function updateRestockStatus(
  restockId: string,
  status: 'RECEIVED' | 'CANCELLED'
): Promise<void> {
  try {
    const ref = doc(db, 'restocks', restockId);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Restock order not found');
      const cur = snap.data() as RestockOrder;
      if (cur.status !== 'ORDERED') return;
      transaction.update(ref, {
        status,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `restocks/${restockId}`);
  }
}

export async function logSentimentFeedback(
  ownerId: string,
  payload: {
    rating: number;
    sentiment: SentimentLabel;
    category: string;
    comment: string;
    ai_summary: string;
    source: 'VOICE' | 'UI';
  }
): Promise<void> {
  const id = makeSafeId('fb');
  try {
    await setDoc(doc(db, 'sentiment_logs', id), {
      ownerId,
      rating: Math.min(5, Math.max(1, Math.round(payload.rating))),
      sentiment: payload.sentiment,
      category: clampStr(payload.category, 64, 'General'),
      comment: clampStr(payload.comment, 500, 'Feedback logged'),
      ai_summary: clampStr(payload.ai_summary, 300, ''),
      source: payload.source,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `sentiment_logs/${id}`);
  }
}

export async function logVoiceTranscript(
  ownerId: string,
  sessionId: string,
  role: 'user' | 'agent' | 'system',
  text: string
): Promise<void> {
  const cleaned = clampStr(text, 1000, '');
  if (!cleaned) return;
  const id = makeSafeId('vt');
  try {
    await setDoc(doc(db, 'voice_transcripts', id), {
      ownerId,
      session_id: clampStr(sessionId, 64, 'live_session'),
      role,
      text: cleaned,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `voice_transcripts/${id}`);
  }
}

export interface CsvCustomerInput {
  name: string;
  phone?: string;
  location?: string;
  current_udhaar_balance?: number;
  credit_limit?: number;
}

export interface CsvInventoryInput {
  sku?: string;
  name: string;
  unit?: string;
  aliases?: string[];
  stock_qty?: number;
  unit_price: number;
  reorder_threshold?: number;
  supplier_name?: string;
}

export async function importCustomersBatch(
  ownerId: string,
  rows: CsvCustomerInput[]
): Promise<{ imported: number }> {
  if (rows.length === 0) return { imported: 0 };
  try {
    let imported = 0;
    const CHUNK = 400;
    for (let start = 0; start < rows.length; start += CHUNK) {
      const slice = rows.slice(start, start + CHUNK);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      for (const row of slice) {
        const cleanName = clampStr(row.name?.trim() || '', 120);
        if (!cleanName) continue;
        const rawPhone = (row.phone ?? '').trim();
        const cleanPhone = rawPhone.length >= 5 ? clampStr(rawPhone, 30) : '0000000000';
        const cleanLocation = clampStr(row.location?.trim() || 'Local Market', 120);
        const balance = Math.max(0, Number(row.current_udhaar_balance) || 0);
        const limitVal = Math.max(0, Number(row.credit_limit) || 50000);

        const id = makeSafeId('cust');
        batch.set(doc(db, 'customers', id), {
          ownerId,
          name: cleanName,
          phone: cleanPhone,
          location: cleanLocation,
          current_udhaar_balance: balance,
          credit_limit: limitVal,
          createdAt: now,
          updatedAt: now,
        });
        imported += 1;
      }

      await batch.commit();
    }
    return { imported };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'customers/csv_import');
  }
}

export async function importInventoryBatch(
  ownerId: string,
  rows: CsvInventoryInput[]
): Promise<{ imported: number }> {
  if (rows.length === 0) return { imported: 0 };
  try {
    let imported = 0;
    const CHUNK = 400;
    for (let start = 0; start < rows.length; start += CHUNK) {
      const slice = rows.slice(start, start + CHUNK);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      for (let i = 0; i < slice.length; i++) {
        const row = slice[i];
        const cleanName = clampStr(row.name?.trim() || '', 140);
        const unitPrice = Number(row.unit_price);
        if (!cleanName || !Number.isFinite(unitPrice) || unitPrice <= 0) continue;

        const rawSku = (row.sku ?? '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, '_');
        const cleanSku =
          rawSku.length >= 2
            ? rawSku.slice(0, 64)
            : `SKU_${(start + i + 1).toString().padStart(3, '0')}_${Date.now()
                .toString(36)
                .slice(-3)
                .toUpperCase()}`;

        const cleanUnit = clampStr(row.unit?.trim() || 'units', 32);
        const cleanedAliases = (row.aliases ?? [])
          .map((a) => clampStr(a, 64))
          .filter((a) => a.length > 0)
          .slice(0, 10);
        const finalAliases =
          cleanedAliases.length > 0
            ? cleanedAliases
            : [clampStr(cleanName.toLowerCase(), 64) || 'item'];

        const stockQty = Math.max(0, Number(row.stock_qty) || 0);
        const reorderThreshold = Math.max(0, Number(row.reorder_threshold) || 0);
        const supplierName = clampStr(
          row.supplier_name?.trim() || 'Wholesale Distributor',
          120
        );

        const id = makeSafeId('inv');
        batch.set(doc(db, 'inventory', id), {
          ownerId,
          sku: cleanSku,
          name: cleanName,
          unit: cleanUnit,
          aliases: finalAliases,
          stock_qty: stockQty,
          unit_price: unitPrice,
          reorder_threshold: reorderThreshold,
          supplier_name: supplierName,
          createdAt: now,
          updatedAt: now,
        });
        imported += 1;
      }

      await batch.commit();
    }
    return { imported };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'inventory/csv_import');
  }
}

export interface CreateReceiptNotifyInput {
  customer: Customer;
  transaction?: LedgerTransaction | null;
  channel: NotificationChannel;
  customMessage?: string;
  note?: string;
  upiVpa?: string;
  storeName?: string;
}

export interface DispatchedReceiptResult {
  receipt: Receipt;
  notification: StoreNotification;
}

function buildSafeTxId(raw?: string): string {
  const cleaned = (raw ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  return cleaned.length >= 1 ? cleaned : makeSafeId('stmt');
}

export async function createReceiptAndNotifyStore(
  ownerId: string,
  input: CreateReceiptNotifyInput
): Promise<DispatchedReceiptResult> {
  const receiptId = makeSafeId('rcpt');
  const notificationId = makeSafeId('ntf');
  const receiptNumber = buildReceiptNumber();

  try {
    const cust = input.customer;
    const tx = input.transaction ?? null;
    const safePhone =
      cust.phone && cust.phone.trim().length >= 5
        ? clampStr(cust.phone, 30)
        : '0000000000';
    const safeLocation = clampStr(cust.location, 120, 'Local Market');
    const safeName = clampStr(cust.name, 120, 'Store Account');

    const txId = buildSafeTxId(tx?.tx_id);
    const txType: TxType = tx?.type ?? 'UDHAAR';
    const itemName = clampStr(tx?.item_name, 140, 'Khata Balance Statement');
    const qty = Math.max(0, Number(tx?.qty ?? 0));
    const unit = clampStr(tx?.unit, 32, 'statement');
    const unitPrice = Math.max(0, Number(tx?.unit_price ?? 0));
    const totalAmount = Math.max(
      0,
      Number(tx ? tx.total_amount : cust.current_udhaar_balance) || 0
    );
    const previousBalance = Math.max(
      0,
      Number(tx ? tx.previous_balance : cust.current_udhaar_balance) || 0
    );
    const newBalance = Math.max(0, Number(cust.current_udhaar_balance) || 0);
    const storeName = clampStr(input.storeName, 80, 'BolKhata Wholesale');
    const noteText = clampStr(
      input.note ?? tx?.note,
      300,
      tx ? `Receipt for ${tx.tx_id}` : 'Digital Khata Parchi & Balance Statement'
    );

    const upiUri = sanitizeUpiUri(
      buildUpiUriForReceipt({
        upiVpa: input.upiVpa || 'bolkhata.store@okaxis',
        merchantName: storeName,
        amount: newBalance > 0 ? newBalance : totalAmount,
        note: `${receiptNumber} ${safeName}`,
      })
    );

    const defaultMessage = buildStoreNotificationMessage({
      receiptNumber,
      storeName,
      customerName: safeName,
      itemName,
      qty,
      unit,
      totalAmount,
      txType,
      previousBalance,
      newBalance,
      upiVpa: input.upiVpa,
      note: noteText,
    });
    const finalMessage = clampStr(input.customMessage, 1000, defaultMessage) || defaultMessage;

    const now = serverTimestamp();
    const batch = writeBatch(db);

    const receiptPayload: Omit<Receipt, 'id'> = {
      ownerId,
      receipt_number: receiptNumber,
      tx_id: txId,
      customer_id: cust.id,
      customer_name: safeName,
      customer_phone: safePhone,
      customer_location: safeLocation,
      item_name: itemName,
      qty,
      unit,
      unit_price: unitPrice,
      total_amount: totalAmount,
      tx_type: txType,
      previous_balance: previousBalance,
      new_balance: newBalance,
      upi_uri: upiUri,
      note: noteText,
      status: 'SENT',
      createdAt: now,
      updatedAt: now,
    };

    const notificationPayload: Omit<StoreNotification, 'id'> = {
      ownerId,
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      customer_id: cust.id,
      customer_name: safeName,
      customer_phone: safePhone,
      channel: input.channel,
      message: finalMessage,
      status: 'DISPATCHED',
      createdAt: now,
      updatedAt: now,
    };

    batch.set(doc(db, 'receipts', receiptId), receiptPayload);
    batch.set(doc(db, 'notifications', notificationId), notificationPayload);
    await batch.commit();

    return {
      receipt: { id: receiptId, ...receiptPayload },
      notification: { id: notificationId, ...notificationPayload },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `receipts/${receiptId}`);
  }
}

export async function broadcastReceiptsAndNotificationsToAllStores(
  ownerId: string,
  input: {
    customers: Customer[];
    transactions: LedgerTransaction[];
    channel: NotificationChannel;
    note?: string;
    upiVpa?: string;
    storeName?: string;
  }
): Promise<{
  dispatchedCount: number;
  results: DispatchedReceiptResult[];
}> {
  if (input.customers.length === 0) {
    return { dispatchedCount: 0, results: [] };
  }

  try {
    const storeName = clampStr(input.storeName, 80, 'BolKhata Wholesale');
    const results: DispatchedReceiptResult[] = [];
    // Each store creates 2 docs (receipt + notification), so 200 stores = 400 writes (< 500 batch cap)
    const CHUNK = 200;

    for (let start = 0; start < input.customers.length; start += CHUNK) {
      const slice = input.customers.slice(start, start + CHUNK);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      for (const cust of slice) {
        const latestTx =
          input.transactions.find(
            (t) => t.customer_id === cust.id && t.status === 'COMPLETED'
          ) ?? null;

        const receiptId = makeSafeId('rcpt');
        const notificationId = makeSafeId('ntf');
        const receiptNumber = buildReceiptNumber();

        const safePhone =
          cust.phone && cust.phone.trim().length >= 5
            ? clampStr(cust.phone, 30)
            : '0000000000';
        const safeLocation = clampStr(cust.location, 120, 'Local Market');
        const safeName = clampStr(cust.name, 120, 'Store Account');

        const txId = buildSafeTxId(latestTx?.tx_id);
        const txType: TxType = latestTx?.type ?? 'UDHAAR';
        const itemName = clampStr(latestTx?.item_name, 140, 'Khata Balance Statement');
        const qty = Math.max(0, Number(latestTx?.qty ?? 0));
        const unit = clampStr(latestTx?.unit, 32, 'statement');
        const unitPrice = Math.max(0, Number(latestTx?.unit_price ?? 0));
        const totalAmount = Math.max(
          0,
          Number(latestTx ? latestTx.total_amount : cust.current_udhaar_balance) || 0
        );
        const previousBalance = Math.max(
          0,
          Number(latestTx ? latestTx.previous_balance : cust.current_udhaar_balance) || 0
        );
        const newBalance = Math.max(0, Number(cust.current_udhaar_balance) || 0);
        const noteText = clampStr(
          input.note,
          300,
          latestTx
            ? `Broadcast Parchi (${latestTx.tx_id})`
            : 'Periodic Digital Khata Statement'
        );

        const upiUri = sanitizeUpiUri(
          buildUpiUriForReceipt({
            upiVpa: input.upiVpa || 'bolkhata.store@okaxis',
            merchantName: storeName,
            amount: newBalance > 0 ? newBalance : totalAmount,
            note: `${receiptNumber} ${safeName}`,
          })
        );

        const message = buildStoreNotificationMessage({
          receiptNumber,
          storeName,
          customerName: safeName,
          itemName,
          qty,
          unit,
          totalAmount,
          txType,
          previousBalance,
          newBalance,
          upiVpa: input.upiVpa,
          note: noteText,
        });

        const receiptPayload: Omit<Receipt, 'id'> = {
          ownerId,
          receipt_number: receiptNumber,
          tx_id: txId,
          customer_id: cust.id,
          customer_name: safeName,
          customer_phone: safePhone,
          customer_location: safeLocation,
          item_name: itemName,
          qty,
          unit,
          unit_price: unitPrice,
          total_amount: totalAmount,
          tx_type: txType,
          previous_balance: previousBalance,
          new_balance: newBalance,
          upi_uri: upiUri,
          note: noteText,
          status: 'SENT',
          createdAt: now,
          updatedAt: now,
        };

        const notificationPayload: Omit<StoreNotification, 'id'> = {
          ownerId,
          receipt_id: receiptId,
          receipt_number: receiptNumber,
          customer_id: cust.id,
          customer_name: safeName,
          customer_phone: safePhone,
          channel: input.channel,
          message,
          status: 'DISPATCHED',
          createdAt: now,
          updatedAt: now,
        };

        batch.set(doc(db, 'receipts', receiptId), receiptPayload);
        batch.set(doc(db, 'notifications', notificationId), notificationPayload);

        results.push({
          receipt: { id: receiptId, ...receiptPayload },
          notification: { id: notificationId, ...notificationPayload },
        });
      }

      await batch.commit();
    }

    return { dispatchedCount: results.length, results };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'receipts/broadcast');
  }
}

export async function updateNotificationStatus(
  notificationId: string,
  status: Extract<NotificationStatus, 'DELIVERED' | 'FAILED'>
): Promise<void> {
  try {
    const ref = doc(db, 'notifications', notificationId);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;
      const cur = snap.data() as StoreNotification;
      if (cur.status !== 'DISPATCHED') return;
      transaction.update(ref, {
        status,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notificationId}`);
  }
}

export async function createReceiptAndNotifyByVoice(
  ownerId: string,
  args: {
    customer_name?: string;
    notify_all_stores?: boolean;
    channel?: string;
    note?: string;
  }
): Promise<Record<string, unknown>> {
  const rawChannel = String(args.channel || '').toUpperCase();
  const channel: NotificationChannel =
    rawChannel === 'WHATSAPP' ||
    rawChannel === 'SMS' ||
    rawChannel === 'IN_APP' ||
    rawChannel === 'BROADCAST'
      ? rawChannel
      : args.notify_all_stores
      ? 'BROADCAST'
      : 'WHATSAPP';

  const custSnap = await getDocs(
    query(collection(db, 'customers'), where('ownerId', '==', ownerId))
  );
  const customers = custSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Customer, 'id'>),
  }));

  if (customers.length === 0) {
    return { ok: false, error: 'No stores or traders found in Khata.' };
  }

  const txSnap = await getDocs(
    query(collection(db, 'transactions'), where('ownerId', '==', ownerId))
  );
  const transactions = txSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<LedgerTransaction, 'id'>) }))
    .sort((a, b) => {
      const ta = (a.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      return tb - ta;
    });

  let savedVpa = 'bolkhata.store@okaxis';
  let savedMerchant = 'BolKhata Wholesale';
  try {
    savedVpa = localStorage.getItem('bolkhata_upi_vpa') || savedVpa;
    savedMerchant = localStorage.getItem('bolkhata_merchant_name') || savedMerchant;
  } catch {
    // ignore storage errors
  }

  if (args.notify_all_stores || !args.customer_name?.trim()) {
    const broadcast = await broadcastReceiptsAndNotificationsToAllStores(ownerId, {
      customers,
      transactions,
      channel,
      note: args.note,
      upiVpa: savedVpa,
      storeName: savedMerchant,
    });
    return {
      ok: true,
      mode: 'ALL_STORES',
      dispatched_count: broadcast.dispatchedCount,
      stores: broadcast.results.map((r) => ({
        customer_name: r.receipt.customer_name,
        receipt_number: r.receipt.receipt_number,
        balance_inr: r.receipt.new_balance,
      })),
    };
  }

  const q = normalizeText(args.customer_name);
  const matched =
    customers.find((c) => normalizeText(c.name) === q) ||
    customers.find(
      (c) => normalizeText(c.name).includes(q) || q.includes(normalizeText(c.name).split(' ')[0])
    ) ||
    null;

  if (!matched) {
    return {
      ok: false,
      error: `Store or trader "${args.customer_name}" not found.`,
      available_stores: customers.map((c) => c.name),
    };
  }

  const latestTx =
    transactions.find((t) => t.customer_id === matched.id && t.status === 'COMPLETED') ?? null;

  const dispatched = await createReceiptAndNotifyStore(ownerId, {
    customer: matched,
    transaction: latestTx,
    channel,
    note: args.note,
    upiVpa: savedVpa,
    storeName: savedMerchant,
  });

  return {
    ok: true,
    mode: 'SINGLE_STORE',
    receipt_number: dispatched.receipt.receipt_number,
    customer_name: dispatched.receipt.customer_name,
    customer_phone: dispatched.receipt.customer_phone,
    total_amount: dispatched.receipt.total_amount,
    new_balance: dispatched.receipt.new_balance,
    channel: dispatched.notification.channel,
    notification_status: dispatched.notification.status,
  };
}



