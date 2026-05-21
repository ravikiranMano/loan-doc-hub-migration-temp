import { supabase } from '@/services/supabase/client';

export async function listPackets() {
  const { data, error } = await supabase.from('packets').select('*').order('name');
  if (error) throw error;
  return data || [];
}

export async function fetchPacketById(id: string) {
  const { data, error } = await supabase.from('packets').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function listActivePackets() {
  const { data, error } = await supabase
    .from('packets')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function listActiveTemplates() {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function fetchPacketTemplateIds(packetId: string) {
  const { data, error } = await supabase
    .from('packet_templates')
    .select('template_id')
    .eq('packet_id', packetId);
  if (error) throw error;
  return (data || []).map((pt) => pt.template_id);
}

export async function listPacketTemplatesWithJoin(packetId: string) {
  const { data, error } = await supabase
    .from('packet_templates')
    .select('*, templates(*)')
    .eq('packet_id', packetId)
    .order('display_order');
  if (error) throw error;
  return data || [];
}

export async function listPacketTemplates(packetId: string) {
  const { data, error } = await supabase
    .from('packet_templates')
    .select('*')
    .eq('packet_id', packetId);
  if (error) throw error;
  return data || [];
}

export async function insertPacket(payload: Record<string, unknown>) {
  const { error } = await supabase.from('packets').insert(payload);
  if (error) throw error;
}

export async function updatePacket(id: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from('packets').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deletePacket(id: string) {
  const { error } = await supabase.from('packets').delete().eq('id', id);
  if (error) throw error;
}

export async function insertPacketTemplate(payload: Record<string, unknown>) {
  const { error } = await supabase.from('packet_templates').insert(payload);
  if (error) throw error;
}

export async function deletePacketTemplatesByTemplate(templateId: string) {
  const { error } = await supabase
    .from('packet_templates')
    .delete()
    .eq('template_id', templateId);
  if (error) throw error;
}

export async function deletePacketTemplate(id: string) {
  const { error } = await supabase.from('packet_templates').delete().eq('id', id);
  if (error) throw error;
}
