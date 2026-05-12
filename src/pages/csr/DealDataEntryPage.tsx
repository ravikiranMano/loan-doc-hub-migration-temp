import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useDealFields } from "@/hooks/useDealFields";
import { useEntryOrchestration } from "@/hooks/useEntryOrchestration";
import { useFieldPermissions } from "@/hooks/useFieldPermissions";
import { useExternalModificationDetector } from "@/hooks/useExternalModificationDetector";
import { useFormPermissions } from "@/hooks/useFormPermissions";
import { useAuth } from "@/contexts/AuthContext";
import { DealNavigationProvider, useDealNavigation } from "@/contexts/DealNavigationContext";
import { useWorkspaceOptional } from "@/contexts/WorkspaceContext";
import { DirtyFieldsProvider } from "@/contexts/DirtyFieldsContext";
import { SaveConfirmationDialog } from "@/components/workspace/SaveConfirmationDialog";
import { RefreshConfirmationDialog } from "@/components/deal/RefreshConfirmationDialog";
import { DealSectionTab } from "@/components/deal/DealSectionTab";
import { BorrowerSectionContent } from "@/components/deal/BorrowerSectionContent";
import { LenderSectionContent } from "@/components/deal/LenderSectionContent";
import { PropertySectionContent } from "@/components/deal/PropertySectionContent";

import { BrokerSectionContent } from "@/components/deal/BrokerSectionContent";
import { LoanTermsSectionContent } from "@/components/deal/LoanTermsSectionContent";
import { LoanTermsFundingForm } from "@/components/deal/LoanTermsFundingForm";
import { ChargesSectionContent } from "@/components/deal/ChargesSectionContent";
import { OriginationFeesSectionContent } from "@/components/deal/OriginationFeesSectionContent";
import { NotesSectionContent } from "@/components/deal/NotesSectionContent";
import { EventJournalViewer } from "@/components/deal/EventJournalViewer";

import { ParticipantsSectionContent } from "@/components/deal/ParticipantsSectionContent";
import { logDealUpdated, logDealMarkedReady, logDealRevertedToDraft } from "@/hooks/useActivityLog";
import { validateBalancesSoldRate, validatePenaltyDistributions } from "@/lib/loanAllocationValidation";
import {
  ArrowLeft,
  Loader2,
  Save,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Clock,
  Lock,
  User,
  Eye,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getRoleDisplayName } from "@/lib/accessControl";
import type { Database } from "@/integrations/supabase/types";

type FieldSection = Database["public"]["Enums"]["field_section"];

interface Deal {
  id: string;
  deal_number: string;
  state: string;
  product_type: string;
  mode: "doc_prep" | "servicing_only";
  status: "draft" | "ready" | "generated";
  packet_id: string | null;
}

// Section labels for display (partial - only includes displayable main sections)
const SECTION_LABELS: Partial<
  Record<FieldSection | "origination_fees" | "funding" | "event_journal" | "participants", string>
> = {
  participants: "Participants",
  property: "Property",
  loan_terms: "Loan",
  
  funding: "Funding",
  charges: "Charges",
  
  notes: "Conversation Log",
  event_journal: "Events Journal",
  seller: "Seller",
  other: "Other",
  origination_fees: "Other Origination",
  system: "System",
};

// Custom ordering for top navbar tabs
const SECTION_ORDER: string[] = [
  "participants",
  "loan_terms",
  "property",
  
  "funding",
  "charges",
  "notes",
  "event_journal",
  "other",
  "origination_fees",
  "seller",
];

interface DealDataEntryInnerProps {
  dealIdProp?: string;
  isActiveTab?: boolean;
  registerSaveFn?: (dealId: string, fn: () => Promise<boolean>) => void;
  unregisterSaveFn?: (dealId: string) => void;
}

