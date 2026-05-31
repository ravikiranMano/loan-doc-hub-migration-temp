## Goal

Replicate the Lender ID edit/uniqueness/cascade pattern (already shipped) for Broker and Borrower IDs.

Format rules:
- Broker: `BR-\d{4,}` (e.g. `BR-00020`)
- Borrower: `B-\d{4,}` (e.g. `B-00043`)
- Uniqueness is scoped per `contact_type` (a Broker ID may coexist with a Borrower ID that has the same numeric portion, but never two Brokers with the same ID).

## Scope of changes

### 1. Uniqueness validation (per type)

`src/hooks/useContactsCrud.ts` — extend the existing `updateContact` duplicate check (already used for Lenders) so it scopes to the contact's own `contact_type`:
- Pre-check: `select id from contacts where contact_id = $newContactId and contact_type = $contactType and id <> $id limit 1`
- On hit, return `{ ok: false, duplicateId: true }` → inline error in the form.
- Keep the existing Postgres `23505` fallback for race conditions; surface the same per-type message.

The DB `contacts.contact_id` UNIQUE constraint is global, which is stricter than required but doesn't block us; the UI message stays per-type ("This Broker ID already exists…" / "This Borrower ID already exists…").

### 2. Editable ID field + format validation

**Broker** — `src/components/deal/BrokerInfoForm.tsx`:
- Make the `Broker ID` input editable (currently displays `BR-00020`).
- Uppercase + trim on change; inline regex check `/^BR-\d{4,}$/`.
- Accept new `brokerIdError` prop for server-side duplicate message; render under the field.

**Borrower** — there is no `BorrowerInfoForm.tsx`. The Borrower detail page renders the form fields directly inside `ContactBorrowerDetailLayout.tsx` (the `Borrower ID` input visible in screenshot 1). Make that specific input editable with the same logic, regex `/^B-\d{4,}$/`, and a local `borrowerIdError` state.

### 3. Persist + cascade on save

**`src/components/contacts/broker-detail/ContactBrokerDetailLayout.tsx`** and **`src/components/contacts/borrower-detail/ContactBorrowerDetailLayout.tsx`**:
- Mirror the Lender layout pattern:
  - Local `contact` state so the header (`Broker — BR-00020` / `Borrower — B-00043`) updates immediately after save.
  - In `handleSave`, detect ID rename, validate format, call `updateContact(id, payload, { newContactId })`.
  - On duplicate, set the inline error and abort.
  - On success: call `updateContactId(id, newContactId, fullName?)` from `ContactWorkspaceContext` (already exists) to rewrite the open tab label, and dispatch `window.dispatchEvent(new CustomEvent('contact-id-renamed', { detail: { contactDbId, oldContactId, newContactId, contactType } }))`.

### 4. Grid + Participants cascade

- **Brokers grid** (`src/pages/contacts/ContactBrokersPage.tsx`) and **Borrowers grid** (`src/pages/contacts/ContactBorrowersPage.tsx`): after a successful rename in the detail layout's save flow, call the page's `crud.fetchContacts` (same hook already used for Lenders) so the grid reflects the new ID.
- **Participants grid** (`src/components/deal/ParticipantsSectionContent.tsx`): the existing `contact-id-renamed` listener already calls `fetchParticipants()` — no change needed; it fires for any contact type.
- **Loan-file ID search components** (`BrokerIdSearch`, equivalent borrower search): they read live from `contacts`, so the next dropdown open shows the new ID. No code change.

### 5. Tab label + breadcrumbs

`ContactWorkspaceContext.updateContactId` (already added for Lenders) is type-agnostic and will update both Broker and Borrower tab labels in `WorkspaceTabBar`. No new context work required.

## Out of scope

- No DB migration. The global UNIQUE on `contacts.contact_id` already prevents true duplicates; per-type messaging is enforced in the UI layer.
- No historical backfill of any denormalized ID strings stored in `deal_section_values` JSONB; downstream views read live from `contacts` via joins.
- No changes to Additional Guarantor / Authorized Party / Lender (already done) ID editing.
- No changes to `generate_contact_id` RPC.

## Acceptance

- Editing `BR-00020` → `BR-09999` (or `B-00043` → `B-09999`) and saving:
  - Updates the detail header, the open workspace tab, the Brokers/Borrowers grid, and the Participants grid on any open loan file.
  - Persists to `contacts.contact_id`.
- Saving a duplicate within the same type shows the inline error and blocks the save.
- Saving an invalid format (e.g. `BR-12` or `BORROWER1`) shows the format error and blocks the save.

## Files to edit

- `src/hooks/useContactsCrud.ts` — scope duplicate pre-check by `contact_type`.
- `src/components/deal/BrokerInfoForm.tsx` — editable Broker ID + inline validation.
- `src/components/contacts/broker-detail/ContactBrokerDetailLayout.tsx` — save flow, local header state, tab update, rename event.
- `src/components/contacts/borrower-detail/ContactBorrowerDetailLayout.tsx` — editable Borrower ID input + same save flow.
- `src/pages/contacts/ContactBrokersPage.tsx` — refetch on successful rename.
- `src/pages/contacts/ContactBorrowersPage.tsx` — refetch on successful rename.
