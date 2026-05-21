import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getContactContactData } from '@/services/contacts/contacts.service';

import { format, startOfMonth } from 'date-fns';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { BookOpen, Columns, ChevronDown } from 'lucide-react';
import { GridToolbar, FilterOption } from '@/components/deal/GridToolbar';
import { GridExportDialog, ExportColumn } from '@/components/deal/GridExportDialog';
import { SortableTableHead } from '@/components/deal/SortableTableHead';
import { useGridSortFilter } from '@/hooks/useGridSortFilter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import type { ContactEventJournalEntry, ContactFieldChange } from '@/hooks/useContactEventJournal';

interface BorrowerEventRow {
  id: string;
  event_number: number;
  section: string;
  actor_name: string;
  details: ContactFieldChange[];
  created_at: string;
  ip_address: string | null;
  event_summary: string;
  event_type: string;
}

const SEARCH_FIELDS = ['actor_name', 'section', 'event_number', 'event_summary', 'ip_address'];

const SECTION_OPTIONS = [
  { value: 'borrower_profile', label: 'Borrower Profile' },
  { value: 'contact_info', label: 'Contact Info' },
  { value: 'banking', label: 'Banking' },
  { value: 'authorized_party', label: 'Authorized Party' },
  { value: 'tax_info', label: 'Tax Info' },
  { value: 'attachments', label: 'Attachments' },
  { value: 'notes', label: 'Notes' },
  { value: 'status', label: 'Status' },
];

const FILTER_OPTIONS: FilterOption[] = [
  { id: 'section', label: 'Section', options: SECTION_OPTIONS },
];

const EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'event_number', label: 'Event #' },
  { id: 'created_at', label: 'Timestamp' },
  { id: 'section', label: 'Section' },
  { id: 'actor_name', label: 'User' },
  { id: 'event_summary', label: 'Details' },
  { id: 'ip_address', label: 'IP Address' },
];

const ALL_COLUMNS = [
  { id: 'event_number', label: 'Event #', default: true },
  { id: 'created_at', label: 'Timestamp', default: true },
  { id: 'section', label: 'Section', default: true },
  { id: 'actor_name', label: 'User', default: true },
  { id: 'event_summary', label: 'Details', default: true },
  { id: 'ip_address', label: 'IP Address', default: true },
];

function buildEventSummary(details: ContactFieldChange[]): string {
  if (!Array.isArray(details) || details.length === 0) return 'No details';
  const text = details
    .map((d) => `${d.fieldLabel || 'Field'}: ${d.oldValue || '(empty)'} → ${d.newValue || '(empty)'}`)
    .join('; ');
  return text.length > 120 ? text.substring(0, 120) + '…' : text;
}

function inferEventType(details: ContactFieldChange[]): string {
  if (!details || details.length === 0) return 'update';
  const hasAllEmpty = details.every(d => !d.oldValue || d.oldValue === '(empty)');
  const hasAllNew = details.every(d => !d.newValue || d.newValue === '(empty)');
  if (hasAllEmpty) return 'create';
  if (hasAllNew) return 'delete';
  return 'update';
}

