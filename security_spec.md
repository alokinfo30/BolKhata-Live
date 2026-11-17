# BolKhata Live — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document across `customers`, `inventory`, `transactions`, `approvals`, `restocks`, `sentiment_logs`, and `agent_traces` MUST have `ownerId == request.auth.uid`, verified email (`request.auth.token.email_verified == true`), and immutable `ownerId` / `createdAt`.
2. **PII Protection**: `customers` documents contain phone numbers and credit balances; `get` and `list` queries are strictly locked to `resource.data.ownerId == request.auth.uid`.
3. **Referential Integrity**: On `transactions` and `approvals` creation, the referenced `customer_id` document must exist and belong to `request.auth.uid`.
4. **Terminal State Locking**: Once an `approvals` document transitions from `PENDING` to `APPROVED` or `REJECTED`, it cannot be mutated again. Once a `transactions` document transitions to `UNDONE`, it cannot be reverted or re-modified.
5. **Temporal Integrity & Bounded Payloads**: `createdAt` and `updatedAt` must equal `request.time`. All strings, arrays (`aliases.size() <= 10`), and document IDs (`^[a-zA-Z0-9_\-]+$`, max 128 chars) are strictly bounded.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Customer Read**: `get /customers/cust_1` with `auth == null` -> `PERMISSION_DENIED`.
2. **Cross-Tenant List Scraping**: `list /customers` without `where('ownerId', '==', uid)` or querying another user's `ownerId` -> `PERMISSION_DENIED`.
3. **Email Unverified Spoof**: Create customer with valid `uid` but `email_verified: false` -> `PERMISSION_DENIED`.
4. **Owner Spoofing on Create**: Create `transactions` with `ownerId: 'victim_uid'` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection**: Create `customers` with extra field `isAdminBypass: true` -> `PERMISSION_DENIED`.
6. **ID Poisoning Attack**: Create `inventory` with 500-char ID or invalid characters `../../evil` -> `PERMISSION_DENIED`.
7. **Unbounded Array Bomb**: Create `inventory` with `aliases` containing 25 elements or non-string element -> `PERMISSION_DENIED`.
8. **Timestamp Forgery**: Create `transactions` with backdated `createdAt` instead of `request.time` -> `PERMISSION_DENIED`.
9. **Approval Terminal State Tampering**: Update an `APPROVED` approval document back to `PENDING` -> `PERMISSION_DENIED`.
10. **Transaction Amount Poisoning**: Update `transactions` `total_amount` after creation (only `status` and `updatedAt` may change for `COMPLETED -> UNDONE`) -> `PERMISSION_DENIED`.
11. **Orphaned Transaction Creation**: Create `transactions` referencing non-existent `customer_id` -> `PERMISSION_DENIED`.
12. **Customer Owner Hijack on Update**: Update `customers` attempting to modify `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
