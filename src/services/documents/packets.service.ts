import { apiClient } from '@/services/node-api/client';

export async function listPackets() {
  return apiClient.get<unknown[]>('/packets');
}

export async function fetchPacketById(id: string) {
  return apiClient.get<unknown>(`/packets/${id}`);
}

export async function listActivePackets() {
  return apiClient.get<unknown[]>('/packets?active=true');
}

export async function listActiveTemplates() {
  return apiClient.get<unknown[]>('/templates?active=true');
}

export async function fetchPacketTemplateIds(packetId: string) {
  const rows = await apiClient.get<{ template_id: string }[]>(`/packets/${packetId}/templates`);
  return (rows || []).map((pt) => pt.template_id);
}

export async function listPacketTemplatesWithJoin(packetId: string) {
  return apiClient.get<unknown[]>(`/packets/${packetId}/templates`);
}

export async function listPacketTemplates(packetId: string) {
  return apiClient.get<unknown[]>(`/packets/${packetId}/templates`);
}

export async function insertPacket(payload: Record<string, unknown>) {
  return apiClient.post('/packets', payload);
}

export async function updatePacket(id: string, payload: Record<string, unknown>) {
  return apiClient.patch(`/packets/${id}`, payload);
}

export async function deletePacket(id: string) {
  return apiClient.delete(`/packets/${id}`);
}

export async function insertPacketTemplate(payload: Record<string, unknown>) {
  const packetId = payload['packet_id'] as string;
  const body = {
    template_id: payload['template_id'],
    display_order: payload['display_order'],
    is_required: payload['is_required'],
  };
  return apiClient.post(`/packets/${packetId}/templates`, body);
}

export async function deletePacketTemplatesByTemplate(templateId: string) {
  return apiClient.delete(`/templates/${templateId}/packet-templates`);
}

export async function deletePacketTemplate(id: string) {
  return apiClient.delete(`/packet-templates/${id}`);
}
