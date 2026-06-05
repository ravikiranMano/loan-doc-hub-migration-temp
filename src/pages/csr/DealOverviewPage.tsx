import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { fetchDealById, updateDeal } from '@/services/deals/deals.service';
import {
  fetchSectionValuesByDealWithUpdatedAt,
} from '@/services/deals/section-values.service';
import {
  listParticipantsByDealCreatedAsc,
  updateParticipant,
} from '@/services/deals/participants.service';
import {
  getContactsByIds,
  getContactById,
  getContactByEmail,
} from '@/services/contacts/contacts.service';
import { fetchPacketById, listPacketTemplatesWithJoin } from '@/services/documents/packets.service';
import { listTemplateFieldMaps } from '@/services/documents/template-field-maps.service';
import { resolvePacketFields, resolveAllFields } from '@/lib/requiredFieldsResolver';
import { ActivityLogViewer } from '@/components/deal/ActivityLogViewer';
import { InviteParticipantsPanel } from '@/components/deal/InviteParticipantsPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useFormPermissions } from '@/hooks/useFormPermissions';
import { logDealMarkedReady } from '@/hooks/useActivityLog';
import { useWorkspaceOptional } from '@/contexts/WorkspaceContext';
import { MaxFilesDialog } from '@/components/workspace/MaxFilesDialog';
import { cn } from '@/lib/utils';
import { 
  ArrowLeft, 
  Loader2, 
  Package, 
  FileText,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Edit,
  User,
  Users,
  History,
  FileOutput
} from 'lucide-react';

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
  notes: string | null;
  created_at: string;
  updated_at: string;
  packet_id: string | null;
}

interface Packet {
  id: string;
  name: string;
  description: string | null;
}

interface TemplateFieldSummary {
  template_id: string;
  template_name: string;
  total_fields: number;
  required_fields: number;
  filled_fields: number;
  missing_required: number;
}

interface LastUpdatedInfo {
  updated_at: string;
  updated_by_email: string | null;
}

const modeLabels: Record<string, string> = {
  doc_prep: 'Document Preparation',
  servicing_only: 'Servicing Only',
};

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType; bgColor: string }> = {
  draft: { label: 'Draft', color: 'text-muted-foreground', bgColor: 'bg-muted', icon: Clock },
  ready: { label: 'Ready', color: 'text-primary', bgColor: 'bg-primary/10', icon: CheckCircle2 },
  generated: { label: 'Generated', color: 'text-success', bgColor: 'bg-success/10', icon: CheckCircle2 },
};

