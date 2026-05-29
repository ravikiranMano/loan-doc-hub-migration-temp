import React, { useState } from 'react';
import { Plus, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ColumnConfigPopover, ColumnConfig } from './ColumnConfigPopover';
import { useTableColumnConfig } from '@/hooks/useTableColumnConfig';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog';
import { GridToolbar, FilterOption } from './GridToolbar';
import { GridExportDialog, ExportColumn } from './GridExportDialog';
import { SortableTableHead } from './SortableTableHead';
import { useGridSortFilter } from '@/hooks/useGridSortFilter';
import { useGridSelection } from '@/hooks/useGridSelection';

export interface PropertyData {
  id: string;
  isPrimary: boolean;
  description: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  county: string;
  propertyType: string;
  occupancy: string;
  appraisedValue: string;
  appraisedDate: string;
 ltv: string;
 originationLtv?: string;
  apn: string;
  loanPriority: string;
  floodZone?: string;
  fireZone?: string;
  landClassification?: string;
  pledgedEquity?: string;
  zoning?: string;
  performedBy?: string;
  copyBorrowerAddress?: boolean;
  purchasePrice?: string;
  downPayment?: string;
  delinquentTaxes?: string;
  appraiserStreet?: string;
  appraiserCity?: string;
  appraiserState?: string;
  appraiserZip?: string;
  appraiserPhone?: string;
  appraiserEmail?: string;
  yearBuilt?: string;
  squareFeet?: string;
  constructionType?: string;
  monthlyIncome?: string;
  lienProtectiveEquity?: string;
  sourceLienInfo?: string;
  delinquencies60day?: boolean;
  delinquenciesHowMany?: string;
  currentlyDelinquent?: boolean;
  paidByLoan?: boolean;
  sourceOfPayment?: string;
  recordingNumber?: string;
  primaryCollateral?: boolean;
  purchaseDate?: string;
  propertyGeneratesIncome?: boolean;
  netMonthlyIncome?: string;
  fromRent?: string;
  fromOtherDescribe?: string;
  valuationDate?: string;
  valuationType?: string;
  thirdPartyFullName?: string;
  thirdPartyStreet?: string;
  thirdPartyCity?: string;
  thirdPartyState?: string;
  thirdPartyZip?: string;
  protectiveEquity?: string;
  cltv?: string;
  informationProvidedBy?: string;
  propertyOwner?: string;
}

interface PropertiesTableViewProps {
  properties: PropertyData[];
  onAddProperty: () => void;
  onEditProperty: (property: PropertyData) => void;
  onRowClick: (property: PropertyData) => void;
  onPrimaryChange: (propertyId: string, isPrimary: boolean) => void;
  onDeleteProperty?: (property: PropertyData) => void;
  onBulkDelete?: (properties: PropertyData[]) => void;
  onRefresh?: () => void;
  disabled?: boolean;
  currentPage?: number;
  totalPages?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'isPrimary', label: 'Primary', visible: true },
  { id: 'informationProvidedBy', label: 'Info Provided By', visible: true },
  { id: 'description', label: 'Description', visible: true },
  { id: 'street', label: 'Street', visible: true },
  { id: 'city', label: 'City', visible: true },
  { id: 'state', label: 'State', visible: true },
  { id: 'zipCode', label: 'Zip Code', visible: true },
  { id: 'county', label: 'County', visible: true },
  { id: 'purchaseDate', label: 'Purchase Date', visible: false },
  { id: 'purchasePrice', label: 'Purchase Price', visible: true },
  { id: 'downPayment', label: 'Down Payment', visible: false },
  { id: 'propertyType', label: 'Property Type', visible: true },
  { id: 'occupancy', label: 'Occupancy', visible: true },
  { id: 'yearBuilt', label: 'Year Built', visible: false },
  { id: 'squareFeet', label: 'Square Feet', visible: false },
  { id: 'constructionType', label: 'Construction Type', visible: false },
  { id: 'zoning', label: 'Zoning', visible: false },
  { id: 'floodZone', label: 'Flood Zone', visible: true },
  { id: 'propertyGeneratesIncome', label: 'Generates Income', visible: false },
  { id: 'netMonthlyIncome', label: 'Net Monthly Income', visible: false },
  { id: 'fromRent', label: 'From Rent', visible: false },
  { id: 'fromOtherDescribe', label: 'From Other', visible: false },
  { id: 'appraisedValue', label: 'Estimate of Value', visible: true },
  { id: 'appraisedDate', label: 'Valuation Date', visible: true },
  { id: 'valuationType', label: 'Valuation Type', visible: false },
  { id: 'performedBy', label: 'Performed By', visible: false },
  { id: 'thirdPartyFullName', label: 'Appraiser Name', visible: false },
  { id: 'appraiserPhone', label: 'Appraiser Phone', visible: false },
  { id: 'appraiserEmail', label: 'Appraiser Email', visible: false },
  { id: 'protectiveEquity', label: 'Protective Equity', visible: false },
  { id: 'ltv', label: 'Loan To Value', visible: true },
  { id: 'cltv', label: 'CLTV', visible: false },
];

