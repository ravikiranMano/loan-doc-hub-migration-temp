## Goal

The Loan → Attachments tab (`DealAttachmentsTab.tsx`) already exists and is wired into `DealDataEntryPage.tsx`. Network inspection on deal `DL-2026-0282` shows the fetch succeeds (HTTP 200, empty array) and no row exists yet in `deal_section_values` for `section='attachments_grid'`. So the wiring works, but the spec calls out several gaps vs. the required behavior. This plan closes those gaps without changing schema, APIs, or layout.

## Changes (single file: `src/components/deal/DealAttachmentsTab.tsx`)

1. **File validation before upload** (per spec)
   - Add `validateAttachment(file)`:
     - Allowed MIME types: PDF, JPG, PNG, GIF, DOC, DOCX, XLS, XLSX, TXT.
     - Max size: 25 MB (already enforced) → unified into validator.
     - File name length ≤ 255.
   - Run validator in the upload mutation; on failure show `toast.error(message)` and abort.
   - Set `accept="..."` on the `<input type="file">` so the OS picker pre-filters.

2. **Attachment count badge** next to the "Attachments" heading: `Attachments (N)` using `attachments.length`.

3. **Delete confirmation**: replace `window.confirm` with the existing `DeleteConfirmationDialog` component for consistency with the rest of the app.

4. **Upload progress / disabled state**: disable the Upload button + show spinner while `uploadMutation.isPending` (already partly done); also disable the file `<input>` during upload to prevent double-submit.

5. **Refresh-after-upload guarantee**: keep existing `invalidateQueries`; additionally `await queryClient.refetchQueries({ queryKey })` in `onSuccess` of upload + delete so the list reflects immediately even if the cache is stale.

6. **Loan-id scoping safety**: early-return an empty state if `dealId` is falsy; key the query strictly on `dealId` (already true) so navigating between loans clears the list automatically via React Query.

7. **Empty-state copy**: keep current empty state but show "No attachments yet. Click Upload to add one." (minor copy tweak, no layout change).

## Out of scope (explicitly NOT changed)

- No new tables / schema (`deal_section_values.attachments_grid` JSONB row keeps current shape `{ files: AttachmentMeta[] }`).
- No new APIs or edge functions; continues to use Supabase Storage bucket `contact-attachments` under `deal/{dealId}/...` and existing RLS policies.
- No changes to `DealDataEntryPage.tsx` wiring, tab layout, other forms, document generation, or any unrelated component.
- No changes to existing successful upload/download/delete flows beyond the items above.

## Verification

- Open deal `DL-2026-0282` → Attachments tab.
- Upload a PDF < 25 MB → appears in list, count badge increments, toast shown, row persists in `deal_section_values` (`section='attachments_grid'`).
- Upload an `.exe` → blocked with validation toast.
- Upload a 30 MB file → blocked with size toast.
- Download → triggers browser download with original filename.
- Delete → confirmation dialog → row removed, storage object removed, count decrements.
- Refresh page → list still shows uploaded files (persistence).
- Navigate to a different deal → list shows only that deal's attachments.
