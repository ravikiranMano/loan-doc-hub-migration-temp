import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Tag,
  ArrowRight,
  RefreshCw,
  Pencil,
  Save,
  Trash2,
  Database,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { validateTemplate as invokeValidateTemplate } from '@/services/documents/template-validate.service';
import {
  listMergeTagAliasesByTagNames,
  updateMergeTagAlias,
  deleteMergeTagAlias,
} from '@/services/documents/merge-tag-aliases.service';
import { useToast } from '@/hooks/use-toast';

interface FieldDictionaryInfo {
  id: string;
  label: string;
  data_type: string;
  section: string;
  description: string | null;
}

interface FoundTag {
  tag: string;
  tagName: string;
  tagType: 'merge_tag' | 'label' | 'f_code' | 'curly_brace';
  fieldKey: string | null;
  mapped: boolean;
  suggestions?: string[];
  fieldDictionaryInfo?: FieldDictionaryInfo | null;
}

interface ValidationResult {
  valid: boolean;
  totalTagsFound: number;
  mappedTags: FoundTag[];
  unmappedTags: FoundTag[];
  warnings: string[];
  errors: string[];
  summary: {
    mergeTagCount: number;
    labelCount: number;
    fCodeCount: number;
    curlyBraceCount: number;
    mappedCount: number;
    unmappedCount: number;
  };
  documentText?: string;
}

interface MergeTagAlias {
  id: string;
  tag_name: string;
  field_key: string;
  tag_type: 'merge_tag' | 'label' | 'f_code';
  is_active: boolean;
  description: string | null;
}

interface TemplateDocumentViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
}

