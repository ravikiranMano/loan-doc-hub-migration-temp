import { PrismaService } from '../../prisma/prisma.service';
import type { ResolvedDealField } from './deal-field-values.loader';

/**
 * One row for docxtemplater `{{#lenders}}` loops.
 * Field names mirror generate-document `lendersN.*` / `lender_N_*` (edge ~1269–1394).
 */
export interface LenderLoopRow {
  index: number;
  type: string;
  isIndividual: string;
  vesting: string;
  firstName: string;
  middle: string;
  last: string;
  fullName: string;
  firstIfEntityUse: string;
  displayName: string;
  email: string;
  phone: string;
  contactId: string;
  label: string;
  isPrimary: string;
  exists: string;
  shortName: string;
  proRata: string;
  fundingAmount: string;
  fundsDepositedDate: string;
}

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  contact_data: unknown;
};

const withTrailingSpace = (v: string): string => {
  const t = v.trim();
  return t ? `${t} ` : '';
};

function fv(fieldValues: Map<string, ResolvedDealField> | undefined, key: string): string {
  if (!fieldValues) return '';
  return (fieldValues.get(key)?.rawValue ?? '').toString().trim();
}

/** First non-empty value among deal merge keys (CSR uses lender1.*, lender.*, and ld_p_*). */
function fvAny(fieldValues: Map<string, ResolvedDealField> | undefined, keys: string[]): string {
  for (const key of keys) {
    const v = fv(fieldValues, key);
    if (v) return v;
  }
  return '';
}

function pick(...vals: string[]): string {
  for (const v of vals) {
    const t = v.trim();
    if (t) return t;
  }
  return '';
}

/** Mirrors generate-document injectContact + lender loop contact reads (~698–707, 1275–1287). */
function readContactLenderFields(
  contact: ContactRow | undefined,
  participantContactId: string | null,
): Omit<LenderLoopRow, 'index' | 'label' | 'isPrimary' | 'exists' | 'shortName' | 'proRata' | 'fundingAmount' | 'fundsDepositedDate'> {
  const cd = (contact?.contact_data ?? {}) as Record<string, unknown>;
  const firstName = pick(String(cd.first_name ?? ''), contact?.first_name ?? '');
  const middle = pick(String(cd.middle_initial ?? ''), String(cd.middle_name ?? ''));
  const last = pick(String(cd.last_name ?? ''), contact?.last_name ?? '');
  const assembled = [firstName, middle, last].filter(Boolean).join(' ');
  const fullName = pick(assembled, String(cd.full_name ?? ''), contact?.full_name ?? '');
  const type = String(cd.type ?? '').trim();
  const vesting =
    cd.vesting !== undefined && cd.vesting !== null ? String(cd.vesting).trim() : '';
  const email = pick(String(cd.email ?? ''), contact?.email ?? '');
  const phone = pick(
    String(cd['phone.cell'] ?? ''),
    String(cd['phone.work'] ?? ''),
    String(cd['phone.home'] ?? ''),
    String(cd.phone ?? ''),
    contact?.phone ?? '',
  );
  const contactId = pick(
    String(cd.contact_id ?? ''),
    participantContactId ?? '',
    contact?.id ?? '',
  );
  const isIndividual = type.toLowerCase() === 'individual';
  const displayName = isIndividual ? assembled || fullName : vesting;

  return {
    type,
    isIndividual: isIndividual ? 'true' : 'false',
    vesting,
    firstName,
    middle,
    last,
    fullName,
    firstIfEntityUse: withTrailingSpace(firstName),
    displayName,
    email,
    phone,
    contactId,
  };
}

/** Keys used when CSR saves Lender Info (indexed lenderN.*, canonical lender.*, merge ld_p_*). */
function sectionKeyVariants(n: number, dotSuffix: string, ldSuffix: string): string[] {
  const keys = [`lender${n}.${dotSuffix}`, `ld_p_${ldSuffix}_${n}`];
  if (n === 1) {
    keys.push(`lender.${dotSuffix}`, `ld_p_${ldSuffix}`);
  }
  return keys;
}

