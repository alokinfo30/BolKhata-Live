import type {
  ApprovalRequest,
  Customer,
  CustomerComplaint,
  DeliveryRecord,
  InventoryItem,
  LedgerTransaction,
  Receipt,
  RestockOrder,
} from '../types';

export type WorkspaceTab = 'counter' | 'khata' | 'approvals' | 'performance' | 'insights';
export type VoiceCommandCategory = 'all' | 'inventory' | 'orders' | 'reports' | 'complaints';
export type VoiceLanguagePreset = 'hinglish' | 'hindi' | 'english' | 'regional';

export interface VoiceCommandExample {
  id: string;
  command: string;
  description: string;
  category: Exclude<VoiceCommandCategory, 'all'>;
  language: VoiceLanguagePreset;
  languageLabel: string;
  tools: string;
}

export interface AutoSuggestItem {
  id: string;
  command: string;
  contextHint: string;
  tools: string;
  source: 'history' | 'tab' | 'live_alert' | 'catalog';
}

export interface OperationalImpactMetrics {
  completedTasksCount: number;
  estimatedMinutesSaved: number;
  errorsPreventedOrRecovered: number;
  hitlGuardsTriggered: number;
  undoRecoveries: number;
  autoRestocksTriggered: number;
  receiptsDispatched: number;
}

