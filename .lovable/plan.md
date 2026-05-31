## Goal

Allow the Lender ID on the Lender Info page to be edited, validate it is unique across all contacts, and make sure the new ID shows up everywhere it is displayed (Lender grid, Participants grid, open workspace tab, page header, etc.).

## Current state

- `contacts.contact_id` (e.g. `L-00055`) is the canonical Lender ID and already has a DB-level `UNIQUE` constraint.
- On the **Lender Info** screen (`src/components/deal/LenderInfoForm.tsx`, used by `ContactLenderDetailLayout.tsx`), the Lender ID input is bound to a JSONB key `lender.lender_id`. The save path (`useContactsCrud.updateContact`) writes that key into `contact_data` but **never updates `contacts.contact_id`**, so today edits silently do nothing to the canonical ID.
- All downstream views read the live canonical ID:
  - Lenders grid (`ContactLendersPage`) selects `contact_id` from `contacts`.
  - Participants grid (`ParticipantsSectionContent`) joins `deal_participants.contact_id` (uuid → `contacts.id`) and shows `contacts.contact_id` as `contact_id_display`.
  - Lender detail header (`ContactLenderDetailLayout`) shows `contact.contact_id`.
  - Workspace tab label is cached in `sessionStorage` via `ContactWorkspaceContext.OpenContact.contactId` and must be refreshed after a successful rename.

So the real fix is: actually persist the new ID to `contacts.contact_id`, guard it with uniqueness + format validation, and refresh the in-memory caches (open tab + parent list) so visible labels update without a reload.

## Changes

### 1. Lender Info input — make editable + inline validation
File: `src/components/deal/LenderInfoForm.tsx`

- Remove any disabled state on the Lender ID input; allow typing.
- Normalize on change: uppercase, strip spaces. Enforce format `L-#####` (regex `^L-\d{4,}$`) — show inline helper text under the field when invalid.
- Track an `idError` state surfaced under the input in destructive color; block parent save by writing the error into a shared ref / via the existing form-level validation hook the page already uses.

### 2. Persist Lender ID + uniqueness check on save
Files:
- `src/components/contacts/lender-detail/ContactLenderDetailLayout.tsx` (caller)
- `src/hooks/useContactsCrud.ts` (`updateContact`)

- In `ContactLenderDetailLayout.handleSave`, read the edited `lender.lender_id` from `values`, trim/uppercase, and pass it as a separate argument (e.g. `updateContact(id, contactData, { newContactId })`).
- In `updateContact`:
  - If `newContactId` is provided and differs from the current row's `contact_id`:
    - Pre-check: `select id from contacts where contact_id = $newContactId and id <> $id limit 1`. If a row exists, toast + return `false` with reason `"This Lender ID already exists. Please enter a unique ID."` — surfaced inline by the form.
    - Include `contact_id: newContactId` in the `update({...})` payload.
    - Wrap the update; if it fails with Postgres `23505` (unique violation) treat it as the same duplicate error (race-safe fallback).
- Return a structured result (`{ ok: boolean; duplicateId?: boolean; newContactId?: string }`) so the layout can show the inline error on the Lender ID field instead of (or in addition to) the toast.

### 3. Cascade the new ID to visible UI

- **Lender Detail header** (`ContactLenderDetailLayout`): after a successful save with a renamed ID, update local `contact.contact_id` (lift state or refetch the single contact row) so `Lender — {contact.contact_id}` re-renders.
- **Open workspace tab**: extend `ContactWorkspaceContext` with a `updateContactId(id, newContactId, fullName?)` helper that rewrites the matching entry in `openContacts` (and persists to sessionStorage). Call it from `ContactLenderDetailLayout` after a successful rename so the tab label `L-XXXXX · Name` updates immediately.
- **Lenders grid** (`ContactLendersPage`): the page already lists contacts from state. After `handleSave` resolves, refetch via the existing `crud.fetchContacts` call (or update the row in place using the returned `newContactId`) so the row reflects the new ID without a reload.
- **Participants grid** (`ParticipantsSectionContent`): no code change needed — it joins on `contacts.id` and reads `contacts.contact_id` live, so the next render/refetch picks up the rename automatically. Just ensure a refetch is triggered (already happens on tab switch / focus); no additional cascade write is required because no other table stores the human Lender ID as data.

### 4. Acceptance verification

- Editing `L-00055` → `L-09999` and saving:
  - Shows the new ID in the page header, in the Lenders grid row, in the open tab label `L-09999 · John Andersan`, and in any Participants grid that lists this lender (after its normal refetch).
  - Saving a value that matches another lender's ID blocks the save and shows `"This Lender ID already exists. Please enter a unique ID."` inline under the field.
  - Invalid format (empty, lowercase, missing prefix) shows inline format error and blocks save.

## Out of scope

- No DB migration — the `UNIQUE (contact_id)` constraint already exists.
- No changes to Borrower/Broker ID editing (same pattern can be applied later if requested).
- No backfill of historical denormalized strings (none found that store the human Lender ID outside `contacts.contact_id`).
