import React, { useState, useEffect, useRef } from 'react';
import { format, parse } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { StickyNote, Paperclip, X, CalendarIcon } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RichTextEditor } from './RichTextEditor';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TypableDateField } from '@/components/ui/typable-date-field';
import { parseDisplayDate, formatDateOnly } from '@/lib/dateOnly';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { hasModalFormData } from '@/lib/modalFormValidation';
import type { NoteData, AttachmentMeta } from './NotesTableView';
import { getAttachmentName } from './NotesTableView';

interface NotesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note?: NoteData | null;
  onSave: (note: NoteData) => void;
  isEdit?: boolean;
  defaultAccount?: string;
  defaultName?: string;
  dealId?: string;
}

const formatDateTimeDisplay = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
  } catch { return isoStr; }
};

const getEmptyNote = (defaultAccount: string, defaultName: string): NoteData => {
  const now = new Date();
  return {
    id: `notes_entry_${Date.now()}`,
    highPriority: false,
    incoming: false,
    outgoing: false,
    date: now.toISOString(),
    asOfDate: now.toISOString(),
    account: defaultAccount,
    name: defaultName,
    reference: '',
    content: '',
    type: '',
    attachments: [],
    followupReminder: '',
    completed: '',
    assignedOn: '',
    assignedTo: '',
    assignedDepartment: '',
    assignedBy: defaultName,
    completedBy: '',
    completedOn: '',
    publish: false,
    addToParticipants: false,
  };
};

const NOTE_TYPES_FALLBACK = ['Conversation Log', 'Attorney / Client', 'Internal'];

