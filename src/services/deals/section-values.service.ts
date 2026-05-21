import { supabase } from '@/services/supabase/client';
import { fetchAllRows } from '@/services/supabase/pagination';
import type { Database } from '@/services/supabase/types';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

type FieldSection = Database['public']['Enums']['field_section'];

export async function fetchSectionValuesByDeal(dealId: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/sections`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_section_values')
    .select('section, field_values')
    .eq('deal_id', dealId);
  if (error) throw error;
  return data || [];
}

export async function fetchSectionValuesByDealWithUpdatedAt(dealId: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/sections`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_section_values')
    .select('section, field_values, updated_at')
    .eq('deal_id', dealId);
  if (error) throw error;
  return data || [];
}

export async function fetchLoanTermsSectionRows(dealId: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/sections/loan_terms`).then((r) => r ? [r] : []);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_section_values')
    .select('id, field_values, version')
    .eq('deal_id', dealId)
    .eq('section', 'loan_terms');
  if (error) throw error;
  return data || [];
}

export async function insertLoanTermsSectionRow(
  dealId: string,
  fieldValues: Record<string, unknown>
) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.patch(`/deals/${dealId}/sections/loan_terms`, { field_values: fieldValues });
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('deal_section_values').insert({
    deal_id: dealId,
    section: 'loan_terms',
    field_values: fieldValues,
    version: 1,
  });
  if (error) throw error;
}

export async function fetchSectionValuesWithVersion(dealId: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/sections`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_section_values')
    .select('id, section, field_values, version')
    .eq('deal_id', dealId);
  if (error) throw error;
  return data || [];
}

export async function fetchSectionValueByDealAndSection(
  dealId: string,
  section: string
) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown>(`/deals/${dealId}/sections/${section}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_section_values')
    .select('id, field_values')
    .eq('deal_id', dealId)
    .eq('section', section)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateSectionValueById(
  id: string,
  payload: Record<string, unknown>
) {
  if (isNodeApiEnabled('deals')) {
    const dealId = payload['deal_id'] as string | undefined;
    const section = payload['section'] as string | undefined;
    if (dealId && section) {
      return apiClient.patch(`/deals/${dealId}/sections/${section}`, { field_values: payload['field_values'] });
    }
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('deal_section_values').update(payload).eq('id', id);
  if (error) throw error;
}

export async function insertSectionValues(rows: Record<string, unknown>[]) {
  if (isNodeApiEnabled('deals')) {
    return Promise.all(
      rows.map((row) =>
        apiClient.patch(`/deals/${row['deal_id']}/sections/${row['section']}`, {
          field_values: row['field_values'],
        })
      )
    );
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('deal_section_values').insert(rows);
  if (error) throw error;
}

export async function upsertParticipantsSectionValues(
  dealId: string,
  fieldValues: Record<string, unknown>
) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.patch(`/deals/${dealId}/sections/participants`, { field_values: fieldValues });
  }
  // — Supabase (keep unchanged) —
  const existing = await fetchSectionValueByDealAndSection(dealId, 'participants');
  if ((existing as { id?: string })?.id) {
    await updateSectionValueById((existing as { id: string }).id, {
      field_values: fieldValues,
      updated_at: new Date().toISOString(),
    });
  } else {
    await insertSectionValues([{ deal_id: dealId, section: 'participants', field_values: fieldValues }]);
  }
}

export async function fetchFieldDictionaryTmoSections(sections: FieldSection[]) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/admin/fields?sections=${sections.join(',')}`);
  }
  return fetchAllRows((client) =>
    client
      .from('field_dictionary')
      .select(
        'id, field_key, label, section, data_type, description, default_value, is_calculated, is_repeatable, validation_rule, calculation_formula, calculation_dependencies'
      )
      .in('section', sections)
  );
}

export async function fetchFieldDictionaryByIds(ids: string[]) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/admin/fields?ids=${ids.join(',')}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('field_dictionary')
    .select('id, field_key, data_type')
    .in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function fetchFieldDictionaryByFieldKeys(keys: string[]) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>('/admin/fields');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('field_dictionary')
    .select('id, field_key, section, data_type')
    .in('field_key', keys);
  if (error) throw error;
  return data || [];
}

export async function fetchFieldDictionarySelect(columns: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>('/admin/fields');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('field_dictionary').select(columns);
  if (error) throw error;
  return data || [];
}

export async function fetchSectionValuesBySection(section: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/sections/by-section/${section}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_section_values')
    .select('deal_id, field_values')
    .eq('section', section);
  if (error) throw error;
  return data || [];
}

export async function fetchSectionValuesForDeals(
  dealIds: string[],
  options?: { section?: string; sections?: string[] }
) {
  if (isNodeApiEnabled('deals') && dealIds.length > 0) {
    const params = new URLSearchParams({ dealIds: dealIds.join(',') });
    if (options?.section) params.set('section', options.section);
    if (options?.sections?.length) params.set('sections', options.sections.join(','));
    return apiClient.get<unknown[]>(`/deals/sections?${params}`);
  }
  // — Supabase (keep unchanged) —
  let query = supabase
    .from('deal_section_values')
    .select('deal_id, field_values, section')
    .in('deal_id', dealIds);
  if (options?.section) query = query.eq('section', options.section);
  if (options?.sections?.length) query = query.in('section', options.sections);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
