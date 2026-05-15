import React, { useState, useMemo, useEffect, useRef } from 'react';
import { logContactEvent } from '@/hooks/useContactEventJournal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Plus, Settings2, Filter, Download, CalendarIcon, X, Paperclip, FileDown, Eye } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { RichTextEditor } from '@/components/deal/RichTextEditor';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface AttachmentMeta {
  name: string;
  storagePath: string;
  uploadedAt: string;
}

interface LogRow {
  id: string;
  date: string;
  asOfDate: string;
  type: string;
  subject: string;
  from: string;
  to: string;
  status: string;
  content: string;
  highPriority: boolean;
  followUp?: boolean;
  reference: string;
  attachments: (string | AttachmentMeta)[];
  account: string;
  name: string;
  completed?: boolean;
  completedBy?: string;
  completedDate?: string;
}

const ALL_COLUMNS = [
  { id: 'account', label: 'Account' },
  { id: 'date', label: 'Date Called' },
  { id: 'type', label: 'Call In/Out' },
  { id: 'name', label: 'Contact Name' },
  { id: 'subject', label: 'Subject' },
  { id: 'highPriority', label: 'Follow Up?' },
  { id: 'to', label: 'Assigned To' },
  { id: 'asOfDate', label: 'Follow Up Date' },
  { id: 'completed', label: 'Completed?' },
  
  { id: 'completedDate', label: 'Completed Date' },
];

const LOG_TYPES_FALLBACK = ['Conversation Log', 'Attorney / Client', 'Internal'];

const formatDateTimeDisplay = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return format(d, 'MM/dd/yyyy HH:mm:ss');
  } catch { return isoStr; }
};

const formatDateDisplay = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return format(d, 'MM/dd/yyyy');
  } catch { return isoStr; }
};

const getAttachmentName = (att: string | AttachmentMeta): string => {
  return typeof att === 'string' ? att : att.name;
};

const getAttachmentPath = (att: string | AttachmentMeta): string | null => {
  return typeof att === 'object' && att.storagePath ? att.storagePath : null;
};

const getEmptyLog = (): Omit<LogRow, 'id'> => {
  const now = new Date();
  return {
    date: now.toISOString(),
    asOfDate: now.toISOString(),
    type: '',
    subject: '',
    from: '',
    to: '',
    status: '',
    content: '',
    highPriority: false,
    followUp: false,
    reference: '',
    attachments: [],
    account: '',
    name: '',
    completed: false,
    completedBy: '',
    completedDate: '',
  };
};

