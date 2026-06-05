import { apiClient } from '@/services/node-api/client';

export async function fetchSectionValuesByDeal(dealId: string) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/sections`);
}

export async function fetchSectionValuesByDealWithUpdatedAt(dealId: string) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/sections`);
}

export async function fetchLoanTermsSectionRows(dealId: string) {
  return apiClient
    .get<unknown[]>(`/deals/${dealId}/sections/loan_terms`)
    .then((r) => (r ? [r] : []));
}

export async function insertLoanTermsSectionRow(
  dealId: string,
  fieldValues: Record<string, unknown>,
) {
  return apiClient.patch(`/deals/${dealId}/sections/loan_terms`, { field_values: fieldValues });
}

export async function fetchSectionValuesWithVersion(dealId: string) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/sections`);
}

export async function fetchSectionValueByDealAndSection(dealId: string, section: string) {
  return apiClient.get<unknown>(`/deals/${dealId}/sections/${section}`);
}

export async function updateSectionValueById(
  _id: string,
  payload: Record<string, unknown>,
  ctx?: { dealId?: string; section?: string },
) {
  const dealId = (payload['deal_id'] as string | undefined) ?? ctx?.dealId;
  const section = (payload['section'] as string | undefined) ?? ctx?.section;
  if (!dealId || !section) {
    throw new Error('Section update requires deal_id and section');
  }
  return apiClient.patch(`/deals/${dealId}/sections/${encodeURIComponent(section)}`, {
    field_values: payload['field_values'],
  });
}

export async function insertSectionValues(rows: Record<string, unknown>[]) {
  return Promise.all(
    rows.map((row) =>
      apiClient.patch(
        `/deals/${row['deal_id']}/sections/${encodeURIComponent(String(row['section']))}`,
        { field_values: row['field_values'] },
      ),
    ),
  );
}

export async function upsertParticipantsSectionValues(
  dealId: string,
  fieldValues: Record<string, unknown>,
) {
  return apiClient.patch(`/deals/${dealId}/sections/participants`, {
    field_values: fieldValues,
  });
}

export async function fetchFieldDictionaryTmoSections(sections: string[]) {
  return apiClient.get<unknown[]>(`/admin/fields?sections=${sections.join(',')}`);
}

export async function fetchFieldDictionaryByIds(ids: string[]) {
  if (!ids.length) return [];
  return apiClient.post<unknown[]>('/admin/fields/by-ids', { ids });
}

export async function fetchFieldDictionaryByFieldKeys(keys: string[]) {
  if (!keys.length) return [];
  return apiClient.post<unknown[]>('/admin/fields/by-keys', { field_keys: keys });
}

export async function fetchFieldDictionarySelect(_columns: string) {
  return apiClient.get<unknown[]>('/admin/fields');
}

export async function fetchSectionValuesBySection(section: string) {
  return apiClient.get<unknown[]>(`/deals/sections/by-section/${section}`);
}

export async function fetchSectionValuesForDeals(
  dealIds: string[],
  options?: { section?: string; sections?: string[] },
) {
  if (!dealIds.length) return [];
  const params = new URLSearchParams({ dealIds: dealIds.join(',') });
  if (options?.section) params.set('section', options.section);
  if (options?.sections?.length) params.set('sections', options.sections.join(','));
  return apiClient.get<unknown[]>(`/deals/sections?${params}`);
}