// Inner component that uses the navigation context
export const DealDataEntryInner: React.FC<DealDataEntryInnerProps> = ({
  dealIdProp,
  isActiveTab: isActiveTabProp,
  registerSaveFn,
  unregisterSaveFn,
}) => {
  const params = useParams<{ id: string }>();
  const id = dealIdProp || params.id;
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { user, isExternalUser, isInternalUser, loading: authLoading } = useAuth();
  const { activeTab, setActiveTab, setSubSection } = useDealNavigation();
  const workspace = useWorkspaceOptional();

  // Always reset to Loan -> Terms & Balances on every entry to /edit (including
  // when the file is kept-alive in the workspace). location.key changes on every
  // navigation, so this re-fires when user clicks "Enter Data" again.
  useEffect(() => {
    setActiveTab('loan_terms');
    setSubSection('loan_terms', 'balances_loan_details');
    if ((location.state as { resetToLoanTerms?: boolean } | null)?.resetToLoanTerms) {
      window.history.replaceState({ ...window.history.state, usr: null }, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const isDirectDealRoute = !!id && (
    location.pathname === `/deals/${id}/data` ||
    location.pathname === `/deals/${id}/edit`
  );

  // Determine if this tab is active (for deferred loading)
  const isActive = isActiveTabProp !== undefined
    ? isActiveTabProp
    : (!workspace || workspace.activeFileId === id || isDirectDealRoute);

  const [deal, setDeal] = useState<Deal | null>(null);
  const [dealLoading, setDealLoading] = useState(true);
  const [showValidation, setShowValidation] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [completingSection, setCompletingSection] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showRefreshConfirm, setShowRefreshConfirm] = useState(false);

  const [hasEverBeenActive, setHasEverBeenActive] = useState(isActive);

  // Track when this tab first becomes active
  useEffect(() => {
    if (isActive && !hasEverBeenActive) {
      setHasEverBeenActive(true);
    }
  }, [isActive, hasEverBeenActive]);

  // Fetch deal info - deferred until tab is first active, then never refetched
  const hasFetchedDealRef = useRef(false);
  useEffect(() => {
    if (authLoading) return;
    if (id && (isActive || hasEverBeenActive) && !hasFetchedDealRef.current) {
      hasFetchedDealRef.current = true;
      fetchDeal();
    }
  }, [id, isActive, hasEverBeenActive, authLoading]);

  const fetchDeal = async () => {
    try {
      const { data, error } = await supabase
        .from("deals")
        .select("id, deal_number, state, product_type, mode, status, packet_id")
        .eq("id", id)
        .single();

      if (error) throw error;
      setDeal(data);

      // Register with workspace if available (only if not already open)
      if (workspace && data && !workspace.openFiles.find(f => f.id === data.id)) {
        workspace.openFile({
          id: data.id,
          dealNumber: data.deal_number,
          state: data.state || '',
          productType: data.product_type || '',
          openedAt: Date.now(),
        });
      }
    } catch (error) {
      console.error("Error fetching deal:", error);
      // Check if this is a transient auth issue before closing workspace tab
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Transient auth drop — retry after recovery delay
        await new Promise(r => setTimeout(r, 1500));
        const { data: { session: retrySession } } = await supabase.auth.getSession();
        if (retrySession) {
          // Session recovered — retry fetch
          hasFetchedDealRef.current = false;
          fetchDeal();
          return;
        }
      }
      // Only close workspace file if session is valid (real 404/permission error)
      if (workspace && workspace.openFiles.find(f => f.id === id)) {
        workspace.closeFile(id);
      } else {
        toast({
          title: "Error",
          description: "Failed to load file",
          variant: "destructive",
        });
      }
    } finally {
      setDealLoading(false);
    }
  };

  const {
    fields,
    fieldsBySection,
    sections,
    values,
    visibleFieldKeys,
    requiredFieldKeys,
    loading: fieldsLoading,
    saving,
    isDirty,
    dirtyFieldKeys,
    updateValue,
    removeValuesByPrefix,
    saveDraft,
    getMissingRequiredFields,
    isSectionComplete,
    isPacketComplete,
    hasRequiredFieldChanged,
    resetDirty,
    computeCalculatedFields,
    calculationResults,
    refetchData,
  } = useDealFields(id || "", deal?.packet_id || null, (isActive || hasEverBeenActive) && !authLoading);

  // Field permissions for filtering visible fields/sections
  const { checkCanView, loading: permissionsLoading } = useFieldPermissions();

  // Form-level access permissions (editable vs view-only)
  const { isFormViewOnly, loading: formPermLoading } = useFormPermissions();

  // Helper: check if a section/form is disabled due to form permissions
  const isSectionDisabledByFormPerm = (section: string): boolean => {
    // Standalone sections not gated by form permissions
    if (section === 'event_journal') return false;

    // Map section names to form_keys
    const sectionToFormKey: Record<string, string> = {
      borrower: 'borrower',
      co_borrower: 'co_borrower',
      property: 'property',
      loan_terms: 'loan_terms',
      lender: 'lender',
      broker: 'broker',
      charges: 'charges',
      notes: 'notes',
      insurance: 'insurance',
      liens: 'liens',
      origination_fees: 'origination',
      trust_ledger: 'trust_ledger',
      participants: 'participants',
      funding: 'loan_terms',
      escrow: 'loan_terms',
      other: 'loan_terms',
    };
    const formKey = sectionToFormKey[section] || section;
    return isFormViewOnly(formKey);
  };

  // Entry orchestration for external users
  const {
    mode: orchestrationMode,
    canEdit: orchestrationCanEdit,
    isWaiting,
    currentParticipant,
    blockingParticipant,
    hasCompleted,
    loading: orchestrationLoading,
    completeSection,
  } = useEntryOrchestration(id || "");

  // External modification detection for CSR warning banner
  // Only fetch for the active workspace tab to reduce API calls
  const {
    hasExternalModifications,
    externalModifications,
    markAsReviewed,
    loading: modificationsLoading,
  } = useExternalModificationDetector(id || "", isActive);

  // Track dirty state in workspace - only sync from the workspace-managed instance
  // (the one with dealIdProp). The Outlet-rendered instance must NOT sync to avoid
  // two instances racing and resetting each other's dirty state.
  // Use a ref for workspace to avoid re-triggering on context object changes.
  const isWorkspaceInstance = !!dealIdProp;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  useEffect(() => {
    if (isWorkspaceInstance && workspaceRef.current && id) {
      workspaceRef.current.setFileDirty(id, isDirty);
    }
  }, [isDirty, id, isWorkspaceInstance]);

  // Register save function with workspace
  useEffect(() => {
    if (registerSaveFn && id) {
      registerSaveFn(id, async () => {
        computeCalculatedFields();
        const success = await saveDraft();
        if (success) resetDirty();
        return success;
      });
    }
    return () => {
      if (unregisterSaveFn && id) {
        unregisterSaveFn(id);
      }
    };
  }, [id, registerSaveFn, unregisterSaveFn, saveDraft, resetDirty, computeCalculatedFields]);

  // Calculate visible fields and sections for external users
  const {
    visibleSections,
    visibleFieldsBySection,
    visibleRequiredCount,
    visibleFilledRequiredCount,
    externalMissingFields,
  } = useMemo(() => {
    if (!isExternalUser) {
      // Internal users see everything
      const totalRequired = fields.filter((f) => f.is_required).length;
      const filledRequired = fields.filter((f) => f.is_required && values[f.field_key]?.trim()).length;
      return {
        visibleSections: sections,
        visibleFieldsBySection: fieldsBySection,
        visibleRequiredCount: totalRequired,
        visibleFilledRequiredCount: filledRequired,
        externalMissingFields: getMissingRequiredFields(),
      };
    }

    // For external users, filter fields by allowed_roles
    const filteredBySection: Record<FieldSection, typeof fields> = {} as any;
    let totalVisible = 0;
    let requiredCount = 0;
    let filledRequired = 0;
    const missing: typeof fields = [];

    sections.forEach((section) => {
      const sectionFields = fieldsBySection[section] || [];
      const visibleFields = sectionFields.filter((f) => checkCanView(f.field_key));
      if (visibleFields.length > 0) {
        filteredBySection[section] = visibleFields;
        totalVisible += visibleFields.length;

        visibleFields.forEach((f) => {
          if (f.is_required) {
            requiredCount++;
            if (values[f.field_key]?.trim()) {
              filledRequired++;
            } else {
              missing.push(f);
            }
          }
        });
      }
    });

    const visibleSectionList = sections.filter((s) => filteredBySection[s]?.length > 0);

    return {
      visibleSections: visibleSectionList,
      visibleFieldsBySection: filteredBySection,
      visibleRequiredCount: requiredCount,
      visibleFilledRequiredCount: filledRequired,
      externalMissingFields: missing,
    };
  }, [isExternalUser, sections, fieldsBySection, fields, values, checkCanView, getMissingRequiredFields]);

  // Set initial active tab when sections load (use visible sections for external users)
  useEffect(() => {
    const targetSections = isExternalUser ? visibleSections : sections;
    if (targetSections.length > 0 && !activeTab) {
      // Default to loan_terms if available, otherwise first section
      const defaultTab = targetSections.includes('loan_terms' as any) ? 'loan_terms' : targetSections[0];
      setActiveTab(defaultTab as string);
    }
  }, [sections, visibleSections, activeTab, isExternalUser]);

  // Auto-revert to Draft if a required field is changed when status is Ready or Generated
  useEffect(() => {
    if ((deal?.status === "ready" || deal?.status === "generated") && hasRequiredFieldChanged() && isDirty) {
      // Revert status to draft
      revertToDraft();
    }
  }, [values, deal?.status, hasRequiredFieldChanged, isDirty]);

  const revertToDraft = async () => {
    const wasGenerated = deal?.status === "generated";

    try {
      const { error } = await supabase.from("deals").update({ status: "draft" }).eq("id", id);

      if (error) throw error;

      // Log the revert
      if (id) {
        await logDealRevertedToDraft(id, {
          reason: wasGenerated
            ? "Required field modified after documents were generated"
            : "Required field modified after ready status",
          previousStatus: deal?.status,
        });
      }

      setDeal((prev) => (prev ? { ...prev, status: "draft" } : null));

      toast({
        title: "Status changed to Draft",
        description: wasGenerated
          ? "File status was reverted because a required field was modified. Documents should be regenerated."
          : "File status was reverted because a required field was modified",
        variant: wasGenerated ? "destructive" : "default",
      });
    } catch (error) {
      console.error("Error reverting to draft:", error);
    }
  };

  const performSave = async () => {
    setShowValidation(true);

    // Block save when Sold Rate / Penalty Distribution allocations are invalid.
    const balancesCheck = validateBalancesSoldRate(values);
    if (!balancesCheck.ok) {
      setActiveTab('loan_terms');
      setSubSection('loan_terms', 'balances_loan_details');
      toast({
        title: 'Cannot save',
        description: 'Please complete the allocate remaining percentage in subsequent fields before saving',
        variant: 'destructive',
      });
      return;
    }
    const penaltyCheck = validatePenaltyDistributions(values);
    if (!penaltyCheck.ok) {
      setActiveTab('loan_terms');
      setSubSection('loan_terms', 'penalties');
      toast({
        title: 'Cannot save',
        description: 'Please complete the allocate remaining percentage in subsequent fields before saving',
        variant: 'destructive',
      });
      return;
    }

    // Run calculations before saving
    computeCalculatedFields();
    const success = await saveDraft();
    if (success) {
      // Log the save activity
      if (id) {
        const filledCount = Object.values(values).filter((v) => v && String(v).trim() !== "").length;
        await logDealUpdated(id, {
          fieldsUpdated: filledCount,
          fieldsTotal: visibleFieldKeys.length,
        });
      }

      resetDirty();
      if (workspace && id) {
        workspace.setFileDirty(id, false);
      }
      // Refresh deal to get updated timestamp
      fetchDeal();
      const missing = getMissingRequiredFields();
      if (missing.length > 0) {
        toast({
          title: "Saved with incomplete fields",
          description: `${missing.length} required field${missing.length > 1 ? "s" : ""} still missing`,
          variant: "default",
        });
      }
    }
  };

  const handleSave = async () => {
    if (isDirty) {
      setShowSaveConfirm(true);
    } else {
      // Nothing to save
      toast({
        title: "No changes",
        description: "There are no unsaved changes to save.",
      });
    }
  };

  const handleSaveConfirmed = async () => {
    setShowSaveConfirm(false);
    await performSave();
  };

  // Centralized refresh handler that checks for unsaved changes
  const handleGridRefresh = useCallback(() => {
    if (isDirty) {
      setShowRefreshConfirm(true);
    } else {
      // No unsaved changes, just reload grid data
      refetchData();
    }
  }, [isDirty, refetchData]);

  const handleRefreshSave = async () => {
    setShowRefreshConfirm(false);
    await performSave();
    refetchData();
  };

  const handleRefreshDiscard = () => {
    setShowRefreshConfirm(false);
    resetDirty();
    refetchData();
  };

  const handleRefreshCancel = () => {
    setShowRefreshConfirm(false);
  };

  const handleMarkReady = async () => {
    if (!isPacketComplete()) {
      toast({
        title: "Cannot mark ready",
        description: "Please complete all required fields first",
        variant: "destructive",
      });
      return;
    }

    // Block mark-ready when Sold Rate / Penalty Distribution allocations are invalid.
    const balancesCheck = validateBalancesSoldRate(values);
    if (!balancesCheck.ok) {
      setShowValidation(true);
      setActiveTab('loan_terms');
      setSubSection('loan_terms', 'balances_loan_details');
      toast({
        title: 'Cannot mark ready',
        description: 'Please complete the allocate remaining percentage in subsequent fields before saving',
        variant: 'destructive',
      });
      return;
    }
    const penaltyCheck = validatePenaltyDistributions(values);
    if (!penaltyCheck.ok) {
      setShowValidation(true);
      setActiveTab('loan_terms');
      setSubSection('loan_terms', 'penalties');
      toast({
        title: 'Cannot mark ready',
        description: 'Please complete the allocate remaining percentage in subsequent fields before saving',
        variant: 'destructive',
      });
      return;
    }

    setMarkingReady(true);
    try {
      // Run calculations before saving
      computeCalculatedFields();

      // Save first
      const saveSuccess = await saveDraft();
      if (!saveSuccess) return;

      // Update deal status to ready
      const { error } = await supabase.from("deals").update({ status: "ready" }).eq("id", id);

      if (error) throw error;

      // Log the mark ready activity
      if (id) {
        await logDealMarkedReady(id, {
          requiredFieldsCount: requiredFieldKeys.length,
        });
      }

      resetDirty();
      if (workspace && id) {
        workspace.setFileDirty(id, false);
      }
      toast({
        title: "File marked as ready",
        description: "All required fields are complete",
      });

      // Update local state
      setDeal((prev) => (prev ? { ...prev, status: "ready" } : null));
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to mark file as ready",
        variant: "destructive",
      });
    } finally {
      setMarkingReady(false);
    }
  };

  const jumpToFirstMissing = () => {
    const missing = getMissingRequiredFields();
    if (missing.length === 0) return;

    const firstMissing = missing[0];
    // Switch to the tab containing the first missing field
    setActiveTab(firstMissing.section);
    setShowValidation(true);

    // Scroll to the field after tab switch
    setTimeout(() => {
      const element = document.getElementById(`field-${firstMissing.field_key}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        // Focus the input
        const input = element.querySelector("input, textarea");
        if (input) {
          (input as HTMLElement).focus();
        }
      }
    }, 100);
  };

  // Handle Complete Section for external users
  const handleCompleteSection = async () => {
    // Validate that required fields visible to this user are filled
    const missing = isExternalUser ? externalMissingFields : getMissingRequiredFields();
    if (missing.length > 0) {
      setShowValidation(true);
      toast({
        title: "Cannot complete section",
        description: `Please fill in all ${missing.length} required field(s) first`,
        variant: "destructive",
      });
      return;
    }

    setCompletingSection(true);
    try {
      // Save first
      computeCalculatedFields();
      const saveSuccess = await saveDraft();
      if (!saveSuccess) {
        throw new Error("Failed to save changes");
      }

      // Complete the section
      const success = await completeSection();
      if (!success) {
        throw new Error("Failed to complete section");
      }

      toast({
        title: "Section completed",
        description: "Thank you! Your section has been submitted successfully.",
      });

      resetDirty();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to complete section",
        variant: "destructive",
      });
    } finally {
      setCompletingSection(false);
    }
  };

  // Calculate missing/progress based on user type
  const totalMissing = isExternalUser ? externalMissingFields.length : getMissingRequiredFields().length;
  const canMarkReady = isPacketComplete() && deal?.status === "draft";
  const showCompleteSectionButton = isExternalUser && currentParticipant && !hasCompleted && orchestrationCanEdit;
  const progressPercent =
    visibleRequiredCount > 0 ? Math.round((visibleFilledRequiredCount / visibleRequiredCount) * 100) : 100;

  // Show lightweight skeleton for inactive tabs that haven't loaded yet
  if (!hasEverBeenActive && !isActive) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Waiting to load...</p>
        </div>
      </div>
    );
  }

  if (dealLoading) {
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
        <p className="text-muted-foreground mb-4">The file you're looking for doesn't exist.</p>
        <Button onClick={() => navigate("/deals")}>Back to Files</Button>
      </div>
    );
  }

  // Packet is no longer required - fields will load from field_dictionary if no packet

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(isExternalUser ? "/deals" : `/deals/${deal.id}`)}
                className="h-8 w-8"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-2xl font-bold text-foreground">
                {isExternalUser ? "Complete Your Information" : "Enter File Data"}
              </h1>
              {/* Show deal status for CSR only */}
              {isInternalUser && deal.status !== "draft" && (
                <Badge variant={deal.status === "ready" ? "default" : "secondary"} className="capitalize">
                  {deal.status}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              {deal.deal_number}
              {deal.state && deal.state !== 'TBD' ? ` • ${deal.state}` : ''}
              {deal.product_type && deal.product_type !== 'TBD' ? ` • ${deal.product_type}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Refresh button - refreshes grid data without full page reload */}
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={handleGridRefresh}
              disabled={saving}
              title="Refresh data"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Save button - always visible unless completed */}
            {(!isExternalUser || !hasCompleted) && (
              <Button
                onClick={handleSave}
                disabled={saving || (isExternalUser && !orchestrationCanEdit)}
                variant="outline"
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Draft
              </Button>
            )}

            {/* Mark Ready button - CSR only */}
            {isInternalUser && (
              <Button onClick={handleMarkReady} disabled={!canMarkReady || markingReady || saving} className="gap-2">
                {markingReady ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Mark File Ready
              </Button>
            )}

            {/* Complete Section button - External users only */}
            {showCompleteSectionButton && (
              <Button
                onClick={handleCompleteSection}
                disabled={completingSection || saving || totalMissing > 0}
                className="gap-2"
              >
                {completingSection ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Complete Section
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* External User Progress Banner */}
      {isExternalUser && !fieldsLoading && visibleSections.length > 0 && (
        <div className="mb-6 space-y-3">
          {/* Role and Status */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span>
              Logged in as{" "}
              <span className="font-medium text-foreground">
                {getRoleDisplayName((currentParticipant?.role as any) || "borrower")}
              </span>
            </span>
            {hasCompleted && (
              <Badge variant="secondary" className="bg-success/10 text-success border-success/20">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Completed
              </Badge>
            )}
          </div>

          {/* Progress bar */}
          <div className="px-4 py-4 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">Your Progress</span>
              <span className="text-sm text-muted-foreground">
                {visibleFilledRequiredCount} of {visibleRequiredCount} required fields
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {progressPercent === 100
                ? "All your required fields are complete! You can now submit your section."
                : `Complete the remaining ${totalMissing} required field${totalMissing > 1 ? "s" : ""} to submit.`}
            </p>
          </div>
        </div>
      )}

      {/* CSR External Modification Warning Banner */}
      {isInternalUser && !modificationsLoading && hasExternalModifications && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-orange-800 dark:text-orange-200">External data was modified</p>
                <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                  {externalModifications.length} field{externalModifications.length > 1 ? "s were" : " was"} updated by
                  external participants. Review before generating documents.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {externalModifications.slice(0, 5).map((mod) => (
                    <Badge
                      key={mod.field_key}
                      variant="outline"
                      className="text-xs bg-orange-100 dark:bg-orange-900/50 border-orange-300 dark:border-orange-700 text-orange-800 dark:text-orange-200"
                    >
                      {mod.field_key}
                    </Badge>
                  ))}
                  {externalModifications.length > 5 && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-orange-100 dark:bg-orange-900/50 border-orange-300 dark:border-orange-700 text-orange-800 dark:text-orange-200"
                    >
                      +{externalModifications.length - 5} more
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const success = await markAsReviewed();
                if (success) {
                  toast({
                    title: "Marked as reviewed",
                    description: "External modifications have been acknowledged",
                  });
                }
              }}
              className="gap-1.5 flex-shrink-0 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/50"
            >
              <Eye className="h-4 w-4" />
              Mark Reviewed
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      {fieldsLoading || permissionsLoading || formPermLoading ? (
        <div className="section-card flex items-center justify-center min-h-[300px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (isExternalUser ? visibleSections : sections).length === 0 ? (
        <div className="section-card text-center py-12">
          <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {isExternalUser ? "No Fields Available" : "No Fields Configured"}
          </h3>
          <p className="text-muted-foreground">
            {isExternalUser
              ? "There are no fields assigned to your role for this deal."
              : "No fields have been mapped to the templates in this packet."}
          </p>
        </div>
      ) : (
        <div className="section-card">
          <DirtyFieldsProvider dirtyFieldKeys={dirtyFieldKeys}>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6 flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
              {(() => {
                // Get base sections, filter out 'dates' (merged into other) and apply custom order
                const baseSections = (isExternalUser ? visibleSections : sections).filter(
                  (s) => SECTION_LABELS[s] && s !== "dates" && s !== "origination_fees",
                );

                // Add virtual tabs for internal users
                const allTabs = [...baseSections];
                if (isInternalUser) {
                  if (!allTabs.includes("participants" as any)) allTabs.push("participants" as any);
                  
                  if (!allTabs.includes("funding" as any)) allTabs.push("funding" as any);
                  
                  
                  if (!allTabs.includes("event_journal" as any)) allTabs.push("event_journal" as any);
                }

                // Sort by SECTION_ORDER
                allTabs.sort((a, b) => {
                  const idxA = SECTION_ORDER.indexOf(a);
                  const idxB = SECTION_ORDER.indexOf(b);
                  return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
                });

                return allTabs.map((section) => {
                  const sectionFields = isExternalUser
                    ? visibleFieldsBySection[section as FieldSection] || []
                    : fieldsBySection[section as FieldSection] || [];

                  const sectionMissing = sectionFields.filter(
                    (f) => f.is_required && !values[f.field_key]?.trim(),
                  ).length;
                  const isComplete = sectionMissing === 0;
                  const hasRequiredFields = sectionFields.some((f) => f.is_required);

                  // Check if any field in this section has been modified (dirty)
                  // For dictionary fields: exact key match
                  // For 'other' tab: exclude origination-prefixed keys (those belong to the origination_fees tab)
                  const ORIGINATION_PREFIXES = ['origination_fees.', 'origination_app.', 'origination_svc.', 'origination_esc.', 'origination_ins.'];
                  const sectionHasDirtyFields = sectionFields.some((f) => {
                    if (!dirtyFieldKeys.has(f.field_key)) return false;
                    if (section === 'other' && ORIGINATION_PREFIXES.some(p => f.field_key.startsWith(p))) return false;
                    return true;
                  });
                  
                  // For multi-entity sections: check prefixed dirty keys (e.g., borrower1.xxx, property2.xxx)
                  const SECTION_PREFIX_MAP: Record<string, string[]> = {
                    borrower: ['borrower', 'coborrower', 'trust_ledger'],
                    property: ['property', 'insurance', 'lien'],
                    charges: ['charge'],
                    lender: ['lender'],
                    broker: ['broker'],
                    notes: ['note'],
                  };
                  const prefixes = SECTION_PREFIX_MAP[section] || [];

                  // For virtual tabs (funding, escrow) that share loan_terms fields
                  // Only highlight if dirty keys match section-specific prefixes, not ALL loan_terms fields
                  const VIRTUAL_TAB_DIRTY_PREFIXES: Record<string, string[]> = {
                    funding: ['loan_terms.funding'],
                    escrow: ['loan_terms.escrow', 'loan_terms.reserve', 'loan_terms.to_escrow'],
                  };
                  const virtualPrefixes = VIRTUAL_TAB_DIRTY_PREFIXES[section] || [];
                  const fallbackHasDirty = virtualPrefixes.length > 0 && Array.from(dirtyFieldKeys).some(key =>
                    virtualPrefixes.some(vp => key.startsWith(vp))
                  );
                  const sectionHasPrefixedDirty = prefixes.length > 0 && Array.from(dirtyFieldKeys).some(key => 
                    prefixes.some(p => key.match(new RegExp(`^${p}\\d+\\.`)))
                  );

                  return (
                    <TabsTrigger
                      key={section}
                      value={section}
                      className={cn(
                        "gap-2 data-[state=active]:bg-background relative",
                        !isComplete && hasRequiredFields && showValidation && "text-warning",
                        (sectionHasDirtyFields || sectionHasPrefixedDirty || fallbackHasDirty) && "bg-warning/10 ring-1 ring-warning/30",
                      )}
                    >
                      {SECTION_LABELS[section as keyof typeof SECTION_LABELS]}

                      {!isComplete && hasRequiredFields && (
                        <Badge variant="destructive" className="h-5 min-w-[20px] px-1.5 text-xs font-medium">
                          {sectionMissing}
                        </Badge>
                      )}

                      {isComplete && hasRequiredFields && <CheckCircle2 className="h-4 w-4 text-success" />}
                    </TabsTrigger>
                  );
                });
              })()}

              {/* Origination Fees - Custom UI Tab (always visible for internal users) */}
              {isInternalUser && (
                <TabsTrigger value="origination_fees" className={cn("gap-2 data-[state=active]:bg-background relative", Array.from(dirtyFieldKeys).some(k => k.match(/^origination_(fees|app|svc|esc|ins)\./)) && "bg-warning/10 ring-1 ring-warning/30")}>
                  {SECTION_LABELS["origination_fees"]}
                </TabsTrigger>
              )}

              {/* Attachments - Coming Soon tab */}
              {isInternalUser && (
                <TabsTrigger value="attachments" className="gap-2 data-[state=active]:bg-background">
                  Attachments
                </TabsTrigger>
              )}
            </TabsList>

            {(isExternalUser ? visibleSections : sections)
              .filter((s) => SECTION_LABELS[s] && s !== "dates" && s !== "origination_fees")
              .map((section) => (
                <TabsContent key={section} value={section} forceMount className={cn("animate-fade-in", activeTab !== section && "hidden")}>
                  {section === "property" ? (
                    <PropertySectionContent
                      fields={isExternalUser ? visibleFieldsBySection[section] || [] : fieldsBySection[section] || []}
                      values={values}
                      onValueChange={updateValue}
                      onRemoveValuesByPrefix={removeValuesByPrefix}
                      onPersist={async () => {
                        computeCalculatedFields();
                        const success = await saveDraft();
                        if (success) resetDirty();
                        return success;
                      }}
                      showValidation={showValidation}
                      disabled={(isExternalUser && (!orchestrationCanEdit || hasCompleted)) || isSectionDisabledByFormPerm(section)}
                      calculationResults={calculationResults}
                    />
                  ) : section === "loan_terms" ? (
                    <LoanTermsSectionContent
                      fields={isExternalUser ? visibleFieldsBySection[section] || [] : fieldsBySection[section] || []}
                      values={values}
                      onValueChange={updateValue}
                      showValidation={showValidation}
                      disabled={(isExternalUser && (!orchestrationCanEdit || hasCompleted)) || isSectionDisabledByFormPerm(section)}
                      calculationResults={calculationResults}
                      dealId={id || ""}
                      escrowFields={isExternalUser ? visibleFieldsBySection['escrow'] || [] : fieldsBySection['escrow'] || []}
                    />
                  ) : section === "charges" ? (
                    <ChargesSectionContent
                      fields={isExternalUser ? visibleFieldsBySection[section] || [] : fieldsBySection[section] || []}
                      values={values}
                      onValueChange={updateValue}
                      onRemoveValuesByPrefix={removeValuesByPrefix}
                      showValidation={showValidation}
                      disabled={(isExternalUser && (!orchestrationCanEdit || hasCompleted)) || isSectionDisabledByFormPerm(section)}
                      calculationResults={calculationResults}
                    />
                  ) : section === "notes" ? (
                    <NotesSectionContent
                      fields={isExternalUser ? visibleFieldsBySection[section] || [] : fieldsBySection[section] || []}
                      values={values}
                      onValueChange={updateValue}
                      onRemoveValuesByPrefix={removeValuesByPrefix}
                      showValidation={showValidation}
                      disabled={(isExternalUser && (!orchestrationCanEdit || hasCompleted)) || isSectionDisabledByFormPerm(section)}
                      calculationResults={calculationResults}
                      dealNumber={deal.deal_number}
                      dealId={deal.id}
                      userName={user?.email || ''}
                      onRefresh={handleGridRefresh}
                      onPersist={async () => {
                        computeCalculatedFields();
                        const success = await saveDraft({ silent: true });
                        if (success) resetDirty();
                        return success;
                      }}
                    />
                  ) : section === "other" ? (
                    <DealSectionTab
                      fields={[
                        ...(isExternalUser ? visibleFieldsBySection[section] || [] : fieldsBySection[section] || []),
                        ...(isExternalUser
                          ? visibleFieldsBySection["dates" as FieldSection] || []
                          : fieldsBySection["dates" as FieldSection] || []),
                      ]}
                      values={values}
                      onValueChange={updateValue}
                      missingRequiredFields={[
                        ...(isExternalUser ? visibleFieldsBySection[section] || [] : fieldsBySection[section] || []),
                        ...(isExternalUser
                          ? visibleFieldsBySection["dates" as FieldSection] || []
                          : fieldsBySection["dates" as FieldSection] || []),
                      ].filter((f) => f.is_required && !values[f.field_key]?.trim())}
                      showValidation={showValidation}
                      calculationResults={calculationResults}
                      orchestrationCanEdit={isSectionDisabledByFormPerm('other') ? false : orchestrationCanEdit}
                      isWaitingForPrevious={isWaiting}
                      blockingRole={blockingParticipant?.role}
                      hasCompleted={hasCompleted}
                      hideValidationStatus={true}
                    />
                  ) : (
                    <DealSectionTab
                      fields={isExternalUser ? visibleFieldsBySection[section] || [] : fieldsBySection[section] || []}
                      values={values}
                      onValueChange={updateValue}
                      missingRequiredFields={(isExternalUser
                        ? visibleFieldsBySection[section] || []
                        : fieldsBySection[section] || []
                      ).filter((f) => f.is_required && !values[f.field_key]?.trim())}
                      showValidation={showValidation}
                      calculationResults={calculationResults}
                      orchestrationCanEdit={isSectionDisabledByFormPerm(section) ? false : orchestrationCanEdit}
                      isWaitingForPrevious={isWaiting}
                      blockingRole={blockingParticipant?.role}
                      hasCompleted={hasCompleted}
                      hideValidationStatus={["charges", "dates", "escrow", "notes", "other"].includes(section)}
                    />
                  )}
                </TabsContent>
              ))}

            {/* Participants - standalone top-level tab */}
            <TabsContent value="participants" forceMount className={cn("animate-fade-in", activeTab !== "participants" && "hidden")}>
              <ParticipantsSectionContent
                dealId={id || ""}
                disabled={isSectionDisabledByFormPerm("participants")}
                onRefresh={handleGridRefresh}
              />
            </TabsContent>


            {/* Funding - standalone top-level tab */}
            <TabsContent value="funding" forceMount className={cn("animate-fade-in", activeTab !== "funding" && "hidden")}>
              <LoanTermsFundingForm
                fields={fieldsBySection["loan_terms" as FieldSection] || []}
                values={values}
                onValueChange={updateValue}
                saveDraft={saveDraft}
                showValidation={showValidation}
                disabled={(isExternalUser && (!orchestrationCanEdit || hasCompleted)) || isSectionDisabledByFormPerm("funding")}
                calculationResults={calculationResults}
                dealId={id || ""}
              />
            </TabsContent>


            {/* Event Journal */}
            <TabsContent value="event_journal" forceMount className={cn("animate-fade-in", activeTab !== "event_journal" && "hidden")}>
              <EventJournalViewer dealId={id || ""} disabled={isSectionDisabledByFormPerm("event_journal")} />
            </TabsContent>

            {/* Origination Fees - Custom UI Tab Content */}
            {isInternalUser && (
              <TabsContent value="origination_fees" forceMount className={cn("animate-fade-in", activeTab !== "origination_fees" && "hidden")}>
                <OriginationFeesSectionContent
                  fields={[]}
                  values={values}
                  onValueChange={updateValue}
                  showValidation={showValidation}
                  disabled={isSectionDisabledByFormPerm('origination_fees')}
                  calculationResults={calculationResults}
                />
              </TabsContent>
            )}

            {/* Attachments - Coming Soon */}
            {isInternalUser && (
              <TabsContent value="attachments" forceMount className={cn("animate-fade-in", activeTab !== "attachments" && "hidden")}>
                <div className="flex items-center justify-center min-h-[300px]">
                  <div className="text-center space-y-2">
                    <h1 className="text-4xl font-bold text-foreground tracking-tight" style={{ fontFamily: "'Brush Script MT', cursive" }}>
                      Coming
                    </h1>
                    <p className="text-3xl font-extrabold uppercase tracking-widest text-foreground/80">
                      SOON
                    </p>
                    <p className="text-sm text-muted-foreground pt-2">
                      Attachments is under development. Data will be available soon.
                    </p>
                  </div>
                </div>
              </TabsContent>
            )}
          </Tabs>
          </DirtyFieldsProvider>
        </div>
      )}

      {/* Save Confirmation Dialog */}
      <SaveConfirmationDialog
        open={showSaveConfirm}
        onConfirm={handleSaveConfirmed}
        onCancel={() => setShowSaveConfirm(false)}
      />

      {/* Refresh Confirmation Dialog */}
      <RefreshConfirmationDialog
        open={showRefreshConfirm}
        onSave={handleRefreshSave}
        onDiscard={handleRefreshDiscard}
        onCancel={handleRefreshCancel}
      />
    </div>
  );
};

// Wrapper component that provides the navigation context (used for direct route access)
export const DealDataEntryPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return (
    <DealNavigationProvider dealId={id} initialTab="loan_terms">
      <DealDataEntryInner />
    </DealNavigationProvider>
  );
};

export default DealDataEntryPage;
