import { supabase } from '@/services/supabase/client';
import { downloadFile, STORAGE_BUCKETS } from '@/services/supabase/storage';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

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