const SEARCH_FIELDS = ['description', 'street', 'city', 'state', 'zipCode', 'county', 'propertyType', 'apn'];

const FILTER_OPTIONS: FilterOption[] = [
  {
    id: 'propertyType',
    label: 'Property Type',
    options: [
      { value: 'SFR 1-4', label: 'SFR 1-4' },
      { value: 'Multi-family', label: 'Multi-family' },
      { value: 'Condo / Townhouse', label: 'Condo / Townhouse' },
      { value: 'Mobile Home', label: 'Mobile Home' },
      { value: 'Commercial', label: 'Commercial' },
      { value: 'Mixed-use', label: 'Mixed-use' },
      { value: 'Land', label: 'Land' },
      { value: 'Farm', label: 'Farm' },
      { value: 'Restaurant / Bar', label: 'Restaurant / Bar' },
      { value: 'Group Housing', label: 'Group Housing' },
    ],
  },
  {
    id: 'occupancy',
    label: 'Occupancy',
    options: [
      { value: 'owner_occupied', label: 'Owner Occupied' },
      { value: 'investment', label: 'Investment' },
      { value: 'second_home', label: 'Second Home' },
      { value: 'vacant', label: 'Vacant' },
    ],
  },
  {
    id: 'state',
    label: 'State',
    options: [
      { value: 'CA', label: 'CA' },
      { value: 'TX', label: 'TX' },
      { value: 'FL', label: 'FL' },
      { value: 'NY', label: 'NY' },
      { value: 'WA', label: 'WA' },
    ],
  },
];

