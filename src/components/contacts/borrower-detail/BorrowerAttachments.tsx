import React, { useState, useRef, useCallback, useMemo } from 'react';
import { format as formatDate } from 'date-fns';

const fmtUploadedDate = (v?: string) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : formatDate(d, 'MM/dd/yyyy');
};
import { Plus, Search, Trash2, Download, Loader2, Eye, Pencil, Upload, X, Filter, Columns, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  listActiveBorrowerAttachments,
  insertBorrowerAttachment,
  updateBorrowerAttachment,
} from '@/services/contacts/attachments.service';
import {
  uploadContactAttachment,
  downloadContactAttachment,
  removeContactAttachments,
} from '@/services/contacts/attachments.service';
import { fetchProfilesByUserIds } from '@/services/admin/profiles.service';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { GridExportDialog } from '@/components/deal/GridExportDialog';

const CATEGORIES = [
  'Identification',
  'KYC Documents',
  'Tax Returns',
  'Financial Statements',
  'Bank Statements',
  'Corporate Documents',
  'Personal Documents',
  'Miscellaneous',
];

interface AttachmentRow {
  id: string;
  contact_id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: string | null;
  category: string;
  description: string | null;
  uploaded_by: string;
  uploaded_at: string;
  version_number: number;
  status: string;
  uploader_name?: string;
}

interface UploadFormState {
  file: File | null;
  category: string;
  description: string;
  version_number: string;
}