export const DealOverviewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, role, loading: authLoading } = useAuth();
  const { isFormViewOnly } = useFormPermissions();
  const workspace = useWorkspaceOptional();
  const [showMaxFilesDialog, setShowMaxFilesDialog] = useState(false);
  const [dealParticipants, setDealParticipants] = useState<any[]>([]);
  
  const [deal, setDeal] = useState<Deal | null>(null);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [templateSummaries, setTemplateSummaries] = useState<TemplateFieldSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalMissingRequired, setTotalMissingRequired] = useState(0);
  const [totalRequiredFields, setTotalRequiredFields] = useState(0);
  const [totalFilledRequiredFields, setTotalFilledRequiredFields] = useState(0);
  const [lastUpdatedInfo, setLastUpdatedInfo] = useState<LastUpdatedInfo | null>(null);
  const [markingReady, setMarkingReady] = useState(false);

  useEffect(() => {
    if (!id || authLoading) return;
    if (!user) {
      navigate('/auth');
      return;
    }
    fetchDealData();
    fetchParticipants();
  }, [id, authLoading, user, navigate]);

  const fetchParticipants = async () => {
    if (!id) return;
    try {
      const rows = await listParticipantsByDealCreatedAsc(id);

      // Sync latest contact data
      const contactIds = rows
        .map((p: any) => p.contact_id)
        .filter((cid: string | null): cid is string => !!cid);

      if (contactIds.length > 0) {
        const contacts = await getContactsByIds(
          contactIds,
          'id, full_name, email, phone, contact_id'
        );

        if (contacts.length > 0) {
          const contactMap: Record<string, { full_name: string; email: string; phone: string; contact_id: string }> = {};
          for (const c of contacts) {
            contactMap[c.id] = { full_name: c.full_name || '', email: c.email || '', phone: c.phone || '', contact_id: c.contact_id || '' };
          }

          // Update stale records silently
          for (const p of rows) {
            const contact = p.contact_id ? contactMap[p.contact_id] : null;
            if (contact) {
              const needsUpdate =
                (contact.full_name && contact.full_name !== (p.name || '')) ||
                (contact.email && contact.email !== (p.email || '')) ||
                (contact.phone && contact.phone !== (p.phone || ''));
              if (needsUpdate) {
                updateParticipant(p.id, {
                  name: contact.full_name || p.name,
                  email: contact.email || p.email,
                  phone: contact.phone || p.phone,
                }).catch(() => {});
              }
            }
          }

          // Use contact data for display
          const synced = rows.map((p: any) => {
            const contact = p.contact_id ? contactMap[p.contact_id] : null;
            return {
              ...p,
              name: contact?.full_name || p.name || '',
              email: contact?.email || p.email || '',
              phone: contact?.phone || p.phone || '',
              contact_id_display: contact?.contact_id || '',
            };
          });
          setDealParticipants(synced);
          return;
        }
      }

      setDealParticipants(rows);
    } catch (err) {
      console.error('Error fetching participants:', err);
    }
  };

  const fetchDealData = async () => {
    try {
      const dealData = await fetchDealById(id!);
      if (!dealData) {
        setDeal(null);
        return;
      }
      setDeal(dealData as Deal);

      if (dealData.packet_id) {
        const packetData = await fetchPacketById(dealData.packet_id);
        setPacket(packetData as Packet);
      }

      // Use the resolver to get fields - works with or without packet
      const resolved = dealData.packet_id 
        ? await resolvePacketFields(dealData.packet_id)
        : await resolveAllFields();
      setTotalRequiredFields(resolved.requiredFieldKeys.length);

      const sectionValues = await fetchSectionValuesByDealWithUpdatedAt(id!);

      // Create a map of field_dictionary_id to field_key using resolved fields
      const fieldDictIdToKeyMap = new Map<string, string>();
      resolved.fields.forEach(f => fieldDictIdToKeyMap.set(f.field_dictionary_id, f.field_key));

      // Find filled field keys from section values (JSONB format)
      const filledFieldKeys = new Set<string>();
      let mostRecentUpdate: { updated_at: string } | null = null;
      
      (sectionValues || []).forEach((sv: any) => {
        const fieldValues = sv.field_values || {};
        Object.entries(fieldValues).forEach(([fieldDictId, fieldData]: [string, any]) => {
          const fieldKey = fieldDictIdToKeyMap.get(fieldDictId);
          if (fieldKey && fieldData) {
            const hasValue = fieldData.value_text || fieldData.value_number !== null || fieldData.value_date;
            if (hasValue) {
              filledFieldKeys.add(fieldKey);
            }
          }
        });
        
        // Track most recent update
        if (sv.updated_at && (!mostRecentUpdate || new Date(sv.updated_at) > new Date(mostRecentUpdate.updated_at))) {
          mostRecentUpdate = sv;
        }
      });

      // Count filled required fields and missing required fields
      const filledRequiredCount = resolved.fields.filter(
        field => field.is_required && filledFieldKeys.has(field.field_key)
      ).length;
      const missingCount = resolved.requiredFieldKeys.length - filledRequiredCount;
      
      setTotalFilledRequiredFields(filledRequiredCount);
      setTotalMissingRequired(missingCount);

      // Get last updated info
      if (mostRecentUpdate) {
        setLastUpdatedInfo({
          updated_at: (mostRecentUpdate as any).updated_at,
          updated_by_email: null, // Section values don't track individual updated_by
        });
      }

      // Fetch templates in packet for template breakdown (only if packet exists)
      if (dealData.packet_id) {
        const packetTemplates = await listPacketTemplatesWithJoin(dealData.packet_id);

        const summaries: TemplateFieldSummary[] = [];
        
        for (const pt of packetTemplates) {
          const template = (pt as any).templates;
          if (!template) continue;

          const fieldMaps = await listTemplateFieldMaps(template.id);

          // Map field_dictionary_ids to field_keys using resolved fields
          const totalFields = fieldMaps?.length || 0;
          const requiredFields = fieldMaps?.filter((fm: any) => fm.required_flag).length || 0;
          const filledFields = fieldMaps?.filter((fm: any) => {
            const fieldKey = resolved.fields.find(f => f.field_dictionary_id === fm.field_dictionary_id)?.field_key;
            return fieldKey && filledFieldKeys.has(fieldKey);
          }).length || 0;
          const missingRequired = fieldMaps?.filter((fm: any) => {
            const fieldKey = resolved.fields.find(f => f.field_dictionary_id === fm.field_dictionary_id)?.field_key;
            return fm.required_flag && fieldKey && !filledFieldKeys.has(fieldKey);
          }).length || 0;

          summaries.push({
            template_id: template.id,
            template_name: template.name,
            total_fields: totalFields,
            required_fields: requiredFields,
            filled_fields: filledFields,
            missing_required: missingRequired,
          });
        }

        setTemplateSummaries(summaries);
      }
    } catch (error) {
      console.error('Error fetching deal:', error);
      setDeal(null);
      toast({
        title: 'Error',
        description: 'Failed to load file',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const totalFields = templateSummaries.reduce((sum, t) => sum + t.total_fields, 0);
  const totalFilledFields = templateSummaries.reduce((sum, t) => sum + t.filled_fields, 0);
  // Overall progress is based on required fields completion, not total fields
  const completionPercent = totalRequiredFields > 0 
    ? Math.round((totalFilledRequiredFields / totalRequiredFields) * 100) 
    : 0;

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  if (loading || authLoading) {
    return (
      <div className="page-container space-y-4 animate-pulse">
        <div className="h-8 w-64 rounded-md bg-muted" />
        <div className="h-4 w-96 rounded-md bg-muted" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
          <div className="h-32 rounded-lg bg-muted" />
          <div className="h-32 rounded-lg bg-muted" />
          <div className="h-32 rounded-lg bg-muted" />
        </div>
        <div className="h-64 rounded-lg bg-muted" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="page-container text-center py-16">
        <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Unable to load deal</h2>
        <p className="text-muted-foreground mb-4">
          This deal may not exist, or your session may have expired. Try signing in again.
        </p>
        <Button onClick={() => navigate('/deals')}>Back to Files</Button>
      </div>
    );
  }

  const StatusIcon = statusConfig[deal.status].icon;
  const isReady = deal.status === 'ready';
  const isGenerated = deal.status === 'generated';
  const canBeReady = totalMissingRequired === 0 && totalRequiredFields > 0;

  // Check if user is CSR
  const isCsr = role === 'csr' || role === 'admin';

  // Check if participants section is read-only for this user
  const isParticipantsReadOnly = isFormViewOnly('participants');

  const handleMarkReady = async () => {
    if (!deal || markingReady) return;
    
    setMarkingReady(true);
    try {
      await updateDeal(deal.id, { status: 'ready' });

      await logDealMarkedReady(deal.id);

      setDeal({ ...deal, status: 'ready' });
      toast({
        title: 'File Marked Ready',
        description: 'You can now generate documents for this file.',
      });
    } catch (error) {
      console.error('Error marking deal ready:', error);
      toast({
        title: 'Error',
        description: 'Failed to mark file as ready',
        variant: 'destructive',
      });
    } finally {
      setMarkingReady(false);
    }
  };

  // Section labels for display
  const sectionLabels: Record<string, string> = {
    borrower: 'Borrower',
    broker: 'Broker',
    co_borrower: 'Co-Borrower',
    escrow: 'Escrow',
    loan_terms: 'Loan Terms',
    other: 'Other',
    property: 'Property',
    seller: 'Seller',
    system: 'System',
    title: 'Title',
  };

  return (
    <div className="page-container">
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => navigate('/deals')} 
                className="h-8 w-8"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-2xl font-bold text-foreground">{deal.deal_number}</h1>
              <Badge 
                variant="secondary" 
                className={cn(statusConfig[deal.status].bgColor, statusConfig[deal.status].color)}
              >
                <StatusIcon className="h-3.5 w-3.5 mr-1" />
                {statusConfig[deal.status].label}
              </Badge>
            </div>
            {(() => {
              const parts = [
                deal.state && deal.state !== 'TBD' ? deal.state : null,
                deal.product_type && deal.product_type !== 'TBD' ? deal.product_type : null,
                modeLabels[deal.mode],
              ].filter(Boolean);
              return parts.length > 0 ? (
                <p className="text-muted-foreground mt-1">{parts.join(' • ')}</p>
              ) : null;
            })()}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => {
              if (workspace && deal) {
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
                  state: deal.state || '',
                  productType: deal.product_type || '',
                  openedAt: Date.now(),
                });
              }
              navigate(`/deals/${deal.id}/edit`, { state: { resetToLoanTerms: true } });
            }} className="gap-2">
              <Edit className="h-4 w-4" />
              Enter Data
            </Button>
            {isCsr && (
              <Button 
                onClick={() => navigate(`/deals/${deal.id}/documents`)}
                className="gap-2"
                variant={deal.status === 'ready' || deal.status === 'generated' ? 'default' : 'outline'}
              >
                <FileOutput className="h-4 w-4" />
                Documents
              </Button>
            )}
          </div>
        </div>
      </div>
      {/* Status Banner */}
      {totalRequiredFields > 0 && (
        <div className={cn(
          'mb-6 px-4 py-3 rounded-lg flex items-center justify-between',
          totalMissingRequired > 0 
            ? 'bg-warning/10 border border-warning/20' 
            : 'bg-success/10 border border-success/20'
        )}>
          <div className="flex items-center gap-3">
            {totalMissingRequired > 0 ? (
              <>
                <AlertTriangle className="h-5 w-5 text-warning" />
                <div>
                  <p className="font-medium text-foreground">
                    {totalMissingRequired} required field{totalMissingRequired > 1 ? 's' : ''} missing
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Complete all required fields to mark file as ready
                  </p>
                </div>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5 text-success" />
                <div>
                  <p className="font-medium text-foreground">
                    {isReady || isGenerated ? 'File is ready for document generation' : 'All required fields complete'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {totalRequiredFields} required field{totalRequiredFields > 1 ? 's' : ''} filled
                  </p>
                </div>
              </>
            )}
          </div>
          {isCsr && canBeReady && deal.status === 'draft' && (
            <Button onClick={handleMarkReady} disabled={markingReady} className="gap-2">
              {markingReady ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Mark Ready
            </Button>
          )}
          {isCsr && (isReady || isGenerated) && packet && (
            <Button onClick={() => navigate(`/deals/${deal.id}/documents`)} className="gap-2">
              <FileOutput className="h-4 w-4" />
              Generate Documents
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Completion Summary */}
          <div className="section-card">
            <h2 className="text-lg font-semibold text-foreground mb-4">Completion Summary</h2>
            
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">Overall Progress</span>
                <span className="text-sm font-medium text-primary">{completionPercent}%</span>
              </div>
              <Progress value={completionPercent} className="h-2" />
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold text-foreground">{totalFields}</p>
                <p className="text-xs text-muted-foreground">Total Fields</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-primary/10">
                <p className="text-2xl font-bold text-primary">{totalRequiredFields}</p>
                <p className="text-xs text-muted-foreground">Required</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-success/10">
                <p className="text-2xl font-bold text-success">{totalFilledFields}</p>
                <p className="text-xs text-muted-foreground">Filled</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-destructive/10">
                <p className="text-2xl font-bold text-destructive">{totalMissingRequired}</p>
                <p className="text-xs text-muted-foreground">Missing Req.</p>
              </div>
            </div>
          </div>

          {/* Template Breakdown */}
          {packet && templateSummaries.length > 0 && (
            <div className="section-card">
              <div className="flex items-center gap-3 mb-4">
                <Package className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">
                  Packet: {packet.name}
                </h2>
              </div>

              <div className="space-y-3">
                {templateSummaries.map((summary) => {
                  const progress = summary.total_fields > 0
                    ? Math.round((summary.filled_fields / summary.total_fields) * 100)
                    : 0;
                  const isComplete = summary.missing_required === 0;

                  return (
                    <div
                      key={summary.template_id}
                      className="p-4 rounded-lg border border-border"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-foreground">{summary.template_name}</span>
                        </div>
                        {isComplete ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-success/10 text-success flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Complete
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-full bg-warning/10 text-warning">
                            {summary.missing_required} missing
                          </span>
                        )}
                      </div>
                      <Progress value={progress} className="h-1.5 mb-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{summary.filled_fields} / {summary.total_fields} fields filled</span>
                        <span>{summary.required_fields} required</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!packet && (
            <div className="section-card text-center py-8">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No packet assigned to this file</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Deal Info */}
          <div className="section-card">
            <h3 className="font-semibold text-foreground mb-4">File Information</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">File Number</dt>
                <dd className="font-medium text-foreground">{deal.deal_number}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge 
                    variant="secondary" 
                    className={cn(
                      'text-xs',
                      statusConfig[deal.status].bgColor, 
                      statusConfig[deal.status].color
                    )}
                  >
                    {statusConfig[deal.status].label}
                  </Badge>
                </dd>
              </div>
              {deal.state && deal.state !== 'TBD' && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">State</dt>
                  <dd className="font-medium text-foreground">{deal.state}</dd>
                </div>
              )}
              {deal.product_type && deal.product_type !== 'TBD' && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Product Type</dt>
                  <dd className="font-medium text-foreground">{deal.product_type}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Mode</dt>
                <dd className="font-medium text-foreground">{modeLabels[deal.mode]}</dd>
              </div>
              {deal.borrower_name && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Borrower</dt>
                  <dd className="font-medium text-foreground">{deal.borrower_name}</dd>
                </div>
              )}
              {deal.loan_amount && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Loan Amount</dt>
                  <dd className="font-medium text-foreground">{formatCurrency(deal.loan_amount)}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Participants Block */}
          <div className="section-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Participants</h3>
                <Badge variant="secondary" className="text-xs">{dealParticipants.length}</Badge>
              </div>
              {isCsr && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => {
                    if (workspace && deal) {
                      const alreadyOpen = workspace.openFiles.find(f => f.id === deal.id);
                      if (!alreadyOpen) {
                        if (workspace.isAtLimit()) {
                          setShowMaxFilesDialog(true);
                          return;
                        }
                        workspace.openFile({
                          id: deal.id,
                          dealNumber: deal.deal_number,
                          state: deal.state || '',
                          productType: deal.product_type || '',
                          openedAt: Date.now(),
                        });
                      } else {
                        workspace.switchToFile(deal.id);
                      }
                    }
                    navigate(`/deals/${deal.id}/edit`, { state: { resetToLoanTerms: true } });
                  }}
                >
                  <Edit className="h-3 w-3" />
                  Manage
                </Button>
              )}
            </div>
            {dealParticipants.length > 0 ? (
              <div className="space-y-2">
                {dealParticipants.map((p: any) => {
                  const roleColors: Record<string, string> = {
                    borrower: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
                    lender: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
                    broker: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
                    other: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
                    csr: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
                    admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
                  };
                  const roleLabels: Record<string, string> = { borrower: 'Borrower', lender: 'Lender', broker: 'Broker', other: 'Other', csr: 'CSR', admin: 'Admin' };
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={async () => {
                        if (p.contact_id) {
                          const data = await getContactById(p.contact_id);
                          if (data) {
                            const route = data.contact_type === 'lender' ? 'lenders' : data.contact_type === 'broker' ? 'brokers' : 'borrowers';
                            navigate(`/contacts/${route}/${data.id}`);
                          }
                        } else if (p.email) {
                          const data = await getContactByEmail(p.email, 'id, contact_type');
                          if (data) {
                            const route = data.contact_type === 'lender' ? 'lenders' : data.contact_type === 'broker' ? 'brokers' : 'borrowers';
                            navigate(`/contacts/${route}/${data.id}`);
                          }
                        }
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium text-foreground truncate">{p.name ? (p.contact_id_display ? `${p.name} - ${p.contact_id_display}` : p.name) : 'Unnamed'}</span>
                        </div>
                        {(p.email || p.phone) && (
                          <p className="text-xs text-muted-foreground ml-5.5 truncate">
                            {[p.email, p.phone].filter(Boolean).join(' • ')}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className={cn('text-xs shrink-0 ml-2', roleColors[p.role] || '')}>
                        {roleLabels[p.role] || p.role}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-4">
                <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No participants added yet</p>
              </div>
            )}
          </div>

          {/* Participants Panel - CSR only */}
          {isCsr && (
            <InviteParticipantsPanel dealId={deal.id} dealNumber={deal.deal_number} disabled={isParticipantsReadOnly} />
          )}

          {/* Activity Log */}
          <div className="section-card">
            <div className="flex items-center gap-2 mb-4">
              <History className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Activity Log</h3>
            </div>
            <ActivityLogViewer dealId={id!} maxHeight="360px" />
          </div>

          {/* Timestamps */}
          <div className="section-card">
            <h3 className="font-semibold text-foreground mb-4">Timestamps</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground">
                  {formatDateTime(deal.created_at)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">File Updated</dt>
                <dd className="text-foreground">
                  {formatDateTime(deal.updated_at)}
                </dd>
              </div>
              {lastUpdatedInfo && (
                <>
                  <div className="border-t border-border pt-3 mt-3">
                    <dt className="text-muted-foreground mb-1">Last Field Update</dt>
                    <dd className="text-foreground">
                      {formatDateTime(lastUpdatedInfo.updated_at)}
                    </dd>
                  </div>
                  {lastUpdatedInfo.updated_by_email && (
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{lastUpdatedInfo.updated_by_email}</span>
                    </div>
                  )}
                </>
              )}
            </dl>
          </div>

          {/* Notes */}
          {deal.notes && (
            <div className="section-card">
              <h3 className="font-semibold text-foreground mb-2">Notes</h3>
              <p className="text-sm text-muted-foreground">{deal.notes}</p>
            </div>
          )}
        </div>
      </div>
      <MaxFilesDialog
        open={showMaxFilesDialog}
        onClose={() => setShowMaxFilesDialog(false)}
      />
    </div>
  );
};

export default DealOverviewPage;