const LenderConversationLog: React.FC<{ lenderId: string; contactDbId: string; disabled?: boolean }> = ({ lenderId, contactDbId, disabled = false }) => {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(ALL_COLUMNS.map(c => c.id)));
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [newLog, setNewLog] = useState<Omit<LogRow, 'id'>>(getEmptyLog());
  const [asOfDateFilter, setAsOfDateFilter] = useState<Date | undefined>(undefined);
  const [asOfFilterOpen, setAsOfFilterOpen] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [addAsOfOpen, setAddAsOfOpen] = useState(false);
  const [addCompletedDateOpen, setAddCompletedDateOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logTypes, setLogTypes] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [viewingRow, setViewingRow] = useState<LogRow | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    (supabase as any).from('conversation_log_types').select('label').eq('is_active', true).order('display_order').then(({ data, error }: any) => {
      if (error || !data?.length) setLogTypes(LOG_TYPES_FALLBACK);
      else setLogTypes(data.map((r: any) => r.label));
    });
  }, []);

  useEffect(() => {
    if (!contactDbId) return;
    const load = async () => {
      const { data } = await supabase.from('contacts').select('contact_data').eq('id', contactDbId).single();
      if (data?.contact_data && (data.contact_data as any)._conversation_logs) {
        setRows((data.contact_data as any)._conversation_logs);
      }
    };
    load();
  }, [contactDbId]);

  const persistLogs = async (updated: LogRow[]) => {
    const { data: current } = await supabase.from('contacts').select('contact_data').eq('id', contactDbId).single();
    const existing = (current?.contact_data as Record<string, any>) || {};
    const merged = { ...existing, _conversation_logs: updated };
    const { error } = await supabase.from('contacts').update({ contact_data: merged as any }).eq('id', contactDbId);
    if (error) toast.error('Failed to save conversation log');
  };

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortCol(null);
    } else { setSortCol(col); setSortDir('asc'); }
  };

  const toggleColumn = (colId: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      next.has(colId) ? next.delete(colId) : next.add(colId);
      return next;
    });
  };

  const activeColumns = ALL_COLUMNS.filter(c => visibleColumns.has(c.id));

  const filtered = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
    }
    if (asOfDateFilter) {
      const filterStr = format(asOfDateFilter, 'yyyy-MM-dd');
      result = result.filter(r => r.asOfDate && r.asOfDate.startsWith(filterStr));
    }
    if (filterType) result = result.filter(r => r.type === filterType);
    if (filterStatus) result = result.filter(r => r.status === filterStatus);
    if (sortCol && sortDir) {
      result = [...result].sort((a, b) => {
        const va = (a as any)[sortCol] || '';
        const vb = (b as any)[sortCol] || '';
        return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    }
    return result;
  }, [rows, search, sortCol, sortDir, asOfDateFilter, filterType, filterStatus]);

  const uploadFilesToStorage = async (files: File[], logId: string): Promise<AttachmentMeta[]> => {
    const results: AttachmentMeta[] = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `lender/${contactDbId}/${logId}/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from('contact-attachments').upload(path, file);
      if (error) {
        console.error('Upload failed:', error);
        toast.error(`Failed to upload ${file.name}`);
        continue;
      }
      results.push({ name: file.name, storagePath: path, uploadedAt: new Date().toISOString() });
    }
    return results;
  };

  const validateLog = (): boolean => {
    const errors: Record<string, string> = {};
    if (!newLog.type || newLog.type.trim() === '') errors.type = 'Type is required';
    if (newLog.name && newLog.name.length > 100) errors.name = 'Name must be 100 characters or less';
    if (newLog.account && newLog.account.length > 100) errors.account = 'Account must be 100 characters or less';
    if (newLog.reference && newLog.reference.length > 100) errors.reference = 'Topic must be 100 characters or less';
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddLog = async () => {
    if (!validateLog()) return;
    setUploading(true);
    const logId = `conv_${Date.now()}`;
    let attachmentsMeta: (string | AttachmentMeta)[] = [...newLog.attachments];

    if (pendingFiles.length > 0) {
      const uploaded = await uploadFilesToStorage(pendingFiles, logId);
      attachmentsMeta = uploaded;
    }

    const entry: LogRow = { ...newLog, id: logId, attachments: attachmentsMeta };
    const updated = [...rows, entry];
    setRows(updated);
    await persistLogs(updated);
    setNewLog(getEmptyLog());
    setPendingFiles([]);
    setAddOpen(false);
    setUploading(false);
    toast.success('Conversation log added');
    logContactEvent(contactDbId, 'Conversation Log', [{ fieldLabel: 'Log Added', oldValue: '', newValue: entry.subject || 'New log' }]);
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.size === 0) return;
    const updated = rows.filter(r => !selectedRows.has(r.id));
    setRows(updated);
    setSelectedRows(new Set());
    await persistLogs(updated);
    toast.success(`Deleted ${selectedRows.size} entry(ies)`);
    logContactEvent(contactDbId, 'Conversation Log', [{ fieldLabel: 'Logs Deleted', oldValue: `${selectedRows.size} entry(ies)`, newValue: '(deleted)' }]);
  };

  const handleExport = () => {
    const exportRows = selectedRows.size > 0 ? filtered.filter(r => selectedRows.has(r.id)) : filtered;
    if (exportRows.length === 0) { toast.info('No data to export'); return; }
    const headers = activeColumns.map(c => c.label);
    const csvRows = exportRows.map(r => activeColumns.map(c => `"${String((r as any)[c.id] || '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'conversation_log_export.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === filtered.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(filtered.map(r => r.id)));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const fileArr = Array.from(files);
    setPendingFiles(prev => [...prev, ...fileArr]);
    const newNames: AttachmentMeta[] = fileArr.map(f => ({ name: f.name, storagePath: '', uploadedAt: '' }));
    setNewLog(prev => ({ ...prev, attachments: [...prev.attachments, ...newNames] }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (idx: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
    setNewLog(p => ({ ...p, attachments: p.attachments.filter((_, i) => i !== idx) }));
  };

  const handleDownloadAttachment = async (att: string | AttachmentMeta) => {
    const path = getAttachmentPath(att);
    if (!path) {
      toast.info('This attachment has no downloadable file');
      return;
    }
    const { data, error } = await supabase.storage.from('contact-attachments').download(path);
    if (error || !data) {
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

  const addAsOfDateObj = newLog.asOfDate ? (() => {
    try { const d = new Date(newLog.asOfDate); return isNaN(d.getTime()) ? undefined : d; } catch { return undefined; }
  })() : undefined;

  const uniqueTypes = [...new Set(rows.map(r => r.type).filter(Boolean))];
  const uniqueStatuses = [...new Set(rows.map(r => r.status).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-foreground">Conversation Log</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">As Of</span>
          <Popover open={asOfFilterOpen} onOpenChange={setAsOfFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1 w-[130px] justify-start">
                {asOfDateFilter ? format(asOfDateFilter, 'MM/dd/yyyy') : <span className="text-muted-foreground">mm/dd/yyyy</span>}
                <CalendarIcon className="h-3 w-3 ml-auto" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-[9999]" align="end">
              <EnhancedCalendar mode="single" selected={asOfDateFilter} onSelect={(d) => { setAsOfDateFilter(d); setAsOfFilterOpen(false); }} onClear={() => { setAsOfDateFilter(undefined); setAsOfFilterOpen(false); }} onToday={() => { setAsOfDateFilter(new Date()); setAsOfFilterOpen(false); }} initialFocus />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1"><Settings2 className="h-3.5 w-3.5" /> Columns</Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2 z-[9999]" align="end">
              {ALL_COLUMNS.map(c => (
                <label key={c.id} className="flex items-center gap-2 py-1 px-1 text-xs cursor-pointer hover:bg-muted/50 rounded">
                  <Checkbox checked={visibleColumns.has(c.id)} onCheckedChange={() => toggleColumn(c.id)} />
                  {c.label}
                </label>
              ))}
            </PopoverContent>
          </Popover>
          {!disabled && (
            <Button size="sm" className="h-8 text-xs gap-1" onClick={() => { setNewLog(getEmptyLog()); setPendingFiles([]); setValidationErrors({}); setAddOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Add Conversation Logs
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search conversations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1"><Filter className="h-3.5 w-3.5" /> Filters</Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 space-y-3 z-[9999]" align="start">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">All</SelectItem>
                  {uniqueTypes.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">All</SelectItem>
                  {uniqueStatuses.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" className="text-xs w-full" onClick={() => { setFilterType(''); setFilterStatus(''); }}>Clear Filters</Button>
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={handleExport}><Download className="h-3.5 w-3.5" /> Export</Button>
        {selectedRows.size > 0 && !disabled && (
          <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={handleDeleteSelected}>Delete ({selectedRows.size})</Button>
        )}
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10"><Checkbox checked={filtered.length > 0 && selectedRows.size === filtered.length} onCheckedChange={toggleSelectAll} /></TableHead>
              {activeColumns.map(c => <SortableTableHead key={c.id} columnId={c.id} label={c.label} sortColumnId={sortCol} sortDirection={sortDir} onSort={handleSort} />)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={activeColumns.length + 1} className="text-center py-8 text-muted-foreground">No conversation log entries found.</TableCell></TableRow>
            ) : filtered.map(r => (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setViewingRow(r)}>
                <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={selectedRows.has(r.id)} onCheckedChange={() => { const n = new Set(selectedRows); n.has(r.id) ? n.delete(r.id) : n.add(r.id); setSelectedRows(n); }} /></TableCell>
                {activeColumns.map(c => (
                  <TableCell key={c.id} className="text-xs">
                    {c.id === 'date' ? formatDateTimeDisplay((r as any)[c.id] || '') :
                     c.id === 'asOfDate' ? (r.asOfDate ? formatDateDisplay(r.asOfDate) : '--') :
                     c.id === 'highPriority' ? (r.highPriority ? 'Yes' : 'No') :
                     c.id === 'completed' ? (r.completed ? 'Yes' : 'No') :
                     c.id === 'completedDate' ? (r.completedDate ? formatDateDisplay(r.completedDate) : '--') :
                     (r as any)[c.id] || '--'}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-muted-foreground text-right">
        Total Conversation Logs: {filtered.length}
      </div>

      {/* View Row Detail Dialog */}
      <Dialog open={!!viewingRow} onOpenChange={(open) => { if (!open) setViewingRow(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-4">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-sm">Conversation Log Details</DialogTitle>
          </DialogHeader>
          {viewingRow && (
            <div className="space-y-3 mt-3 flex-1 overflow-y-auto overflow-x-hidden min-h-0">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Date</Label>
                  <span className="text-xs">{formatDateTimeDisplay(viewingRow.date)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">As Of</Label>
                  <span className="text-xs">{formatDateDisplay(viewingRow.asOfDate)}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Type</Label>
                  <span className="text-xs">{viewingRow.type || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Topic</Label>
                  <span className="text-xs">{viewingRow.reference || '-'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Account</Label>
                  <span className="text-xs">{viewingRow.account || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Name</Label>
                  <span className="text-xs">{viewingRow.name || '-'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Subject</Label>
                  <span className="text-xs">{viewingRow.subject || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Assigned To</Label>
                  <span className="text-xs">{viewingRow.to || '-'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">High Priority</Label>
                  <span className="text-xs">{viewingRow.highPriority ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Follow Up</Label>
                  <span className="text-xs">{viewingRow.followUp ? 'Yes' : 'No'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Completed?</Label>
                  <span className="text-xs">{viewingRow.completed ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs text-muted-foreground">Completed Date</Label>
                  <span className="text-xs">{viewingRow.completedDate ? formatDateDisplay(viewingRow.completedDate) : '-'}</span>
                </div>
              </div>
              {viewingRow.content && (
                <div>
                  <Label className="text-xs text-muted-foreground">Content</Label>
                  <div className="mt-1 p-2 border border-border rounded text-xs bg-muted/30 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: viewingRow.content }} />
                </div>
              )}

              {/* Attachments Section */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-foreground">Attachments</Label>
                {(!viewingRow.attachments || viewingRow.attachments.length === 0) ? (
                  <p className="text-xs text-muted-foreground italic">No attachments available</p>
                ) : (
                  <div className="space-y-1">
                    {viewingRow.attachments.map((att, idx) => (
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
                          <span className="text-muted-foreground shrink-0">{formatDateDisplay(att.uploadedAt)}</span>
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
          <DialogFooter className="mt-4 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setViewingRow(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-4" onInteractOutside={(e) => { if ((e.target as HTMLElement)?.closest('[data-radix-popper-content-wrapper]')) e.preventDefault(); }}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-sm">Add New Conversation Log</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-3 flex-1 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox checked={newLog.highPriority} onCheckedChange={(c) => setNewLog(p => ({ ...p, highPriority: !!c }))} />
                <Label className="text-xs">High Priority</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={!!newLog.followUp} onCheckedChange={(c) => setNewLog(p => ({ ...p, followUp: !!c }))} />
                <Label className="text-xs">Follow Up</Label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Label className="w-[80px] shrink-0 text-xs">Date</Label>
                <Input value={formatDateTimeDisplay(newLog.date)} readOnly disabled className="h-7 text-xs flex-1 bg-muted" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[80px] shrink-0 text-xs">As Of</Label>
                <Popover modal={true} open={addAsOfOpen} onOpenChange={setAddAsOfOpen}>
                  <PopoverTrigger asChild>
                    <div className="relative flex-1 cursor-pointer">
                      <Input value={newLog.asOfDate ? formatDateTimeDisplay(newLog.asOfDate) : ''} readOnly placeholder="Select date..." className="h-7 text-xs pr-7 cursor-pointer" />
                      <CalendarIcon className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar mode="single" selected={addAsOfDateObj} onSelect={(d) => { if (d) { const ex = newLog.asOfDate ? new Date(newLog.asOfDate) : new Date(); if (!isNaN(ex.getTime())) { d.setHours(ex.getHours()); d.setMinutes(ex.getMinutes()); d.setSeconds(ex.getSeconds()); } setNewLog(p => ({ ...p, asOfDate: d.toISOString() })); } setAddAsOfOpen(false); }} onClear={() => { setNewLog(p => ({ ...p, asOfDate: '' })); setAddAsOfOpen(false); }} onToday={() => { setNewLog(p => ({ ...p, asOfDate: new Date().toISOString() })); setAddAsOfOpen(false); }} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs">Type <span className="text-destructive">*</span></Label>
                  <Select value={newLog.type || undefined} onValueChange={(v) => { setNewLog(p => ({ ...p, type: v })); setValidationErrors(prev => { const n = { ...prev }; delete n.type; return n; }); }}>
                    <SelectTrigger className={cn("h-7 text-xs flex-1", validationErrors.type && "border-destructive")}><SelectValue placeholder="Select type..." /></SelectTrigger>
                    <SelectContent className="z-[9999]">
                      {logTypes.length > 0 ? logTypes.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>) : <SelectItem value="__none__" disabled className="text-xs">No options available</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                {validationErrors.type && <p className="text-xs text-destructive ml-[88px]">{validationErrors.type}</p>}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs">Topic</Label>
                  <Input value={newLog.reference} onChange={e => setNewLog(p => ({ ...p, reference: e.target.value }))} maxLength={100} className={cn("h-7 text-xs flex-1", validationErrors.reference && "border-destructive")} />
                </div>
                {validationErrors.reference && <p className="text-xs text-destructive ml-[88px]">{validationErrors.reference}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs">Account</Label>
                  <Input value={newLog.account} onChange={e => setNewLog(p => ({ ...p, account: e.target.value }))} maxLength={100} className={cn("h-7 text-xs flex-1", validationErrors.account && "border-destructive")} />
                </div>
                {validationErrors.account && <p className="text-xs text-destructive ml-[88px]">{validationErrors.account}</p>}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="w-[80px] shrink-0 text-xs">Name</Label>
                  <Input value={newLog.name} onChange={e => { const v = e.target.value.replace(/[0-9]/g, ''); setNewLog(p => ({ ...p, name: v })); }} maxLength={100} className={cn("h-7 text-xs flex-1", validationErrors.name && "border-destructive")} />
                </div>
                {validationErrors.name && <p className="text-xs text-destructive ml-[88px]">{validationErrors.name}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Label className="w-[80px] shrink-0 text-xs">Subject</Label>
                <Input value={newLog.subject} onChange={e => setNewLog(p => ({ ...p, subject: e.target.value }))} maxLength={200} className="h-7 text-xs flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[80px] shrink-0 text-xs">Assigned To</Label>
                <Input value={newLog.to} onChange={e => setNewLog(p => ({ ...p, to: e.target.value }))} maxLength={100} className="h-7 text-xs flex-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Label className="w-[80px] shrink-0 text-xs">Completed?</Label>
                <div className="flex-1 flex items-center">
                  <Checkbox checked={!!newLog.completed} onCheckedChange={(c) => setNewLog(p => ({ ...p, completed: !!c, completedDate: !!c ? (p.completedDate || new Date().toISOString()) : '' }))} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[80px] shrink-0 text-xs">Completed Date</Label>
                <Popover modal={true} open={addCompletedDateOpen} onOpenChange={setAddCompletedDateOpen}>
                  <PopoverTrigger asChild>
                    <div className="relative flex-1 cursor-pointer">
                      <Input value={newLog.completedDate ? formatDateDisplay(newLog.completedDate) : ''} readOnly placeholder="Select date..." className="h-7 text-xs pr-7 cursor-pointer" />
                      <CalendarIcon className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar mode="single" selected={newLog.completedDate ? (() => { try { const d = new Date(newLog.completedDate); return isNaN(d.getTime()) ? undefined : d; } catch { return undefined; } })() : undefined} onSelect={(d) => { if (d) setNewLog(p => ({ ...p, completedDate: d.toISOString() })); setAddCompletedDateOpen(false); }} onClear={() => { setNewLog(p => ({ ...p, completedDate: '' })); setAddCompletedDateOpen(false); }} onToday={() => { setNewLog(p => ({ ...p, completedDate: new Date().toISOString() })); setAddCompletedDateOpen(false); }} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Conversation Log</Label>
              <div className="h-[160px] border border-border rounded-md overflow-hidden">
                <RichTextEditor value={newLog.content} onChange={(v) => setNewLog(p => ({ ...p, content: v }))} placeholder="Enter conversation log content..." minHeight="60px" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Attachments</Label>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="h-3 w-3" /> Attach File
                </Button>
                <input ref={fileInputRef} type="file" className="hidden" multiple accept=".doc,.docx,.xls,.xlsx,.pdf,.csv,.txt,.png,.jpg,.jpeg" onChange={handleFileChange} />
              </div>
              {newLog.attachments.length > 0 && (
                <div className="space-y-1">
                  {newLog.attachments.map((att, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 overflow-hidden min-w-0">
                      <Paperclip className="h-3 w-3 shrink-0" />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex-1 min-w-0 truncate">{getAttachmentName(att)}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm break-all">
                            <p>{getAttachmentName(att)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button type="button" variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => removeAttachment(idx)}><X className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="mt-4 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAddLog} disabled={uploading}>{uploading ? 'Uploading...' : 'OK'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LenderConversationLog;
