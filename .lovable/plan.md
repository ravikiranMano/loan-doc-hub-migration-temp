## Root cause

In `LoanTermsFundingForm.tsx` the grid is passed the already-paginated slice (`paginatedRecords`) as `fundingRecords`. The grid then:

- Tracks `prevRecordsLenRef` against this paginated slice length, so its "auto-clear filters when records grow" effect (`LoanFundingGrid.tsx` lines 274–282) does not fire on add (slice length usually shrinks or stays the same when jumping to the new last page).
- Runs `useGridSortFilter(fundingRecords, …)` on the paginated slice, so any active search/filter applied to the prior page silently filters out the just-added record on the new page.

Result: after saving in the Add Funding modal, the new row never appears in the grid until the user manually clears the search/filter or refreshes.

## Change (minimal, frontend only)

Edit only the prop wiring so the grid can detect total-record growth correctly. No API, schema, layout, or persistence change.

1. `src/components/deal/LoanTermsFundingForm.tsx`
   - Add a new prop value passed to `<LoanFundingGrid>`: `totalRecordCount={fundingRecords.length}` (the full, unpaginated list length already computed in this file).
   - Leave everything else (paginated slice prop, persistence, page jump) untouched.

2. `src/components/deal/LoanFundingGrid.tsx`
   - Add an optional `totalRecordCount?: number` to `LoanFundingGridProps` and destructure it (default to `fundingRecords.length` for safety/backwards compat).
   - Replace the growth detector at lines 274–282 to track `totalRecordCount` instead of the paginated slice length:
     ```ts
     const prevTotalRef = useRef(totalRecordCount);
     useEffect(() => {
       if (totalRecordCount > prevTotalRef.current) {
         if (searchQuery || activeFilterCount > 0) clearFilters();
       }
       prevTotalRef.current = totalRecordCount;
     }, [totalRecordCount, searchQuery, activeFilterCount, clearFilters]);
     ```
   - No other logic, no UI, no totals row, no columns, no styling changed.

## Why this fixes it

- The page-jump in `handleAddFunding` already moves the user to the page that contains the new record.
- With the corrected growth detector, any active search/filter is cleared on add, so the newly added record on the new page is no longer hidden by stale filter state and shows up immediately in the grid.
- Persistence is unchanged (`directPersistFundingField` still writes both `funding_records` and `funding_history` JSON via the existing API).

## Out of scope

- No changes to AddFundingModal, persistence helpers, save APIs, schema, or any other grid (history, adjustments).
- No edits to totals/summary calculations or column definitions.