const BorrowerAttachments: React.FC<{ borrowerId: string; contactDbId: string; disabled?: boolean }> = ({ contactDbId, disabled }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'uploaded_at', desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<AttachmentRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState<UploadFormState>({ file: null, category: 'Miscellaneous', description: '', version_number: '1' });
  const [editForm, setEditForm] = useState<{ category: string; description: string }>({ category: '', description: '' });

  // Filters
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterUploader, setFilterUploader] = useState<string>('all');

  // Fetch attachments
  const { data: attachments = [], isLoading } = useQuery({
    queryKey: ['borrower-attachments', contactDbId],
    queryFn: async () => {
      const data = await listActiveBorrowerAttachments(contactDbId);

      const uploaderIds: string[] = Array.from(new Set(data.map((d) => String(d.uploaded_by))));
      let profileMap: Record<string, string> = {};
      if (uploaderIds.length > 0) {
        const profiles = await fetchProfilesByUserIds(uploaderIds);
        profiles.forEach((p) => {
          profileMap[p.user_id] = p.full_name || 'Unknown';
        });
      }

      return data.map((row) => ({
        ...row,
        uploader_name: profileMap[row.uploaded_by] || 'Unknown',
      })) as AttachmentRow[];
    },
    enabled: !!contactDbId,
  });

  // Unique uploaders for filter
  const uniqueUploaders = useMemo(() => {
    const map = new Map<string, string>();
    attachments.forEach(a => { if (a.uploaded_by) map.set(a.uploaded_by, a.uploader_name || 'Unknown'); });
    return Array.from(map.entries());
  }, [attachments]);

  // Apply filters
  const filteredData = useMemo(() => {
    let result = attachments;
    if (filterCategory !== 'all') result = result.filter(a => a.category === filterCategory);
    if (filterUploader !== 'all') result = result.filter(a => a.uploaded_by === filterUploader);
    return result;
  }, [attachments, filterCategory, filterUploader]);

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (form: UploadFormState) => {
      if (disabled) throw new Error('You have read-only access to attachments');
      if (!form.file || !user) throw new Error('Missing file or user');
      const storagePath = `borrower/${contactDbId}/${crypto.randomUUID()}_${form.file.name}`;
      await uploadContactAttachment(storagePath, form.file);

      await insertBorrowerAttachment({
        contact_id: contactDbId,
        file_name: form.file.name,
        file_path: storagePath,
        file_type: form.file.type || 'unknown',
        file_size: `${(form.file.size / 1024).toFixed(1)} KB`,
        category: form.category,
        description: form.description || null,
        uploaded_by: user.id,
        version_number: parseInt(form.version_number) || 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['borrower-attachments', contactDbId] });
      toast.success('Attachment uploaded successfully');
      setShowUploadModal(false);
      setUploadForm({ file: null, category: 'Miscellaneous', description: '', version_number: '1' });
    },
    onError: (err: any) => toast.error(err.message || 'Upload failed'),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (attachment: AttachmentRow) => {
      if (disabled) throw new Error('You have read-only access to attachments');
      await removeContactAttachments([attachment.file_path]);
      await updateBorrowerAttachment(attachment.id, { status: 'archived' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['borrower-attachments', contactDbId] });
      toast.success('Attachment deleted');
    },
    onError: (err: any) => toast.error(err.message || 'Delete failed'),
  });

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: async () => {
      if (disabled) throw new Error('You have read-only access to attachments');
      if (!selectedAttachment) return;
      await updateBorrowerAttachment(selectedAttachment.id, {
        category: editForm.category,
        description: editForm.description || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['borrower-attachments', contactDbId] });
      toast.success('Attachment updated');
      setShowEditModal(false);
    },
    onError: (err: any) => toast.error(err.message || 'Update failed'),
  });

  // New version mutation
  const newVersionMutation = useMutation({
    mutationFn: async ({ attachment, file }: { attachment: AttachmentRow; file: File }) => {
      if (disabled) throw new Error('You have read-only access to attachments');
      if (!user) throw new Error('Not authenticated');
      const storagePath = `borrower/${contactDbId}/${crypto.randomUUID()}_${file.name}`;
      await uploadContactAttachment(storagePath, file);
      await updateBorrowerAttachment(attachment.id, { status: 'archived' });
      await insertBorrowerAttachment({
        contact_id: contactDbId,
        file_name: file.name,
        file_path: storagePath,
        file_type: file.type || 'unknown',
        file_size: `${(file.size / 1024).toFixed(1)} KB`,
        category: attachment.category,
        description: attachment.description,
        uploaded_by: user.id,
        version_number: attachment.version_number + 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['borrower-attachments', contactDbId] });
      toast.success('New version uploaded');
    },
    onError: (err: any) => toast.error(err.message || 'Version upload failed'),
  });

  const handleDownload = useCallback(async (attachment: AttachmentRow) => {
    let data: Blob;
    try {
      data = await downloadContactAttachment(attachment.file_path);
    } catch {
      toast.error('Download failed');
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = attachment.file_name; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handlePreview = useCallback(async (attachment: AttachmentRow) => {
    const isPreviewable = attachment.file_type?.startsWith('image/') || attachment.file_type === 'application/pdf';
    if (!isPreviewable) { handleDownload(attachment); return; }
    let data: Blob;
    try {
      data = await downloadContactAttachment(attachment.file_path);
    } catch {
      toast.error('Preview failed');
      return;
    }
    setPreviewUrl(URL.createObjectURL(data));
    setSelectedAttachment(attachment);
    setShowPreviewModal(true);
  }, [handleDownload]);

  const handleNewVersion = useCallback((attachment: AttachmentRow) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) newVersionMutation.mutate({ attachment, file });
    };
    input.click();
  }, [newVersionMutation]);

  const columns: ColumnDef<AttachmentRow>[] = useMemo(() => [
    { accessorKey: 'file_name', header: 'File Name', cell: ({ row }) => <span className="font-medium">{row.original.file_name}</span> },
    { accessorKey: 'category', header: 'Category', cell: ({ row }) => <Badge variant="outline">{row.original.category}</Badge> },
    { accessorKey: 'description', header: 'Description', cell: ({ row }) => <span className="text-muted-foreground text-xs">{row.original.description || '—'}</span> },
    { accessorKey: 'file_type', header: 'File Type', cell: ({ row }) => row.original.file_type || '—' },
    { accessorKey: 'file_size', header: 'File Size' },
    { accessorKey: 'uploader_name', header: 'Uploaded By' },
    { accessorKey: 'uploaded_at', header: 'Uploaded Date', cell: ({ row }) => fmtUploadedDate(row.original.uploaded_at) },
    { accessorKey: 'version_number', header: 'Version', cell: ({ row }) => `v${row.original.version_number}` },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handlePreview(row.original); }} title="Preview">
            <Eye className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleDownload(row.original); }} title="Download">
            <Download className="h-4 w-4 text-muted-foreground" />
          </Button>
          {!disabled && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedAttachment(row.original); setEditForm({ category: row.original.category, description: row.original.description || '' }); setShowEditModal(true); }} title="Edit">
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
          {!disabled && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleNewVersion(row.original); }} title="Upload New Version">
              <Upload className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
          {!disabled && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(row.original); }} title="Delete">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ], [handlePreview, handleDownload, handleNewVersion, deleteMutation]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const exportData = filteredData.map(a => ({
    'File Name': a.file_name,
    Category: a.category,
    Description: a.description || '',
    'File Type': a.file_type || '',
    'File Size': a.file_size || '',
    'Uploaded By': a.uploader_name || '',
    'Uploaded Date': fmtUploadedDate(a.uploaded_at),
    Version: a.version_number,
  }));

  const allColumns = columns.filter(c => c.id !== 'actions').map(c => ({
    id: (c as any).accessorKey || c.id || '',
    label: typeof c.header === 'string' ? c.header : '',
  }));

  if (isLoading) return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading attachments…</div>;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-lg font-semibold text-foreground">Borrower Attachments</h4>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search..." value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} className="pl-8 h-9 w-[200px]" />
          </div>

          {/* Filters */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Filter className="h-4 w-4" /> Filters
                {(filterCategory !== 'all' || filterUploader !== 'all') && <Badge variant="secondary" className="ml-1 h-5 px-1 text-xs">{[filterCategory !== 'all', filterUploader !== 'all'].filter(Boolean).length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3" align="end">
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Uploaded By</Label>
                <Select value={filterUploader} onValueChange={setFilterUploader}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {uniqueUploaders.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => { setFilterCategory('all'); setFilterUploader('all'); }}>Clear Filters</Button>
            </PopoverContent>
          </Popover>

          {/* Column Visibility */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1"><Columns className="h-4 w-4" /> Columns</Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 space-y-2" align="end">
              {table.getAllLeafColumns().filter(c => c.id !== 'actions').map(column => (
                <div key={column.id} className="flex items-center gap-2">
                  <Checkbox checked={column.getIsVisible()} onCheckedChange={v => column.toggleVisibility(!!v)} id={column.id} />
                  <label htmlFor={column.id} className="text-xs">{typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}</label>
                </div>
              ))}
            </PopoverContent>
          </Popover>

          <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="gap-1">
            <FileText className="h-4 w-4" /> Export
          </Button>

          {!disabled && (
            <Button variant="outline" size="sm" onClick={() => setShowUploadModal(true)} className="gap-1">
              <Plus className="h-4 w-4" /> Upload Attachment
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(hg => (
              <TableRow key={hg.id} className="bg-muted/50">
                {hg.headers.map(header => (
                  <TableHead key={header.id} className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''} onClick={header.column.getToggleSortingHandler()}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow><TableCell colSpan={columns.length} className="text-center py-12 text-muted-foreground">No borrower attachments available.</TableCell></TableRow>
            ) : table.getRowModel().rows.map(row => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map(cell => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Upload Attachment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>File</Label>
              <Input type="file" onChange={e => setUploadForm(prev => ({ ...prev, file: e.target.files?.[0] || null }))} />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={uploadForm.category} onValueChange={v => setUploadForm(prev => ({ ...prev, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={uploadForm.description} onChange={e => setUploadForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Optional description..." rows={2} />
            </div>
            <div className="space-y-1">
              <Label>Version Number</Label>
              <Input type="number" min="1" value={uploadForm.version_number} onChange={e => setUploadForm(prev => ({ ...prev, version_number: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadModal(false)}>Cancel</Button>
            <Button onClick={() => uploadMutation.mutate(uploadForm)} disabled={!uploadForm.file || uploadMutation.isPending}>
              {uploadMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Uploading...</> : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Attachment Metadata</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={editForm.category} onValueChange={v => setEditForm(prev => ({ ...prev, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={editForm.description} onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
            <Button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Modal */}
      <Dialog open={showPreviewModal} onOpenChange={v => { if (!v) { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); } setShowPreviewModal(v); }}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh]">
          <DialogHeader><DialogTitle>{selectedAttachment?.file_name}</DialogTitle></DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            {previewUrl && selectedAttachment?.file_type?.startsWith('image/') && <img src={previewUrl} alt={selectedAttachment.file_name} className="w-full rounded" />}
            {previewUrl && selectedAttachment?.file_type === 'application/pdf' && <iframe src={previewUrl} className="w-full h-[55vh] rounded" />}
          </div>
        </DialogContent>
      </Dialog>

      {/* Export */}
      <GridExportDialog
        open={showExport}
        onOpenChange={setShowExport}
        data={exportData}
        columns={allColumns}
        fileName="borrower_attachments"
      />
    </div>
  );
};

export default BorrowerAttachments;
