import { supabase } from '@/services/supabase/client';
import { downloadFile, STORAGE_BUCKETS } from '@/services/supabase/storage';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

const nodeApiBase = (): string =>
  (import.meta.env.VITE_NODE_API_URL as string | undefined) || 'http://localhost:3000/api';

export interface GenerateDocumentBody {
  outputType: 'docx_only' | 'docx_and_pdf';
  templateId?: string;
  packetId?: string;
}

export interface GenerateDocumentResult {
  status?: string;
  jobId?: string;
  successCount: number;
  failCount: number;
  results: Array<{ templateName: string; success: boolean; error?: string }>;
}

export interface DocumentPayloadPreviewResult {
  dealId: string;
  dealNumber?: string;
  templateId: string;
  templateName: string;
  fieldCount: number;
  totalKeysInMap: number;
  data: Record<string, string>;
  /** v2 only: conditionals from docxtemplater inspect. */
  templateConditions?: TemplateConditionV2[];
}

/**
 * Document generation runs on the Supabase `generate-document` edge function.
 * The Nest route proxies there (cookie auth) — it does not reimplement merge logic.
 */
export async function generateDocument(
  dealId: string,
  body: GenerateDocumentBody,
): Promise<GenerateDocumentResult> {
  return apiClient.post<GenerateDocumentResult>(`/deals/${dealId}/documents/generate`, body);
}

/** Merge field map that would be sent to the DOCX engine (same pipeline as generate, stops before merge). */
export async function previewDocumentPayload(
  dealId: string,
  templateId: string,
): Promise<DocumentPayloadPreviewResult> {
  const q = encodeURIComponent(templateId);
  return apiClient.get<DocumentPayloadPreviewResult>(
    `/deals/${dealId}/documents/preview-payload?templateId=${q}`,
  );
}

export async function listGeneratedDocuments(dealId?: string) {
  if (isNodeApiEnabled('documents') && dealId) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/documents`);
  }
  // — Supabase (keep unchanged) —
  let query = supabase.from('generated_documents').select('*');
  if (dealId) query = query.eq('deal_id', dealId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listGeneratedDocumentsByDealIds(dealIds: string[]) {
  if (isNodeApiEnabled('documents')) {
    if (!dealIds.length) return [];
    return apiClient.get<unknown[]>(
      `/documents/generated?dealIds=${dealIds.map((id) => encodeURIComponent(id)).join(',')}`,
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('generated_documents')
    .select('*')
    .in('deal_id', dealIds)
    .eq('generation_status', 'success')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listGenerationJobs(dealId: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/documents/jobs`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteGeneratedDocumentsByTemplate(templateId: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.delete(`/templates/${templateId}/generated-documents`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('generated_documents')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function deleteGenerationJobsByTemplate(templateId: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.delete(`/templates/${templateId}/generation-jobs`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('generation_jobs')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function deletePacketTemplatesByTemplate(templateId: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.delete(`/templates/${templateId}/packet-templates`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('packet_templates')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function deleteTemplateFieldMapsByTemplate(templateId: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.delete(`/templates/${templateId}/field-maps`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('template_field_maps')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function downloadGeneratedDoc(path: string) {
  return downloadFile(STORAGE_BUCKETS.generatedDocs, path);
}

// ─── v2: docxtemplater engine ─────────────────────────────────────────────────

export interface TemplateConditionV2 {
  expression: string;
  driverField: string | null;
  operator: string | null;
  compareValue: string | null;
  fieldKeys: string[];
  driverValue?: string;
  driverResolved?: boolean;
  matchesCompare?: boolean;
}

export interface FieldDataV2Result {
  data: Record<string, unknown>;
  metadata: {
    dealId: string;
    dealNumber: string;
    templateId: string;
    templateName: string;
    filePath: string;
    fieldMapCount: number;
    resolvedCount: number;
    templateTagKeys?: string[];
    templateResolvedCount?: number;
    templateConditions?: TemplateConditionV2[];
    templateTagTree?: Record<string, unknown>;
    valueSource?: string;
  };
}

/** Returns the fully-resolved JSON that would be passed to docxtemplater for inspection. */
export async function getFieldDataV2(dealId: string, templateId: string): Promise<FieldDataV2Result> {
  const q = encodeURIComponent(templateId);
  return apiClient.get<FieldDataV2Result>(`/deals/${dealId}/documents/field-data-v2?templateId=${q}`);
}

/**
 * Generates a DOCX via the docxtemplater engine (v2) and triggers a browser download.
 * Returns the template name so the caller can show feedback.
 */
export async function generateDocumentV2(dealId: string, templateId: string): Promise<string> {
  const res = await fetch(`${nodeApiBase()}/deals/${dealId}/documents/generate-v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ templateId }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message ?? `v2 generation failed (${res.status})`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'generated_v2.docx';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return filename;
}
