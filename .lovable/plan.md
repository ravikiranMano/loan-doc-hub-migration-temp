## Goal

Add two new icon-only action buttons to the Actions column of the Document History table on `Deal → Documents → Document History` tab, alongside the existing DOCX/PDF download buttons. No schema, API, or download-flow changes.

## Scope

File: `src/pages/csr/DealDocumentsPage.tsx` (Actions cell of the history table, ~lines 1415–1445).

For each successful generated document row, add:

1. **Open** icon button (`ExternalLink` from lucide-react)
   - Tooltip: "Open in new window"
   - Behavior: create a Supabase Storage signed URL (1 hour) for the document (prefer `output_pdf_path`, fall back to `output_docx_path` so PDFs render inline in the browser; DOCX will download via the browser when no PDF exists) and open it in a new tab with `window.open(url, '_blank', 'noopener,noreferrer')`.

2. **Print** icon button (`Printer` from lucide-react)
   - Tooltip: "Print document"
   - Behavior: create a signed URL for `output_pdf_path` (PDF is required for browser print). Load it into a hidden iframe; on iframe `load`, call `contentWindow.print()`. If no PDF exists for the row, disable the button with a tooltip "PDF not available for printing".

Both buttons use `variant="outline"`, `size="sm"`, `h-7 w-7 p-0`, and sit to the left of the existing DOCX/PDF buttons in the same flex row. No layout changes elsewhere.

## Notes on persistence / APIs

Open and Print are read-only client actions — they only call the existing `supabase.storage.from('generated-docs').createSignedUrl(...)` API used elsewhere in the file. No new tables, no schema changes, no new edge functions, no edits to the document-generation flow or any other UI. The existing generated_documents rows (already persisted by the save/generate flow) drive the buttons; nothing else needs to be stored.

## Out of scope

- The Documents listing page (`src/pages/csr/DocumentsPage.tsx`)
- Any change to generation, download, version, or status logic
- Any styling or column changes outside the Actions cell
