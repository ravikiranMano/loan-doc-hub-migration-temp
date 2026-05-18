import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { ColumnConfigPopover, ColumnConfig } from '@/components/deal/ColumnConfigPopover';
import { DeleteConfirmationDialog } from '@/components/deal/DeleteConfirmationDialog';
import { GridToolbar, FilterOption } from '@/components/deal/GridToolbar';
import { GridExportDialog, ExportColumn } from '@/components/deal/GridExportDialog';
import { SortableTableHead } from '@/components/deal/SortableTableHead';
import { useTableColumnConfig } from '@/hooks/useTableColumnConfig';
import { useGridSelection } from '@/hooks/useGridSelection';
import type { ContactRecord } from '@/hooks/useContactsCrud';
import { format, parse, isValid } from 'date-fns';

const AGREEMENT_DATE_COLUMN_IDS = new Set(['agreement_on_file_date', 'servicing_agreement_on_file_date']);

type SortDir = 'asc' | 'desc' | null;

interface ContactsListViewProps {
  title: string;
  contacts: ContactRecord[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  isLoading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onPageChange: (page: number) => void;
  onRowClick: (contact: ContactRecord) => void;
  onCreateNew: () => void;
  onDeleteSelected?: (ids: string[]) => Promise<void>;
  defaultColumns: ColumnConfig[];
  tableConfigKey: string;
  addButtonLabel?: string;
  breadcrumbLabel?: string;
  filterOptions?: FilterOption[];
  renderCellValue?: (contact: ContactRecord, columnId: string) => React.ReactNode;
  searchPlaceholder?: string;
  createDisabled?: boolean;
}

export const ContactsListView: React.FC<ContactsListViewProps> = ({
  title,
  contacts,
  totalCount,
  totalPages,
  currentPage,
  isLoading,
  searchQuery,
  onSearchChange,
  onPageChange,
  onRowClick,
  onCreateNew,
  onDeleteSelected,
  defaultColumns,
  tableConfigKey,
  addButtonLabel,
  breadcrumbLabel,
  filterOptions = [],
  renderCellValue,
  searchPlaceholder,
  createDisabled = false,
}) => {
  const [columns, setColumns, resetColumns] = useTableColumnConfig(tableConfigKey, defaultColumns);
  const visibleColumns = columns.filter((c) => c.visible);

  // Client-side sorting on current page
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  // Client-side column filter
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  // Export dialog
  const [exportOpen, setExportOpen] = useState(false);

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleSort = (colId: string) => {
    if (sortColumn === colId) {
      if (sortDir === 'asc') setSortDir('desc');
      else if (sortDir === 'desc') { setSortColumn(null); setSortDir(null); }
      else setSortDir('asc');
    } else {
      setSortColumn(colId);
      setSortDir('asc');
    }
  };

  const getCellValue = (contact: ContactRecord, columnId: string): string => {
    const topLevel: Record<string, string> = {
      contact_id: contact.contact_id,
      full_name: contact.full_name,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      phone: contact.phone,
      city: contact.city,
      state: contact.state,
      company: contact.company,
    };
    if (columnId in topLevel) return topLevel[columnId] || '';
    const cd = (contact.contact_data || {}) as Record<string, string>;
    // Direct match in contact_data
    if (columnId in cd) return cd[columnId] || '';
    // Try dot-notation keys (e.g. 'primary_address.city')
    const dotKey = columnId.replace(/\./g, '.');
    if (dotKey in cd) return cd[dotKey] || '';
    return '';
  };

  // Apply client-side active filters
  const filteredContacts = useMemo(() => {
    let result = contacts;
    Object.entries(activeFilters).forEach(([key, value]) => {
      if (value && value !== 'all') {
        result = result.filter((c) => {
          const val = getCellValue(c, key);
          return val.toLowerCase() === value.toLowerCase();
        });
      }
    });
    return result;
  }, [contacts, activeFilters]);

  // Apply client-side sorting
  const sortedContacts = useMemo(() => {
    if (!sortColumn || !sortDir) return filteredContacts;
    return [...filteredContacts].sort((a, b) => {
      const aVal = getCellValue(a, sortColumn).toLowerCase();
      const bVal = getCellValue(b, sortColumn).toLowerCase();
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredContacts, sortColumn, sortDir]);

  // Selection via shared hook
  const {
    selectedIds, toggleOne, toggleAll, clearSelection,
    isAllSelected, isSomeSelected, selectedCount,
  } = useGridSelection(sortedContacts);

  const handleDeleteConfirm = useCallback(async () => {
    if (onDeleteSelected && selectedCount > 0) {
      await onDeleteSelected(Array.from(selectedIds));
      clearSelection();
    }
    setDeleteDialogOpen(false);
  }, [onDeleteSelected, selectedIds, selectedCount, clearSelection]);

  const setFilter = (key: string, value: string) => {
    setActiveFilters((prev) => {
      if (!value || value === 'all') {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  };

  const clearAllFilters = () => {
    setActiveFilters({});
    onSearchChange('');
  };

  const activeFilterCount = Object.keys(activeFilters).length;

  const defaultRenderCell = (contact: ContactRecord, columnId: string): React.ReactNode => {
    const val = getCellValue(contact, columnId);
    if (val === 'true') return '✓';
    if (val === 'false') return '';
    if (columnId === 'full_name') return <span className="font-medium">{val || '-'}</span>;
    return val || '-';
  };

  // Export columns from visible columns
  const exportColumns: ExportColumn[] = visibleColumns.map((c) => ({ id: c.id, label: c.label }));

  // Export data mapped to flat key-value
  const exportData = useMemo(() => {
    return sortedContacts.map((contact) => {
      const row: Record<string, any> = {};
      visibleColumns.forEach((col) => {
        row[col.id] = getCellValue(contact, col.id);
      });
      return row;
    });
  }, [sortedContacts, visibleColumns]);

  return (
    <div className="p-6 space-y-4">
      {/* Breadcrumb */}
      {breadcrumbLabel && (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink className="cursor-default">Contact</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{breadcrumbLabel}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )}

      <div className="border border-border rounded-lg bg-background p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg text-foreground">{title}</h3>
          <div className="flex items-center gap-2">
            <ColumnConfigPopover columns={columns} onColumnsChange={setColumns} onResetColumns={resetColumns} />
            <Button variant="outline" size="sm" onClick={onCreateNew} className="gap-1" disabled={createDisabled}>
              <Plus className="h-4 w-4" /> {addButtonLabel || 'Create New'}
            </Button>
          </div>
        </div>

        {/* GridToolbar - same pattern as deal grids */}
        <GridToolbar
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          filterOptions={filterOptions}
          activeFilters={activeFilters}
          onFilterChange={setFilter}
          onClearFilters={clearAllFilters}
          activeFilterCount={activeFilterCount}
          disabled={isLoading}
          selectedCount={selectedCount}
          onBulkDelete={onDeleteSelected ? () => setDeleteDialogOpen(true) : undefined}
          onExport={() => setExportOpen(true)}
          searchPlaceholder={searchPlaceholder || `Search ${title.toLowerCase()}...`}
        />

        <div className="border border-border rounded-lg overflow-x-auto">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) (el as any).indeterminate = isSomeSelected;
                    }}
                    onCheckedChange={toggleAll}
                    disabled={isLoading || sortedContacts.length === 0}
                    aria-label="Select all"
                    className="h-4 w-4"
                  />
                </TableHead>
                {visibleColumns.map((col) => (
                  <SortableTableHead
                    key={col.id}
                    columnId={col.id}
                    label={col.label.toUpperCase()}
                    sortColumnId={sortColumn}
                    sortDirection={sortDir}
                    onSort={handleSort}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 1} className="text-center py-8">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </div>
                  </TableCell>
                </TableRow>
              ) : sortedContacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 1} className="text-center py-8 text-muted-foreground">
                    {totalCount === 0
                      ? `No contacts yet. Click "${addButtonLabel || 'Create New'}" to add one.`
                      : 'No contacts match your search or filters.'}
                  </TableCell>
                </TableRow>
              ) : (
                sortedContacts.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className={`cursor-pointer hover:bg-muted/30 ${selectedIds.has(contact.id) ? 'bg-muted/40' : ''}`}
                  >
                    <TableCell className="w-[40px]" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(contact.id)}
                        onCheckedChange={() => toggleOne(contact.id)}
                        aria-label={`Select ${contact.full_name}`}
                        className="h-4 w-4"
                      />
                    </TableCell>
                    {visibleColumns.map((col) => (
                      <TableCell key={col.id} onClick={() => onRowClick(contact)}>
                        {renderCellValue
                          ? renderCellValue(contact, col.id)
                          : defaultRenderCell(contact, col.id)}
                      </TableCell>
                    ))}
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
              Showing {((currentPage - 1) * 10) + 1}–{Math.min(currentPage * 10, totalCount)} of {totalCount} {title.toLowerCase()}
              {selectedCount > 0 && ` · ${selectedCount} selected`}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onPageChange(1)} disabled={currentPage <= 1 || isLoading}>
                First
              </Button>
              <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1 || isLoading}>
                Previous
              </Button>
              <span className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm">
                {currentPage}
              </span>
              <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages || isLoading}>
                Next
              </Button>
              <Button variant="outline" size="sm" onClick={() => onPageChange(totalPages)} disabled={currentPage >= totalPages || isLoading}>
                Last
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        title={`Delete ${selectedCount} Contact${selectedCount !== 1 ? 's' : ''}`}
        description={`Are you sure you want to delete ${selectedCount} selected contact${selectedCount !== 1 ? 's' : ''}? This action cannot be undone.`}
      />

      {/* Export Dialog - same as deal grids */}
      <GridExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        columns={exportColumns}
        data={exportData}
        fileName={title.toLowerCase().replace(/\s+/g, '_')}
      />
    </div>
  );
};
