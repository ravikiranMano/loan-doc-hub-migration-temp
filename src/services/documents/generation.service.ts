import { supabase } from '@/services/supabase/client';
import { invokeGenerateDocument } from '@/services/supabase/functions';
import { downloadFile, STORAGE_BUCKETS } from '@/services/supabase/storage';

export { invokeGenerateDocument };

export async function listGeneratedDocuments(dealId?: string) {
  let query = supabase.from('generated_documents').select('*');
  if (dealId) query = query.eq('deal_id', dealId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listGeneratedDocumentsByDealIds(dealIds: string[]) {
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
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteGeneratedDocumentsByTemplate(templateId: string) {
  const { error } = await supabase
    .from('generated_documents')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function deleteGenerationJobsByTemplate(templateId: string) {
  const { error } = await supabase
    .from('generation_jobs')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function deletePacketTemplatesByTemplate(templateId: string) {
  const { error } = await supabase
    .from('packet_templates')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function deleteTemplateFieldMapsByTemplate(templateId: string) {
  const { error } = await supabase
    .from('template_field_maps')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function downloadGeneratedDoc(path: string) {
  return downloadFile(STORAGE_BUCKETS.generatedDocs, path);
}
