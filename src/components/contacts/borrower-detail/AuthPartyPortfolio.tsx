import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, Settings2, Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO } from 'date-fns';

// Field dictionary UUIDs (same source of truth used by deal forms)
const FIELD_IDS = {
  loanAmount: '163cd0b4-7cc0-4975-bcfb-43aa4be9c5c8',
  principalBalance: '27c1bee2-05d4-46e5-a16b-e10c1e38cafd',
  accountNumber: 'b593a1fb-df22-405c-8ed0-670d251901a4',
  loanStatus: '356839ff-f156-4431-ac7d-87f038428178',
};

interface PortfolioRow {
  id: string;
  dealId: string;
  loanId: string;
  accountNumber: string;
  loanStatus: string;
  authorizationLevel: string;
  authStartDate: string;
  authEndDate: string;
  borrowerName: string;
  loanAmount: number;
  currentBalance: number;
  accessPermissions: string;
  lastAccessedDate: string;
}

const DEFAULT_VISIBLE = new Set([
  'loanId', 'accountNumber', 'loanStatus',
  'authorizationLevel',
  'authStartDate', 'authEndDate',
  'borrowerName', 'loanAmount',
  'currentBalance', 'accessPermissions',
  'lastAccessedDate',
]);

const ALL_COLUMNS = [
  { id: 'loanId', label: 'Loan ID' },
  { id: 'accountNumber', label: 'Account Number' },
  { id: 'loanStatus', label: 'Loan Status' },
  { id: 'authorizationLevel', label: 'Authorization Level' },
  { id: 'authStartDate', label: 'Auth Start Date' },
  { id: 'authEndDate', label: 'Auth End Date' },
  { id: 'borrowerName', label: 'Borrower Name' },
  { id: 'loanAmount', label: 'Loan Amount' },
  { id: 'currentBalance', label: 'Current Balance' },
  { id: 'accessPermissions', label: 'Access Permissions' },
  { id: 'lastAccessedDate', label: 'Last Accessed Date' },
];

const fmtCurrency = (v: number) =>
  v ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v) : '-';

const fmtDate = (v: string) => {
  if (!v) return '-';
  try { return format(parseISO(v), 'MM/dd/yyyy'); } catch { return '-'; }
};

function extractFieldValue(fv: Record<string, any>, fieldId: string, key: string): any {
  const entry = fv?.[fieldId];
  if (!entry) return null;
  if (typeof entry === 'object' && entry !== null) return entry[key] ?? null;
  return entry;
}

interface Props {
  authPartyId: string;
  contactDbId: string;
}

