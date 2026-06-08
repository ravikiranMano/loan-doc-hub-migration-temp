import { apiClient } from '@/services/client';

/** Coalesce concurrent GET /templates/:id/field-maps (same template). */
const fieldMapsInflight = new Map<string, Promise<Record<string, unknown>[]>>();

function normalizeFieldMapRow(fm: Record<string, unknown>) {
  const dict = (fm.field_dictionary ?? fm.field) as Record<string, unknown> | null | undefined;
  return {
    ...fm,
    display_order: (fm.display_order as number | null | undefined) ?? 0,
    field_dictionary: dict ?? null,
  };
}

function fetchTemplateFieldMapsFromApi(templateId: string): Promise<Record<string, unknown>[]> {
  const key = templateId.trim();
  const existing = fieldMapsInflight.get(key);
  if (existing) return existing;

  const promise = apiClient
    .get<Record<string, unknown>[]>(
      `/templates/${encodeURIComponent(key)}/field-maps`,
    )
    .then((rows) => (Array.isArray(rows) ? rows : []).map(normalizeFieldMapRow))
    .finally(() => fieldMapsInflight.delete(key));

  fieldMapsInflight.set(key, promise);
  return promise;
}

export function clearTemplateFieldMapsInflight(templateId?: string) {
  if (templateId) fieldMapsInflight.delete(templateId.trim());
  else fieldMapsInflight.clear();
}

export async function fetchFieldMapsByTemplateIds(templateIds: string[]) {
  if (!templateIds.length) return [];
  return apiClient.get<unknown[]>(
    `/templates/field-maps/batch?templateIds=${templateIds.join(',')}`,
  );
}

export async function listTemplateFieldMapsWithFields(templateId: string) {
  return fetchTemplateFieldMapsFromApi(templateId);
}

export async function listTemplateFieldMaps(templateId: string) {
  return fetchTemplateFieldMapsFromApi(templateId);
}

export async function insertTemplateFieldMap(payload: Record<string, unknown>) {
  const templateId = payload['template_id'] as string;
  const body = {
    field_dictionary_id: payload['field_dictionary_id'],
    required_flag: payload['required_flag'],
    transform_rule: payload['transform_rule'],
    display_order: payload['display_order'],
  };
  const result = await apiClient.post<Record<string, unknown>>(
    `/templates/${encodeURIComponent(templateId)}/field-maps`,
    body,
  );
  clearTemplateFieldMapsInflight(templateId);
  return normalizeFieldMapRow(result);
}

export async function updateTemplateFieldMap(id: string, payload: Record<string, unknown>) {
  const templateId = payload['template_id'] as string | undefined;
  const body = {
    field_dictionary_id: payload['field_dictionary_id'],
    required_flag: payload['required_flag'],
    transform_rule: payload['transform_rule'],
    display_order: payload['display_order'],
  };
  if (!templateId) throw new Error('template_id is required to update a field map');
  const result = await apiClient.patch<Record<string, unknown>>(
    `/templates/${encodeURIComponent(templateId)}/field-maps/${encodeURIComponent(id)}`,
    body,
  );
  clearTemplateFieldMapsInflight(templateId);
  return normalizeFieldMapRow(result);
}

export async function deleteTemplateFieldMap(id: string, templateId?: string) {
  if (!templateId) throw new Error('templateId is required to delete a field map');
  const result = await apiClient.delete(
    `/templates/${encodeURIComponent(templateId)}/field-maps/${encodeURIComponent(id)}`,
  );
  clearTemplateFieldMapsInflight(templateId);
  return result;
}

export async function deleteTemplateFieldMapsByTemplate(templateId: string) {
  const result = await apiClient.delete(
    `/templates/${encodeURIComponent(templateId)}/field-maps`,
  );
  clearTemplateFieldMapsInflight(templateId);
  return result;
}

export async function fetchAllFieldDictionaryOrdered() {
  return apiClient.get<unknown[]>('/admin/fields');
}

export async function listPacketTemplatesByPacketIds(packetIds: string[]) {
  if (!packetIds.length) return [];
  return apiClient.get<unknown[]>(
    `/packets/templates/batch?packetIds=${packetIds.join(',')}`,
  );
}
