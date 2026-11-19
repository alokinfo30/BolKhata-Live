export type TxType = 'UDHAAR' | 'JAMA' | 'CASH_SALE';
export type TxStatus = 'COMPLETED' | 'UNDONE' | 'PENDING_APPROVAL';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type RestockStatus = 'ORDERED' | 'RECEIVED' | 'CANCELLED';
export type SentimentLabel = 'POSITIVE' | 'NEUTRAL' | 'FRICTION';
export type ReceiptStatus = 'ISSUED' | 'SENT' | 'VOIDED';
export type NotificationChannel = 'WHATSAPP' | 'SMS' | 'IN_APP' | 'BROADCAST';
export type NotificationStatus = 'DISPATCHED' | 'DELIVERED' | 'FAILED';

export type TraceStepType =
  | 'VOICE_INTENT'
  | 'TOOL_CALL'
  | 'POLICY_CHECK'
  | 'HITL_PAUSE'
  | 'EXECUTED'
  | 'UNDO'
  | 'RESTOCK'
  | 'ERROR';

export interface Receipt {
  id: string;
  ownerId: string;
  receipt_number: string;
  tx_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_location: string;
  item_name: string;
  qty: number;
  unit: string;
  unit_price: number;
  total_amount: number;
  tx_type: TxType;
  previous_balance: number;
  new_balance: number;
  upi_uri: string;
  note: string;
  status: ReceiptStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StoreNotification {
  id: string;
  ownerId: string;
  receipt_id: string;
  receipt_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  channel: NotificationChannel;
  message: string;
  status: NotificationStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Customer {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  location: string;
  current_udhaar_balance: number;
  credit_limit: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InventoryItem {
  id: string;
  ownerId: string;
  sku: string;
  name: string;
  unit: string;
  aliases: string[];
  stock_qty: number;
  unit_price: number;
  reorder_threshold: number;
  supplier_name: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LedgerTransaction {
  id: string;
  ownerId: string;
  tx_id: string;
  customer_id: string;
  customer_name: string;
  item_sku: string;
  item_name: string;
  unit: string;
  qty: number;
  unit_price: number;
  total_amount: number;
  type: TxType;
  status: TxStatus;
  previous_balance: number;
  previous_stock: number;
  note: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ApprovalRequest {
  id: string;
  ownerId: string;
  approval_id: string;
  customer_id: string;
  customer_name: string;
  item_sku: string;
  item_name: string;
  unit: string;
  qty: number;
  total_amount: number;
  tx_type: TxType;
  reason: string;
  status: ApprovalStatus;
  approved_by: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RestockOrder {
  id: string;
  ownerId: string;
  po_number: string;
  item_sku: string;
  item_name: string;
  supplier_name: string;
  order_qty: number;
  unit: string;
  estimated_cost: number;
  reason: string;
  status: RestockStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SentimentLog {
  id: string;
  ownerId: string;
  rating: number;
  sentiment: SentimentLabel;
  category: string;
  comment: string;
  ai_summary: string;
  source: 'VOICE' | 'UI';
  createdAt?: unknown;
}

export interface AgentTraceItem {
  id: string;
  ownerId: string;
  session_id: string;
  step_type: TraceStepType;
  title: string;
  detail: string;
  latency_ms: number;
  createdAt?: unknown;
}

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: number;
}

export interface PersistedVoiceTranscript {
  id: string;
  ownerId: string;
  session_id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  createdAt?: unknown;
}

export interface LatencySamplePoint {
  timestamp: number;
  timeLabel: string;
  latencyMs: number;
  source: 'Voice' | 'Tool';
}

export interface ActiveBillPreview {
  customerId: string;
  customerName: string;
  itemName: string;
  qty: number;
  unit: string;
  totalAmount: number;
  txType: TxType;
  status: 'READBACK' | 'PENDING_APPROVAL' | 'CONFIRMED';
  updatedAt: number;
}

export interface InsightsReport {
  whatsapp_reminder: {
    customer_name: string;
    phone: string;
    message_hinglish: string;
  };
  distributor_po: {
    supplier_name: string;
    subject: string;
    body_english: string;
    items_summary: string;
  };
  eod_summary: {
    headline: string;
    total_volume_inr: number;
    credit_issued_inr: number;
    collections_inr: number;
    risk_alerts: string[];
    action_items: string[];
  };
  sentiment_digest: {
    overall_mood: string;
    top_praise: string;
    top_friction_point: string;
    recommended_tweak: string;
  };
}
