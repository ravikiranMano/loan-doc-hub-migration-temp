import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, Trash2, Lock, Search, Settings2, GripVertical, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { GridExportDialog, ExportColumn } from './GridExportDialog';
import { ColumnConfigPopover, ColumnConfig } from './ColumnConfigPopover';
import { useTableColumnConfig } from '@/hooks/useTableColumnConfig';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog';

interface FundingHistoryRecord {
  id: string;
  fundingDate: string;
  reference: string;
  lenderAccount: string;
  lenderName: string;
  amountFunded: number;
  notes?: string;
}

interface FundingHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  historyRecords?: FundingHistoryRecord[];
  /**
   * Business rule: Funding edits/adjustments only take effect AFTER the loan
   * is released for Servicing. When false (default), all actions are disabled.
   */
  loanReleased?: boolean;
  onDeleteRecord?: (record: FundingHistoryRecord) => void;
}

const HISTORY_EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'fundingDate', label: 'Funding Date' },
  { id: 'reference', label: 'Reference' },
  { id: 'lenderAccount', label: 'Account' },
  { id: 'lenderName', label: 'Lender Name' },
  { id: 'amountFunded', label: 'Amount Funded' },
  { id: 'notes', label: 'Notes' },
];

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'fundingDate', label: 'Funding Date', visible: true },
  { id: 'reference', label: 'Reference', visible: true },
  { id: 'lenderAccount', label: 'Account', visible: true },
  { id: 'lenderName', label: 'Lender Name', visible: true },
  { id: 'amountFunded', label: 'Amount Funded', visible: true },
  { id: 'notes', label: 'Notes', visible: true },
];

