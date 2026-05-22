import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { subscribePostgresChanges } from '@/services/supabase/realtime';
import { fetchDealById } from '@/services/deals/deals.service';
import {
  generateDocument,
  generateDocumentV2,
  getFieldDataV2,
  previewDocumentPayload,
  type DocumentPayloadPreviewResult,
  type FieldDataV2Result,
  listGeneratedDocuments,
  listGenerationJobs,
  downloadGeneratedDoc,
} from '@/services/documents/generation.service';
import { SessionExpiredError } from '@/services/node-api/client';
import { listTemplates, updateTemplate, uploadTemplateDocx } from '@/services/documents/templates.service';
import {
  listActivePackets,
  fetchPacketById,
  listPacketTemplatesWithJoin,
} from '@/services/documents/packets.service';
import { fetchProfilesByUserIds } from '@/services/admin/profiles.service';
import { useAuth } from '@/contexts/AuthContext';
import { 
  ArrowLeft, 
  Loader2, 
  Package, 
  FileText,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Download,
  RefreshCw,
  Play,
  Clock,
  XCircle,
  FileOutput,
  File,
  ChevronDown,
  ChevronRight,
  History,
  User,
  Eye,
  Upload,
  ArrowUpDown,
  Filter,
  Search,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface Deal {
  id: string;
  deal_number: string;
  state: string;
  product_type: string;
  status: 'draft' | 'ready' | 'generated';
  packet_id: string | null;
}

interface Packet {
  id: string;
  name: string;
  description: string | null;
  all_states?: boolean;
  states?: string[];
}

interface Template {
  id: string;
  name: string;
  file_path: string | null;
  version: number;
}

interface PacketTemplate {
  template_id: string;
  display_order: number;
  is_required: boolean;
  templates: Template;
}

interface Profile {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface GeneratedDocument {
  id: string;
  template_id: string;
  template_name: string | null;
  packet_id: string | null;
  packet_name: string | null;
  generation_batch_id: string | null;
  output_docx_path: string;
  output_pdf_path: string | null;
  output_type: 'docx_only' | 'docx_and_pdf';
  version_number: number;
  generation_status: 'queued' | 'running' | 'success' | 'failed';
  error_message: string | null;
  created_at: string;
  created_by: string;
}

interface GenerationJob {
  id: string;
  request_type: 'single_doc' | 'packet';
  status: 'queued' | 'running' | 'success' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

type OutputType = 'docx_only' | 'docx_and_pdf';

const statusConfig = {
  queued: { label: 'Queued', color: 'text-muted-foreground', bgColor: 'bg-muted', icon: Clock },
  running: { label: 'Running', color: 'text-primary', bgColor: 'bg-primary/10', icon: Loader2 },
  success: { label: 'Success', color: 'text-success', bgColor: 'bg-success/10', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'text-destructive', bgColor: 'bg-destructive/10', icon: XCircle },
};

export const DealDocumentsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role } = useAuth();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [packetTemplates, setPacketTemplates] = useState<PacketTemplate[]>([]);
  const [allTemplates, setAllTemplates] = useState<Template[]>([]);
  const [availablePackets, setAvailablePackets] = useState<Packet[]>([]);
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const [selectedPacketTemplates, setSelectedPacketTemplates] = useState<PacketTemplate[]>([]);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [recentJobs, setRecentJobs] = useState<GenerationJob[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingV2, setGeneratingV2] = useState(false);
  const [previewMode, setPreviewMode] = useState<'legacy' | 'v2'>('legacy');
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [outputType, setOutputType] = useState<OutputType>('docx_only');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<DocumentPayloadPreviewResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState('');
  const [generationMode, setGenerationMode] = useState<'single' | 'packet'>('packet');
  const [expandedTemplates, setExpandedTemplates] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>('generate');
  // History filters & sorting
  const [historySortField, setHistorySortField] = useState<'date' | 'template' | 'packet' | 'user'>('date');
  const [historySortDir, setHistorySortDir] = useState<'asc' | 'desc'>('desc');
  const [historyFilterSearch, setHistoryFilterSearch] = useState('');
  const [historyFilterType, setHistoryFilterType] = useState<'all' | 'template' | 'packet'>('all');

  const isCsr = role === 'csr' || role === 'admin';
  const isAdminViewOnly = role === 'admin';
  const canGenerate = (role === 'csr' || role === 'admin') && (deal?.status === 'ready' || deal?.status === 'generated');

  const initialLoadDone = useRef(false);
  const realtimeDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const runningJobsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (id) {
      fetchDataInitial();
    }
  }, [id]);

  // Subscribe to real-time updates for generated documents
  useEffect(() => {
    if (!id) return;

    const docsSub = subscribePostgresChanges({
      channelName: `generated-docs-changes-${id}`,
      table: 'generated_documents',
      filter: `deal_id=eq.${id}`,
      onChange: debouncedBackgroundRefresh,
    });
    const jobsSub = subscribePostgresChanges({
      channelName: `generation-jobs-changes-${id}`,
      table: 'generation_jobs',
      filter: `deal_id=eq.${id}`,
      onChange: debouncedBackgroundRefresh,
    });

    return () => {
      docsSub.unsubscribe();
      jobsSub.unsubscribe();
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
    };
  }, [id]);

  useEffect(() => {
    const hasRunningJobs = recentJobs.some(job => job.status === 'running');

    if (!hasRunningJobs) {
      if (runningJobsPollRef.current) {
        clearInterval(runningJobsPollRef.current);
        runningJobsPollRef.current = null;
      }
      return;
    }

    if (runningJobsPollRef.current) return;

    runningJobsPollRef.current = setInterval(() => {
      refreshDataInBackground();
    }, 4000);

    return () => {
      if (runningJobsPollRef.current) {
        clearInterval(runningJobsPollRef.current);
        runningJobsPollRef.current = null;
      }
    };
  }, [recentJobs]);

  const debouncedBackgroundRefresh = useCallback(() => {
    if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
    realtimeDebounceRef.current = setTimeout(() => {
      refreshDataInBackground();
    }, 500);
  }, [id]);

  // Initial load — sets loading=true, shows spinner
  const fetchDataInitial = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchDeal(),
        fetchGeneratedDocuments(),
        fetchRecentJobs(),
      ]);
      initialLoadDone.current = true;
    } finally {
      setLoading(false);
    }
  };

  // Background refresh — does NOT set loading, preserves UI state
  const refreshDataInBackground = async () => {
    try {
      await Promise.all([
        fetchGeneratedDocuments(),
        fetchRecentJobs(),
      ]);
    } catch (err) {
      console.error('Background refresh error:', err);
    }
  };

  // Full background refresh including deal data (for after upload)
  const refreshAllInBackground = async () => {
    try {
      await Promise.all([
        fetchDeal(),
        fetchGeneratedDocuments(),
        fetchRecentJobs(),
      ]);
    } catch (err) {
      console.error('Background refresh error:', err);
    }
  };

  const fetchDeal = async () => {
    const dealData = await fetchDealById(id!);
    setDeal(dealData);

    const [templatesData, packetsData] = await Promise.all([
      listTemplates(true, 'id, name, file_path, version'),
      listActivePackets(),
    ]);

    setAllTemplates(templatesData as Template[]);
    setAvailablePackets(packetsData as Packet[]);

    if (dealData.packet_id) {
      const packetData = await fetchPacketById(dealData.packet_id);
      setPacket(packetData);

      const ptData = await listPacketTemplatesWithJoin(dealData.packet_id);
      setPacketTemplates(ptData as any);
    }
  };

  const fetchGeneratedDocuments = async () => {
    const data = await listGeneratedDocuments(id!);
    setGeneratedDocuments(data || []);

    if (data.length > 0) {
      const creatorIds = [
        ...new Set(data.map((d) => d.created_by).filter((id): id is string => Boolean(id))),
      ];
      if (creatorIds.length > 0) {
        const profilesData = await fetchProfilesByUserIds(creatorIds);
        const profilesMap = new Map(profilesData.map((p) => [p.user_id, p]));
        setProfiles(profilesMap);
      }
    }
  };

  const fetchRecentJobs = async () => {
    const data = await listGenerationJobs(id!);
    setRecentJobs((data || []).slice(0, 5));
  };

  const handleGenerateClick = (mode: 'single' | 'packet', templateId?: string) => {
    setGenerationMode(mode);
    setSelectedTemplateId(templateId || null);
    setShowConfirmDialog(true);
  };

  const handlePreviewPayload = async () => {
    if (!id || !selectedTemplateId) return;
    setPreviewMode('legacy');
    setPreviewLoading(true);
    setPreviewResult(null);
    setPreviewFilter('');
    setShowPreviewDialog(true);
    try {
      const result = await previewDocumentPayload(id, selectedTemplateId);
      setPreviewResult(result);
    } catch (error: unknown) {
      if (error instanceof SessionExpiredError) return;
      const message = error instanceof Error ? error.message : 'Failed to load merge payload';
      toast({ title: 'Preview failed', description: message, variant: 'destructive' });
      setShowPreviewDialog(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerateV2 = async () => {
    if (!id || !selectedTemplateId) return;
    setGeneratingV2(true);
    try {
      const filename = await generateDocumentV2(id, selectedTemplateId);
      toast({ title: 'Downloaded (v2)', description: filename });
    } catch (error: unknown) {
      if (error instanceof SessionExpiredError) return;
      const message = error instanceof Error ? error.message : 'v2 generation failed';
      toast({ title: 'Generate (v2) Failed', description: message, variant: 'destructive' });
    } finally {
      setGeneratingV2(false);
    }
  };

  const handleInspectFieldData = async () => {
    if (!id || !selectedTemplateId) return;
    setPreviewMode('v2');
    setPreviewLoading(true);
    setPreviewResult(null);
    setPreviewFilter('');
    setShowPreviewDialog(true);
    try {
      const result = await getFieldDataV2(id, selectedTemplateId);
      // Adapt v2 response to the existing preview result shape
      const tagKeys = result.metadata.templateTagKeys ?? [];
      setPreviewResult({
        dealId: result.metadata.dealId,
        dealNumber: result.metadata.dealNumber,
        templateId: result.metadata.templateId,
        templateName: result.metadata.templateName,
        fieldCount: result.metadata.templateResolvedCount ?? result.metadata.resolvedCount,
        totalKeysInMap: tagKeys.length || result.metadata.fieldMapCount,
        templateConditions: result.metadata.templateConditions,
        data: Object.fromEntries(
          Object.entries(result.data)
            .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
            .map(([k, v]) => [k, String(v)])
        ) as Record<string, string>,
      });
    } catch (error: unknown) {
      if (error instanceof SessionExpiredError) return;
      const message = error instanceof Error ? error.message : 'Failed to load field data';
      toast({ title: 'Field data (v2) failed', description: message, variant: 'destructive' });
      setShowPreviewDialog(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewJsonDisplay = useMemo(() => {
    if (!previewResult?.data) return '';
    const filter = previewFilter.trim().toLowerCase();
    const entries = Object.entries(previewResult.data)
      .filter(([k]) => !filter || k.toLowerCase().includes(filter))
      .sort(([a], [b]) => a.localeCompare(b));
    const payload: Record<string, unknown> = { fields: Object.fromEntries(entries) };
    if (previewMode === 'v2' && previewResult.templateConditions?.length) {
      payload.conditions = previewResult.templateConditions;
    }
    return JSON.stringify(payload, null, 2);
  }, [previewResult, previewFilter, previewMode]);

  const handleGenerate = async () => {
    setShowConfirmDialog(false);
    setGenerating(true);

    try {
      const body: { outputType: string; templateId?: string; packetId?: string } = {
        outputType,
      };

      if (generationMode === 'single' && selectedTemplateId) {
        body.templateId = selectedTemplateId;
      } else {
        if (!selectedPacketId) throw new Error('Please select a packet before generating.');
        body.packetId = selectedPacketId;
      }

      const result = await generateDocument(deal!.id, body);

      if (result.status === 'running' && result.jobId) {
        toast({
          title: 'Generation Started',
          description: 'Documents are being processed in the background and will appear here automatically when ready.',
        });
      } else if (result.failCount === 0 && result.successCount > 0) {
        toast({
          title: 'Documents Generated',
          description: `Successfully generated ${result.successCount} document${result.successCount > 1 ? 's' : ''}.`,
        });
      } else if (result.successCount > 0) {
        toast({
          title: 'Partially Generated',
          description: `${result.successCount} document${result.successCount > 1 ? 's' : ''} succeeded, ${result.failCount} failed.`,
          variant: 'destructive',
        });
      } else {
        const firstError = result.results?.find(r => !r.success)?.error ?? 'Document generation failed.';
        toast({
          title: 'Generation Failed',
          description: firstError,
          variant: 'destructive',
        });
      }

      refreshDataInBackground();
    } catch (error: unknown) {
      // Session expired: redirect is already in flight — do not show a toast.
      if (error instanceof SessionExpiredError) return;
      const message = error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
      toast({
        title: 'Generation Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (path: string, filename: string) => {
    try {
      const data = await downloadGeneratedDoc(path);
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      if (error instanceof SessionExpiredError) return;
      const message = error instanceof Error ? error.message : 'Failed to download file.';
      toast({
        title: 'Download Failed',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const getLatestDocumentForTemplate = (templateId: string): GeneratedDocument | undefined => {
    return generatedDocuments.find(
      doc => doc.template_id === templateId && doc.generation_status === 'success'
    );
  };

  const getDocumentHistory = (templateId: string): GeneratedDocument[] => {
    return generatedDocuments.filter(doc => doc.template_id === templateId);
  };

  const getCreatorName = (userId: string): string => {
    const profile = profiles.get(userId);
    return profile?.full_name || profile?.email || 'Unknown';
  };

  const getDocTemplateName = (doc: GeneratedDocument): string => {
    // Prefer denormalized snapshot name, fallback to live lookup
    if (doc.template_name) return doc.template_name;
    const fromPacket = packetTemplates.find(pt => pt.template_id === doc.template_id);
    if (fromPacket?.templates?.name) return fromPacket.templates.name;
    const fromAll = allTemplates.find(t => t.id === doc.template_id);
    if (fromAll?.name) return fromAll.name;
    return 'Unknown Template';
  };

  const getGeneratedVia = (doc: GeneratedDocument): 'Packet' | 'Template' => {
    return doc.packet_id ? 'Packet' : 'Template';
  };

  // Sorted & filtered history documents
  const filteredHistoryDocs = useMemo(() => {
    let docs = [...generatedDocuments];

    // Filter by type
    if (historyFilterType === 'packet') {
      docs = docs.filter(d => d.packet_id);
    } else if (historyFilterType === 'template') {
      docs = docs.filter(d => !d.packet_id);
    }

    // Search filter
    if (historyFilterSearch) {
      const q = historyFilterSearch.toLowerCase();
      docs = docs.filter(d => {
        const tName = getDocTemplateName(d).toLowerCase();
        const pName = (d.packet_name || '').toLowerCase();
        const creator = getCreatorName(d.created_by).toLowerCase();
        return tName.includes(q) || pName.includes(q) || creator.includes(q);
      });
    }

    // Sort
    docs.sort((a, b) => {
      let cmp = 0;
      switch (historySortField) {
        case 'date':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'template':
          cmp = getDocTemplateName(a).localeCompare(getDocTemplateName(b));
          break;
        case 'packet':
          cmp = (a.packet_name || '').localeCompare(b.packet_name || '');
          break;
        case 'user':
          cmp = getCreatorName(a.created_by).localeCompare(getCreatorName(b.created_by));
          break;
      }
      return historySortDir === 'desc' ? -cmp : cmp;
    });

    return docs;
  }, [generatedDocuments, historyFilterType, historyFilterSearch, historySortField, historySortDir]);

  const toggleTemplateExpanded = (templateId: string) => {
    setExpandedTemplates(prev => {
      const next = new Set(prev);
      if (next.has(templateId)) {
        next.delete(templateId);
      } else {
        next.add(templateId);
      }
      return next;
    });
  };

  const getDocumentsGroupedByTemplate = () => {
    const grouped = new Map<string, { template: Template | null; documents: GeneratedDocument[] }>();
    
    // Initialize with packet templates
    packetTemplates.forEach(pt => {
      grouped.set(pt.template_id, { template: pt.templates, documents: [] });
    });
    
    // Add documents to groups
    generatedDocuments.forEach(doc => {
      if (grouped.has(doc.template_id)) {
        grouped.get(doc.template_id)!.documents.push(doc);
      } else {
        // Document for a template not in current packet (edge case)
        grouped.set(doc.template_id, { template: null, documents: [doc] });
      }
    });
    
    return grouped;
  };

  const getFailedDocuments = (): GeneratedDocument[] => {
    return generatedDocuments.filter(doc => doc.generation_status === 'failed');
  };

  // Handle template file upload for templates without files
  const handleTemplateUpload = async (templateId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.docx')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a .docx file',
        variant: 'destructive',
      });
      return;
    }

    setUploadingTemplate(true);
    try {
      const fileName = `${Date.now()}_${file.name}`;
      await uploadTemplateDocx(fileName, file, { upsert: true });

      await updateTemplate(templateId, { file_path: fileName });

      toast({
        title: 'Template Uploaded',
        description: 'Template file uploaded successfully. You can now generate documents.',
      });

      // Refresh data
      refreshAllInBackground();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload Failed',
        description: error.message || 'Failed to upload template file',
        variant: 'destructive',
      });
    } finally {
      setUploadingTemplate(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="page-container text-center py-16">
        <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">File Not Found</h2>
        <Button onClick={() => navigate('/deals')}>Back to Files</Button>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate(`/deals/${id}`)} className="gap-2 mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to File
        </Button>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">File Documents</h1>
            <p className="text-muted-foreground mt-1">
              {deal.deal_number} • {deal.state} • {deal.product_type}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {role === 'admin' && (
              <Badge variant="outline" className="gap-1">
                <Eye className="h-3 w-3" />
                Admin View
              </Badge>
            )}
            <Badge 
              className={cn(
                'text-sm px-3 py-1',
                deal.status === 'ready' ? 'bg-primary/10 text-primary' :
                deal.status === 'generated' ? 'bg-success/10 text-success' :
                'bg-muted text-muted-foreground'
              )}
            >
              {deal.status.charAt(0).toUpperCase() + deal.status.slice(1)}
            </Badge>
          </div>
        </div>
      </div>

      {/* Status Banner */}
      {deal.status === 'draft' && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-warning/10 border border-warning/20 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <div>
            <p className="font-medium text-foreground">File Not Ready</p>
            <p className="text-sm text-muted-foreground">
              Complete all required fields and mark the file as Ready before generating documents.
            </p>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="ml-auto"
            onClick={() => navigate(`/deals/${id}/edit`, { state: { resetToLoanTerms: true } })}
          >
            Enter Data
          </Button>
        </div>
      )}

      {/* Tabs for Generate / History */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'generate' | 'history')} className="mb-6">
        <TabsList>
          <TabsTrigger value="generate" className="gap-2">
            <Play className="h-4 w-4" />
            Generate
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            Document History
            {generatedDocuments.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                {generatedDocuments.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'generate' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Templates & Generation */}
          <div className="lg:col-span-2 space-y-6">
            {/* Packet Generation Section - always visible */}
            <div className="section-card">
              <div className="flex items-center gap-3 mb-4">
                <Package className="h-5 w-5 text-primary" />
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Generate from Packet</h2>
                  <p className="text-sm text-muted-foreground">
                    Select a packet to generate all its templates at once.
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium text-foreground">Packet:</span>
                  <Select
                    value={selectedPacketId || ''}
                    onValueChange={async (v) => {
                      setSelectedPacketId(v);
                      const ptData = await listPacketTemplatesWithJoin(v);
                      setSelectedPacketTemplates(ptData as any);
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePackets.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}{p.all_states ? ' (All States)' : (p.states?.length ? ` (${p.states.join(', ')})` : '')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedPacketId && selectedPacketTemplates.length > 0 && (
                  <div className="p-3 bg-muted/30 rounded-lg space-y-2">
                    <p className="text-sm font-medium text-foreground">Templates in Packet ({selectedPacketTemplates.length}):</p>
                    {selectedPacketTemplates.map((pt, idx) => (
                      <div key={pt.template_id} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="font-medium w-5">{idx + 1}.</span>
                        <FileText className="h-3.5 w-3.5" />
                        <span>{pt.templates?.name || 'Unknown'}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium text-foreground">Output Format:</span>
                  <Select value={outputType} onValueChange={(v) => setOutputType(v as OutputType)}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="docx_only">DOCX Only</SelectItem>
                      <SelectItem value="docx_and_pdf">DOCX + PDF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button 
                  onClick={() => handleGenerateClick('packet')}
                  disabled={!canGenerate || generating || !selectedPacketId}
                  className="w-full gap-2"
                  size="lg"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5" />
                      Generate Full Packet ({selectedPacketTemplates.length} templates)
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Single Template Generation - always visible */}
            <div className="section-card">
              <div className="flex items-center gap-3 mb-4">
                <FileText className="h-5 w-5 text-primary" />
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Single Template Generation</h2>
                  <p className="text-sm text-muted-foreground">
                    Select a template to generate a single document.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium text-foreground">Template:</span>
                  <Select 
                    value={selectedTemplateId || ''} 
                    onValueChange={(v) => setSelectedTemplateId(v)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {allTemplates.map(template => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name} (v{template.version})
                          {!template.file_path && ' - No file'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium text-foreground">Output Format:</span>
                  <Select value={outputType} onValueChange={(v) => setOutputType(v as OutputType)}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="docx_only">DOCX Only</SelectItem>
                      <SelectItem value="docx_and_pdf">DOCX + PDF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePreviewPayload}
                    disabled={!canGenerate || previewLoading || generating || !selectedTemplateId}
                    className="flex-1 gap-2"
                    size="lg"
                  >
                    {previewLoading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Loading payload...
                      </>
                    ) : (
                      <>
                        <Eye className="h-5 w-5" />
                        Preview merge data
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => handleGenerateClick('single', selectedTemplateId || undefined)}
                    disabled={!canGenerate || generating || !selectedTemplateId}
                    className="flex-1 gap-2"
                    size="lg"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Play className="h-5 w-5" />
                        Generate Document
                      </>
                    )}
                  </Button>
                </div>

                {/* v2 docxtemplater test row */}
                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    v2 engine (docxtemplater) — templates must use unbroken <code className="text-[11px]">{'{{field_key}}'}</code> tags typed in Word (no v1 XML repair).
                  </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <p className="text-xs text-muted-foreground self-center mr-auto sm:hidden">
                    Actions
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleInspectFieldData}
                    disabled={!canGenerate || previewLoading || !selectedTemplateId}
                    className="gap-2"
                  >
                    {previewLoading && previewMode === 'v2' ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />Loading…</>
                    ) : (
                      <><Info className="h-4 w-4" />Inspect field data</>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleGenerateV2}
                    disabled={!canGenerate || generatingV2 || !selectedTemplateId}
                    className="gap-2"
                  >
                    {generatingV2 ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
                    ) : (
                      <><FileOutput className="h-4 w-4" />Generate (v2)</>
                    )}
                  </Button>
                </div>
                </div>
              </div>
            </div>

          {/* Templates List - only show if packet exists */}
          {packet && packetTemplates.length > 0 && (
          <div className="section-card">
            <h3 className="text-lg font-semibold text-foreground mb-4">Templates in Packet</h3>
            
            <div className="space-y-3">
              {packetTemplates.map((pt, index) => {
                const template = pt.templates;
                const latestDoc = getLatestDocumentForTemplate(template.id);
                const history = getDocumentHistory(template.id);
                const hasFile = !!template.file_path;

                return (
                  <div
                    key={pt.template_id}
                    className="p-4 rounded-lg border border-border hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-sm font-medium">
                          {index + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{template.name}</span>
                            <span className="text-xs text-muted-foreground">v{template.version}</span>
                            {pt.is_required && (
                              <Badge variant="outline" className="text-xs">Required</Badge>
                            )}
                          </div>
                          
                          {latestDoc ? (
                            <div className="flex items-center gap-2 mt-1">
                              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                              <span className="text-sm text-success">
                                Generated v{latestDoc.version_number}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(latestDoc.created_at), 'MMM d, h:mm a')}
                              </span>
                            </div>
                          ) : hasFile ? (
                            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                              <FileText className="h-3.5 w-3.5" />
                              <span>Ready to generate</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mt-1 text-sm text-destructive">
                              <AlertCircle className="h-3.5 w-3.5" />
                              <span>No template file</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Download buttons */}
                        {latestDoc && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              onClick={() => handleDownload(
                                latestDoc.output_docx_path,
                                `${template.name}_v${latestDoc.version_number}.docx`
                              )}
                            >
                              <Download className="h-3.5 w-3.5" />
                              DOCX
                            </Button>
                            {latestDoc.output_pdf_path && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                onClick={() => handleDownload(
                                  latestDoc.output_pdf_path!,
                                  `${template.name}_v${latestDoc.version_number}.pdf`
                                )}
                              >
                                <Download className="h-3.5 w-3.5" />
                                PDF
                              </Button>
                            )}
                          </div>
                        )}
                        
                        {/* Regenerate / Generate button */}
                        {hasFile && (
                          <Button
                            variant={latestDoc ? 'ghost' : 'outline'}
                            size="sm"
                            disabled={!canGenerate || generating}
                            onClick={() => handleGenerateClick('single', template.id)}
                            className="gap-1"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            {latestDoc ? 'Regenerate' : 'Generate'}
                          </Button>
                        )}

                        {/* Upload button for templates without files */}
                        {!hasFile && (role === 'admin' || role === 'csr') && (
                          <label className="cursor-pointer">
                            <input
                              type="file"
                              accept=".docx"
                              className="hidden"
                              onChange={(e) => handleTemplateUpload(template.id, e)}
                              disabled={uploadingTemplate}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              asChild
                              disabled={uploadingTemplate}
                            >
                              <span>
                                {uploadingTemplate ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Upload className="h-3.5 w-3.5" />
                                )}
                                Upload DOCX
                              </span>
                            </Button>
                          </label>
                        )}
                      </div>
                    </div>

                    {/* Version History */}
                    {history.length > 1 && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-2">Previous Versions</p>
                        <div className="space-y-1">
                          {history.slice(1, 4).map((doc) => (
                            <div key={doc.id} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                v{doc.version_number} - {format(new Date(doc.created_at), 'MMM d, h:mm a')}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => handleDownload(
                                  doc.output_docx_path,
                                  `${template.name}_v${doc.version_number}.docx`
                                )}
                              >
                                <Download className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                          {history.length > 4 && (
                            <p className="text-xs text-muted-foreground">
                              +{history.length - 4} more versions
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}
        </div>

        {/* Right Column - Status & History */}
        <div className="space-y-6">
          {/* Generation Summary */}
          <div className="section-card">
            <h3 className="font-semibold text-foreground mb-4">Generation Summary</h3>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Templates</span>
                <span className="font-medium text-foreground">{packetTemplates.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Generated</span>
                <span className="font-medium text-success">
                  {new Set(generatedDocuments.filter(d => d.generation_status === 'success').map(d => d.template_id)).size}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total Versions</span>
                <span className="font-medium text-foreground">
                  {generatedDocuments.filter(d => d.generation_status === 'success').length}
                </span>
              </div>
            </div>

            {/* Progress */}
            {packetTemplates.length > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Completion</span>
                  <span className="font-medium">
                    {Math.round(
                      (new Set(generatedDocuments.filter(d => d.generation_status === 'success').map(d => d.template_id)).size / 
                       packetTemplates.length) * 100
                    )}%
                  </span>
                </div>
                <Progress 
                  value={
                    (new Set(generatedDocuments.filter(d => d.generation_status === 'success').map(d => d.template_id)).size / 
                     packetTemplates.length) * 100
                  }
                  className="h-2"
                />
              </div>
            )}
          </div>

          {/* Recent Jobs */}
          {recentJobs.length > 0 && (
            <div className="section-card">
              <h3 className="font-semibold text-foreground mb-4">Recent Jobs</h3>
              
              <div className="space-y-3">
                {recentJobs.map((job) => {
                  const StatusIcon = statusConfig[job.status].icon;
                  return (
                    <div key={job.id} className="p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center justify-between mb-1">
                        <Badge 
                          className={cn(
                            'text-xs',
                            statusConfig[job.status].bgColor,
                            statusConfig[job.status].color
                          )}
                        >
                          <StatusIcon className={cn(
                            'h-3 w-3 mr-1',
                            job.status === 'running' && 'animate-spin'
                          )} />
                          {statusConfig[job.status].label}
                        </Badge>
                        <span className="text-xs text-muted-foreground capitalize">
                          {job.request_type.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {job.started_at && format(new Date(job.started_at), 'MMM d, h:mm:ss a')}
                      </div>
                      {job.error_message && (
                        <p className="text-xs text-destructive mt-1 line-clamp-2">
                          {job.error_message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="section-card">
            <h3 className="font-semibold text-foreground mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2"
                onClick={() => navigate(`/deals/${id}`)}
              >
                <FileText className="h-4 w-4" />
                View Deal Overview
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2"
                onClick={() => navigate(`/deals/${id}/edit`, { state: { resetToLoanTerms: true } })}
              >
                <File className="h-4 w-4" />
                Edit Deal Data
              </Button>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Document History Tab Content */}
      {activeTab === 'history' && (
        <TooltipProvider>
        <div className="space-y-6">
          {/* Failed Generations Alert */}
          {getFailedDocuments().length > 0 && (
            <div className="section-card border-destructive/50 bg-destructive/5">
              <div className="flex items-center gap-3 mb-4">
                <XCircle className="h-5 w-5 text-destructive" />
                <h3 className="font-semibold text-destructive">
                  Failed Generations ({getFailedDocuments().length})
                </h3>
              </div>
              <div className="space-y-3">
                {getFailedDocuments().map((doc) => (
                  <div key={doc.id} className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {getDocTemplateName(doc)}
                          </span>
                          <Badge variant="destructive" className="text-xs">Failed</Badge>
                          {doc.packet_name && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Package className="h-3 w-3" />
                              {doc.packet_name}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {format(new Date(doc.created_at), 'MM/dd/yyyy – hh:mm a')} • by {getCreatorName(doc.created_by)}
                        </div>
                        {doc.error_message && (
                          <p className="text-sm text-destructive mt-2 p-2 bg-background rounded">
                            {doc.error_message}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Document History Table */}
          <div className="section-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                Document History
              </h3>
              <span className="text-sm text-muted-foreground">
                {generatedDocuments.filter(d => d.generation_status === 'success').length} versions total
              </span>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by template, packet, or user..."
                  value={historyFilterSearch}
                  onChange={(e) => setHistoryFilterSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={historyFilterType} onValueChange={(v) => setHistoryFilterType(v as any)}>
                <SelectTrigger className="w-40">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="template">Template Only</SelectItem>
                  <SelectItem value="packet">Packet Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {generatedDocuments.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No documents generated yet</p>
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={() => setActiveTab('generate')}
                >
                  Go to Generate
                </Button>
              </div>
            ) : filteredHistoryDocs.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No documents match your filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <button
                          className="flex items-center gap-1 hover:text-foreground transition-colors"
                          onClick={() => {
                            if (historySortField === 'template') setHistorySortDir(d => d === 'asc' ? 'desc' : 'asc');
                            else { setHistorySortField('template'); setHistorySortDir('asc'); }
                          }}
                        >
                          Document Name
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead>Generated Via</TableHead>
                      <TableHead>
                        <button
                          className="flex items-center gap-1 hover:text-foreground transition-colors"
                          onClick={() => {
                            if (historySortField === 'packet') setHistorySortDir(d => d === 'asc' ? 'desc' : 'asc');
                            else { setHistorySortField('packet'); setHistorySortDir('asc'); }
                          }}
                        >
                          Packet Name
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>
                        <button
                          className="flex items-center gap-1 hover:text-foreground transition-colors"
                          onClick={() => {
                            if (historySortField === 'user') setHistorySortDir(d => d === 'asc' ? 'desc' : 'asc');
                            else { setHistorySortField('user'); setHistorySortDir('asc'); }
                          }}
                        >
                          Generated By
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          className="flex items-center gap-1 hover:text-foreground transition-colors"
                          onClick={() => {
                            if (historySortField === 'date') setHistorySortDir(d => d === 'asc' ? 'desc' : 'asc');
                            else { setHistorySortField('date'); setHistorySortDir('desc'); }
                          }}
                        >
                          Generated On
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHistoryDocs.map((doc) => {
                      const templateName = getDocTemplateName(doc);
                      const via = getGeneratedVia(doc);
                      return (
                        <TableRow key={doc.id} className={cn(doc.generation_status === 'failed' && 'bg-destructive/5')}>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-primary shrink-0" />
                                  <span className="font-medium text-foreground">{templateName}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-xs">
                                <div className="space-y-1 text-xs">
                                  <p><strong>Template:</strong> {templateName}</p>
                                  {doc.packet_name && <p><strong>Packet:</strong> {doc.packet_name}</p>}
                                  <p><strong>Generated by:</strong> {getCreatorName(doc.created_by)}</p>
                                  <p><strong>Timestamp:</strong> {format(new Date(doc.created_at), 'MM/dd/yyyy – hh:mm:ss a')}</p>
                                  {doc.generation_batch_id && <p><strong>Batch:</strong> {doc.generation_batch_id.slice(0, 8)}…</p>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs gap-1">
                              {via === 'Packet' ? <Package className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                              {via}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {doc.packet_name || '—'}
                          </TableCell>
                          <TableCell className="text-sm">v{doc.version_number}</TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1 text-sm text-muted-foreground">
                              <User className="h-3 w-3" />
                              {getCreatorName(doc.created_by)}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {format(new Date(doc.created_at), 'MM/dd/yyyy – hh:mm a')}
                          </TableCell>
                          <TableCell>
                            {doc.generation_status === 'success' ? (
                              <Badge className="bg-success/10 text-success text-xs">Success</Badge>
                            ) : doc.generation_status === 'failed' ? (
                              <Badge variant="destructive" className="text-xs">Failed</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">{doc.generation_status}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {doc.generation_status === 'success' && (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1 h-7 text-xs"
                                  onClick={() => handleDownload(
                                    doc.output_docx_path,
                                    `${templateName}_v${doc.version_number}.docx`
                                  )}
                                >
                                  <Download className="h-3 w-3" />
                                  DOCX
                                </Button>
                                {doc.output_pdf_path && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1 h-7 text-xs"
                                    onClick={() => handleDownload(
                                      doc.output_pdf_path!,
                                      `${templateName}_v${doc.version_number}.pdf`
                                    )}
                                  >
                                    <Download className="h-3 w-3" />
                                    PDF
                                  </Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
        </TooltipProvider>
      )}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileOutput className="h-5 w-5" />
              {generationMode === 'packet' ? 'Generate Full Packet' : 'Generate Document'}
            </DialogTitle>
            <DialogDescription>
              {generationMode === 'packet' ? (
                <>
                  This will generate all {packetTemplates.length} templates in the packet.
                  Existing documents will receive new version numbers.
                </>
              ) : (
                <>
                  This will generate a new version of the selected template.
                  Previous versions will remain accessible.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="p-3 rounded-lg bg-muted/50 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Deal</span>
                <span className="font-medium">{deal.deal_number}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Output Type</span>
                <span className="font-medium">
                  {outputType === 'docx_only' ? 'DOCX Only' : 'DOCX + PDF'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Templates</span>
                <span className="font-medium">
                  {generationMode === 'packet' 
                    ? `${packetTemplates.length} templates` 
                    : packetTemplates.find(pt => pt.template_id === selectedTemplateId)?.templates.name
                  }
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewMode === 'v2' ? <Info className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              {previewMode === 'v2' ? 'Merge field data — v2 engine (docxtemplater)' : 'Merge field payload (preview)'}
            </DialogTitle>
            <DialogDescription>
              {previewMode === 'v2'
                ? 'Values for tags in this template, loaded from deal section data (same source as Generate Document). Empty means no saved value for that field on this deal.'
                : 'Same key/value map used immediately before the Word template is filled. Keys match merge tags (e.g. pr_p_street_1), not deal form storage IDs.'}
            </DialogDescription>
          </DialogHeader>

          {previewLoading && (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              {previewMode === 'v2' ? 'Building v2 field data…' : 'Building payload from deal data…'}
            </div>
          )}

          {!previewLoading && previewResult && (
            <div className="flex flex-col gap-3 min-h-0 flex-1">
              <div className="grid grid-cols-2 gap-2 text-sm p-3 rounded-lg bg-muted/50">
                <div>
                  <span className="text-muted-foreground">Template</span>
                  <p className="font-medium">{previewResult.templateName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {previewMode === 'v2' ? 'Filled / tags in template' : 'Non-empty fields'}
                  </span>
                  <p className="font-medium">
                    {previewResult.fieldCount} / {previewResult.totalKeysInMap}
                    {previewMode === 'v2' ? ' template tags' : ' keys in map'}
                  </p>
                </div>
              </div>
              {previewMode === 'v2' && previewResult.templateConditions && previewResult.templateConditions.length > 0 && (
                <div className="text-xs p-3 rounded-lg border bg-background space-y-2 max-h-40 overflow-y-auto">
                  <p className="font-medium text-muted-foreground">Template conditions</p>
                  {previewResult.templateConditions.map((c) => (
                    <div key={c.expression} className="font-mono">
                      <span className="text-foreground">{c.expression}</span>
                      {c.driverField && (
                        <span className="text-muted-foreground">
                          {' '}
                          — {c.driverField}={c.driverValue ?? '(empty)'}
                          {c.matchesCompare != null && (c.matchesCompare ? ' ✓ branch' : ' ✗ else branch')}
                        </span>
                      )}
                      {c.fieldKeys.length > 0 && (
                        <span className="block text-muted-foreground pl-2">
                          fields: {c.fieldKeys.join(', ')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Input
                placeholder="Filter keys (e.g. pr_p_, broker.)"
                value={previewFilter}
                onChange={(e) => setPreviewFilter(e.target.value)}
              />
              <Textarea
                readOnly
                className="font-mono text-xs min-h-[320px] flex-1 resize-y"
                value={previewJsonDisplay}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (previewJsonDisplay) {
                  void navigator.clipboard.writeText(previewJsonDisplay);
                  toast({ title: 'Copied to clipboard' });
                }
              }}
              disabled={!previewJsonDisplay}
            >
              Copy JSON
            </Button>
            <Button onClick={() => setShowPreviewDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DealDocumentsPage;
