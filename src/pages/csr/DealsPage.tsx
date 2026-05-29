import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useWorkspaceOptional } from '@/contexts/WorkspaceContext';
import { MaxFilesDialog } from '@/components/workspace/MaxFilesDialog';
import { useAuth } from '@/contexts/AuthContext';
import { logDealCreated } from '@/hooks/useActivityLog';
import { 
  Plus, 
  Search, 
  Filter,
  MoreHorizontal,
  FolderOpen,
  Loader2,
  Eye,
  Edit,
  Trash2,
  Copy,
  ChevronLeft,
  ChevronRight,
  RefreshCw
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface Deal {
  id: string;
  deal_number: string;
  state: string;
  product_type: string;
  mode: 'doc_prep' | 'servicing_only';
  status: 'draft' | 'ready' | 'generated';
  borrower_name: string | null;
  property_address: string | null;
  loan_amount: number | null;
  created_at: string;
  packet?: { name: string } | null;
}

import { US_STATES } from '@/lib/usStates';

const PRODUCT_TYPES = [
  'Conventional', 'FHA', 'VA', 'USDA', 'Jumbo', 'Reverse Mortgage', 'HELOC', 'Construction'
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'generated', label: 'Generated' },
];

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  ready: 'bg-primary/10 text-primary',
  generated: 'bg-success/10 text-success',
};

const modeLabels: Record<string, string> = {
  doc_prep: 'Doc Prep',
  servicing_only: 'Servicing Only',
};

const PAGE_SIZE = 10;
const DEALS_CACHE_KEY = 'deals_page_cache';

interface DealsPageCache {
  deals: Deal[];
  totalCount: number;
  currentPage: number;
}

function loadDealsPageCache(): DealsPageCache | null {
  try {
    const raw = sessionStorage.getItem(DEALS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as DealsPageCache) : null;
  } catch {
    return null;
  }
}

