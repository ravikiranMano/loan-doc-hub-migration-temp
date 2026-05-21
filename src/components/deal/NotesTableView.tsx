import React, { useState } from 'react';
import { Plus, Paperclip, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ColumnConfigPopover, ColumnConfig } from './ColumnConfigPopover';
import { useTableColumnConfig } from '@/hooks/useTableColumnConfig';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog';
import { GridToolbar, FilterOption } from './GridToolbar';
import { GridExportDialog, ExportColumn } from './GridExportDialog';
import { SortableTableHead } from './SortableTableHead';
import { useGridSortFilter } from '@/hooks/useGridSortFilter';
import { useGridSelection } from '@/hooks/useGridSelection';
import { downloadContactAttachment } from '@/services/contacts/attachments.service';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { format, parse, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

export interface AttachmentMeta {
  name: string;
  storagePath: string;
  uploadedAt: string;
}

export interface NoteData {
  id: string;
  highPriority: boolean;
  incoming: boolean;
  outgoing: boolean;
  date: string;
  asOfDate: string;
  account: string;
  name: string;
  reference: string;
  content: string;
  type: string;
  attachments: (string | AttachmentMeta)[];
  followupReminder: string;
  completed: string;
  assignedOn: string;
  assignedTo: string;
  assignedDepartment: string;
  assignedBy: string;
  completedBy: string;
  completedOn: string;
  publish: boolean;
  addToParticipants: boolean;
}

export const getAttachmentName = (att: string | AttachmentMeta): string => {
  return typeof att === 'string' ? att : att.name;
};

export const getAttachmentPath = (att: string | AttachmentMeta): string | null => {
  return typeof att === 'object' && att.storagePath ? att.storagePath : null;
};

interface NotesTableViewProps {
  notes: NoteData[];
  onAddNote: () => void;
  onEditNote: (note: NoteData) => void;
  onRowClick: (note: NoteData) => void;
  onDeleteNote?: (note: NoteData) => void;
  onBulkDelete?: (notes: NoteData[]) => void;
  onExport?: () => void;
  onRefresh?: () => void;
  onSave?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  asOfFilter?: string;
  onAsOfFilterChange?: (value: string) => void;
  currentPage?: number;
  totalPages?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'account', label: 'Account', visible: true },
  { id: 'date', label: 'Date - Time', visible: true },
  { id: 'incomingOutgoing', label: 'Incoming/Outgoing', visible: true },
  { id: 'name', label: 'Contact', visible: true },
  { id: 'content', label: 'Conversation Log', visible: true },
  { id: 'assignedTo', label: 'Assigned TO', visible: true },
  { id: 'followupReminder', label: 'Followup Reminder', visible: true },
  { id: 'completed', label: 'Completed', visible: true },
  { id: 'completedBy', label: 'Completed BY', visible: true },
];

const SEARCH_FIELDS = ['name', 'account', 'reference', 'type', 'content', 'date', 'asOfDate'];

const buildFilterOptions = (notes: NoteData[]): FilterOption[] => {
  const uniqueAsOfDates = [...new Set(notes.map(n => n.asOfDate).filter(Boolean))].sort();

  return [
    {
      id: 'type',
      label: 'Type',
      options: [
        { value: 'note', label: 'Note' },
        { value: 'call', label: 'Call' },
        { value: 'email', label: 'Email' },
        { value: 'meeting', label: 'Meeting' },
      ],
    },
    {
      id: 'highPriority',
      label: 'Priority',
      options: [
        { value: 'true', label: 'High Priority' },
        { value: 'false', label: 'Normal' },
      ],
    },
    ...(uniqueAsOfDates.length > 0 ? [{
      id: 'asOfDate',
      label: 'As Of Date',
      options: uniqueAsOfDates.map(d => ({ value: d, label: d })),
    }] : []),
  ];
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch { return dateStr; }
};

