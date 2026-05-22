import { supabase } from '@/services/supabase/client';
import { fetchAllRows } from '@/services/supabase/pagination';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

/** Coalesce concurrent GET /templates/:id/field-maps (same template). */
const fieldMapsInflight = new Map<string, Promise<unknown[]>>();

function fetchTemplateFieldMapsFromApi(templateId: string): Promise<unknown[]> {
  const existing = fieldMapsInflight.get(templateId);
  if (existing) return existing;

  const promise = apiClient
    .get<unknown[]>(`/templates/${templateId}/field-maps`)
    .finally(() => fieldMapsInflight.delete(templateId));

  fieldMapsInflight.set(templateId, promise);
  return promise;
}

export function clearTemplateFieldMapsInflight(templateId?: string) {
  if (templateId) fieldMapsInflight.delete(templateId);
  else fieldMapsInflight.clear();
}

export async function fetchFieldMapsByTemplateIds(templateIds: string[]) {
  if (isNodeApiEnabled('documents')) {
    if (!templateIds.length) return [];
    return apiClient.get<unknown[]>(
      `/templates/field-maps/batch?templateIds=${templateIds.join(',')}`,
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('template_field_maps')
    .select('field_dictionary_id, required_flag, transform_rule')
    .in('template_id', templateIds);
  if (error) throw error;
  return data || [];
}

export async function listTemplateFieldMapsWithFields(templateId: string) {
  if (isNodeApiEnabled('documents')) {
    return fetchTemplateFieldMapsFromApi(templateId);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('template_field_maps')
    .select('*, field_dictionary!fk_template_field_maps_field_dictionary(*)')
    .eq('template_id', templateId)
    .order('display_order');
  if (error) throw error;
  return data || [];
}

export async function listTemplateFieldMaps(templateId: string) {
  if (isNodeApiEnabled('documents')) {
    return fetchTemplateFieldMapsFromApi(templateId);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('template_field_maps')
    .select('*')
    .eq('template_id', templateId);
  if (error) throw error;
  return data || [];
}

export async function insertTemplateFieldMap(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('documents')) {
    const templateId = payload['template_id'] as string;
    const body = {
      field_dictionary_id: payload['field_dictionary_id'],
      required_flag: payload['required_flag'],
      transform_rule: payload['transform_rule'],
      display_order: payload['display_order'],
    };
    const result = await apiClient.post(`/templates/${templateId}/field-maps`, body);
    clearTemplateFieldMapsInflight(templateId);
    return result;
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('template_field_maps').insert(payload);
  if (error) throw error;
}

export async function updateTemplateFieldMap(id: string, payload: Record<string, unknown>) {
  if (isNodeApiEnabled('documents')) {
    const templateId = payload['template_id'] as string | undefined;
    const body = {
      field_dictionary_id: payload['field_dictionary_id'],
      required_flag: payload['required_flag'],
      transform_rule: payload['transform_rule'],
      display_order: payload['display_order'],
    };
    if (!templateId) throw new Error('template_id is required to update a field map via Node API');
    const result = await apiClient.patch(`/templates/${templateId}/field-maps/${id}`, body);
    if (templateId) clearTemplateFieldMapsInflight(templateId);
    return result;
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('template_field_maps').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteTemplateFieldMap(id: string, templateId?: string) {
  if (isNodeApiEnabled('documents')) {
    if (!templateId) throw new Error('templateId is required to delete a field map via Node API');
    const result = await apiClient.delete(`/templates/${templateId}/field-maps/${id}`);
    clearTemplateFieldMapsInflight(templateId);
    return result;
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('template_field_maps').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteTemplateFieldMapsByTemplate(templateId: string) {
  if (isNodeApiEnabled('documents')) {
    const result = await apiClient.delete(`/templates/${templateId}/field-maps`);
    clearTemplateFieldMapsInflight(templateId);
    return result;
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('template_field_maps')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function fetchAllFieldDictionaryOrdered() {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>('/admin/fields');
  }
  return fetchAllRows((client) =>
    client.from('field_dictionary').select('*').order('section, label')
  );
}

export async function listPacketTemplatesByPacketIds(packetIds: string[]) {
  if (isNodeApiEnabled('documents')) {
    if (!packetIds.length) return [];
    return apiClient.get<unknown[]>(
      `/packets/templates/batch?packetIds=${packetIds.join(',')}`,
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('packet_templates')
    .select('*')
    .in('packet_id', packetIds);
  if (error) throw error;
  return data || [];
}
