import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { listTemplates } from '@/services/documents/templates.service';
import {
  fetchAllFieldDictionaryOrdered,
  listTemplateFieldMapsWithFields,
  insertTemplateFieldMap,
  updateTemplateFieldMap,
  deleteTemplateFieldMap,
} from '@/services/documents/template-field-maps.service';
import { 
  Search, 
  Loader2, 
  Plus,
  Trash2,
  FileText,
  Key,
  ArrowLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Template {
  id: string;
  name: string;
  state: string | null;
  product_type: string | null;
  version: number;
}

interface FieldDictionary {
  id: string;
  field_key: string;
  label: string;
  section: string;
  data_type: string;
}

interface TemplateFieldMap {
  id: string;
  template_id: string;
  field_dictionary_id: string;
  required_flag: boolean;
  transform_rule: string | null;
  display_order: number;
  field?: FieldDictionary;
}

const TRANSFORM_RULES = [
  { value: 'none', label: 'None' },
  { value: 'uppercase', label: 'UPPERCASE' },
  { value: 'lowercase', label: 'lowercase' },
  { value: 'titlecase', label: 'Title Case' },
  { value: 'date_short', label: 'Date (MM/DD/YYYY)' },
  { value: 'date_long', label: 'Date (Month DD, YYYY)' },
  { value: 'currency', label: 'Currency ($X,XXX.XX)' },
  { value: 'currency_words', label: 'Currency (Words)' },
  { value: 'percentage', label: 'Percentage (X.XX%)' },
  { value: 'phone', label: 'Phone ((XXX) XXX-XXXX)' },
  { value: 'ssn_masked', label: 'SSN (XXX-XX-****)' },
];

const fieldMapsLoadInflight = new Map<string, Promise<void>>();

export const FieldMapEditorPage: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [fields, setFields] = useState<FieldDictionary[]>([]);
  const [fieldMaps, setFieldMaps] = useState<TemplateFieldMap[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'mapped' | 'add'>('mapped');
  const selectedTemplateRef = useRef('');
  const { toast } = useToast();

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchFieldMaps = useCallback(async (templateId: string) => {
    if (!templateId) return;

    const inflight = fieldMapsLoadInflight.get(templateId);
    if (inflight) return inflight;

    const job = (async () => {
      try {
        setMapsLoading(true);
        const data = await listTemplateFieldMapsWithFields(templateId);
        if (selectedTemplateRef.current !== templateId) return;

        setFieldMaps(
          (data || []).map((fm: Record<string, unknown>) => ({
            ...fm,
            field: fm.field_dictionary,
          })) as TemplateFieldMap[],
        );
      } catch (error) {
        console.error('Error fetching field maps:', error);
      } finally {
        if (selectedTemplateRef.current === templateId) {
          setMapsLoading(false);
        }
        fieldMapsLoadInflight.delete(templateId);
      }
    })();

    fieldMapsLoadInflight.set(templateId, job);
    return job;
  }, []);

  const handleTemplateChange = useCallback((templateId: string) => {
    selectedTemplateRef.current = templateId;
    setSelectedTemplateId(templateId);
    setViewMode('mapped');
  }, []);

  useEffect(() => {
    if (selectedTemplateId) {
      void fetchFieldMaps(selectedTemplateId);
    } else {
      selectedTemplateRef.current = '';
      setFieldMaps([]);
    }
  }, [selectedTemplateId, fetchFieldMaps]);

  const fetchInitialData = async () => {
    try {
      const [templatesData, allFields] = await Promise.all([
        listTemplates(true),
        fetchAllFieldDictionaryOrdered(),
      ]);

      setTemplates(templatesData as Template[]);
      setFields(allFields || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddField = async (fieldId: string) => {
    if (!selectedTemplateId) return;

    try {
      const maxOrder = fieldMaps.length > 0
        ? Math.max(...fieldMaps.map((fm) => fm.display_order))
        : -1;

      await insertTemplateFieldMap({
        template_id: selectedTemplateId,
        field_dictionary_id: fieldId,
        required_flag: false,
        display_order: maxOrder + 1,
      });
      fieldMapsLoadInflight.delete(selectedTemplateId);
      await fetchFieldMaps(selectedTemplateId);
      toast({ title: 'Field added to template' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add field',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveField = async (fieldMapId: string) => {
    try {
      await deleteTemplateFieldMap(fieldMapId, selectedTemplateId);
      if (selectedTemplateId) {
        fieldMapsLoadInflight.delete(selectedTemplateId);
        await fetchFieldMaps(selectedTemplateId);
      }
      toast({ title: 'Field removed from template' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to remove field',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateField = async (
    fieldMapId: string,
    updates: { required_flag?: boolean; transform_rule?: string | null }
  ) => {
    try {
      await updateTemplateFieldMap(fieldMapId, updates);

      setFieldMaps((prev) =>
        prev.map((fm) => (fm.id === fieldMapId ? { ...fm, ...updates } : fm))
      );
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update field',
        variant: 'destructive',
      });
    }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const mappedFieldIds = fieldMaps.map((fm) => fm.field_dictionary_id);
  const availableFields = fields.filter((f) => !mappedFieldIds.includes(f.id));

  const filteredAvailableFields = availableFields.filter(
    (f) =>
      f.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.field_key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group available fields by section
  const groupedFields = filteredAvailableFields.reduce((acc, field) => {
    const section = field.section;
    if (!acc[section]) acc[section] = [];
    acc[section].push(field);
    return acc;
  }, {} as Record<string, FieldDictionary[]>);

  // Filter mapped fields by search
  const filteredMappedFields = fieldMaps.filter(
    (fm) =>
      !searchQuery ||
      fm.field?.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      fm.field?.field_key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Template Field Mapping</h1>
        <p className="text-muted-foreground mt-1">Map fields from the dictionary to templates</p>
      </div>

      <div className="section-card mb-6">
        <div className="space-y-2">
          <Label>Select Template</Label>
          <Select value={selectedTemplateId} onValueChange={handleTemplateChange}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} v{t.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedTemplate && viewMode === 'mapped' && (
        <div className="section-card">
          {mapsLoading && (
            <div className="flex items-center justify-center py-8 mb-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <div className={cn(mapsLoading && 'opacity-50 pointer-events-none', 'flex items-center justify-between mb-4')}>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Mapped Fields</h3>
              <p className="text-sm text-muted-foreground">
                {fieldMaps.length} fields mapped to this template
              </p>
            </div>
            <Button onClick={() => setViewMode('add')} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Add Fields
            </Button>
          </div>

          {fieldMaps.length > 6 && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search mapped fields..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 max-w-sm"
              />
            </div>
          )}

          {fieldMaps.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No fields mapped yet</p>
              <Button onClick={() => setViewMode('add')} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Add Fields
              </Button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {filteredMappedFields.map((fm, idx) => (
                <div
                  key={fm.id}
                  className="p-3 rounded-lg border border-border bg-card"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground w-5">
                        {idx + 1}
                      </span>
                      <div>
                        <p className="font-medium text-foreground">
                          {fm.field?.label || fm.field?.field_key || 'Unknown field'}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {fm.field?.field_key || fm.field_dictionary_id}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveField(fm.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-4 mt-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={fm.required_flag}
                        onCheckedChange={(checked) =>
                          handleUpdateField(fm.id, { required_flag: checked })
                        }
                      />
                      <Label className="text-sm">Required</Label>
                    </div>
                    <div className="flex-1">
                      <Select
                        value={fm.transform_rule || 'none'}
                        onValueChange={(value) =>
                          handleUpdateField(fm.id, { transform_rule: value === 'none' ? null : value })
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {TRANSFORM_RULES.map((rule) => (
                            <SelectItem key={rule.value} value={rule.value}>
                              {rule.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedTemplate && viewMode === 'add' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Available Fields */}
          <div className="section-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Available Fields</h3>
              <span className="text-sm text-muted-foreground">
                {availableFields.length} fields
              </span>
            </div>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search fields..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="max-h-[500px] overflow-y-auto space-y-4">
              {Object.entries(groupedFields).map(([section, sectionFields]) => (
                <div key={section}>
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    {section.replace('_', ' ')}
                  </h4>
                  <div className="space-y-1">
                    {sectionFields.map((field) => (
                      <div
                        key={field.id}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium text-foreground">{field.label}</p>
                            <p className="text-xs text-muted-foreground font-mono">{field.field_key}</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAddField(field.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {Object.keys(groupedFields).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {searchQuery ? 'No matching fields found' : 'All fields have been mapped'}
                </p>
              )}
            </div>
          </div>

          {/* Mapped Fields */}
          <div className="section-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Mapped Fields</h3>
              <Button variant="outline" size="sm" onClick={() => { setViewMode('mapped'); setSearchQuery(''); }}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Done
              </Button>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {fieldMaps.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No fields mapped yet</p>
                  <p className="text-sm text-muted-foreground">
                    Add fields from the left panel
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {fieldMaps.map((fm, idx) => (
                    <div
                      key={fm.id}
                      className="p-3 rounded-lg border border-border bg-card"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground w-5">
                            {idx + 1}
                          </span>
                          <div>
                            <p className="font-medium text-foreground">
                              {fm.field?.label || fm.field?.field_key || 'Unknown field'}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {fm.field?.field_key || fm.field_dictionary_id}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveField(fm.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-4 mt-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={fm.required_flag}
                            onCheckedChange={(checked) =>
                              handleUpdateField(fm.id, { required_flag: checked })
                            }
                          />
                          <Label className="text-sm">Required</Label>
                        </div>
                        <div className="flex-1">
                          <Select
                            value={fm.transform_rule || 'none'}
                            onValueChange={(value) =>
                              handleUpdateField(fm.id, { transform_rule: value === 'none' ? null : value })
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {TRANSFORM_RULES.map((rule) => (
                                <SelectItem key={rule.value} value={rule.value}>
                                  {rule.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!selectedTemplateId && (
        <div className="section-card text-center py-16">
          <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold text-foreground mb-2">Select a Template</h3>
          <p className="text-muted-foreground">
            Choose a template above to configure its field mappings
          </p>
        </div>
      )}
    </div>
  );
};

export default FieldMapEditorPage;
