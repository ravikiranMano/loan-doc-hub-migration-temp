import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export async function listPackets() {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>('/packets');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('packets').select('*').order('name');
  if (error) throw error;
  return data || [];
}

export async function fetchPacketById(id: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown>(`/packets/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('packets').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function listActivePackets() {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>('/packets?active=true');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('packets')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function listActiveTemplates() {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>('/templates?active=true');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function fetchPacketTemplateIds(packetId: string) {
  if (isNodeApiEnabled('documents')) {
    const rows = await apiClient.get<{ template_id: string }[]>(`/packets/${packetId}/templates`);
    return (rows || []).map((pt) => pt.template_id);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('packet_templates')
    .select('template_id')
    .eq('packet_id', packetId);
  if (error) throw error;
  return (data || []).map((pt) => pt.template_id);
}

export async function listPacketTemplatesWithJoin(packetId: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>(`/packets/${packetId}/templates`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('packet_templates')
    .select('*, templates(*)')
    .eq('packet_id', packetId)
    .order('display_order');
  if (error) throw error;
  return data || [];
}

export async function listPacketTemplates(packetId: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>(`/packets/${packetId}/templates`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('packet_templates')
    .select('*')
    .eq('packet_id', packetId);
  if (error) throw error;
  return data || [];
}

export async function insertPacket(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.post('/packets', payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('packets').insert(payload);
  if (error) throw error;
}

export async function updatePacket(id: string, payload: Record<string, unknown>) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.patch(`/packets/${id}`, payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('packets').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deletePacket(id: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.delete(`/packets/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('packets').delete().eq('id', id);
  if (error) throw error;
}

export async function insertPacketTemplate(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('documents')) {
    const packetId = payload['packet_id'] as string;
    const body = {
      template_id: payload['template_id'],
      display_order: payload['display_order'],
      is_required: payload['is_required'],
    };
    return apiClient.post(`/packets/${packetId}/templates`, body);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('packet_templates').insert(payload);
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

export async function deletePacketTemplate(id: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.delete(`/packet-templates/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('packet_templates').delete().eq('id', id);
  if (error) throw error;
}