export const PropertiesTableView: React.FC<PropertiesTableViewProps> = ({
  properties,
  onAddProperty,
  onEditProperty,
  onRowClick,
  onPrimaryChange,
  onDeleteProperty,
  onBulkDelete,
  onRefresh,
  disabled = false,
  currentPage = 1,
  totalPages = 1,
  totalCount,
  onPageChange,
}) => {
  const [columns, setColumns, resetColumns] = useTableColumnConfig('properties', DEFAULT_COLUMNS);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  
  const visibleColumns = columns.filter((col) => col.visible);

  const {
    searchQuery, setSearchQuery, sortState, toggleSort,
    activeFilters, setFilter, clearFilters, activeFilterCount, filteredData,
  } = useGridSortFilter(properties, SEARCH_FIELDS);

  const {
    selectedIds, selectedItems, toggleOne, toggleAll, clearSelection,
    isAllSelected, isSomeSelected, selectedCount,
  } = useGridSelection(filteredData);

  const formatCurrency = (value: string) => {
    if (!value) return '$0.00';
    const num = parseFloat(value);
    if (isNaN(num)) return '$0.00';
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercentage = (value: string) => {
    if (!value && value !== '0') return '0.00%';
    return formatRatio(value) || '0.00%';
  };

  const formatDate = (val: string) => {
    if (!val) return '-';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    } catch { return val; }
  };

  const renderCellValue = (property: PropertyData, columnId: string) => {
    switch (columnId) {
      case 'isPrimary':
        return (
          <Checkbox
            checked={property.isPrimary}
            onCheckedChange={(checked) => onPrimaryChange(property.id, !!checked)}
            disabled={disabled || property.isPrimary}
            className="h-3.5 w-3.5"
          />
        );
      case 'appraisedValue':
      case 'purchasePrice':
      case 'downPayment':
      case 'protectiveEquity':
        return formatCurrency(String(property[columnId as keyof PropertyData] || ''));
      case 'ltv':
      case 'cltv':
        return formatPercentage(String(property[columnId as keyof PropertyData] || ''));
      case 'floodZone':
        return property.floodZone ? 'Yes' : 'No';
      case 'appraisedDate':
      case 'purchaseDate':
      case 'yearBuilt':
        return formatDate(String(property[columnId as keyof PropertyData] || ''));
      case 'propertyGeneratesIncome':
        return property.propertyGeneratesIncome ? 'Yes' : 'No';
      case 'netMonthlyIncome':
      case 'fromRent':
      case 'fromOtherDescribe':
        return formatCurrency(String(property[columnId as keyof PropertyData] || ''));
      case 'thirdPartyFullName':
      case 'appraiserPhone':
      case 'appraiserEmail':
        return property[columnId as keyof PropertyData] || '-';
      default:
        return property[columnId as keyof PropertyData] || '-';
    }
  };

  const handleBulkDelete = () => {
    if (onBulkDelete) {
      onBulkDelete(selectedItems);
    } else if (onDeleteProperty) {
      selectedItems.forEach((item) => onDeleteProperty(item));
    }
    clearSelection();
    setBulkDeleteOpen(false);
  };

  const exportColumns: ExportColumn[] = DEFAULT_COLUMNS.filter(c => c.id !== 'isPrimary').map(c => ({ id: c.id, label: c.label }));

  const handlePrint = () => {
    window.print();
  };


  return (
    <div className="p-6 space-y-4">
      {/* Header with title and actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg text-foreground">Properties</h3>
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
            onClick={onAddProperty}
            disabled={disabled || properties.length >= 5}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Add Property
          </Button>
        </div>
      </div>

      {/* Grid Toolbar with Print next to Export */}
      <GridToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={onRefresh}
        filterOptions={FILTER_OPTIONS}
        activeFilters={activeFilters}
        onFilterChange={setFilter}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        disabled={disabled}
        selectedCount={selectedCount}
        onBulkDelete={() => setBulkDeleteOpen(true)}
        onExport={() => setExportOpen(true)}
        onPrint={handlePrint}
      />

      {/* Properties Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <Table className="min-w-[1400px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={isAllSelected}
                  ref={(el) => {
                    if (el) (el as any).indeterminate = isSomeSelected;
                  }}
                  onCheckedChange={toggleAll}
                  disabled={disabled || filteredData.length === 0}
                />
              </TableHead>
              {visibleColumns.map((col) => (
                col.id === 'isPrimary' ? (
                  <TableHead key={col.id} className="w-[80px]">{col.label.toUpperCase()}</TableHead>
                ) : (
                  <SortableTableHead
                    key={col.id}
                    columnId={col.id}
                    label={col.label.toUpperCase()}
                    sortColumnId={sortState.columnId}
                    sortDirection={sortState.direction}
                    onSort={toggleSort}
                  />
                )
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 1} className="text-center py-8 text-muted-foreground">
                  {properties.length === 0
                    ? 'No properties added. Click "Add Property" to add one.'
                    : 'No properties match your search or filters.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((property) => (
                <TableRow
                  key={property.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => onRowClick(property)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(property.id)}
                      onCheckedChange={() => toggleOne(property.id)}
                      disabled={disabled}
                    />
                  </TableCell>
                  {visibleColumns.map((col) => (
                    <TableCell
                      key={col.id}
                      onClick={col.id === 'isPrimary' ? (e) => e.stopPropagation() : undefined}
                    >
                      {renderCellValue(property, col.id)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>


      {/* Footer with totals */}
      {properties.length > 0 && (
        <div className="flex justify-end">
          <div className="text-sm text-muted-foreground">
            Total Properties: {totalCount ?? properties.length} | 
            Total Estimate of Value: {formatCurrency(
              properties.reduce((sum, p) => sum + (parseFloat(p.appraisedValue) || 0), 0).toString()
            )}
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation */}
      <DeleteConfirmationDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedCount} Properties`}
        description={`Are you sure you want to delete ${selectedCount} selected properties? This action cannot be undone.`}
      />

      {/* Export Dialog */}
      <GridExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        columns={exportColumns}
        data={properties}
        fileName="properties"
      />

    </div>
  );
};

export default PropertiesTableView;