export const AVAILABLE_VOICE_COMMANDS_CATALOG: VoiceCommandExample[] = [
  {
    id: 'cmd-today-sales',
    command: 'Aaj ki sales ka summary batao.',
    description: 'Pulls live today Udhaar, Cash, Jama collections, pending deliveries, and open complaints.',
    category: 'reports',
    language: 'hinglish',
    languageLabel: 'Hinglish',
    tools: 'get_sales_and_orders_report',
  },
  {
    id: 'cmd-rahul-delivery',
    command: 'Rahul ki delivery pending mark kar do.',
    description: 'Creates or updates a live delivery tracking entry for any Khata store or named party.',
    category: 'orders',
    language: 'hinglish',
    languageLabel: 'Hinglish',
    tools: 'manage_delivery_status',
  },
  {
    id: 'cmd-yesterday-report',
    command: 'Kal ke orders ka report bana do.',
    description: 'Generates yesterday itemized order report on screen with instant copy and .txt export.',
    category: 'reports',
    language: 'hinglish',
    languageLabel: 'Hinglish',
    tools: 'get_sales_and_orders_report',
  },
  {
    id: 'cmd-customer-complaint',
    command: 'Is customer ki complaint register karo.',
    description: 'Logs a tracked complaint ticket (CMP-...) linked to the active or most recent counter customer.',
    category: 'complaints',
    language: 'hinglish',
    languageLabel: 'Hinglish',
    tools: 'register_customer_complaint',
  },
  {
    id: 'cmd-stock-udhaar',
    command: 'Sharma General Store ke khate mein 15 bori Basmati chawal udhaar likh do, check karo stock kitna hai.',
    description: 'Checks live Khata balance & godown stock, validates policy, and reads back before atomic write.',
    category: 'inventory',
    language: 'hinglish',
    languageLabel: 'Hinglish',
    tools: 'lookup_customer_and_stock · check_business_policy · execute_ledger_and_inventory_tx',
  },
  {
    id: 'cmd-hitl-order',
    command: 'Verma Traders ko 50 peti refined oil udhaar pe bhej do.',
    description: 'Triggers Human-in-the-Loop owner approval automatically when credit limit or ₹50,000 cap is breached.',
    category: 'orders',
    language: 'hinglish',
    languageLabel: 'Hinglish',
    tools: 'lookup_customer_and_stock · check_business_policy · request_human_approval',
  },
  {
    id: 'cmd-undo-entry',
    command: 'Galti ho gayi, pichli entry cancel karo.',
    description: 'Atomically rolls back the last ledger entry and restores both Khata balance and godown stock.',
    category: 'complaints',
    language: 'hinglish',
    languageLabel: 'Hinglish',
    tools: 'undo_last_transaction',
  },
  {
    id: 'cmd-receipt-all',
    command: 'Sabhi stores ko aaj ki parchi aur balance notification bhej do.',
    description: 'Generates digital Parchi receipts and dispatches balance notifications to every active store.',
    category: 'orders',
    language: 'hinglish',
    languageLabel: 'Hinglish',
    tools: 'create_receipt_and_notify_store',
  },
  {
    id: 'cmd-hindi-stock',
    command: 'आज की कुल बिक्री और बकाया उधार का विवरण बताइए।',
    description: 'Spoken pure Hindi summary of daily sales, Jama payments, and total Khata receivables.',
    category: 'reports',
    language: 'hindi',
    languageLabel: 'Hindi',
    tools: 'get_sales_and_orders_report',
  },
  {
    id: 'cmd-hindi-complaint',
    command: 'शर्मा जनरल स्टोर की खराब बोरी की शिकायत दर्ज कर दीजिए।',
    description: 'Registers a Hindi quality complaint directly against Sharma General Store.',
    category: 'complaints',
    language: 'hindi',
    languageLabel: 'Hindi',
    tools: 'register_customer_complaint',
  },
  {
    id: 'cmd-english-stock',
    command: 'Check remaining stock and rate for Basmati Rice 25kg and Refined Oil.',
    description: 'Queries live inventory stock levels, reorder thresholds, and unit rates in English.',
    category: 'inventory',
    language: 'english',
    languageLabel: 'English',
    tools: 'lookup_customer_and_stock',
  },
  {
    id: 'cmd-english-report',
    command: 'Generate the last 7 days sales and collections report.',
    description: 'Produces a 7-day sales breakdown with top-selling SKUs and downloadable text report.',
    category: 'reports',
    language: 'english',
    languageLabel: 'English',
    tools: 'get_sales_and_orders_report',
  },
  {
    id: 'cmd-marathi-delivery',
    command: 'राहुलची डिलिव्हरी पेंडिंग मार्क करा.',
    description: 'Marathi voice command to mark Rahul delivery status as pending in Firestore.',
    category: 'orders',
    language: 'regional',
    languageLabel: 'Marathi',
    tools: 'manage_delivery_status',
  },
  {
    id: 'cmd-gujarati-sales',
    command: 'આજના વેચાણ અને ઉધારનો હિસાબ બતાવો.',
    description: 'Gujarati voice query for today sales summary and outstanding Udhaar.',
    category: 'reports',
    language: 'regional',
    languageLabel: 'Gujarati',
    tools: 'get_sales_and_orders_report',
  },
  {
    id: 'cmd-punjabi-stock',
    command: 'ਬਾਸਮਤੀ ਚਾਵਲ ਦਾ ਸਟਾਕ ਚੈੱਕ ਕਰੋ ਅਤੇ ਘੱਟ ਹੋਵੇ ਤਾਂ ਰੀਸਟਾਕ ਆਰਡਰ ਪਾ ਦਿਓ।',
    description: 'Punjabi stock check with automated supplier restock purchase order if low.',
    category: 'inventory',
    language: 'regional',
    languageLabel: 'Punjabi',
    tools: 'lookup_customer_and_stock · create_supplier_restock',
  },
  {
    id: 'cmd-tamil-complaint',
    command: 'இந்த வாடிக்கையாளரின் புகாரை பதிவு செய்யவும்.',
    description: 'Tamil voice instruction to register a complaint ticket for the active customer.',
    category: 'complaints',
    language: 'regional',
    languageLabel: 'Tamil',
    tools: 'register_customer_complaint',
  },
];