/** Deal section / merge-tag keys from deal_section_values (authoritative when contact is empty). */
function readSectionLenderFields(
  n: number,
  fieldValues: Map<string, ResolvedDealField> | undefined,
): Partial<ReturnType<typeof readContactLenderFields>> {
  if (!fieldValues) return {};

  const firstName = fvAny(fieldValues, sectionKeyVariants(n, 'first_name', 'firstName'));
  const middle = fvAny(
    fieldValues,
    [
      ...sectionKeyVariants(n, 'middle_name', 'middleName'),
      ...sectionKeyVariants(n, 'middle_initial', 'middleInitia'),
    ],
  );
  const last = fvAny(fieldValues, sectionKeyVariants(n, 'last_name', 'lastName'));
  const assembled = [firstName, middle, last].filter(Boolean).join(' ');
  const fullName = pick(
    assembled,
    fvAny(fieldValues, sectionKeyVariants(n, 'full_name', 'fullName')),
    fv(fieldValues, 'ld_p_lenderName'),
    fv(fieldValues, 'lender.name'),
  );
  const type = fvAny(fieldValues, sectionKeyVariants(n, 'type', 'lenderType'));
  const vesting = fvAny(fieldValues, [
    ...sectionKeyVariants(n, 'vesting', 'vesting'),
    ...(n === 1 ? ['ld_p_vestin', 'ld_p_vesting'] : []),
  ]);
  const isIndividual = type.toLowerCase() === 'individual';
  const displayName = isIndividual ? assembled || fullName : pick(vesting, fullName, assembled);

  return {
    type,
    isIndividual: type ? (isIndividual ? 'true' : 'false') : undefined,
    vesting,
    firstName,
    middle,
    last,
    fullName,
    firstIfEntityUse: firstName ? withTrailingSpace(firstName) : undefined,
    displayName,
    email: fvAny(fieldValues, sectionKeyVariants(n, 'email', 'email')),
    phone: fvAny(fieldValues, [
      ...sectionKeyVariants(n, 'phone.cell', 'cellPhone'),
      ...sectionKeyVariants(n, 'phone.work', 'workPhone'),
      ...sectionKeyVariants(n, 'phone.home', 'homePhone'),
      `lender${n}.phone`,
      ...(n === 1 ? ['lender.phone', 'ld_p_phone'] : []),
    ]),
  };
}

/** Prefer CSR deal fields, then contact (contact often empty when only deal form is filled). */
function mergeLenderFields(
  section: Partial<ReturnType<typeof readContactLenderFields>>,
  contact: ReturnType<typeof readContactLenderFields>,
): ReturnType<typeof readContactLenderFields> {
  const type = pick(section.type ?? '', contact.type);
  const firstName = pick(section.firstName ?? '', contact.firstName);
  const middle = pick(section.middle ?? '', contact.middle);
  const last = pick(section.last ?? '', contact.last);
  const assembled = [firstName, middle, last].filter(Boolean).join(' ');
  const fullName = pick(section.fullName ?? '', contact.fullName, assembled);
  const vesting = pick(section.vesting ?? '', contact.vesting);
  const isIndividual = type.toLowerCase() === 'individual';
  const displayName = isIndividual
    ? pick(section.displayName ?? '', assembled, fullName, contact.displayName)
    : pick(section.displayName ?? '', vesting, fullName, assembled, contact.displayName);

  return {
    type,
    isIndividual: isIndividual ? 'true' : 'false',
    vesting,
    firstName,
    middle,
    last,
    fullName,
    firstIfEntityUse: withTrailingSpace(firstName),
    displayName,
    email: pick(section.email ?? '', contact.email),
    phone: pick(section.phone ?? '', contact.phone),
    contactId: contact.contactId,
  };
}