const BorrowerEventsJournal: React.FC<{ borrowerId: string; contactDbId: string }> = ({ contactDbId }) => {
  const [selectedEvent, setSelectedEvent] = useState<BorrowerEventRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.id))
  );

  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ['borrower-contact-events-journal', contactDbId],
    enabled: !!contactDbId,
    queryFn: async () => {
      const contactData = (await getContactContactData(contactDbId)) as Record<string, any>;
      const journal: ContactEventJournalEntry[] = contactData._events_journal || [];

      return journal
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((entry): BorrowerEventRow => ({
          id: entry.id,
          event_number: entry.eventNumber,
          section: entry.section,
          actor_name: entry.user,
          details: entry.details || [],
          created_at: entry.created_at,
          ip_address: entry.ip_address || null,
          event_summary: buildEventSummary(entry.details || []),
          event_type: inferEventType(entry.details || []),
        }));
    },
  });

  const { searchQuery, setSearchQuery, sortState, toggleSort, activeFilters, setFilter, clearFilters, activeFilterCount, filteredData } =
    useGridSortFilter(events, SEARCH_FIELDS);

  const metrics = useMemo(() => {
    const monthStart = startOfMonth(new Date());
    const thisMonth = events.filter(e => new Date(e.created_at) >= monthStart).length;
    const profileEvents = events.filter(e => e.section === 'borrower_profile' || e.section === 'contact_info').length;
    const bankingEvents = events.filter(e => e.section === 'banking' || e.section === 'tax_info').length;
    return { total: events.length, thisMonth, profileEvents, bankingEvents };
  }, [events]);

  const toggleCol = (colId: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId); else next.add(colId);
      return next;
    });
  };

  const handleRowClick = (event: BorrowerEventRow) => {
    setSelectedEvent(event);
    setDrawerOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-muted-foreground">Loading event journal…</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Events Journal</h3>
          <p className="text-muted-foreground">No borrower events recorded.</p>
        </div>
      </div>
    );
  }

  const colSpan = ALL_COLUMNS.filter(c => visibleCols.has(c.id)).length;

  return (
    <div className="flex flex-col border border-border rounded-lg bg-background overflow-hidden">
    <div className="p-6 space-y-4">
      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Events', value: metrics.total },
          { label: 'Events This Month', value: metrics.thisMonth },
          { label: 'Profile Events', value: metrics.profileEvents },
          { label: 'Banking / Tax Events', value: metrics.bankingEvents },
        ].map(m => (
          <div key={m.label} className="bg-card border border-border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="text-xl font-bold text-foreground">{m.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-foreground">Borrower Events Journal</h4>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1">
              <Columns className="h-3.5 w-3.5" />
              Columns
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-2">
            {ALL_COLUMNS.map(col => (
              <label key={col.id} className="flex items-center gap-2 py-1 px-1 text-sm cursor-pointer hover:bg-muted/50 rounded">
                <Checkbox checked={visibleCols.has(col.id)} onCheckedChange={() => toggleCol(col.id)} />
                {col.label}
              </label>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <GridToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterOptions={FILTER_OPTIONS}
        activeFilters={activeFilters}
        onFilterChange={setFilter}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        onExport={() => setExportOpen(true)}
        onRefresh={() => refetch()}
      />

      <div className="border border-border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {visibleCols.has('event_number') && (
                <SortableTableHead columnId="event_number" label="Event #" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[80px] text-xs" />
              )}
              {visibleCols.has('created_at') && (
                <SortableTableHead columnId="created_at" label="Timestamp" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[160px] text-xs" />
              )}
              {visibleCols.has('section') && (
                <SortableTableHead columnId="section" label="Section" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[140px] text-xs" />
              )}
              {visibleCols.has('actor_name') && (
                <SortableTableHead columnId="actor_name" label="User" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[150px] text-xs" />
              )}
              {visibleCols.has('event_summary') && (
                <TableHead className="text-xs">Details</TableHead>
              )}
              {visibleCols.has('ip_address') && (
                <SortableTableHead columnId="ip_address" label="IP Address" sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="w-[130px] text-xs" />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground">
                  No events match your search or filters.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((entry) => (
                <TableRow key={entry.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleRowClick(entry)}>
                  {visibleCols.has('event_number') && (
                    <TableCell className="font-mono text-xs">{entry.event_number}</TableCell>
                  )}
                  {visibleCols.has('created_at') && (
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(entry.created_at), 'MMM d, yyyy h:mm a')}
                    </TableCell>
                  )}
                  {visibleCols.has('section') && (
                    <TableCell className="text-xs capitalize">{entry.section.replace(/_/g, ' ')}</TableCell>
                  )}
                  {visibleCols.has('actor_name') && (
                    <TableCell className="text-xs">{entry.actor_name}</TableCell>
                  )}
                  {visibleCols.has('event_summary') && (
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[300px]">
                      {entry.event_summary}
                    </TableCell>
                  )}
                  {visibleCols.has('ip_address') && (
                    <TableCell className="text-xs text-muted-foreground font-mono">{entry.ip_address || '—'}</TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {events.length > 0 && (
        <div className="flex justify-end">
          <div className="text-sm text-muted-foreground">
            {filteredData.length !== events.length && `Showing ${filteredData.length} of `}
            Total Events: {events.length}
          </div>
        </div>
      )}

      {/* Event Details Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-[400px] sm:w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Event #{selectedEvent?.event_number}</SheetTitle>
            <SheetDescription>
              {selectedEvent ? format(new Date(selectedEvent.created_at), 'MMM d, yyyy h:mm a') : ''}
            </SheetDescription>
          </SheetHeader>
          {selectedEvent && (
            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Section</p>
                  <p className="font-medium text-foreground capitalize">{selectedEvent.section.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Event Type</p>
                  <p className="font-medium text-foreground capitalize">{selectedEvent.event_type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Performed By</p>
                  <p className="font-medium text-foreground">{selectedEvent.actor_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">IP Address</p>
                  <p className="font-medium text-foreground font-mono">{selectedEvent.ip_address || '—'}</p>
                </div>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-2">Field Changes</p>
                <div className="space-y-2 bg-muted/30 rounded-lg p-3">
                  {selectedEvent.details.length > 0 ? selectedEvent.details.map((d, i) => (
                    <div key={i} className="text-sm">
                      <span className="font-medium text-foreground">{d.fieldLabel || 'Field'}:</span>{' '}
                      <span className="text-muted-foreground">{d.oldValue || '(empty)'}</span>
                      <span className="mx-1 text-primary">→</span>
                      <span className="text-foreground">{d.newValue || '(empty)'}</span>
                    </div>
                  )) : (
                    <p className="text-sm text-muted-foreground">No field changes recorded.</p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-2">Full Event JSON</p>
                <pre className="bg-muted/30 rounded-lg p-3 text-xs overflow-x-auto max-h-[200px]">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <GridExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        columns={EXPORT_COLUMNS}
        data={events}
        fileName="borrower_event_journal"
      />
    </div>
    </div>
  );
};

export default BorrowerEventsJournal;
