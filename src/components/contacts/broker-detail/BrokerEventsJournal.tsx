import React, { useState, useEffect } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { BookOpen } from 'lucide-react';
import { GridToolbar, FilterOption } from '@/components/deal/GridToolbar';
import { GridExportDialog, ExportColumn } from '@/components/deal/GridExportDialog';
import { SortableTableHead } from '@/components/deal/SortableTableHead';
import { useGridSortFilter } from '@/hooks/useGridSortFilter';
import { getContactContactData } from '@/services/contacts/contacts.service';
import { format } from 'date-fns';
import type { ContactEventJournalEntry, ContactFieldChange } from '@/hooks/useContactEventJournal';

function formatDetailsPreview(details: ContactFieldChange[]): string {
  const text = details
    .map(d => `${d.fieldLabel}: ${d.oldValue || '(empty)'} → ${d.newValue || '(empty)'}`)
    .join('; ');
  return text.length > 80 ? text.substring(0, 80) + '…' : text;
}

function formatDetailsFull(details: ContactFieldChange[]): React.ReactNode {
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

const SEARCH_FIELDS = ['user', 'section', 'eventNumber', 'ip_address'];

const FILTER_OPTIONS: FilterOption[] = [
  {
    id: 'section',
    label: 'Section',
    options: [
      { value: 'Charges', label: 'Charges' },
      { value: 'Trust Ledger', label: 'Trust Ledger' },
      { value: 'Conversation Log', label: 'Conversation Log' },
      { value: 'Broker Info', label: 'Broker Info' },
    ],
  },
];

const EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'eventNumber', label: 'Event #' },
  { id: 'user', label: 'User' },
  { id: 'section', label: 'Section' },
  { id: 'ip_address', label: 'IP Address' },
  { id: 'created_at', label: 'Timestamp' },
];

const BrokerEventsJournal: React.FC<{ brokerId: string; contactDbId: string }> = ({ contactDbId }) => {
  const [entries, setEntries] = useState<ContactEventJournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<ContactEventJournalEntry | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!contactDbId) { setIsLoading(false); return; }
    (async () => {
      const contactData = await getContactContactData(contactDbId);
      if (contactData._events_journal) {
        const journal = contactData._events_journal as ContactEventJournalEntry[];
        setEntries(journal.slice().reverse());
      }
      setIsLoading(false);
    })();
  }, [contactDbId]);

  const {
    searchQuery, setSearchQuery, sortState, toggleSort,
    activeFilters, setFilter, clearFilters, activeFilterCount, filteredData,
  } = useGridSortFilter(entries, SEARCH_FIELDS);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-muted-foreground">Loading event journal…</p>
      </div>
    );
  }

  const handleRefresh = async () => {
    const contactData = await getContactContactData(contactDbId);
    if (contactData._events_journal) {
      setEntries((contactData._events_journal as ContactEventJournalEntry[]).slice().reverse());
    } else {
      setEntries([]);
    }
  };

  return (
    <div className="flex flex-col border border-border rounded-lg bg-background overflow-hidden">
    <div className="p-6 space-y-4">
      <h4 className="text-lg font-semibold text-foreground">Events Journal</h4>

      <GridToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterOptions={FILTER_OPTIONS}
        activeFilters={activeFilters}
        onFilterChange={setFilter}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        onExport={() => setExportOpen(true)}
        onRefresh={handleRefresh}
      />

      <div className="border border-border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <SortableTableHead columnId="eventNumber" label="Event #" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[80px] text-xs" />
              <SortableTableHead columnId="user" label="User" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[150px] text-xs" />
              <SortableTableHead columnId="section" label="Section" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[120px] text-xs" />
              <TableHead className="text-xs">Details</TableHead>
              <SortableTableHead columnId="ip_address" label="IP Address" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[130px] text-xs" />
              <SortableTableHead columnId="created_at" label="Timestamp" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[160px] text-xs" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No events match your search or filters.
                </TableCell>
              </TableRow>
            ) : filteredData.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-mono text-xs">{entry.eventNumber}</TableCell>
                <TableCell className="text-xs">{entry.user}</TableCell>
                <TableCell className="text-xs capitalize">{entry.section}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                      {formatDetailsPreview(entry.details)}
                    </span>
                    {entry.details.length > 0 && (
                      <Button variant="link" size="sm" className="shrink-0 px-1 h-auto text-xs" onClick={() => setSelectedEntry(entry)}>
                        Show More
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">{entry.ip_address || '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {format(new Date(entry.created_at), 'MMM d, yyyy h:mm a')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {entries.length > 0 && (
        <div className="flex justify-end">
          <div className="text-sm text-muted-foreground">
            {filteredData.length !== entries.length && `Showing ${filteredData.length} of `}
            Total Events: {entries.length}
          </div>
        </div>
      )}

      <Dialog open={!!selectedEntry} onOpenChange={() => setSelectedEntry(null)}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Event #{selectedEntry?.eventNumber} — {selectedEntry?.section}</DialogTitle>
            <DialogDescription>
              By {selectedEntry?.user} on{' '}
              {selectedEntry ? format(new Date(selectedEntry.created_at), 'MMM d, yyyy h:mm a') : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && formatDetailsFull(selectedEntry.details)}
        </DialogContent>
      </Dialog>

      <GridExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        columns={EXPORT_COLUMNS}
        data={entries}
        fileName="broker_event_journal"
      />
    </div>
    </div>
  );
};

export default BrokerEventsJournal;
