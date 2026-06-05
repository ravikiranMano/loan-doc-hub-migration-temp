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
import {
  listDealsPage,
  generateDealNumber,
  insertDeal,
  deleteDeal,
} from '@/services/deals/deals.service';
import { cloneDeal } from '@/services/deals/deal-clone.service';
import { subscribeToChanges } from '@/services/node-api/realtime';
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
  const [debouncedSearch, setDebouncedSearch] = useState('');
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
  const mounted = React.useRef(false);
  const prevFilters = React.useRef({
    debouncedSearch,
    filterStatus,
    filterState,
    filterProduct,
  });
  const skipNextPageFetch = React.useRef(false);

  const fetchDeals = useCallback(async (page: number = 1, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const { data, count } = await listDealsPage(page, PAGE_SIZE, {
        search: debouncedSearch || undefined,
        status: filterStatus || undefined,
        state: filterState || undefined,
        productType: filterProduct || undefined,
      });

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
  }, [debouncedSearch, filterStatus, filterState, filterProduct]);

  useEffect(() => {
    const debounce = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  useEffect(() => {
    const filtersChanged =
      prevFilters.current.debouncedSearch !== debouncedSearch ||
      prevFilters.current.filterStatus !== filterStatus ||
      prevFilters.current.filterState !== filterState ||
      prevFilters.current.filterProduct !== filterProduct;

    prevFilters.current = {
      debouncedSearch,
      filterStatus,
      filterState,
      filterProduct,
    };

    if (!mounted.current) {
      mounted.current = true;
      fetchDeals(currentPage, { silent: !!cachedState });
      return;
    }

    if (filtersChanged) {
      skipNextPageFetch.current = true;
      setCurrentPage(1);
      fetchDeals(1);
      return;
    }

    if (skipNextPageFetch.current) {
      skipNextPageFetch.current = false;
      return;
    }

    fetchDeals(currentPage);
  }, [currentPage, debouncedSearch, filterStatus, filterState, filterProduct, fetchDeals]);

  useEffect(() => {
    const { unsubscribe } = subscribeToChanges({
      channelName: 'deals-changes',
      table: 'deals',
      onChange: () => fetchDeals(currentPage, { silent: true }),
    });

    return unsubscribe;
  }, [fetchDeals, currentPage]);

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
      const dealNumber = await generateDealNumber();

      const data = await insertDeal({
        deal_number: dealNumber,
        state: 'TBD',
        product_type: 'TBD',
        mode: 'doc_prep',
        status: 'draft',
        created_by: user?.id,
      });

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
      await deleteDeal(deal.id);
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
      const newDeal = await cloneDeal(source.id);

      toast({
        title: 'File copied',
        description: `New file ${newDeal.deal_number} created from ${source.deal_number}.`,
      });
      setCopyTarget(null);
      navigate(`/deals/${newDeal.id}/edit`, { state: { resetToLoanTerms: true } });
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

  const hasActiveSearch = !!debouncedSearch;

  const clearFilters = () => {
    setFilterStatus('');
    setFilterState('');
    setFilterProduct('');
  };

  const hasActiveFilters = filterStatus || filterState || filterProduct || hasActiveSearch;

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
            {totalCount} {totalCount === 1 ? 'file' : 'files'}
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

      {deals.length === 0 ? (
        <div className="section-card text-center py-12">
          <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No files found</h3>
          <p className="text-muted-foreground mb-4">
            {hasActiveFilters
              ? 'Try adjusting your filters or search'
              : 'Create your first file to get started'}
          </p>
          {!hasActiveFilters && (
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
                {deals.map((deal) => (
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
