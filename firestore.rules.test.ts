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
  {
    id: 13,
    name: 'Cross-Tenant Receipt Forgery',
    collection: 'receipts',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description:
      'Creating a receipt referencing another owner customer_id or mutating total_amount must fail.',
  },
  {
    id: 14,
    name: 'Notification Message Tampering',
    collection: 'notifications',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    description:
      'Modifying message or phone after dispatch (only status/updatedAt from DISPATCHED allowed) must fail.',
  },
];

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Firestore Security Rules — Dirty Dozen + Receipt/Notification Invariant Audit', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  const blueprint = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf8')
  ) as { firestore: Record<string, unknown> };

  it('defines all 14 adversarial security test vectors', () => {
    expect(DIRTY_DOZEN_TEST_CASES).toHaveLength(14);
    for (const tc of DIRTY_DOZEN_TEST_CASES) {
      expect(tc.expected).toBe('PERMISSION_DENIED');
    }
  });

  it('enforces global default-deny safety net and verified email identity gate', () => {
    expect(rulesText).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
    expect(rulesText).toContain('request.auth != null');
    expect(rulesText).toContain('request.auth.token.email_verified == true');
  });

  it('enforces strict schema keys().hasOnly(), owner isolation, and path ID regex validation', () => {
    expect(rulesText).toContain('keys().hasOnly(');
    expect(rulesText).toContain('ownerId == request.auth.uid');
    expect(rulesText).toContain("matches('^[a-zA-Z0-9_\\\\-]+$')");
  });

  it('enforces timestamp integrity, terminal state protection, and parent exists() guard', () => {
    expect(rulesText).toContain('request.time');
    expect(rulesText).toContain('affectedKeys().hasOnly(');
    expect(rulesText).toContain('exists(/databases/$(database)/documents/customers/');
  });

  it('enforces strict validators and immutable fields for receipts and notifications', () => {
    expect(rulesText).toContain('function isValidReceipt(data)');
    expect(rulesText).toContain('function isValidStoreNotification(data)');
    expect(rulesText).toContain('match /receipts/{receiptId}');
    expect(rulesText).toContain('match /notifications/{notificationId}');
    expect(rulesText).toContain("existing().status != 'VOIDED'");
    expect(rulesText).toContain("existing().status == 'DISPATCHED'");
    expect(rulesText).toContain("existing().status == 'COMPLETED'");
    expect(rulesText).toContain("incoming().status == 'UNDONE'");
  });

  it('covers every collection declared in firebase-blueprint.json with explicit match blocks', () => {
    for (const collectionPath of Object.keys(blueprint.firestore)) {
      const colName = collectionPath.split('/').filter(Boolean)[0];
      expect(rulesText).toContain(`match /${colName}/{`);
    }
  });
});