export interface ContextualSuggestParams {
  activeTab: WorkspaceTab;
  currentQuery?: string;
  recentUserInputs: string[];
  customers: Customer[];
  inventory: InventoryItem[];
  approvals: ApprovalRequest[];
  deliveries: DeliveryRecord[];
  complaints: CustomerComplaint[];
  transactions: LedgerTransaction[];
  maxItems?: number;
}

export function getContextualAutoSuggestions(params: ContextualSuggestParams): AutoSuggestItem[] {
  const {
    activeTab,
    currentQuery = '',
    recentUserInputs,
    customers,
    inventory,
    approvals,
    deliveries,
    complaints,
    transactions,
    maxItems = 5,
  } = params;

  const candidates: AutoSuggestItem[] = [];
  const seen = new Set<string>();

  const pushUnique = (item: AutoSuggestItem) => {
    const key = item.command.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(item);
  };

  const primaryCustomer = customers[0]?.name || 'Sharma General Store';
  const lowStockItem = inventory.find((i) => i.stock_qty < i.reorder_threshold) || inventory[0];
  const pendingApproval = approvals.find((a) => a.status === 'PENDING');
  const pendingDelivery = deliveries.find(
    (d) => d.status === 'PENDING' || d.status === 'OUT_FOR_DELIVERY'
  );
  const latestCompletedTx = transactions.find((t) => t.status === 'COMPLETED');
  const lastUserInput = (recentUserInputs[0] || '').toLowerCase();

  // 1. Recent input history follow-ups (highest contextual relevance)
  if (lastUserInput) {
    if (
      lastUserInput.includes('udhaar') ||
      lastUserInput.includes('bori') ||
      lastUserInput.includes('peti') ||
      lastUserInput.includes('stock') ||
      lastUserInput.includes('khate')
    ) {
      pushUnique({
        id: 'hist-confirm',
        command: 'Haan, confirm kar do.',
        contextHint: 'Follow-up to your last order read-back',
        tools: 'execute_ledger_and_inventory_tx',
        source: 'history',
      });
      pushUnique({
        id: 'hist-complaint',
        command: 'Is customer ki complaint register karo.',
        contextHint: 'Attach complaint to last discussed customer',
        tools: 'register_customer_complaint',
        source: 'history',
      });
    }

    if (
      lastUserInput.includes('aaj') ||
      lastUserInput.includes('sales') ||
      lastUserInput.includes('summary')
    ) {
      pushUnique({
        id: 'hist-kal-report',
        command: 'Kal ke orders ka report bana do.',
        contextHint: 'Compare today summary with yesterday orders',
        tools: 'get_sales_and_orders_report',
        source: 'history',
      });
    }

    if (lastUserInput.includes('confirm') || lastUserInput.includes('likh do')) {
      pushUnique({
        id: 'hist-parchi',
        command: `${latestCompletedTx?.customer_name || primaryCustomer} ka digital parchi receipt bhej do.`,
        contextHint: 'Send receipt right after last transaction',
        tools: 'create_receipt_and_notify_store',
        source: 'history',
      });
      pushUnique({
        id: 'hist-undo',
        command: 'Galti ho gayi, pichli entry cancel karo.',
        contextHint: 'Instant rollback if last entry had a mistake',
        tools: 'undo_last_transaction',
        source: 'history',
      });
    }

    if (lastUserInput.includes('delivery') || lastUserInput.includes('rahul')) {
      pushUnique({
        id: 'hist-delivery-done',
        command: `${pendingDelivery?.customer_name || 'Rahul'} ki delivery delivered mark kar do.`,
        contextHint: 'Update active delivery to delivered',
        tools: 'manage_delivery_status',
        source: 'history',
      });
    }
  }

  // 2. Active tab specific suggestions
  if (activeTab === 'counter') {
    pushUnique({
      id: 'tab-counter-sales',
      command: 'Aaj ki sales ka summary batao.',
      contextHint: 'Counter quick pulse · Live Udhaar, Cash & Jama',
      tools: 'get_sales_and_orders_report',
      source: 'tab',
    });
    pushUnique({
      id: 'tab-counter-delivery',
      command: 'Rahul ki delivery pending mark kar do.',
      contextHint: 'Counter dispatch · Log or update pending delivery',
      tools: 'manage_delivery_status',
      source: 'tab',
    });
    pushUnique({
      id: 'tab-counter-kal',
      command: 'Kal ke orders ka report bana do.',
      contextHint: 'Counter report · Downloadable order breakdown',
      tools: 'get_sales_and_orders_report',
      source: 'tab',
    });
    pushUnique({
      id: 'tab-counter-complaint',
      command: 'Is customer ki complaint register karo.',
      contextHint: 'Counter support · Opens tracked ticket CMP-...',
      tools: 'register_customer_complaint',
      source: 'tab',
    });
  } else if (activeTab === 'khata') {
    if (lowStockItem) {
      pushUnique({
        id: 'tab-khata-restock',
        command: `${lowStockItem.name} ka stock check karo aur restock order bana do.`,
        contextHint:
          lowStockItem.stock_qty < lowStockItem.reorder_threshold
            ? `Low stock alert: ${lowStockItem.stock_qty} ${lowStockItem.unit} remaining`
            : `Khata & Stock · Live SKU check`,
        tools: 'lookup_customer_and_stock · create_supplier_restock',
        source: 'live_alert',
      });
    }
    pushUnique({
      id: 'tab-khata-jama',
      command: `${primaryCustomer} ke khate mein 5000 rupees jama likh do.`,
      contextHint: 'Khata tab · Record customer Jama payment',
      tools: 'lookup_customer_and_stock · execute_ledger_and_inventory_tx',
      source: 'tab',
    });
    pushUnique({
      id: 'tab-khata-notify',
      command: 'Sabhi stores ko aaj ki parchi aur balance notification bhej do.',
      contextHint: 'Khata tab · Broadcast Parchi & balance alerts',
      tools: 'create_receipt_and_notify_store',
      source: 'tab',
    });
  } else if (activeTab === 'approvals') {
    if (pendingApproval) {
      pushUnique({
        id: 'tab-apr-check',
        command: `${pendingApproval.customer_name} ka current udhaar aur credit limit check karo.`,
        contextHint: `Pending HITL: ₹${pendingApproval.total_amount.toLocaleString('en-IN')} awaiting owner override`,
        tools: 'lookup_customer_and_stock',
        source: 'live_alert',
      });
    }
    pushUnique({
      id: 'tab-apr-policy',
      command: 'Verma Traders ko 50 peti refined oil udhaar pe bhej do.',
      contextHint: 'Approvals tab · Test HITL credit-limit guard',
      tools: 'check_business_policy · request_human_approval',
      source: 'tab',
    });
    pushUnique({
      id: 'tab-apr-undo',
      command: 'Galti ho gayi, pichli entry cancel karo.',
      contextHint: 'Approvals tab · Atomic rollback of last entry',
      tools: 'undo_last_transaction',
      source: 'tab',
    });
  } else if (activeTab === 'performance') {
    pushUnique({
      id: 'tab-perf-today',
      command: 'Aaj ki sales ka summary batao.',
      contextHint: 'Performance tab · Today sales & collections',
      tools: 'get_sales_and_orders_report',
      source: 'tab',
    });
    pushUnique({
      id: 'tab-perf-kal',
      command: 'Kal ke orders ka report bana do.',
      contextHint: 'Performance tab · Yesterday itemized orders',
      tools: 'get_sales_and_orders_report',
      source: 'tab',
    });
    pushUnique({
      id: 'tab-perf-week',
      command: 'Is hafte ki sales aur collections ka report bana do.',
      contextHint: 'Performance tab · 7-day counter volume',
      tools: 'get_sales_and_orders_report',
      source: 'tab',
    });
  } else if (activeTab === 'insights') {
    pushUnique({
      id: 'tab-ins-complaint',
      command: 'Is customer ki complaint register karo.',
      contextHint: `Insights & Audit · ${complaints.filter((c) => c.status !== 'RESOLVED').length} open complaints`,
      tools: 'register_customer_complaint',
      source: 'tab',
    });
    pushUnique({
      id: 'tab-ins-report',
      command: 'Pichle 30 din ki sales ka summary batao.',
      contextHint: 'Insights & Audit · Monthly revenue & Khata pulse',
      tools: 'get_sales_and_orders_report',
      source: 'tab',
    });
    if (pendingDelivery) {
      pushUnique({
        id: 'tab-ins-del',
        command: `${pendingDelivery.customer_name} ki delivery delivered mark kar do.`,
        contextHint: `Open delivery: ${pendingDelivery.order_summary}`,
        tools: 'manage_delivery_status',
        source: 'live_alert',
      });
    }
  }

  // 3. Live alerts fallback (if we still have room)
  if (lowStockItem && lowStockItem.stock_qty < lowStockItem.reorder_threshold) {
    pushUnique({
      id: 'alert-low-stock',
      command: `${lowStockItem.name} ka stock check karo aur restock order bana do.`,
      contextHint: `Low stock alert · ${lowStockItem.stock_qty} ${lowStockItem.unit} left`,
      tools: 'lookup_customer_and_stock · create_supplier_restock',
      source: 'live_alert',
    });
  }

  // Add catalog items so typing/filtering always finds matches across all commands
  for (const item of AVAILABLE_VOICE_COMMANDS_CATALOG) {
    pushUnique({
      id: `cat-${item.id}`,
      command: item.command,
      contextHint: `${item.languageLabel} · ${item.description}`,
      tools: item.tools,
      source: 'catalog',
    });
  }

  const trimmedQuery = currentQuery.trim().toLowerCase();
  if (!trimmedQuery) {
    return candidates.slice(0, maxItems);
  }

  const queryWords = trimmedQuery.split(/\s+/).filter(Boolean);
  const filtered = candidates.filter((item) => {
    const haystack = `${item.command} ${item.contextHint} ${item.tools}`.toLowerCase();
    return queryWords.every((w) => haystack.includes(w));
  });

  return (filtered.length > 0 ? filtered : candidates).slice(0, maxItems);
}