const AuthPartyPortfolio: React.FC<Props> = ({ authPartyId, contactDbId }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_VISIBLE));

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Find deals linked to this contact via deal_participants
      const { data: participants } = await supabase
        .from('deal_participants')
        .select('deal_id')
        .eq('contact_id', contactDbId);

      let dealIds = [...new Set((participants || []).map(p => p.deal_id))];

      // 2. Fallback: scan borrower section JSON for refs to this contact_id / auth party id
      if (dealIds.length === 0 && (contactDbId || authPartyId)) {
        const { data: borrowerSections } = await supabase
          .from('deal_section_values')
          .select('deal_id, field_values')
          .eq('section', 'borrower');
        const matched: string[] = [];
        (borrowerSections || []).forEach(bs => {
          const fv = bs.field_values as Record<string, any>;
          if (!fv) return;
          const flat = JSON.stringify(fv);
          if ((contactDbId && flat.includes(contactDbId)) || (authPartyId && flat.includes(authPartyId))) {
            matched.push(bs.deal_id);
          }
        });
        dealIds = [...new Set(matched)];
      }

      if (dealIds.length === 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }

      const { data: deals } = await supabase
        .from('deals')
        .select('id, deal_number, borrower_name, loan_amount, status')
        .in('id', dealIds);
      const dealsMap = new Map((deals || []).map(d => [d.id, d]));

      const { data: loanTermsSv } = await supabase
        .from('deal_section_values')
        .select('deal_id, field_values')
        .in('deal_id', dealIds)
        .eq('section', 'loan_terms');
      const ltMap = new Map<string, Record<string, any>>();
      (loanTermsSv || []).forEach(sv => ltMap.set(sv.deal_id, sv.field_values as Record<string, any>));

      const { data: borrowerSv } = await supabase
        .from('deal_section_values')
        .select('deal_id, field_values')
        .in('deal_id', dealIds)
        .eq('section', 'borrower');
      const brMap = new Map<string, Record<string, any>>();
      (borrowerSv || []).forEach(sv => brMap.set(sv.deal_id, sv.field_values as Record<string, any>));

      const portfolioRows: PortfolioRow[] = [];

      for (const dealId of dealIds) {
        const deal = dealsMap.get(dealId);
        if (!deal) continue;
        const lt = ltMap.get(dealId) || {};
        const br = brMap.get(dealId) || {};

        const findIn = (obj: Record<string, any>, ...frags: string[]): any => {
          for (const [k, v] of Object.entries(obj)) {
            const lk = k.toLowerCase();
            if (frags.some(f => lk.includes(f))) {
              if (v && typeof v === 'object') {
                const o = v as Record<string, any>;
                return o.value_number ?? o.value_date ?? o.value_text ?? null;
              }
              return v;
            }
          }
          return null;
        };

        const loanAmount = Number(
          extractFieldValue(lt, FIELD_IDS.loanAmount, 'value_number') || deal.loan_amount || 0,
        );
        const currentBalance = Number(
          extractFieldValue(lt, FIELD_IDS.principalBalance, 'value_number') || loanAmount,
        );
        const accountNumber =
          extractFieldValue(lt, FIELD_IDS.accountNumber, 'value_text') ||
          findIn(lt, 'account_number', 'loan_account') || '';

        const lsField = extractFieldValue(lt, FIELD_IDS.loanStatus, 'value_text');
        let loanStatus = 'Active';
        const lsRaw = lsField || lt['loan_status'] || lt['status'] || '';
        if (typeof lsRaw === 'string' && lsRaw) {
          loanStatus = lsRaw;
          const low = lsRaw.toLowerCase();
          if (low.includes('paid') || low.includes('closed')) loanStatus = 'Paid Off';
          else if (low.includes('default')) loanStatus = 'Default';
          else if (low.includes('delinquent')) loanStatus = 'Delinquent';
          else if (low.includes('active')) loanStatus = 'Active';
        }

        // Auth-party-specific fields from borrower.authorized_party.* JSON (best-effort)
        const authLevelRaw =
          findIn(br, 'authorized_party.authorization_level', 'authorized_party.auth_level', 'authorization_level') ||
          findIn(lt, 'authorization_level');
        let authorizationLevel = '-';
        if (typeof authLevelRaw === 'string' && authLevelRaw) {
          const low = authLevelRaw.toLowerCase();
          if (low.includes('full')) authorizationLevel = 'Full';
          else if (low.includes('edit')) authorizationLevel = 'Edit';
          else if (low.includes('view')) authorizationLevel = 'View';
          else authorizationLevel = authLevelRaw;
        }

        const authStartDate = String(
          findIn(br, 'authorized_party.auth_start_date', 'authorized_party.start_date', 'auth_start_date') ||
          findIn(lt, 'auth_start_date') || '',
        );
        const authEndDate = String(
          findIn(br, 'authorized_party.auth_end_date', 'authorized_party.end_date', 'auth_end_date') ||
          findIn(lt, 'auth_end_date') || '',
        );
        const accessPermissionsRaw =
          findIn(br, 'authorized_party.access_permissions', 'access_permissions') ||
          findIn(lt, 'access_permissions');
        const accessPermissions = accessPermissionsRaw ? String(accessPermissionsRaw) : '-';
        const lastAccessedDate = String(
          findIn(br, 'authorized_party.last_accessed_date', 'last_accessed_date') || '',
        );

        portfolioRows.push({
          id: `${dealId}-${authPartyId || contactDbId}`,
          dealId,
          loanId: deal.deal_number || '-',
          accountNumber: accountNumber ? String(accountNumber) : '-',
          loanStatus,
          authorizationLevel,
          authStartDate,
          authEndDate,
          borrowerName: deal.borrower_name || '-',
          loanAmount,
          currentBalance,
          accessPermissions,
          lastAccessedDate,
        });
      }

      setRows(portfolioRows);
    } catch (err) {
      console.error('Failed to load authorized party portfolio:', err);
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [contactDbId, authPartyId]);

  useEffect(() => {
    if (contactDbId) load();
  }, [contactDbId, load]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortCol(null);
    } else { setSortCol(col); setSortDir('asc'); }
  };

  const activeColumns = useMemo(
    () => ALL_COLUMNS.filter(c => visibleColumns.has(c.id)),
    [visibleColumns],
  );

  const filtered = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.loanId.toLowerCase().includes(q) ||
        r.accountNumber.toLowerCase().includes(q) ||
        r.borrowerName.toLowerCase().includes(q),
      );
    }
    if (sortCol && sortDir) {
      result = [...result].sort((a, b) => {
        const av = (a as any)[sortCol];
        const bv = (b as any)[sortCol];
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        return sortDir === 'asc'
          ? String(av || '').localeCompare(String(bv || ''))
          : String(bv || '').localeCompare(String(av || ''));
      });
    }
    return result;
  }, [rows, search, sortCol, sortDir]);

  const toggleColumn = (colId: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      next.has(colId) ? next.delete(colId) : next.add(colId);
      return next;
    });
  };

  const formatCell = (colId: string, row: PortfolioRow): React.ReactNode => {
    switch (colId) {
      case 'loanAmount': return fmtCurrency(row.loanAmount);
      case 'currentBalance': return fmtCurrency(row.currentBalance);
      case 'authStartDate': return fmtDate(row.authStartDate);
      case 'authEndDate': return fmtDate(row.authEndDate);
      case 'lastAccessedDate': return fmtDate(row.lastAccessedDate);
      case 'loanStatus': {
        const s = row.loanStatus;
        if (s === 'Default' || s === 'Delinquent')
          return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{s}</Badge>;
        if (s === 'Paid Off' || s === 'Closed')
          return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{s}</Badge>;
        if (s === 'Active')
          return <Badge className="text-[10px] px-1.5 py-0 bg-emerald-600 hover:bg-emerald-700">{s}</Badge>;
        return <Badge variant="outline" className="text-[10px] px-1.5 py-0">{s}</Badge>;
      }
      case 'authorizationLevel': {
        const s = row.authorizationLevel;
        if (s === 'Full') return <Badge className="text-[10px] px-1.5 py-0 bg-indigo-600 hover:bg-indigo-700">Full</Badge>;
        if (s === 'Edit') return <Badge className="text-[10px] px-1.5 py-0 bg-amber-600 hover:bg-amber-700">Edit</Badge>;
        if (s === 'View') return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">View</Badge>;
        return <span className="text-muted-foreground">-</span>;
      }
      default: return String((row as any)[colId] || '-');
    }
  };

  const handleExport = () => {
    const headers = activeColumns.map(c => c.label).join(',');
    const csvRows = filtered.map(r =>
      activeColumns.map(c => {
        const v = formatCell(c.id, r);
        const text = typeof v === 'string' || typeof v === 'number' ? String(v) : String((r as any)[c.id] ?? '');
        return `"${text.replace(/"/g, '""')}"`;
      }).join(','),
    );
    const csv = [headers, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'authorized_party_portfolio.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const rowClass = (r: PortfolioRow) => {
    if (r.loanStatus === 'Default' || r.loanStatus === 'Delinquent') {
      return 'cursor-pointer hover:bg-muted/60 bg-destructive/5 border-l-2 border-l-destructive';
    }
    return 'cursor-pointer hover:bg-muted/60';
  };

  return (
    <div className="space-y-4">
      <h4 className="text-lg font-semibold text-foreground">Portfolio</h4>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search loans..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-8 w-[200px] text-xs" />
        </div>
        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs">
              <Settings2 className="h-3.5 w-3.5" /> Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3" align="end">
            <div className="space-y-2">
              <span className="text-sm font-medium">Toggle Columns</span>
              {ALL_COLUMNS.map(c => (
                <div key={c.id} className="flex items-center gap-2">
                  <Checkbox id={`ap-col-${c.id}`} checked={visibleColumns.has(c.id)} onCheckedChange={() => toggleColumn(c.id)} />
                  <label htmlFor={`ap-col-${c.id}`} className="text-xs cursor-pointer">{c.label}</label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <Table className="min-w-[1400px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
              {activeColumns.map(c => (
                <SortableTableHead key={c.id} columnId={c.id} label={c.label}
                  sortColumnId={sortCol} sortDirection={sortDir} onSort={handleSort}
                  className="whitespace-nowrap text-xs" />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length} className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length} className="text-center py-8 text-muted-foreground text-sm">
                  No loans found for this authorized party. Portfolio will populate when this party is added to a deal.
                </TableCell>
              </TableRow>
            ) : filtered.map(r => (
              <TableRow key={r.id} className={rowClass(r)} onClick={() => navigate(`/deals/${r.dealId}/data`)}>
                {activeColumns.map(c => (
                  <TableCell key={c.id} className="whitespace-nowrap text-xs">
                    {formatCell(c.id, r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default AuthPartyPortfolio;