const tagTypeLabels: Record<string, { label: string; color: string }> = {
  merge_tag: { label: 'Merge Tag', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  label: { label: 'Label', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  f_code: { label: 'F-Code', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  curly_brace: { label: 'Curly Brace', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
};

export const TemplateDocumentViewerDialog: React.FC<TemplateDocumentViewerDialogProps> = ({
  open,
  onOpenChange,
  templateId,
  templateName,
}) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [aliases, setAliases] = useState<MergeTagAlias[]>([]);
  const [activeTab, setActiveTab] = useState('preview');
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ field_key: '', tag_type: 'merge_tag', is_active: true });
  const [saving, setSaving] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (open && templateId) {
      fetchData();
    }
  }, [open, templateId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const validationResult = await invokeValidateTemplate(templateId) as unknown as ValidationResult;
      setResult(validationResult);

      // Fetch all relevant merge tag aliases for tags in this template
      const allTagNames = [
        ...validationResult.mappedTags.map((t: FoundTag) => t.tagName),
        ...validationResult.unmappedTags.map((t: FoundTag) => t.tagName),
      ];

      if (allTagNames.length > 0) {
        const aliasData = await listMergeTagAliasesByTagNames(allTagNames);
        setAliases(aliasData as MergeTagAlias[]);
      }
    } catch (error: any) {
      console.error('Error fetching template data:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load template data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditAlias = (alias: MergeTagAlias) => {
    setEditingAlias(alias.id);
    setEditForm({
      field_key: alias.field_key,
      tag_type: alias.tag_type,
      is_active: alias.is_active,
    });
  };

  const handleSaveAlias = async (aliasId: string) => {
    setSaving(true);
    try {
      const tagType = editForm.tag_type as 'merge_tag' | 'f_code' | 'label';
      await updateMergeTagAlias(aliasId, {
        field_key: editForm.field_key,
        tag_type: tagType,
        is_active: editForm.is_active,
      });

      toast({ title: 'Mapping updated successfully' });
      setEditingAlias(null);
      await fetchData(); // Refresh data
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update mapping',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAlias = async (aliasId: string, tagName: string) => {
    if (!confirm(`Delete mapping for "${tagName}"?`)) return;
    
    setSaving(true);
    try {
      await deleteMergeTagAlias(aliasId);

      toast({ title: 'Mapping deleted' });
      await fetchData(); // Refresh data
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete mapping',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const highlightTags = (text: string) => {
    if (!text || !result) return text;
    
    // Find all tag patterns and highlight them
    const allTags = [...result.mappedTags, ...result.unmappedTags];
    let highlightedText = text;
    
    for (const tag of allTags) {
      const escapedTag = tag.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedTag, 'g');
      const isMapped = tag.mapped;
    const className = isMapped 
        ? 'bg-success/30 dark:bg-success/20 text-success-foreground px-1 rounded font-mono text-sm'
        : 'bg-destructive/30 dark:bg-destructive/20 text-destructive-foreground px-1 rounded font-mono text-sm';
      
      highlightedText = highlightedText.replace(regex, `<span class="${className}">${tag.tag}</span>`);
    }
    
    return highlightedText;
  };

  const filteredMappedTags = result?.mappedTags.filter(tag => 
    !searchFilter || 
    tag.tagName.toLowerCase().includes(searchFilter.toLowerCase()) ||
    tag.fieldKey?.toLowerCase().includes(searchFilter.toLowerCase())
  ) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Template Document: {templateName}
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>View document content, tag mappings, and edit configurations</span>
            {!loading && (
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchData}
                disabled={loading}
                className="h-7"
              >
                <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
                Refresh
              </Button>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary mb-4" />
              <p className="text-muted-foreground">Loading template content...</p>
            </div>
          </div>
        ) : result ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="preview" className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                Document Preview
              </TabsTrigger>
              <TabsTrigger value="mappings" className="flex items-center gap-1">
                <Database className="h-4 w-4" />
                Tag Mappings
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                  {result.mappedTags.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="edit" className="flex items-center gap-1">
                <Pencil className="h-4 w-4" />
                Edit Mappings
              </TabsTrigger>
            </TabsList>

            {/* Document Preview Tab */}
            <TabsContent value="preview" className="flex-1 mt-4 min-h-0">
              <ScrollArea className="h-[450px] border rounded-lg p-4 bg-muted/20">
                {result.documentText ? (
                  <div 
                    className="whitespace-pre-wrap text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: highlightTags(result.documentText) }}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No document text available</p>
                    <p className="text-xs mt-1">The template may not contain extractable text content</p>
                  </div>
                )}
              </ScrollArea>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-success/30"></span>
                  Mapped tags
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-destructive/30"></span>
                  Unmapped tags
                </span>
              </div>
            </TabsContent>

            {/* Tag Mappings Tab */}
            <TabsContent value="mappings" className="flex-1 mt-4 min-h-0">
              <div className="mb-3">
                <Input
                  placeholder="Search tags or field keys..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="h-9"
                />
              </div>
              <ScrollArea className="h-[400px] pr-4">
                {filteredMappedTags.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No mapped tags found
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredMappedTags.map((tag, index) => (
                      <div
                        key={index}
                        className="border rounded-lg p-4 bg-card"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <Tag className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                            {tag.tagName}
                          </code>
                          <Badge className={cn("text-xs", tagTypeLabels[tag.tagType]?.color)}>
                            {tagTypeLabels[tag.tagType]?.label}
                          </Badge>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          <code className="text-sm font-mono text-success">
                            {tag.fieldKey}
                          </code>
                          <CheckCircle2 className="h-4 w-4 text-success ml-auto" />
                        </div>
                        
                        {tag.fieldDictionaryInfo && (
                          <div className="ml-7 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div className="bg-muted/50 rounded px-2 py-1">
                              <span className="text-muted-foreground">Label: </span>
                              <span className="font-medium">{tag.fieldDictionaryInfo.label}</span>
                            </div>
                            <div className="bg-muted/50 rounded px-2 py-1">
                              <span className="text-muted-foreground">Type: </span>
                              <span className="font-medium">{tag.fieldDictionaryInfo.data_type}</span>
                            </div>
                            <div className="bg-muted/50 rounded px-2 py-1">
                              <span className="text-muted-foreground">Section: </span>
                              <span className="font-medium">{tag.fieldDictionaryInfo.section}</span>
                            </div>
                            {tag.fieldDictionaryInfo.description && (
                              <div className="bg-muted/50 rounded px-2 py-1 col-span-2 md:col-span-1">
                                <span className="text-muted-foreground">Info: </span>
                                <span className="font-medium truncate">{tag.fieldDictionaryInfo.description}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Edit Mappings Tab */}
            <TabsContent value="edit" className="flex-1 mt-4 min-h-0">
              <ScrollArea className="h-[450px] pr-4">
                {aliases.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Pencil className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No editable mappings found</p>
                    <p className="text-xs mt-1">Mappings will appear here once tags are mapped</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {aliases.map((alias) => (
                      <div
                        key={alias.id}
                        className={cn(
                          "border rounded-lg p-4",
                          !alias.is_active && "opacity-60 bg-muted/30"
                        )}
                      >
                        {editingAlias === alias.id ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                                {alias.tag_name}
                              </code>
                              <ArrowRight className="h-4 w-4 text-muted-foreground" />
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Field Key</Label>
                                <Input
                                  value={editForm.field_key}
                                  onChange={(e) => setEditForm({ ...editForm, field_key: e.target.value })}
                                  className="h-8 text-sm"
                                  placeholder="e.g., borrower.name"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Tag Type</Label>
                                <Select
                                  value={editForm.tag_type}
                                  onValueChange={(value) => setEditForm({ ...editForm, tag_type: value as any })}
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="merge_tag">Merge Tag</SelectItem>
                                    <SelectItem value="f_code">F-Code</SelectItem>
                                    <SelectItem value="label">Label</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-end gap-2">
                                <div className="flex items-center gap-2">
                                  <Switch
                                    checked={editForm.is_active}
                                    onCheckedChange={(checked) => setEditForm({ ...editForm, is_active: checked })}
                                  />
                                  <Label className="text-xs">Active</Label>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingAlias(null)}
                                disabled={saving}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleSaveAlias(alias.id)}
                                disabled={saving || !editForm.field_key.trim()}
                              >
                                {saving ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                ) : (
                                  <Save className="h-4 w-4 mr-1" />
                                )}
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                              {alias.tag_name}
                            </code>
                            <Badge className={cn("text-xs", tagTypeLabels[alias.tag_type]?.color)}>
                              {tagTypeLabels[alias.tag_type]?.label}
                            </Badge>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                            <code className="text-sm font-mono text-primary flex-1">
                              {alias.field_key}
                            </code>
                            {!alias.is_active && (
                              <Badge variant="outline" className="text-xs">Inactive</Badge>
                            )}
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditAlias(alias)}
                                disabled={saving}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteAlias(alias.id, alias.tag_name)}
                                disabled={saving}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : null}

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateDocumentViewerDialog;