function parseFundingRecords(
  fieldValues: Map<string, ResolvedDealField> | undefined,
): Array<Record<string, unknown>> {
  if (!fieldValues) return [];
  const raw =
    fieldValues.get('loan_terms.funding_records')?.rawValue ??
    fieldValues.get('ln_p_fundingRecord')?.rawValue;
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function fmtCurrency(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  const num = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num)) return String(v);
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtPct(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  const num = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num)) return String(v);
  const pct = num > 1 ? num : num * 100;
  return `${pct.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function fmtDate(v: unknown): string {
  if (!v) return '';
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : s;
}

function enrichFromFunding(
  row: LenderLoopRow,
  lpContactId: string | null,
  idx: number,
  fundingRecords: Array<Record<string, unknown>>,
): LenderLoopRow {
  if (!fundingRecords.length) return row;
  const frec =
    fundingRecords.find(
      (r) =>
        (r.lenderContactId && r.lenderContactId === lpContactId) ||
        (r.lenderAccount && row.contactId && r.lenderAccount === row.contactId),
    ) ?? fundingRecords[idx] ?? null;
  if (!frec) return row;

  const shortName =
    row.displayName ||
    row.vesting ||
    [row.firstName, row.last].filter(Boolean).join(' ');

  return {
    ...row,
    shortName,
    proRata: fmtPct(frec.proRata),
    fundingAmount: fmtCurrency(frec.originalAmount),
    fundsDepositedDate: fmtDate(frec.fundingDate ?? frec.fundsDepositedDate),
  };
}

/** Load ordered lenders — participants + contacts merged with `lenderN.*` section keys. */
export async function loadDealLenders(
  prisma: PrismaService,
  dealId: string,
  fieldValues?: Map<string, ResolvedDealField>,
): Promise<LenderLoopRow[]> {
  const lenderParticipants = await prisma.deal_participants.findMany({
    where: { deal_id: dealId, role: 'lender' },
    select: { contact_id: true, sequence_order: true, created_at: true },
  });

  const ordered = [...lenderParticipants].sort((a, b) => {
    const aSeq =
      typeof a.sequence_order === 'number' ? a.sequence_order : Number.MAX_SAFE_INTEGER;
    const bSeq =
      typeof b.sequence_order === 'number' ? b.sequence_order : Number.MAX_SAFE_INTEGER;
    if (aSeq !== bSeq) return aSeq - bSeq;
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
  });

  const contactIds = ordered.map((p) => p.contact_id).filter(Boolean) as string[];
  if (contactIds.length === 0) return [];

  const contactRows = await prisma.contacts.findMany({
    where: { id: { in: contactIds } },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      full_name: true,
      email: true,
      phone: true,
      contact_data: true,
    },
  });
  const contactById = new Map(contactRows.map((c) => [c.id, c]));
  const fundingRecords = parseFundingRecords(fieldValues);

  const lenders: LenderLoopRow[] = [];
  ordered.forEach((lp, idx) => {
    const n = idx + 1;
    const contact = lp.contact_id ? contactById.get(lp.contact_id) : undefined;
    if (!contact && !lp.contact_id) return;

    const fromContact = readContactLenderFields(contact, lp.contact_id);
    const fromSection = readSectionLenderFields(n, fieldValues);
    const merged = mergeLenderFields(fromSection, fromContact);

    let row: LenderLoopRow = {
      index: n,
      ...merged,
      label: `LENDER ${n}`,
      isPrimary: n === 1 ? 'true' : 'false',
      exists: 'true',
      shortName: '',
      proRata: '',
      fundingAmount: '',
      fundsDepositedDate: '',
    };
    row = enrichFromFunding(row, lp.contact_id, idx, fundingRecords);
    if (!row.shortName) {
      row.shortName =
        row.displayName ||
        row.vesting ||
        [row.firstName, row.last].filter(Boolean).join(' ');
    }
    lenders.push(row);
  });

  return lenders;
}

/** Additional lenders only (edge `additionalLendersN.*`, lender 2+). */
export function buildAdditionalLendersArray(lenders: LenderLoopRow[]): LenderLoopRow[] {
  return lenders.filter((l) => l.isPrimary !== 'true').map((row, idx) => ({
    ...row,
    index: idx + 1,
    label: `ADDITIONAL LENDER ${idx + 1}`,
    isPrimary: 'false',
  }));
}

/**
 * Publish all lender merge keys (edge ~1055–1394, 1165–1213).
 * Uses setIfEmpty for ld_p_* / lender1.* where edge used setIfEmpty; set for indexed/repeater keys.
 */
export function publishLenderAliases(
  fieldValues: Map<string, ResolvedDealField>,
  lenders: LenderLoopRow[],
): void {
  if (lenders.length === 0) return;

  const setIfEmpty = (key: string, raw: string) => {
    if (!raw) return;
    const existing = fieldValues.get(key)?.rawValue;
    if (existing != null && String(existing).trim() !== '') return;
    fieldValues.set(key, { rawValue: raw, dataType: 'text' });
  };

  /** Never wipe CSR/deal values with empty strings (was clearing ld_p_* after load). */
  const set = (key: string, raw: string) => {
    if (!raw.trim()) return;
    fieldValues.set(key, { rawValue: raw, dataType: 'text' });
  };

  const primary = lenders[0];

  // Primary injectContact + bridges (edge ~1053–1090)
  setIfEmpty('ld_p_firstName', primary.firstName);
  setIfEmpty('ld_p_middleName', primary.middle);
  setIfEmpty('ld_p_lastName', primary.last);
  setIfEmpty('ld_p_lenderName', primary.displayName);
  setIfEmpty('lender.name', primary.displayName);
  setIfEmpty('Lender.Name', primary.displayName);
  setIfEmpty('ld_p_fullNameIfEntity', primary.fullName || primary.displayName);
  if (primary.type) {
    setIfEmpty('ld_p_lenderType', primary.type);
    setIfEmpty('lender1.type', primary.type);
    setIfEmpty('lender.type', primary.type);
  }
  const primaryVesting =
    primary.vesting ||
    lenders.map((l) => l.vesting).find((v) => v.trim() !== '') ||
    '';
  if (primaryVesting) {
    setIfEmpty('ld_p_vesting', primaryVesting);
    setIfEmpty('ld_p_vestin', primaryVesting);
    setIfEmpty('lender.vesting', primaryVesting);
    setIfEmpty('lender1.vesting', primaryVesting);
  }

  // IQ aliases (edge ~5938–5959)
  set('ld_p_firstIfEntityUse', primary.firstIfEntityUse);
  set('ld_p_middle', withTrailingSpace(primary.middle));
  set('ld_p_last', primary.last);

  // Bare ld_p_* = primary only — non-empty only so deal_section_values are not cleared
  set('ld_p_firstName', primary.firstName);
  set('ld_p_middleName', primary.middle);
  set('ld_p_lastName', primary.last);
  set('ld_p_fullName', primary.fullName);
  set('ld_p_vesting', primaryVesting || primary.vesting);
  set('ld_p_vestin', primaryVesting || primary.vesting);

  const investorNames = lenders.map((l) => l.displayName).filter(Boolean);
  set('ld_p_allInvestorNames', investorNames.join('\n'));
  set('lender_count', String(lenders.length));
  set('has_multiple_lenders', lenders.length > 1 ? 'true' : 'false');
  set('additional_lender_count', String(Math.max(0, lenders.length - 1)));

  // Primary convenience inside {{#lenders}} (edge ~1369–1380)
  setIfEmpty('type', primary.type);
  setIfEmpty('vesting', primary.vesting);
  setIfEmpty('firstName', primary.firstName);
  setIfEmpty('middle', primary.middle);
  setIfEmpty('last', primary.last);
  setIfEmpty('isIndividual', primary.isIndividual);
  setIfEmpty('ld_p_isIndividual', primary.isIndividual);
  setIfEmpty('ld_p_displayName', primary.displayName);
  setIfEmpty('ld_p_investorName', primary.displayName);
  setIfEmpty('ld_p_entityName', primary.isIndividual === 'true' ? '' : primary.vesting);

  let additionalIdx = 0;
  for (const row of lenders) {
    const n = row.index;
    const snake = `lender${n}.`;
    const prefix = `lender_${n}_`;
    const dotted = `lenders${n}.`;

    // Dot-notation source keys (edge ~1182–1187)
    set(`${snake}first_name`, row.firstName);
    set(`${snake}middle_name`, row.middle);
    set(`${snake}last_name`, row.last);
    set(`${snake}full_name`, row.fullName);
    set(`${snake}vesting`, row.vesting);
    if (row.type) set(`${snake}type`, row.type);

    // Per-index ld_p_*_N (edge ~1188–1193)
    set(`ld_p_firstName_${n}`, row.firstName);
    set(`ld_p_middleName_${n}`, row.middle);
    set(`ld_p_lastName_${n}`, row.last);
    set(`ld_p_fullName_${n}`, row.fullName);
    set(`ld_p_vesting_${n}`, row.vesting);

    const flatPairs: [string, string][] = [
      [`${prefix}type`, row.type],
      [`${prefix}vesting`, row.vesting],
      [`${prefix}firstName`, row.firstName],
      [`${prefix}middle`, row.middle],
      [`${prefix}last`, row.last],
      [`${prefix}displayName`, row.displayName],
      [`${prefix}isIndividual`, row.isIndividual],
      [`${prefix}exists`, row.exists],
      [`${prefix}email`, row.email],
      [`${prefix}phone`, row.phone],
      [`${prefix}contactId`, row.contactId],
      [`${prefix}label`, row.label],
      [`${prefix}isPrimary`, row.isPrimary],
      [`${dotted}index`, String(n)],
      [`${dotted}type`, row.type],
      [`${dotted}vesting`, row.vesting],
      [`${dotted}firstName`, row.firstName],
      [`${dotted}middle`, row.middle],
      [`${dotted}last`, row.last],
      [`${dotted}displayName`, row.displayName],
      [`${dotted}isIndividual`, row.isIndividual],
      [`${dotted}exists`, row.exists],
      [`${dotted}email`, row.email],
      [`${dotted}phone`, row.phone],
      [`${dotted}contactId`, row.contactId],
      [`${dotted}label`, row.label],
      [`${dotted}isPrimary`, row.isPrimary],
      [`${dotted}firstIfEntityUse`, row.firstIfEntityUse],
      [`${dotted}shortName`, row.shortName],
      [`${dotted}proRata`, row.proRata],
      [`${dotted}fundingAmount`, row.fundingAmount],
      [`${dotted}fundsDepositedDate`, row.fundsDepositedDate],
    ];
    for (const [key, val] of flatPairs) set(key, val);

    if (row.isPrimary !== 'true') {
      additionalIdx++;
      const a = additionalIdx;
      const ad = `additionalLenders${a}.`;
      const addPairs: [string, string][] = [
        [`${ad}index`, String(a)],
        [`${ad}type`, row.type],
        [`${ad}vesting`, row.vesting],
        [`${ad}firstName`, row.firstName],
        [`${ad}middle`, row.middle],
        [`${ad}last`, row.last],
        [`${ad}displayName`, row.displayName],
        [`${ad}isIndividual`, row.isIndividual],
        [`${ad}exists`, row.exists],
        [`${ad}email`, row.email],
        [`${ad}phone`, row.phone],
        [`${ad}contactId`, row.contactId],
        [`${ad}label`, `ADDITIONAL LENDER ${a}`],
        [`${ad}isPrimary`, 'false'],
      ];
      for (const [key, val] of addPairs) set(key, val);
    }
  }
}
