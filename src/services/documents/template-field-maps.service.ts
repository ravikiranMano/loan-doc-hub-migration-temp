import { supabase } from '@/services/supabase/client';
import { fetchAllRows } from '@/services/supabase/pagination';

export async function fetchFieldMapsByTemplateIds(templateIds: string[]) {
  const { data, error } = await supabase
    .from('template_field_maps')
    .select('field_dictionary_id, required_flag, transform_rule')
    .in('template_id', templateIds);
  if (error) throw error;
  return data || [];
}

export async function listTemplateFieldMapsWithFields(templateId: string) {
  const { data, error } = await supabase
    .from('template_field_maps')
    .select('*, field_dictionary!fk_template_field_maps_field_dictionary(*)')
    .eq('template_id', templateId)
    .order('display_order');
  if (error) throw error;
  return data || [];
}

export async function listTemplateFieldMaps(templateId: string) {
  const { data, error } = await supabase
    .from('template_field_maps')
    .select('*')
    .eq('template_id', templateId);
  if (error) throw error;
  return data || [];
}

export async function insertTemplateFieldMap(payload: Record<string, unknown>) {
  const { error } = await supabase.from('template_field_maps').insert(payload);
  if (error) throw error;
}

export async function updateTemplateFieldMap(id: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from('template_field_maps').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteTemplateFieldMap(id: string) {
  const { error } = await supabase.from('template_field_maps').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteTemplateFieldMapsByTemplate(templateId: string) {
  const { error } = await supabase
    .from('template_field_maps')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function fetchAllFieldDictionaryOrdered() {
  return fetchAllRows((client) =>
    client.from('field_dictionary').select('*').order('section, label')
  );
}

export async function listPacketTemplatesByPacketIds(packetIds: string[]) {
  const { data, error } = await supabase
    .from('packet_templates')
    .select('*')
    .in('packet_id', packetIds);
  if (error) throw error;
  return data || [];
}
