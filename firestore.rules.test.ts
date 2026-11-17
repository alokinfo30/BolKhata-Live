/**
 * BolKhata Live — Firestore Security Rules Adversarial Test Suite (Dirty Dozen)
 * Run against Firebase Emulator Suite when testing locally with @firebase/rules-unit-testing.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update';
  expected: 'PERMISSION_DENIED';
  description: string;
}

export const DIRTY_DOZEN_TEST_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Customer Read',
    collection: 'customers',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    description: 'auth == null attempting to read customer PII document must fail.',
  },
  {
    id: 2,
    name: 'Cross-Tenant List Scraping',
    collection: 'customers',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    description: 'Querying customers without ownerId == request.auth.uid must fail.',
  },
  {
    id: 3,
    name: 'Email Unverified Spoof',
    collection: 'customers',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Authenticated token with email_verified: false attempting write must fail.',
  },
  {
    id: 4,
    name: 'Owner Spoofing on Create',
    collection: 'transactions',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Setting ownerId to another user UID must fail.',
  },
  {
    id: 5,
    name: 'Shadow / Ghost Field Injection',
    collection: 'customers',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Adding extra field isAdminBypass: true is blocked by keys().hasOnly().',
  },
  {
    id: 6,
    name: 'ID Poisoning Attack',
    collection: 'inventory',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Document ID exceeding 128 chars or containing invalid chars fails isValidId().',
  },
  {
    id: 7,
    name: 'Unbounded Array Bomb',
    collection: 'inventory',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Inventory aliases array with > 10 items or non-string items must fail.',
  },
  {
    id: 8,
    name: 'Timestamp Forgery',
    collection: 'transactions',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Backdated createdAt != request.time must fail.',
  },
  {
    id: 9,
    name: 'Approval Terminal State Tampering',
    collection: 'approvals',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    description: 'Updating an APPROVED approval document back to PENDING must fail.',
  },
  {
    id: 10,
    name: 'Transaction Amount Poisoning',
    collection: 'transactions',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    description: 'Modifying total_amount on a transaction fails affectedKeys().hasOnly().',
  },
  {
    id: 11,
    name: 'Orphaned Transaction Creation',
    collection: 'transactions',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Creating a transaction for a non-existent customer_id fails exists() guard.',
  },
  {
    id: 12,
    name: 'Customer Owner Hijack on Update',
    collection: 'customers',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    description: 'Attempting to change ownerId or createdAt on update must fail.',
  },
];
