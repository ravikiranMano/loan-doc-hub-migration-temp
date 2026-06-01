import { listDealsByIds } from '@/services/deals/deals.service';
import { fetchSectionValuesForDeals, fetchSectionValuesBySection } from '@/services/deals/section-values.service';
import { listParticipantsByContact } from '@/services/deals/participants.service';

export interface ContactPortfolioDealIdsOptions {
  contactDbId: string;
  /** Optional human contact_id for borrower-section JSON fallback scan. */
  externalId?: string;
  fallbackSection?: 'borrower';
}

/** Resolve deal IDs linked to a contact (participants + optional section JSON fallback). */
export async function resolveContactPortfolioDealIds(
  options: ContactPortfolioDealIdsOptions,
): Promise<string[]> {
  const { contactDbId, externalId, fallbackSection = 'borrower' } = options;

  const participants = (await listParticipantsByContact(contactDbId, 'deal_id')) as Array<{
    deal_id: string;
  }>;
  let dealIds = [...new Set(participants.map((p) => p.deal_id).filter(Boolean))];

  if (dealIds.length === 0 && (contactDbId || externalId)) {
    const borrowerSections = await fetchSectionValuesBySection(fallbackSection);
    const matched: string[] = [];
    (borrowerSections || []).forEach((bs) => {
      const row = bs as { deal_id: string; field_values?: Record<string, unknown> };
      const fv = row.field_values;
      if (!fv) return;
      const flat = JSON.stringify(fv);
      if (
        (contactDbId && flat.includes(contactDbId)) ||
        (externalId && flat.includes(externalId))
      ) {
        matched.push(row.deal_id);
      }
    });
    dealIds = [...new Set(matched)];
  }

  return dealIds;
}

export async function fetchContactPortfolioDealContext(dealIds: string[]) {
  if (!dealIds.length) {
    return {
      dealsMap: new Map<string, Record<string, unknown>>(),
      loanTermsMap: new Map<string, Record<string, unknown>>(),
      borrowerMap: new Map<string, Record<string, unknown>>(),
    };
  }

  const deals = (await listDealsByIds(
    dealIds,
    'id, deal_number, borrower_name, loan_amount, status, property_address, product_type',
  )) as Record<string, unknown>[];

  const dealsMap = new Map(deals.map((d) => [d.id as string, d]));

  const loanTermsSv = await fetchSectionValuesForDeals(dealIds, { section: 'loan_terms' });
  const loanTermsMap = new Map<string, Record<string, unknown>>();
  (loanTermsSv || []).forEach((sv) => {
    const row = sv as { deal_id: string; field_values: Record<string, unknown> };
    loanTermsMap.set(row.deal_id, row.field_values);
  });

  const borrowerSv = await fetchSectionValuesForDeals(dealIds, { section: 'borrower' });
  const borrowerMap = new Map<string, Record<string, unknown>>();
  (borrowerSv || []).forEach((sv) => {
    const row = sv as { deal_id: string; field_values: Record<string, unknown> };
    borrowerMap.set(row.deal_id, row.field_values);
  });

  return { dealsMap, loanTermsMap, borrowerMap };
}