export const DealsPage: React.FC = () => {
  const cachedState = loadDealsPageCache();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refreshKey = searchParams.get('_r');
  const { toast } = useToast();
  const workspace = useWorkspaceOptional();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyTarget, setCopyTarget] = useState<Deal | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Deal | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deals, setDeals] = useState<Deal[]>(cachedState?.deals || []);
  const [loading, setLoading] = useState(!cachedState);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('');
  const [filterProduct, setFilterProduct] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [showMaxFilesDialog, setShowMaxFilesDialog] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(cachedState?.currentPage || 1);
  const [totalCount, setTotalCount] = useState(cachedState?.totalCount || 0);

  // Use a ref for toast to keep fetchDeals stable and prevent re-fetching on parent re-renders
  const toastRef = React.useRef(toast);
  toastRef.current = toast;

  const fetchDeals = useCallback(async (page: number = 1, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await supabase
        .from('deals')
        .select('*, packets(name)', { count: 'exact' })
        .order('updated_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const mappedDeals = (data || []).map((d: any) => ({
        ...d,
        packet: d.packets,
      }));

      setDeals(mappedDeals);
      setTotalCount(count || 0);
      setCurrentPage(page);

      try {
        sessionStorage.setItem(
          DEALS_CACHE_KEY,
          JSON.stringify({ deals: mappedDeals, totalCount: count || 0, currentPage: page })
        );
      } catch {
        // ignore cache write errors
      }
    } catch (error) {
      console.error('Error fetching deals:', error);
      toastRef.current({
        title: 'Error',
        description: 'Failed to load files',
        variant: 'destructive',
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeals(currentPage, { silent: !!cachedState });

    // Real-time subscription - refresh current page
    const channel = supabase
      .channel('deals-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deals' },
        () => fetchDeals(1, { silent: true }) // silent background refresh
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchDeals]);

  // Refresh deals when "All Loan Documents" tab is clicked (refreshKey changes)
  useEffect(() => {
    if (refreshKey) {
      fetchDeals(1);
    }
  }, [refreshKey, fetchDeals]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      fetchDeals(page);
    }
  };

  const handleEnterData = (deal: Deal, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    if (workspace) {
      // Check if already open
      const alreadyOpen = workspace.openFiles.find(f => f.id === deal.id);
      if (alreadyOpen) {
        workspace.switchToFile(deal.id);
        navigate(`/deals/${deal.id}/edit`, { state: { resetToLoanTerms: true } });
        return;
      }
      
      if (workspace.isAtLimit()) {
        setShowMaxFilesDialog(true);
        return;
      }
      
      workspace.openFile({
        id: deal.id,
        dealNumber: deal.deal_number,
        state: deal.state,
        productType: deal.product_type,
        openedAt: Date.now(),
      });
    }
    
    navigate(`/deals/${deal.id}/edit`, { state: { resetToLoanTerms: true } });
  };

  const handleCreateDeal = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { data: dealNumber, error: numErr } = await supabase.rpc('generate_deal_number');
      if (numErr) throw numErr;

      const { data, error } = await supabase
        .from('deals')
        .insert({
          deal_number: dealNumber,
          state: 'TBD',
          product_type: 'TBD',
          mode: 'doc_prep',
          status: 'draft',
          created_by: user?.id,
        })
        .select()
        .single();

      if (error) throw error;

      await logDealCreated(data.id, {
        dealNumber,
        state: 'TBD',
        productType: 'TBD',
        mode: 'doc_prep',
      });

      toast({ title: 'File created successfully' });
      navigate(`/deals/${data.id}`);
    } catch (error: any) {
      console.error('Error creating deal:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create file',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };
  const handleDelete = async (deal: Deal) => {
    setDeleting(true);
    try {
      // Clean up dependent rows first to avoid FK constraint failures
      await Promise.all([
        supabase.from('deal_section_values').delete().eq('deal_id', deal.id),
        supabase.from('deal_field_values').delete().eq('deal_id', deal.id),
        supabase.from('deal_participants').delete().eq('deal_id', deal.id),
      ]);
      const { data: deleted, error } = await supabase.from('deals').delete().eq('id', deal.id).select('id');
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        throw new Error('You do not have permission to delete this file.');
      }
      toast({ title: 'File deleted', description: `File ${deal.deal_number} has been deleted.` });
      setDeleteTarget(null);
      fetchDeals(currentPage);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete file',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  // Create Copy / Clone Loan — duplicates business setup into a brand-new
  // independent file. Explicitly whitelists the rows we copy (deals row,
  // deal_section_values, deal_field_values, deal_participants) and skips
  // everything else (generated_documents, event_journal, activity_log,
  // messages, loan_history*) so no historical/system-generated data leaks
  // into the copy. Uses existing insert APIs only — no new tables/schema.
  const handleCopyDeal = async (source: Deal) => {
    if (copying) return;
    setCopying(true);
    try {
      // 1. Generate new unique file number
      const { data: dealNumber, error: numErr } = await supabase.rpc('generate_deal_number');
      if (numErr) throw numErr;

      // 2. Re-fetch full source deal (the grid row omits notes/packet_id)
      const { data: src, error: srcErr } = await supabase
        .from('deals')
        .select('*')
        .eq('id', source.id)
        .single();
      if (srcErr) throw srcErr;

      // 3. Insert new deal — copy business setup, reset system metadata
      const { data: newDeal, error: insErr } = await supabase
        .from('deals')
        .insert({
          deal_number: dealNumber,
          state: src.state || 'TBD',
          product_type: src.product_type || 'TBD',
          mode: src.mode || 'doc_prep',
          status: 'draft', // always start fresh
          packet_id: src.packet_id ?? null,
          loan_amount: src.loan_amount ?? null,
          property_address: src.property_address ?? null,
          borrower_name: src.borrower_name ?? null,
          notes: src.notes ?? null,
          created_by: user?.id,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      const newDealId = newDeal.id as string;

      // 3a. Resolve field_dictionary IDs for operational/history fields that
      //     must NOT be cloned (funding history + funding override history).
      //     Stored both as composite keys inside deal_section_values.loan_terms
      //     and as typed rows in deal_field_values.
      const { data: excludeDictRows } = await supabase
        .from('field_dictionary')
        .select('id, field_key')
        .in('field_key', [
          'loan_terms.funding_history',
          'loan_terms.funding_adjustments',
        ]);
      const excludedDictIds = new Set<string>((excludeDictRows || []).map((r: any) => r.id));

      // 4. Copy deal_section_values (all JSONB section payloads — loan terms,
      //    property, contacts prefixes, funding setup, custom fields, etc.)
      //    EXCLUDES the 'notes' section so the copied loan starts with a
      //    completely clean Conversation Log, and strips any composite keys
      //    that reference funding history / funding override history so the
      //    copied loan has zero funding event records.
      const { data: sectionRows, error: secErr } = await supabase
        .from('deal_section_values')
        .select('section, field_values, version')
        .eq('deal_id', source.id)
        .neq('section', 'notes');
      if (secErr) throw secErr;
      if (sectionRows && sectionRows.length > 0) {
        const payload = sectionRows.map((r: any) => {
          const cleaned: Record<string, unknown> = {};
          const fv = (r.field_values && typeof r.field_values === 'object') ? r.field_values : {};
          for (const [k, v] of Object.entries(fv)) {
            const tail = k.includes('::') ? k.split('::').pop()! : k;
            if (excludedDictIds.has(tail)) continue;
            cleaned[k] = v;
          }
          return {
            deal_id: newDealId,
            section: r.section,
            field_values: cleaned,
            version: r.version ?? 1,
          };
        });
        const { error } = await supabase.from('deal_section_values').insert(payload);
        if (error) throw error;
      }

      // 5. Copy deal_field_values (typed per-field values referenced by the
      //    field_dictionary). Same field_dictionary_id, new deal_id.
      //    EXCLUDES funding history / funding override history rows.
      const { data: fieldRows, error: fldErr } = await supabase
        .from('deal_field_values')
        .select('field_dictionary_id, value_text, value_number, value_date, value_json')
        .eq('deal_id', source.id);
      if (fldErr) throw fldErr;
      if (fieldRows && fieldRows.length > 0) {
        const filtered = fieldRows.filter((r: any) => !excludedDictIds.has(r.field_dictionary_id));
        if (filtered.length > 0) {
          const payload = filtered.map((r: any) => ({
            deal_id: newDealId,
            field_dictionary_id: r.field_dictionary_id,
            value_text: r.value_text,
            value_number: r.value_number,
            value_date: r.value_date,
            value_json: r.value_json,
            updated_by: user?.id,
          }));
          const { error } = await supabase.from('deal_field_values').insert(payload);
          if (error) throw error;
        }
      }

      // 6. Copy deal_participants as NEW relationship mappings — reuse the
      //    same master contact_id but reset participant lifecycle state so
      //    edits to the copy do not affect the original participant rows.
      const { data: partRows, error: partErr } = await supabase
        .from('deal_participants')
        .select('contact_id, role, name, email, phone, sequence_order, access_method')
        .eq('deal_id', source.id);
      if (partErr) throw partErr;
      if (partRows && partRows.length > 0) {
        const payload = partRows.map((p: any) => ({
          deal_id: newDealId,
          contact_id: p.contact_id,
          role: p.role,
          name: p.name,
          email: p.email,
          phone: p.phone,
          sequence_order: p.sequence_order,
          access_method: p.access_method ?? 'login',
          status: 'invited' as const, // reset workflow status
          // user_id, completed_at, revoked_at intentionally left NULL
        }));
        const { error } = await supabase.from('deal_participants').insert(payload);
        if (error) throw error;
      }

      // 7. Explicitly DO NOT copy: generated_documents, event_journal,
      //    activity_log, messages, loan_history, loan_history_lenders,
      //    magic_links, generation_jobs, and the 'notes' section of
      //    deal_section_values (Conversation Log). These rows are tied by
      //    deal_id to the original file and the new file starts with an
      //    empty history and a clean communication record.

      await logDealCreated(newDealId, {
        dealNumber,
        state: newDeal.state,
        productType: newDeal.product_type,
        mode: newDeal.mode,
        copiedFrom: source.deal_number,
      } as any);

      toast({
        title: 'File copied',
        description: `New file ${dealNumber} created from ${source.deal_number}.`,
      });
      setCopyTarget(null);
      // Open the new loan in edit mode
      navigate(`/deals/${newDealId}/edit`, { state: { resetToLoanTerms: true } });
    } catch (error: any) {
      console.error('Error copying deal:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to copy file',
        variant: 'destructive',
      });
    } finally {
      setCopying(false);
    }
  };



  const formatCurrency = (amount: number | null) => {
    if (!amount) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const filteredDeals = deals.filter((deal) => {
    const matchesSearch =
      deal.deal_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      deal.borrower_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      deal.property_address?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !filterStatus || deal.status === filterStatus;
    const matchesState = !filterState || deal.state === filterState;
    const matchesProduct = !filterProduct || deal.product_type === filterProduct;
    return matchesSearch && matchesStatus && matchesState && matchesProduct;
  });

  const clearFilters = () => {
    setFilterStatus('');
    setFilterState('');
    setFilterProduct('');
  };

  const hasActiveFilters = filterStatus || filterState || filterProduct;

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
           <h1 className="text-2xl font-bold text-foreground">Files</h1>
          <p className="text-muted-foreground mt-1">
            {filteredDeals.length} {filteredDeals.length === 1 ? 'file' : 'files'}
            {hasActiveFilters && ' (filtered)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => fetchDeals(currentPage)} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={handleCreateDeal} disabled={creating} className="gap-2">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create File
          </Button>
        </div>
      </div>

      <div className="section-card mb-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by file #, borrower, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              onClick={() => setShowFilters(!showFilters)}
              className="gap-2"
            >
              <Filter className="h-4 w-4" />
              Filters
              {hasActiveFilters && (
                <span className="ml-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                  {[filterStatus, filterState, filterProduct].filter(Boolean).length}
                </span>
              )}
            </Button>
          </div>

          {showFilters && (
            <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-border">
              <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterState || "all"} onValueChange={(v) => setFilterState(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterProduct || "all"} onValueChange={(v) => setFilterProduct(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Products</SelectItem>
                  {PRODUCT_TYPES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button variant="ghost" onClick={clearFilters} className="text-muted-foreground">
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {filteredDeals.length === 0 ? (
        <div className="section-card text-center py-12">
          <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No files found</h3>
          <p className="text-muted-foreground mb-4">
            {hasActiveFilters || searchQuery
              ? 'Try adjusting your filters or search'
              : 'Create your first file to get started'}
          </p>
          {!hasActiveFilters && !searchQuery && (
            <Button onClick={handleCreateDeal} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Create File
            </Button>
          )}
        </div>
      ) : (
        <div className="section-card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">File #</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Borrower</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Mode</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Amount</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Created</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map((deal) => (
                  <tr
                    key={deal.id}
                    className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/deals/${deal.id}`)}
                  >
                    <td className="py-4 px-4">
                      <span className="font-medium text-foreground">{deal.deal_number}</span>
                    </td>
                    <td className="py-4 px-4 text-foreground">
                      {deal.borrower_name || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-xs text-muted-foreground">
                        {modeLabels[deal.mode]}
                      </span>
                    </td>
                    <td className="py-4 px-4 font-medium text-foreground">
                      {formatCurrency(deal.loan_amount)}
                    </td>
                    <td className="py-4 px-4">
                      <span className={cn(
                        'inline-flex px-2.5 py-1 rounded-full text-xs font-medium capitalize',
                        statusColors[deal.status]
                      )}>
                        {deal.status}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-sm text-muted-foreground">
                      {new Date(deal.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/deals/${deal.id}`);
                          }}>
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => {
                            handleEnterData(deal, e as any);
                          }}>
                            <Edit className="h-4 w-4 mr-2" />
                            Enter Data
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            setCopyTarget(deal);
                          }}>
                            <Copy className="h-4 w-4 mr-2" />
                            Create Copy
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled
                            onSelect={(e) => e.preventDefault()}
                            className="text-destructive opacity-50 cursor-not-allowed"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * PAGE_SIZE) + 1}-{Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount} files
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handlePageChange(pageNum)}
                        className="w-8 h-8 p-0"
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="gap-1"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!copyTarget} onOpenChange={(open) => { if (!open && !copying) setCopyTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a copy of this loan/file?</AlertDialogTitle>
            <AlertDialogDescription>
              The new loan will copy setup and entered data from{' '}
              <span className="font-medium text-foreground">{copyTarget?.deal_number}</span>{' '}
              but will <span className="font-medium">NOT</span> copy generated documents,
              communication history, event logs, or transaction history. A new unique file
              number will be assigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={copying}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={copying}
              onClick={(e) => {
                e.preventDefault();
                if (copyTarget) handleCopyDeal(copyTarget);
              }}
            >
              {copying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />}
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete file no.{' '}
              <span className="font-medium text-foreground">{deleteTarget?.deal_number}</span>?
              This action cannot be undone and will permanently remove all data associated
              with this file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) handleDelete(deleteTarget);
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MaxFilesDialog
        open={showMaxFilesDialog}
        onClose={() => setShowMaxFilesDialog(false)}
      />
    </div>
  );
};

export default DealsPage;
