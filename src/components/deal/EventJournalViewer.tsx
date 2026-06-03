import React, { useState, useEffect } from 'react';
import { usePaginatedEventJournalEntries, useEventJournalEntries, type EventJournalEntry, type FieldChange } from '@/hooks/useEventJournal';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { BookOpen } from 'lucide-react';
import { GridToolbar, FilterOption } from './GridToolbar';
import { GridExportDialog, ExportColumn } from './GridExportDialog';
import { SortableTableHead } from './SortableTableHead';
import { useGridSortFilter } from '@/hooks/useGridSortFilter';
import { useQueryClient } from '@tanstack/react-query';

interface EventJournalViewerProps {
  dealId: string;
  disabled?: boolean;
  /** When true, refetch journal entries (e.g. tab became visible). */
  active?: boolean;
}

function formatDetailsPreview(details: FieldChange[]): string {
  const text = details
    .map(d => `${d.fieldLabel}: ${d.oldValue || '(empty)'} → ${d.newValue || '(empty)'}`)
    .join('; ');
  return text.length > 80 ? text.substring(0, 80) + '…' : text;
}

function formatDetailsFull(details: FieldChange[]): React.ReactNode {
  return (
    <div className="space-y-2">
      {details.map((d, i) => (
        <div key={i} className="text-sm">
          <span className="font-medium text-foreground">{d.fieldLabel}:</span>{' '}
          <span className="text-muted-foreground">{d.oldValue || '(empty)'}</span>
          <span className="mx-1 text-primary">→</span>
          <span className="text-foreground">{d.newValue || '(empty)'}</span>
        </div>
      ))}
    </div>
  );
}

const SEARCH_FIELDS = ['actor_name', 'section', 'event_number', 'ip_address'];

const FILTER_OPTIONS: FilterOption[] = [
  {
    id: 'section',
    label: 'Section',
    options: [
      { value: 'borrower', label: 'Borrower' },
      { value: 'co_borrower', label: 'Co-Borrower' },
      { value: 'loan_terms', label: 'Loan Terms' },
      { value: 'property', label: 'Property' },
      { value: 'lender', label: 'Lender' },
      { value: 'broker', label: 'Broker' },
      { value: 'charges', label: 'Charges' },
      { value: 'notes', label: 'Notes' },
    ],
  },
];

const EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'event_number', label: 'Event #' },
  { id: 'actor_name', label: 'User' },
  { id: 'section', label: 'Section' },
  { id: 'ip_address', label: 'IP Address' },
  { id: 'created_at', label: 'Timestamp' },
];

const PAGE_SIZE = 10;

export const EventJournalViewer: React.FC<EventJournalViewerProps> = ({ dealId, disabled = false, active = true }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const { data: paginatedResult, isLoading, isError, error, refetch } =
    usePaginatedEventJournalEntries(dealId, currentPage, PAGE_SIZE);
  // Keep the full query for export only
  const { data: allEntries } = useEventJournalEntries(dealId);
  const [selectedEntry, setSelectedEntry] = useState<EventJournalEntry | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const queryClient = useQueryClient();

  const entries = paginatedResult?.entries || [];
  const totalCount = paginatedResult?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const {
    searchQuery, setSearchQuery, sortState, toggleSort,
    activeFilters, setFilter, clearFilters, activeFilterCount, filteredData,
  } = useGridSortFilter(entries, SEARCH_FIELDS);

  // Reset to page 1 when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeFilters]);

  // Refetch when the tab becomes visible (forceMount keeps the component mounted while hidden).
  useEffect(() => {
    if (!active || !dealId) return;
    queryClient.invalidateQueries({ queryKey: ['event-journal-paginated', dealId] });
    queryClient.invalidateQueries({ queryKey: ['event-journal', dealId] });
  }, [active, dealId, queryClient]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['event-journal-paginated', dealId] });
    queryClient.invalidateQueries({ queryKey: ['event-journal', dealId] });
  };

  if (isLoading && currentPage === 1) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-muted-foreground">Loading event journal…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center space-y-3">
          <p className="text-destructive font-medium">Could not load event journal</p>
          <p className="text-sm text-muted-foreground">
            {(error as Error)?.message || 'Request failed'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (totalCount === 0 && !isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Event Journal</h3>
          <p className="text-muted-foreground">No changes recorded yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col border border-border rounded-lg bg-background overflow-hidden">
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg text-foreground">Events Journal</h3>
      </div>

      <GridToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterOptions={FILTER_OPTIONS}
        activeFilters={activeFilters}
        onFilterChange={setFilter}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        disabled={disabled}
        onRefresh={handleRefresh}
        onExport={() => setExportOpen(true)}
      />

      <div className="border border-border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <SortableTableHead columnId="event_number" label="EVENT #" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[80px]" />
              <SortableTableHead columnId="actor_name" label="USER" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[150px]" />
              <SortableTableHead columnId="section" label="SECTION" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[120px]" />
              <TableHead>DETAILS</TableHead>
              <SortableTableHead columnId="ip_address" label="IP ADDRESS" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[130px]" />
              <SortableTableHead columnId="created_at" label="TIMESTAMP" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[160px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {isLoading ? 'Loading…' : 'No events match your search or filters.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((entry) => (
                <TableRow key={entry.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono">{entry.event_number}</TableCell>
                  <TableCell>{entry.actor_name}</TableCell>
                  <TableCell className="capitalize">{entry.section.replace(/_/g, ' ')}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground truncate max-w-[300px]">
                        {formatDetailsPreview(entry.details)}
                      </span>
                      {entry.details.length > 0 && (
                        <Button variant="link" size="sm" className="shrink-0 px-1 h-auto" onClick={() => setSelectedEntry(entry)}>
                          Show More
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">
                    {entry.ip_address || '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(entry.created_at), 'MMM d, yyyy h:mm a')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount} events
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(1)} disabled={currentPage <= 1 || isLoading}>
              First
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage <= 1 || isLoading}>
              Previous
            </Button>
            <span className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm">
              {currentPage}
            </span>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage >= totalPages || isLoading}>
              Next
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages || isLoading}>
              Last
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!selectedEntry} onOpenChange={() => setSelectedEntry(null)}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Event #{selectedEntry?.event_number} — {selectedEntry?.section.replace(/_/g, ' ')}
            </DialogTitle>
            <DialogDescription>
              By {selectedEntry?.actor_name} on{' '}
              {selectedEntry ? format(new Date(selectedEntry.created_at), 'MMM d, yyyy h:mm a') : ''}
              {selectedEntry?.ip_address && (
                <span className="block mt-1">IP: {selectedEntry.ip_address}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && formatDetailsFull(selectedEntry.details)}
        </DialogContent>
      </Dialog>

      <GridExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        columns={EXPORT_COLUMNS}
        data={allEntries || []}
        fileName="event_journal"
      />
    </div>
    </div>
  );
};