export const NotesModal: React.FC<NotesModalProps> = ({
  open, onOpenChange, note, onSave, isEdit = false, defaultAccount = '', defaultName = '', dealId = '',
}) => {
  const [formData, setFormData] = useState<NoteData>(getEmptyNote(defaultAccount, defaultName));
  const [noteTypes, setNoteTypes] = useState<string[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTypesLoading(true);
    (supabase as any)
      .from('conversation_log_types')
      .select('label')
      .eq('is_active', true)
      .order('display_order')
      .then(({ data, error }: { data: any[] | null; error: any }) => {
        if (error || !data?.length) {
          setNoteTypes(NOTE_TYPES_FALLBACK);
        } else {
          setNoteTypes(data.map((r: any) => r.label));
        }
        setTypesLoading(false);
      });
  }, [open]);

  useEffect(() => {
    if (open) {
      setFormData(note ? { ...note, attachments: note.attachments || [], asOfDate: note.asOfDate || '' } : getEmptyNote(defaultAccount, defaultName));
      setPendingFiles([]);
    }
  }, [open, note, defaultAccount, defaultName]);

  const asOfDateObj = formData.asOfDate ? (() => {
    try {
      const d = new Date(formData.asOfDate);
      return isNaN(d.getTime()) ? undefined : d;
    } catch { return undefined; }
  })() : undefined;

  const [asOfDateOpen, setAsOfDateOpen] = useState(false);
  const upstreamAsOfDisplay = formData.asOfDate ? formatDateTimeDisplay(formData.asOfDate) : '';
  const [asOfTyped, setAsOfTyped] = useState(upstreamAsOfDisplay);
  const lastSelfAsOfRef = useRef(formData.asOfDate);
  useEffect(() => {
    if (formData.asOfDate !== lastSelfAsOfRef.current) {
      setAsOfTyped(upstreamAsOfDisplay);
      lastSelfAsOfRef.current = formData.asOfDate;
    }
  }, [formData.asOfDate, upstreamAsOfDisplay]);

  const commitAsOf = (text: string) => {
    const t = (text || '').trim();
    if (!t) {
      lastSelfAsOfRef.current = '';
      setFormData(prev => ({ ...prev, asOfDate: '' }));
      return;
    }
    // Try MM/DD/YYYY [HH:mm[:ss]]
    const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const [, mm, dd, yyRaw, hh, mi, ss] = m;
      const yy = yyRaw.length === 2 ? 2000 + parseInt(yyRaw, 10) : parseInt(yyRaw, 10);
      const d = new Date(yy, parseInt(mm, 10) - 1, parseInt(dd, 10));
      if (!isNaN(d.getTime())) {
        const existing = formData.asOfDate ? new Date(formData.asOfDate) : new Date();
        d.setHours(hh != null ? parseInt(hh, 10) : (isNaN(existing.getTime()) ? new Date().getHours() : existing.getHours()));
        d.setMinutes(mi != null ? parseInt(mi, 10) : (isNaN(existing.getTime()) ? new Date().getMinutes() : existing.getMinutes()));
        d.setSeconds(ss != null ? parseInt(ss, 10) : (isNaN(existing.getTime()) ? new Date().getSeconds() : existing.getSeconds()));
        const iso = d.toISOString();
        lastSelfAsOfRef.current = iso;
        setAsOfTyped(formatDateTimeDisplay(iso));
        setFormData(prev => ({ ...prev, asOfDate: iso }));
        return;
      }
    }
    // Invalid: revert to upstream
    setAsOfTyped(upstreamAsOfDisplay);
  };

  const handleAsOfDateSelect = (date: Date | undefined) => {
    if (date) {
      const existing = formData.asOfDate ? new Date(formData.asOfDate) : new Date();
      const hasValidTime = !isNaN(existing.getTime());
      date.setHours(hasValidTime ? existing.getHours() : new Date().getHours());
      date.setMinutes(hasValidTime ? existing.getMinutes() : new Date().getMinutes());
      date.setSeconds(hasValidTime ? existing.getSeconds() : new Date().getSeconds());
      setFormData(prev => ({ ...prev, asOfDate: date.toISOString() }));
    } else {
      setFormData(prev => ({ ...prev, asOfDate: '' }));
    }
    setAsOfDateOpen(false);
  };

  const formatAsOfDisplay = (isoDate: string) => {
    if (!isoDate) return '';
    try {
      const d = new Date(isoDate);
      if (isNaN(d.getTime())) return isoDate;
      return formatDateTimeDisplay(isoDate);
    } catch { return isoDate; }
  };

  const uploadFilesToStorage = async (files: File[], noteId: string): Promise<AttachmentMeta[]> => {
    const results: AttachmentMeta[] = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `deal/${dealId || 'unknown'}/${noteId}/${Date.now()}_${safeName}`;
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

  const isFormFilled = hasModalFormData(formData, ['id', 'date', 'asOfDate', 'account', 'name']);

  const handleSaveClick = () => setShowConfirm(true);

  const handleConfirmSave = async () => {
    setShowConfirm(false);
    setUploading(true);
    let finalAttachments = [...formData.attachments];

    if (pendingFiles.length > 0) {
      const uploaded = await uploadFilesToStorage(pendingFiles, formData.id);
      const existingPersisted = formData.attachments.filter(
        att => typeof att === 'object' && att.storagePath
      );
      finalAttachments = [...existingPersisted, ...uploaded];
    }

    onSave({ ...formData, attachments: finalAttachments });
    setPendingFiles([]);
    setUploading(false);
    onOpenChange(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const fileArr = Array.from(files);
    setPendingFiles(prev => [...prev, ...fileArr]);
    const newMetas: AttachmentMeta[] = fileArr.map(f => ({ name: f.name, storagePath: '', uploadedAt: '' }));
    setFormData(prev => ({ ...prev, attachments: [...prev.attachments, ...newMetas] }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    const att = formData.attachments[index];
    if (typeof att === 'object' && !att.storagePath) {
      const pendingIdx = pendingFiles.findIndex(f => f.name === att.name);
      if (pendingIdx >= 0) {
        setPendingFiles(prev => prev.filter((_, i) => i !== pendingIdx));
      }
    }
    setFormData(prev => ({ ...prev, attachments: prev.attachments.filter((_, i) => i !== index) }));
  };

  const renderDatePickerField = (field: 'followupReminder' | 'completed' | 'assignedOn' | 'completedOn') => {
    const rawVal = formData[field] as string;
    const dateObj = rawVal ? (() => { try { const d = new Date(rawVal); return isNaN(d.getTime()) ? undefined : d; } catch { return undefined; } })() : undefined;
    const canonical = dateObj ? formatDateOnly(dateObj) : '';
    return (
      <TypableDateField
        value={canonical}
        onChange={(c) => {
          if (!c) {
            setFormData(prev => ({ ...prev, [field]: '' }));
            return;
          }
          const p = parseDisplayDate(c) || (() => { const [y, m, d] = c.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); })();
          setFormData(prev => ({ ...prev, [field]: p.toISOString() }));
        }}
        className="flex-1"
        inputClassName="h-7 text-xs"
        buttonClassName="h-6 w-6"
      />
    );
  };

  const renderInlineField = (field: keyof NoteData, label: string, props: Record<string, any> = {}) => (
    <div className="flex items-center gap-2">
      <Label className="w-[100px] shrink-0 text-xs text-foreground">{label}</Label>
      <Input
        value={formData[field] as string}
        onChange={(e) => setFormData(prev => ({ ...prev, [field]: e.target.value }))}
        className="h-7 text-xs flex-1"
        {...props}
      />
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-0"
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('[data-radix-popper-content-wrapper]')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader className="shrink-0 px-4 pt-4 pb-2 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <StickyNote className="h-4 w-4 text-primary" />
              {isEdit ? 'Edit Conversation Log' : 'Add New Conversation Log'}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-4 py-3 space-y-3 min-w-0">
            {/* High Priority + Incoming/Outgoing row */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={formData.highPriority}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, highPriority: !!checked }))}
                />
                <Label className="text-xs text-foreground">High Priority</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={formData.incoming}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, incoming: !!checked }))}
                />
                <Label className="text-xs text-foreground">Incoming</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={formData.outgoing}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, outgoing: !!checked }))}
                />
                <Label className="text-xs text-foreground">Outgoing</Label>
              </div>
            </div>

            {/* Date-Time / As Of row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs text-foreground">Date - Time</Label>
                <Input
                  value={formatDateTimeDisplay(formData.date)}
                  readOnly
                  disabled
                  className="h-7 text-xs flex-1 bg-muted"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs text-foreground">As Of</Label>
                <div className="relative flex-1">
                  <Input
                    value={asOfTyped}
                    onChange={(e) => setAsOfTyped(e.target.value)}
                    onBlur={() => commitAsOf(asOfTyped)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAsOf(asOfTyped); } }}
                    placeholder="MM/DD/YYYY HH:MM:SS"
                    className="h-7 text-xs flex-1 pr-7"
                  />
                  <Popover modal={true} open={asOfDateOpen} onOpenChange={setAsOfDateOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label="Open calendar"
                        className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                      >
                        <CalendarIcon className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 pointer-events-auto z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={asOfDateObj}
                      onSelect={handleAsOfDateSelect}
                      showClearToday={false}
                      initialFocus
                    />
                    <div className="flex items-center gap-1 px-3 pb-3 border-t border-border pt-2">
                      <Label className="text-xs text-muted-foreground mr-1">Time:</Label>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={asOfDateObj ? String(asOfDateObj.getHours()).padStart(2, '0') : '00'}
                        onChange={(e) => {
                          const h = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                          const d = asOfDateObj ? new Date(asOfDateObj) : new Date();
                          d.setHours(h);
                          setFormData(prev => ({ ...prev, asOfDate: d.toISOString() }));
                        }}
                        className="h-7 w-12 text-xs text-center px-1"
                      />
                      <span className="text-xs text-muted-foreground">:</span>
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        value={asOfDateObj ? String(asOfDateObj.getMinutes()).padStart(2, '0') : '00'}
                        onChange={(e) => {
                          const m = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                          const d = asOfDateObj ? new Date(asOfDateObj) : new Date();
                          d.setMinutes(m);
                          setFormData(prev => ({ ...prev, asOfDate: d.toISOString() }));
                        }}
                        className="h-7 w-12 text-xs text-center px-1"
                      />
                      <span className="text-xs text-muted-foreground">:</span>
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        value={asOfDateObj ? String(asOfDateObj.getSeconds()).padStart(2, '0') : '00'}
                        onChange={(e) => {
                          const s = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                          const d = asOfDateObj ? new Date(asOfDateObj) : new Date();
                          d.setSeconds(s);
                          setFormData(prev => ({ ...prev, asOfDate: d.toISOString() }));
                        }}
                        className="h-7 w-12 text-xs text-center px-1"
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Account / Contact row */}
            <div className="grid grid-cols-2 gap-4">
              {renderInlineField('account', 'Account')}
              {renderInlineField('name', 'Contact')}
            </div>

            {/* Type / Reference row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs text-foreground">Type</Label>
                <Select
                  value={formData.type || undefined}
                  onValueChange={(val) => setFormData(prev => ({ ...prev, type: val }))}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]">
                    {noteTypes.length > 0 ? noteTypes.map(t => (
                      <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                    )) : (
                      <SelectItem value="__none__" disabled className="text-xs text-muted-foreground">No options available</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {renderInlineField('reference', 'Reference')}
            </div>

            {/* Conversation Log */}
            <div className="space-y-1 shrink-0">
              <Label className="text-xs text-foreground">Conversation Log</Label>
              <div className="h-[200px] border border-border rounded-md overflow-hidden">
                <RichTextEditor
                  value={formData.content}
                  onChange={(val) => setFormData(prev => ({ ...prev, content: val }))}
                  placeholder="Enter conversation log content..."
                  minHeight="60px"
                />
              </div>
            </div>

            {/* Attachments */}
            <div className="space-y-2 overflow-hidden min-w-0">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-foreground">Attachments</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="h-3 w-3" />
                  Attach File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept=".doc,.docx,.xls,.xlsx,.pdf,.csv,.txt,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                />
              </div>
              {formData.attachments.length > 0 ? (
                <div className="space-y-1 overflow-hidden">
                  {formData.attachments.map((att, idx) => (
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => removeAttachment(idx)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No attachments available</p>
              )}
            </div>

            {/* Followup Reminder / Completed */}
            <div className="border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Label className="w-[120px] shrink-0 text-xs text-foreground">Followup Reminder</Label>
                  {renderDatePickerField('followupReminder')}
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[100px] shrink-0 text-xs text-foreground">Completed</Label>
                  {renderDatePickerField('completed')}
                </div>
              </div>
            </div>

            {/* Create Action Item */}
            <div className="border-t border-border pt-3">
              <Label className="text-xs font-semibold text-foreground">Create Action Item</Label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
                <div className="flex items-center gap-2">
                  <Label className="w-[100px] shrink-0 text-xs text-foreground">Assigned on</Label>
                  {renderDatePickerField('assignedOn')}
                </div>
                <div className="flex items-center gap-2">
                  <Label className="shrink-0 text-xs text-foreground">to</Label>
                  <Select
                    value={formData.assignedTo || undefined}
                    onValueChange={(val) => setFormData(prev => ({ ...prev, assignedTo: val }))}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]">
                      <SelectItem value="csr1" className="text-xs">CSR 1</SelectItem>
                      <SelectItem value="csr2" className="text-xs">CSR 2</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label className="shrink-0 text-xs text-foreground">or</Label>
                  <Select
                    value={formData.assignedDepartment || undefined}
                    onValueChange={(val) => setFormData(prev => ({ ...prev, assignedDepartment: val }))}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]">
                      <SelectItem value="servicing" className="text-xs">Servicing</SelectItem>
                      <SelectItem value="origination" className="text-xs">Origination</SelectItem>
                      <SelectItem value="accounting" className="text-xs">Accounting</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
                <div className="flex items-center gap-2">
                  <Label className="w-[100px] shrink-0 text-xs text-foreground">By</Label>
                  <Input
                    value={formData.assignedBy}
                    readOnly
                    disabled
                    className="h-7 text-xs flex-1 bg-muted"
                    placeholder="Auto-populates"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="shrink-0 text-xs text-foreground">Completed By</Label>
                  <Select
                    value={formData.completedBy || undefined}
                    onValueChange={(val) => setFormData(prev => ({ ...prev, completedBy: val }))}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]">
                      <SelectItem value="csr1" className="text-xs">CSR 1</SelectItem>
                      <SelectItem value="csr2" className="text-xs">CSR 2</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label className="shrink-0 text-xs text-foreground">on</Label>
                  {renderDatePickerField('completedOn')}
                </div>
              </div>
            </div>

            {/* Publish / Add to Participants */}
            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={formData.publish}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, publish: !!checked }))}
                />
                <Label className="text-xs text-foreground">Publish</Label>
                
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={formData.addToParticipants}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, addToParticipants: !!checked }))}
                />
                <Label className="text-xs text-foreground">Add to Participants</Label>
                
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 px-4 py-3 border-t border-border bg-background">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveClick} disabled={uploading || !isFormFilled}>{uploading ? 'Uploading...' : 'OK'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default NotesModal;