export const FundingHistoryDialog: React.FC<FundingHistoryDialogProps> = ({
  open,
  onOpenChange,
  dealId,
  historyRecords = [],
  loanReleased = false,
  onDeleteRecord,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedRecord, setSelectedRecord] = useState<FundingHistoryRecord | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FundingHistoryRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Persisted column configuration (Customize Grid)
  const [columns, setColumns, resetColumns] = useTableColumnConfig(
    'funding_history',
    DEFAULT_COLUMNS,
  );

  // Customize Grid modal — staged (draft) state with OK / Cancel / Apply
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draftColumns, setDraftColumns] = useState<ColumnConfig[]>(columns);

  // Columns modal — opens as a centered modal (same as Export) instead of a popover
  const [columnsModalOpen, setColumnsModalOpen] = useState(false);

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);
  const isVisible = (id: string) => visibleColumns.some((c) => c.id === id);

  // Real-time, case-insensitive, partial-match search across visible-relevant fields
  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return historyRecords;
    return historyRecords.filter((r) => {
      const amount = typeof r.amountFunded === 'number' ? r.amountFunded.toString() : '';
      return (
        (r.fundingDate || '').toLowerCase().includes(q) ||
        (r.reference || '').toLowerCase().includes(q) ||
        (r.lenderAccount || '').toLowerCase().includes(q) ||
        (r.lenderName || '').toLowerCase().includes(q) ||
        amount.includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
      );
    });
  }, [historyRecords, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));

  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  // Reset to page 1 whenever filters/page size change so results stay visible
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  // Warn the user before the browser/tab is closed if there are unsaved changes
  // (pending Customize Grid draft changes). Triggers the browser's native
  // "Leave site?" confirmation dialog.
  React.useEffect(() => {
    if (!open) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const draftDiffers =
        customizeOpen &&
        JSON.stringify(draftColumns) !== JSON.stringify(columns);
      if (draftDiffers) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [open, customizeOpen, draftColumns, columns]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

  const formatFundingDate = (val: string | undefined): string => {
    if (!val) return '';
    // Already MM/DD/YYYY → display as-is
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return val;
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  };

  const handlePageChange = (page: number) => setCurrentPage(page);
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const openCustomize = () => {
    setDraftColumns(columns);
    setCustomizeOpen(true);
  };

  const toggleDraft = (id: string, checked: boolean) => {
    const visibleCount = draftColumns.filter((c) => c.visible).length;
    if (!checked && visibleCount <= 1) return; // keep at least one visible
    setDraftColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, visible: checked } : c)),
    );
  };

  const applyDraft = () => setColumns(draftColumns);
  const handleApply = () => applyDraft();
  const handleOk = () => {
    applyDraft();
    setCustomizeOpen(false);
  };
  const handleCancel = () => {
    setDraftColumns(columns);
    setCustomizeOpen(false);
  };

  const handleDeleteClick = (e: React.MouseEvent, record: FundingHistoryRecord) => {
    e.stopPropagation();
    if (!loanReleased) return;
    setDeleteTarget(record);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget && onDeleteRecord) onDeleteRecord(deleteTarget);
    setDeleteTarget(null);
  };

  const colSpan = visibleColumns.length + 1; // +1 for Actions column

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-primary">💾</span>
            Funding History
            {!loanReleased && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                <Lock className="h-3 w-3" />
                Read-only until loan released for Servicing
              </span>
            )}
          </DialogTitle>
          <div className="flex justify-end -mt-6 mr-6 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setColumnsModalOpen(true)}
            >
              <Settings2 className="h-4 w-4" />
              Columns
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={openCustomize}>
              Customize Grid
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setExportOpen(true)}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search history..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
              aria-label="Search funding history"
            />
          </div>

          {/* Grid */}
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {isVisible('fundingDate') && <TableHead className="font-semibold">FUNDING DATE</TableHead>}
                  {isVisible('reference') && <TableHead className="font-semibold">REFERENCE</TableHead>}
                  {isVisible('lenderAccount') && <TableHead className="font-semibold">ACCOUNT</TableHead>}
                  {isVisible('lenderName') && <TableHead className="font-semibold">LENDER NAME</TableHead>}
                  {isVisible('amountFunded') && <TableHead className="font-semibold text-left">AMOUNT FUNDED</TableHead>}
                  {isVisible('notes') && <TableHead className="font-semibold">NOTES</TableHead>}
                  <TableHead className="font-semibold text-right w-[90px]">ACTIONS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
                      No data available
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRecords.map((record) => (
                    <TableRow
                      key={record.id}
                      data-state={selectedRecord?.id === record.id ? 'selected' : undefined}
                      className={cn('cursor-pointer hover:bg-primary/5')}
                      onClick={() => setSelectedRecord(record)}
                    >
                      {isVisible('fundingDate') && <TableCell>{formatFundingDate(record.fundingDate)}</TableCell>}
                      {isVisible('reference') && <TableCell>{record.reference}</TableCell>}
                      {isVisible('lenderAccount') && (
                        <TableCell className="text-primary font-medium">{record.lenderAccount}</TableCell>
                      )}
                      {isVisible('lenderName') && <TableCell>{record.lenderName}</TableCell>}
                      {isVisible('amountFunded') && (
                        <TableCell className="text-left">{formatCurrency(record.amountFunded)}</TableCell>
                      )}
                      {isVisible('notes') && (
                        <TableCell className="text-muted-foreground">{record.notes || ''}</TableCell>
                      )}
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={!loanReleased}
                          title={
                            loanReleased
                              ? 'Delete record'
                              : 'Available after loan is released for Servicing'
                          }
                          onClick={(e) => handleDeleteClick(e, record)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Show</span>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => handlePageSizeChange(Number(value))}
              >
                <SelectTrigger className="w-[70px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100]" position="popper" sideOffset={4}>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
              <span>entries</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(1)}
                disabled={currentPage === 1}
                className="disabled:opacity-50 disabled:cursor-not-allowed"
              >
                First
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </Button>
              <span className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm">
                {currentPage}
              </span>
              <span className="text-sm text-muted-foreground px-1">of {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage >= totalPages}
                className="disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Last
              </Button>
            </div>
          </div>
        </div>

        <GridExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          columns={HISTORY_EXPORT_COLUMNS}
          data={filteredRecords}
          fileName="funding_history"
        />

        {/* Customize Grid Modal */}
        <Dialog open={customizeOpen} onOpenChange={(o) => (o ? setCustomizeOpen(true) : handleCancel())}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Customize Grid</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <p className="text-xs text-muted-foreground">
                Show or hide columns in the Funding History grid.
              </p>
              <div className="space-y-1 max-h-[320px] overflow-y-auto">
                {draftColumns.map((column) => {
                  const visibleCount = draftColumns.filter((c) => c.visible).length;
                  const isLastVisible = column.visible && visibleCount <= 1;
                  return (
                    <label
                      key={column.id}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={column.visible}
                        disabled={isLastVisible}
                        onCheckedChange={(checked) => toggleDraft(column.id, !!checked)}
                      />
                      <span className="text-sm flex-1">{column.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="outline" onClick={handleApply}>
                Apply
              </Button>
              <Button onClick={handleOk}>OK</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Columns Modal — shown as a centered modal (same as Export) */}
        <Dialog open={columnsModalOpen} onOpenChange={setColumnsModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between pr-6">
                <span>Configure Columns</span>
                {resetColumns && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetColumns}
                    className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </Button>
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <p className="text-xs text-muted-foreground">
                Drag to reorder, toggle to show/hide
              </p>
              <div className="space-y-1 max-h-[320px] overflow-y-auto">
                {columns.map((column, index) => {
                  const visibleCount = columns.filter((c) => c.visible).length;
                  const isLastVisible = column.visible && visibleCount <= 1;
                  return (
                    <div
                      key={column.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', index.toString());
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                        if (dragIndex === index) return;
                        const next = [...columns];
                        const [moved] = next.splice(dragIndex, 1);
                        next.splice(index, 0, moved);
                        setColumns(next);
                      }}
                      className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-move group"
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                      <Checkbox
                        checked={column.visible}
                        disabled={isLastVisible}
                        onCheckedChange={(checked) => {
                          if (!checked && visibleCount <= 1) return;
                          setColumns(
                            columns.map((c) =>
                              c.id === column.id ? { ...c, visible: !!checked } : c,
                            ),
                          );
                        }}
                      />
                      <span className="text-sm flex-1">{column.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setColumnsModalOpen(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DeleteConfirmationDialog
          open={!!deleteTarget}
          onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
          onConfirm={handleConfirmDelete}
          title="Delete Funding History Record"
          description={`Are you sure you want to delete this funding history record${
            deleteTarget?.lenderName ? ` for "${deleteTarget.lenderName}"` : ''
          }? This action cannot be undone.`}
        />
      </DialogContent>
    </Dialog>
  );
};

export default FundingHistoryDialog;