/**
 * Computes verifiable, real-data operational impact from live Firestore records.
 * Benchmark basis (explicitly displayed in UI):
 * - Ledger/Receipt/Delivery/Complaint/Restock voice task saves ~2.0 min vs manual paper + tally + WhatsApp entry.
 */
export function computeOperationalImpact(params: {
  transactions: LedgerTransaction[];
  approvals: ApprovalRequest[];
  restocks: RestockOrder[];
  deliveries: DeliveryRecord[];
  complaints: CustomerComplaint[];
  receipts: Receipt[];
}): OperationalImpactMetrics {
  const completedTxs = params.transactions.filter((t) => t.status === 'COMPLETED').length;
  const undoRecoveries = params.transactions.filter((t) => t.status === 'UNDONE').length;
  const hitlGuardsTriggered = params.approvals.length;
  const autoRestocksTriggered = params.restocks.length;
  const deliveriesManaged = params.deliveries.length;
  const complaintsLogged = params.complaints.length;
  const receiptsDispatched = params.receipts.length;

  const completedTasksCount =
    completedTxs +
    autoRestocksTriggered +
    deliveriesManaged +
    complaintsLogged +
    receiptsDispatched;

  const estimatedMinutesSaved = Math.round(completedTasksCount * 2);
  const errorsPreventedOrRecovered = hitlGuardsTriggered + undoRecoveries + autoRestocksTriggered;

  return {
    completedTasksCount,
    estimatedMinutesSaved,
    errorsPreventedOrRecovered,
    hitlGuardsTriggered,
    undoRecoveries,
    autoRestocksTriggered,
    receiptsDispatched,
  };
}