export const NotesTableView: React.FC<NotesTableViewProps> = ({
  notes, onAddNote, onEditNote, onRowClick, onDeleteNote, onBulkDelete, onExport, onRefresh, onSave, disabled = false, isLoading = false,
  asOfFilter, onAsOfFilterChange,
  currentPage = 1, totalPages = 1, totalCount, onPageChange,
}) => {
  const [columns, setColumns, resetColumns] = useTableColumnConfig('notes_v5', DEFAULT_COLUMNS);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [viewingNote, setViewingNote] = useState<NoteData | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const visibleColumns = columns.filter((col) => col.visible);

  const {
    searchQuery, setSearchQuery, sortState, toggleSort,
    activeFilters, setFilter, clearFilters, activeFilterCount, filteredData,
  } = useGridSortFilter(notes, SEARCH_FIELDS);

  const {
    selectedIds, selectedItems, toggleOne, toggleAll, clearSelection,
    isAllSelected, isSomeSelected, selectedCount,
  } = useGridSelection(filteredData);

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
    } catch { return dateStr; }
  };

  const handleDownloadAttachment = async (att: string | AttachmentMeta) => {
    const path = getAttachmentPath(att);
    if (!path) {
      toast.info('This attachment has no downloadable file');
      return;
    }
    let data: Blob;
    try {
      data = await downloadContactAttachment(path);
    } catch {
      data = null as unknown as Blob;
    }
    if (!data) {
      toast.error('Failed to download file');
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = getAttachmentName(att);
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderCellValue = (note: NoteData, columnId: string) => {
    switch (columnId) {
      case 'account': return note.account || '--';
      case 'date': return formatDateTime(note.date) || '--';
      case 'incomingOutgoing': {
        const parts: string[] = [];
        if (note.incoming) parts.push('Incoming');
        if (note.outgoing) parts.push('Outgoing');
        return parts.length > 0 ? parts.join(' / ') : '--';
      }
      case 'name': return note.name || '--';
      case 'content': {
        if (!note.content) return '--';
        const stripped = note.content.replace(/<[^>]*>/g, '').trim();
        return stripped ? (stripped.length > 60 ? stripped.substring(0, 60) + '…' : stripped) : '--';
      }
      case 'assignedTo': return note.assignedTo || '--';
      case 'followupReminder': return note.followupReminder ? formatDate(note.followupReminder) : '--';
      case 'completed': return note.completed ? formatDate(note.completed) : '--';
      case 'completedBy': return note.completedBy || '--';
      default: return '--';
    }
  };

  const handleBulkDelete = () => {
    if (onBulkDelete) {
      onBulkDelete(selectedItems);
    } else if (onDeleteNote) {
      selectedItems.forEach((item) => onDeleteNote(item));
    }
    clearSelection();
    setBulkDeleteOpen(false);
  };

  const handleRowClick = (note: NoteData) => {
    onRowClick(note);
  };

  const exportColumns: ExportColumn[] = DEFAULT_COLUMNS.filter(c => c.id !== 'attachments').map(c => ({ id: c.id, label: c.label }));

  const filterOptions = buildFilterOptions(notes);

  return (
    <div className="flex flex-col border border-border rounded-lg bg-background overflow-hidden">
    <div className="p-6 space-y-4">
      {/* Header with title and actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg text-foreground">Conversation Log</h3>
        </div>
        <div className="flex items-center gap-2">
          <ColumnConfigPopover
            columns={columns}
            onColumnsChange={setColumns}
            onResetColumns={resetColumns}
            disabled={disabled}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onAddNote}
            disabled={disabled}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Add Conversation Log
          </Button>
        </div>
      </div>

      {/* Grid Toolbar */}
      <GridToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterOptions={filterOptions}
        activeFilters={activeFilters}
        onFilterChange={setFilter}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        disabled={disabled}
        selectedCount={selectedCount}
        onBulkDelete={() => setBulkDeleteOpen(true)}
        onEdit={() => { if (selectedCount === 1) onEditNote(selectedItems[0]); }}
        onExport={() => setExportOpen(true)}
      />

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <Table className="min-w-[600px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={isAllSelected}
                  ref={(el) => { if (el) (el as any).indeterminate = isSomeSelected; }}
                  onCheckedChange={toggleAll}
                  disabled={disabled || filteredData.length === 0}
                />
              </TableHead>
              {visibleColumns.map((col) => (
                <SortableTableHead
                  key={col.id}
                  columnId={col.id}
                  label={col.label.toUpperCase()}
                  sortColumnId={sortState.columnId}
                  sortDirection={sortState.direction}
                  onSort={toggleSort}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  {Array.from({ length: visibleColumns.length }).map((_, ci) => (
                    <TableCell key={`sc-${ci}`}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 1} className="text-center py-8 text-muted-foreground">
                  {notes.length === 0 ? 'No conversation logs added. Click "Add Conversation Log" to add one.' : 'No conversation logs match your search or filters.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((note) => (
                <TableRow key={note.id} className="cursor-pointer hover:bg-muted/30" onClick={() => handleRowClick(note)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedIds.has(note.id)} onCheckedChange={() => toggleOne(note.id)} disabled={disabled} />
                  </TableCell>
                  {visibleColumns.map((col) => (
                    <TableCell key={col.id}>{renderCellValue(note, col.id)}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * 10 + 1}–{Math.min(currentPage * 10, totalCount ?? notes.length)} of {totalCount ?? notes.length} conversation logs
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(1)} disabled={currentPage <= 1 || disabled}>First</Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(currentPage - 1)} disabled={currentPage <= 1 || disabled}>Previous</Button>
            <span className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm">{currentPage}</span>
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(currentPage + 1)} disabled={currentPage >= totalPages || disabled}>Next</Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(totalPages)} disabled={currentPage >= totalPages || disabled}>Last</Button>
          </div>
        </div>
      )}

      {/* Footer */}
      {notes.length > 0 && (
        <div className="flex justify-end">
          <div className="text-sm text-muted-foreground">
            Total Conversation Logs: {totalCount ?? notes.length}
          </div>
        </div>
      )}

      <Dialog open={!!viewingNote} onOpenChange={(open) => { if (!open) setViewingNote(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden p-4">
          <DialogHeader>
            <DialogTitle className="text-sm">Conversation Log Details</DialogTitle>
          </DialogHeader>
          {viewingNote && (
            <div className="space-y-3 mt-3 min-w-0 overflow-hidden">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Date</Label>
                  <span className="text-xs">{formatDateTime(viewingNote.date)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">As Of</Label>
                  <span className="text-xs">{formatDate(viewingNote.asOfDate)}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Type</Label>
                  <span className="text-xs">{viewingNote.type || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Reference</Label>
                  <span className="text-xs">{viewingNote.reference || '-'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Account</Label>
                  <span className="text-xs">{viewingNote.account || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Name</Label>
                  <span className="text-xs">{viewingNote.name || '-'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Priority</Label>
                <span className="text-xs">{viewingNote.highPriority ? 'Yes' : 'No'}</span>
              </div>
              {viewingNote.content && (
                <div>
                  <Label className="text-xs text-muted-foreground">Content</Label>
                  <div className="mt-1 p-2 border border-border rounded text-xs bg-muted/30 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: viewingNote.content }} />
                </div>
              )}

              {/* Attachments Section */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-foreground">Attachments</Label>
                {(!viewingNote.attachments || viewingNote.attachments.length === 0) ? (
                  <p className="text-xs text-muted-foreground italic">No attachments available</p>
                ) : (
                  <div className="space-y-1">
                    {viewingNote.attachments.map((att, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-3 py-2 border border-border overflow-hidden">
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex-1 min-w-0 truncate font-medium">{getAttachmentName(att)}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm break-all">
                              <p>{getAttachmentName(att)}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        {typeof att === 'object' && att.uploadedAt && (
                          <span className="text-muted-foreground shrink-0">{formatDate(att.uploadedAt)}</span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs gap-1 shrink-0"
                          onClick={() => handleDownloadAttachment(att)}
                        >
                          <FileDown className="h-3 w-3" /> Download
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
          <DialogFooter className="mt-4">
            <div className="flex justify-end gap-2 w-full">
              <Button variant="outline" size="sm" onClick={() => { if (viewingNote) { setViewingNote(null); onEditNote(viewingNote); } }}>Edit</Button>
              <Button variant="outline" size="sm" onClick={() => setViewingNote(null)}>Close</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedCount} Conversation Logs`}
        description={`Are you sure you want to delete ${selectedCount} selected conversation logs? This action cannot be undone.`}
      />

      <GridExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        columns={exportColumns}
        data={notes}
        fileName="conversation_log"
      />
    </div>
    </div>
  );
};

export default NotesTableView;
