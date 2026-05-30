import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, Download, Loader2, Eye, Upload, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DeleteConfirmationDialog } from '@/components/deal/DeleteConfirmationDialog';

const BUCKET = 'contact-attachments';
const SECTION = 'attachments_grid' as const;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx,.txt';

function validateAttachment(file: File | null): { isValid: boolean; error?: string } {
  if (!file) return { isValid: false, error: 'No file selected' };
  if (file.name.length > 255) return { isValid: false, error: 'File name too long — max 255 characters' };
  if (file.size > MAX_FILE_SIZE) {
    return { isValid: false, error: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds 25MB limit` };
  }
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
    return { isValid: false, error: 'File type not allowed. Allowed: PDF, JPG, PNG, GIF, DOC, DOCX, XLS, XLSX, TXT' };
  }
  return { isValid: true };
}

const CATEGORIES = [
  'Loan Documents',
  'Property Documents',
  'Identification',
  'Financial Statements',
  'Tax Returns',
  'Bank Statements',
  'Correspondence',
  'Miscellaneous',
];

interface AttachmentMeta {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: string;
  category: string;
  description: string;
  uploaded_by: string;
  uploader_name?: string;
  uploaded_at: string;
}

interface DealAttachmentsTabProps {
  dealId: string;
  disabled?: boolean;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const DealAttachmentsTab: React.FC<DealAttachmentsTabProps> = ({ dealId, disabled }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewAtt, setPreviewAtt] = useState<AttachmentMeta | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttachmentMeta | null>(null);
  const [uploadForm, setUploadForm] = useState<{ file: File | null; category: string; description: string }>({
    file: null,
    category: 'Loan Documents',
    description: '',
  });

  const queryKey = ['deal-attachments', dealId];

  const { data: rowData, isLoading } = useQuery({
    queryKey,
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deal_section_values')
        .select('id, field_values, version')
        .eq('deal_id', dealId)
        .eq('section', SECTION as any)
        .maybeSingle();
      if (error && (error as any).code !== 'PGRST116') throw error;
      const fv = (data?.field_values as any) || {};
      const files: AttachmentMeta[] = Array.isArray(fv.files) ? fv.files : [];

      // Resolve uploader names
      const ids = Array.from(new Set(files.map(f => f.uploaded_by).filter(Boolean)));
      let nameMap: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', ids);
        (profs || []).forEach((p: any) => { nameMap[p.user_id] = p.full_name || p.email || 'Unknown'; });
      }
      return {
        rowId: data?.id || null,
        version: data?.version || 0,
        files: files.map(f => ({ ...f, uploader_name: nameMap[f.uploaded_by] || f.uploader_name || 'Unknown' })),
      };
    },
  });

  const attachments = rowData?.files || [];

  const filtered = useMemo(() => {
    let res = attachments;
    if (filterCategory !== 'all') res = res.filter(a => a.category === filterCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      res = res.filter(a =>
        a.file_name.toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      );
    }
    return res;
  }, [attachments, filterCategory, search]);

  const persistFiles = useCallback(async (nextFiles: AttachmentMeta[]) => {
    const payload = { files: nextFiles };
    if (rowData?.rowId) {
      const { error } = await supabase
        .from('deal_section_values')
        .update({ field_values: payload as any, version: (rowData.version || 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', rowData.rowId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('deal_section_values')
        .insert({ deal_id: dealId, section: SECTION as any, field_values: payload as any, version: 1 });
      if (error) throw error;
    }
  }, [dealId, rowData?.rowId, rowData?.version]);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (disabled) throw new Error('You have read-only access');
      if (!user) throw new Error('Not authenticated');
      const validation = validateAttachment(uploadForm.file);
      if (!validation.isValid) throw new Error(validation.error || 'Invalid file');
      const file = uploadForm.file!;
      const path = `deal/${dealId}/${crypto.randomUUID()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) throw upErr;
      const meta: AttachmentMeta = {
        id: crypto.randomUUID(),
        file_name: file.name,
        file_path: path,
        file_type: file.type || 'application/octet-stream',
        file_size: formatSize(file.size),
        category: uploadForm.category,
        description: uploadForm.description,
        uploaded_by: user.id,
        uploaded_at: new Date().toISOString(),
      };
      const next = [meta, ...(rowData?.files || [])];
      await persistFiles(next);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.refetchQueries({ queryKey });
      toast.success('Attachment uploaded');
      setShowUploadModal(false);
      setUploadForm({ file: null, category: 'Loan Documents', description: '' });
    },
    onError: (e: any) => toast.error(e.message || 'Upload failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (att: AttachmentMeta) => {
      if (disabled) throw new Error('You have read-only access');
      await supabase.storage.from(BUCKET).remove([att.file_path]);
      const next = (rowData?.files || []).filter(a => a.id !== att.id);
      await persistFiles(next);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.refetchQueries({ queryKey });
      toast.success('Attachment deleted');
      setDeleteTarget(null);
    },
    onError: (e: any) => { toast.error(e.message || 'Delete failed'); setDeleteTarget(null); },
  });

  const handleDownload = useCallback(async (att: AttachmentMeta) => {
    const { data, error } = await supabase.storage.from(BUCKET).download(att.file_path);
    if (error || !data) { toast.error('Download failed'); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = att.file_name; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handlePreview = useCallback(async (att: AttachmentMeta) => {
    const previewable = att.file_type?.startsWith('image/') || att.file_type === 'application/pdf';
    if (!previewable) { handleDownload(att); return; }
    const { data, error } = await supabase.storage.from(BUCKET).download(att.file_path);
    if (error || !data) { toast.error('Preview failed'); return; }
    setPreviewUrl(URL.createObjectURL(data));
    setPreviewAtt(att);
  }, [handleDownload]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading attachments…
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-foreground">Attachments ({attachments.length})</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 w-[220px]"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          {!disabled && (
            <Button size="sm" onClick={() => setShowUploadModal(true)} className="gap-1">
              <Plus className="h-4 w-4" /> Upload
            </Button>
          )}
        </div>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Uploaded By</TableHead>
              <TableHead>Uploaded Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No attachments yet. Click Upload to add one.
                </TableCell>
              </TableRow>
            ) : filtered.map(att => (
              <TableRow key={att.id}>
                <TableCell className="font-medium">{att.file_name}</TableCell>
                <TableCell><Badge variant="outline">{att.category}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">{att.description || '—'}</TableCell>
                <TableCell className="text-xs">{att.file_type || '—'}</TableCell>
                <TableCell className="text-xs">{att.file_size}</TableCell>
                <TableCell className="text-xs">{att.uploader_name}</TableCell>
                <TableCell className="text-xs">{new Date(att.uploaded_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handlePreview(att)} title="Preview">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDownload(att)} title="Download">
                      <Download className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    {!disabled && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(att)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Upload modal */}
      <Dialog open={showUploadModal} onOpenChange={(o) => { if (!o) setShowUploadModal(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Attachment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">File</Label>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_ATTR}
                disabled={uploadMutation.isPending}
                onChange={(e) => setUploadForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
                className="block w-full text-sm mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Allowed: PDF, JPG, PNG, GIF, DOC, DOCX, XLS, XLSX, TXT. Max 25 MB.</p>
              {uploadForm.file && (
                <p className="text-xs text-muted-foreground mt-1">{uploadForm.file.name} ({formatSize(uploadForm.file.size)})</p>
              )}
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={uploadForm.category} onValueChange={(v) => setUploadForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={uploadForm.description}
                onChange={(e) => setUploadForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadModal(false)}>Cancel</Button>
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!uploadForm.file || uploadMutation.isPending}
              className="gap-1"
            >
              {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview modal */}
      <Dialog
        open={!!previewUrl}
        onOpenChange={(o) => {
          if (!o) {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
            setPreviewAtt(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>{previewAtt?.file_name}</DialogTitle></DialogHeader>
          {previewUrl && previewAtt?.file_type?.startsWith('image/') && (
            <img src={previewUrl} alt={previewAtt.file_name} className="max-h-[70vh] mx-auto" />
          )}
          {previewUrl && previewAtt?.file_type === 'application/pdf' && (
            <iframe src={previewUrl} title={previewAtt.file_name} className="w-full h-[70vh]" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DealAttachmentsTab;
