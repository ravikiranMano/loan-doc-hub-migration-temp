import { ResolvedDealField } from './deal-field-values.loader';

const MAX_PROPERTIES = 5;

/** All per-property merge keys used inside {{#properties}} loops (no _N suffix). */
export const RE851D_PROPERTY_LOOP_KEYS = [
  'property_number',
  // Part 1 LTV / Part 2 summary
  'ln_p_remainingEncumbrance',
  'ln_p_expectedEncumbrance',
  'ln_p_totalEncumbrance',
  'ln_p_totalWithLoan',
  'ln_p_amountOfEquity',
  'ln_p_equitySecuringLoan',
  'ln_p_loanToValueRatio',
  // Part 2 property types
  'property_type_sfr_owner',
  'property_type_sfr_non_owner',
  'property_type_sfr_zoned',
  'property_type_commercial',
  'property_type_land_zoned',
  'property_type_land_income',
  'property_type_other',
  'property_type_other_text',
  // Property detail
  'pr_p_address',
  'pr_p_ownerName',
  'pr_p_owner',
  'pr_p_appraiseValue',
  'pr_p_appraiseDate',
  'pr_p_appraiserName',
  'pr_p_appraiserAddress',
  'pr_p_occupanc',
  'pr_p_construcType',
  'pr_p_descript',
  'pr_p_delinquHowMany',
  'pr_p_grossAnnualIncome',
  'pr_p_incomeGenerating',
  'pr_p_squareFeet',
  'pr_p_yearBuilt',
  'pr_pt_annualTaxes',
  'pr_pt_actual',
  'pr_pt_estimated',
  'pr_pt_actual_glyph',
  'pr_pt_estimated_glyph',
  'propertytax.delinquent',
  'propertytax.delinquent_amount',
  'propertytax.source_of_information',
  'pr_li_sourceOfInformation',
  'pr_li_sourceOfPayment',
  'pr_li_sourceInfoOtherText',
  'pr_li_currentDelinqu_yes_glyph',
  'pr_li_currentDelinqu_no_glyph',
  'pr_li_delinqu60day_yes_glyph',
  'pr_li_delinqu60day_no_glyph',
  'pr_li_delinquencyPaidByLoan_yes_glyph',
  'pr_li_delinquencyPaidByLoan_no_glyph',
  'pr_li_encumbranceOfRecord_yes_glyph',
  'pr_li_encumbranceOfRecord_no_glyph',
  'pr_li_sourceInfoBorrower_glyph',
  'pr_li_sourceInfoBroker_glyph',
  'pr_li_sourceInfoOther_glyph',
] as const;

/** Lien slot field bases (expanded to _1, _2 in template and data). */
const LIEN_SLOT_BASES = [
  'pr_li_rem_priority',
  'pr_li_rem_interestRate',
  'pr_li_rem_beneficiary',
  'pr_li_rem_originalAmount',
  'pr_li_rem_principalBalance',
  'pr_li_rem_monthlyPayment',
  'pr_li_rem_maturityDate',
  'pr_li_rem_balloonYes',
  'pr_li_rem_balloonNo',
  'pr_li_rem_balloonUnknown',
  'pr_li_rem_balloonAmount',
  'pr_li_ant_priority',
  'pr_li_ant_interestRate',
  'pr_li_ant_beneficiary',
  'pr_li_ant_originalAmount',
  'pr_li_ant_maturityDate',
  'pr_li_ant_monthlyPayment',
  'pr_li_ant_balloonYes',
  'pr_li_ant_balloonNo',
  'pr_li_ant_balloonUnknown',
  'pr_li_ant_balloonAmount',
];

const MAX_LIEN_SLOTS = 2;

const PR_KEY_TO_SUFFIX: Record<string, string> = {
  pr_p_street: 'street',
  pr_p_city: 'city',
  pr_p_state: 'state',
  pr_p_zip: 'zip',
  pr_p_county: 'county',
  pr_p_address: 'address',
  pr_p_apn: 'apn',
  pr_p_marketValue: 'marketValue',
  pr_p_legalDescri: 'legalDescription',
  pr_p_propertyTyp: 'propertyType',
  pr_p_occupancySt: 'occupancyStatus',
  pr_p_yearBuilt: 'yearBuilt',
  pr_p_lotSize: 'lotSize',
  pr_p_squareFeet: 'squareFeet',
  pr_p_numberOfUni: 'numberOfUnits',
  pr_p_country: 'country',
  pr_p_appraiseValue: 'appraised_value',
  pr_p_owner: 'owner',
  pr_p_remainingSenior: 'remaining_senior',
  pr_p_expectedSenior: 'expected_senior',
  pr_p_propertyType: 'appraisal_property_type',
  pr_p_occupanc: 'appraisal_occupancy',
  pr_p_appraiseDate: 'appraised_date',
  pr_p_ltv: 'ltv',
  pr_p_cltv: 'cltv',
  pr_p_descript: 'description',
  pr_p_purchasePrice: 'purchase_price',
  pr_p_downPayme: 'down_payment',
  pr_p_construcType: 'construction_type',
  pr_p_protectiveEquity: 'protective_equity',
  pr_p_zoning: 'zoning',
  pr_p_floodZone: 'flood_zone',
  pr_p_pledgedEquity: 'pledged_equity',
  pr_p_performedBy: 'appraisal_performed_by',
  pr_p_performeBy: 'appraisal_performed_by',
};

const PROP_PRESENCE_FIELDS = [
  'address',
  'street',
  'city',
  'state',
  'zip',
  'county',
  'legal_description',
];

type FieldMap = Map<string, ResolvedDealField>;

function getRaw(map: FieldMap, key: string): string {
  const v = map.get(key)?.rawValue;
  return v != null ? String(v).trim() : '';
}

function setField(map: FieldMap, key: string, raw: string, dataType = 'text'): void {
  map.set(key, { rawValue: raw, dataType });
}

function setBool(map: FieldMap, key: string, on: boolean): void {
  map.set(key, { rawValue: on ? 'true' : 'false', dataType: 'boolean' });
}

function setGlyph(map: FieldMap, key: string, on: boolean): void {
  map.set(key, { rawValue: on ? '☑' : '☐', dataType: 'text' });
}

function toBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'checked' || s === 'on';
}

function parseAmt(v: unknown): number {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function discoverPropertyIndices(map: FieldMap): number[] {
  const indices = new Set<number>();
  for (const key of map.keys()) {
    const m = key.match(/^property(\d+)\./i);
    if (m) indices.add(parseInt(m[1], 10));
  }
  for (let i = 1; i <= MAX_PROPERTIES; i++) {
    if (map.has(`property_number_${i}`) || map.has(`pr_p_address_${i}`)) indices.add(i);
  }
  if (indices.size === 0) indices.add(1);
  return [...indices].sort((a, b) => a - b).slice(0, MAX_PROPERTIES);
}

function realPropertyIndices(map: FieldMap, allIndices: number[]): number[] {
  const real = allIndices.filter((idx) => {
    const prefix = `property${idx}`;
    return PROP_PRESENCE_FIELDS.some((f) => getRaw(map, `${prefix}.${f}`) !== '');
  });
  return real.length > 0 ? real : allIndices.slice(0, 1);
}

function publishPropertyTypeCheckboxes(map: FieldMap, idx: number, prefix: string): void {
  const TYPE_ONLY_MAP: Record<string, string> = {
    'land sfr residential': 'property_type_sfr_zoned',
    'multi-family': 'property_type_commercial',
    'multi family': 'property_type_commercial',
    multifamily: 'property_type_commercial',
    commercial: 'property_type_commercial',
    'commercial income': 'property_type_commercial',
    'mixed-use': 'property_type_commercial',
    'mixed use': 'property_type_commercial',
    'condo / townhouse': 'property_type_commercial',
    'condo/townhouse': 'property_type_commercial',
    condo: 'property_type_commercial',
    townhouse: 'property_type_commercial',
    condominium: 'property_type_commercial',
    'land residential': 'property_type_land_zoned',
    'land commercial': 'property_type_land_zoned',
    'land income producing': 'property_type_land_income',
  };
  const SFR_ALIASES = new Set([
    'sfr 1-4', 'sfr1-4', 'sfr', 'single family', 'single-family', 'singlefamily', '1-4 family',
  ]);

  const ptRaw =
    getRaw(map, `pr_p_propertyTyp_${idx}`) ||
    getRaw(map, `pr_p_propertyType_${idx}`) ||
    getRaw(map, `${prefix}.propertyType`) ||
    getRaw(map, `${prefix}.appraisal_property_type`);
  if (!ptRaw) return;

  const ptLower = ptRaw.toLowerCase();
  const occRaw =
    getRaw(map, `pr_p_occupancySt_${idx}`) ||
    getRaw(map, `pr_p_occupanc_${idx}`) ||
    getRaw(map, `${prefix}.occupancyStatus`) ||
    getRaw(map, `${prefix}.appraisal_occupancy`);
  const occLower = occRaw.toLowerCase();
  const isOwnerOccupied = [
    'yes', 'y', 'true', 'owner occupied', 'owner-occupied', 'owneroccupied', 'owner', 'primary borrower',
  ].includes(occLower);

  let target = TYPE_ONLY_MAP[ptLower] ?? '';
  if (!target && (SFR_ALIASES.has(ptLower) || ptLower.includes('single family'))) {
    target = isOwnerOccupied ? 'property_type_sfr_owner' : 'property_type_sfr_non_owner';
  }
  if (!target) target = 'property_type_other';

  const targets = [
    'property_type_sfr_owner',
    'property_type_sfr_non_owner',
    'property_type_sfr_zoned',
    'property_type_commercial',
    'property_type_land_zoned',
    'property_type_land_income',
    'property_type_other',
  ];
  for (const t of targets) {
    const on = t === target;
    setBool(map, `${t}_${idx}`, on);
    setGlyph(map, `${t}_${idx}`, on);
  }
  if (target === 'property_type_other') {
    setField(map, `property_type_other_text_${idx}`, ptRaw);
  }

  let normalizedOcc = '';
  if (occLower === 'owner occupied') normalizedOcc = 'Owner Occupied';
  else if (occLower === 'tenant / other' || occLower === 'tenant/other' || occLower === 'tenant') {
    normalizedOcc = 'Tenant / Other';
  } else if (occLower === 'vacant') normalizedOcc = 'Vacant';
  else if (occLower === 'na') normalizedOcc = 'NA';
  else if (occRaw) normalizedOcc = occRaw;
  if (normalizedOcc) setField(map, `pr_p_occupanc_${idx}`, normalizedOcc);
}

function publishPropertyTaxFields(map: FieldMap, idx: number, prefix: string): void {
  const taxPrefix = `propertytax${idx}`;
  for (const [tf, dt] of [
    ['annual_payment', 'currency'],
    ['delinquent', 'boolean'],
    ['delinquent_amount', 'currency'],
    ['source_of_information', 'text'],
  ] as const) {
    let v =
      getRaw(map, `${taxPrefix}.${tf}`) ||
      (idx === 1 ? getRaw(map, `propertytax.${tf}`) : '');
    if (!v && tf === 'annual_payment') {
      v =
        getRaw(map, `${prefix}.annual_property_taxes`) ||
        getRaw(map, `${prefix}.annual_tax`) ||
        getRaw(map, `${prefix}.propertytax_annual_payment`);
    }
    if (!v) continue;
    setField(map, `propertytax_${tf}_${idx}`, v, dt);
    setField(map, `propertytax.${tf}_${idx}`, v, dt);
  }

  const annual =
    getRaw(map, `propertytax_annual_payment_${idx}`) ||
    getRaw(map, `${taxPrefix}.annual_payment`) ||
    getRaw(map, `${prefix}.annual_property_taxes`);
  if (annual) setField(map, `pr_pt_annualTaxes_${idx}`, annual, 'currency');

  const conf = (
    getRaw(map, `${taxPrefix}.tax_confidence`) || getRaw(map, `${prefix}.tax_confidence`)
  ).toLowerCase();
  setBool(map, `pr_pt_actual_${idx}`, conf === 'actual');
  setBool(map, `pr_pt_estimated_${idx}`, conf === 'estimated');
  setGlyph(map, `pr_pt_actual_${idx}_glyph`, conf === 'actual');
  setGlyph(map, `pr_pt_estimated_${idx}_glyph`, conf === 'estimated');

  const delRaw = (
    getRaw(map, `propertytax_delinquent_${idx}`) ||
    getRaw(map, `propertytax.delinquent_${idx}`) ||
    (idx === 1 ? getRaw(map, 'propertytax.delinquent') : '')
  ).toLowerCase();
  const isDelinq = ['true', 'yes', 'y', '1'].includes(delRaw);
  const isNo = ['false', 'no', 'n', '0'].includes(delRaw);
  if (isDelinq || isNo) {
    setBool(map, `propertytax.delinquent_${idx}`, isDelinq);
    setGlyph(map, `propertytax.delinquent_${idx}_yes_glyph`, isDelinq);
    setGlyph(map, `propertytax.delinquent_${idx}_no_glyph`, !isDelinq);
  }
}

function bridgePropertyFields(map: FieldMap, idx: number): void {
  const prefix = `property${idx}`;
  for (const [prKey, sfx] of Object.entries(PR_KEY_TO_SUFFIX)) {
    const outKey = `${prKey}_${idx}`;
    if (getRaw(map, outKey)) continue;
    const v = getRaw(map, `${prefix}.${sfx}`);
    if (v) setField(map, outKey, v, map.get(`${prefix}.${sfx}`)?.dataType ?? 'text');
  }

  if (!getRaw(map, `pr_p_address_${idx}`)) {
    const parts = [
      getRaw(map, `${prefix}.street`),
      getRaw(map, `${prefix}.city`),
      getRaw(map, `${prefix}.state`),
      getRaw(map, `${prefix}.country`),
      getRaw(map, `${prefix}.zip`),
    ].filter(Boolean);
    if (parts.length > 0) setField(map, `pr_p_address_${idx}`, parts.join(', '));
  }

  const owner =
    getRaw(map, `${prefix}.property_owner`) ||
    getRaw(map, `${prefix}.owner`) ||
    getRaw(map, `${prefix}.vesting`);
  if (owner) {
    setField(map, `pr_p_owner_${idx}`, owner);
    setField(map, `pr_p_ownerName_${idx}`, owner);
  }

  const appraise =
    getRaw(map, `${prefix}.appraised_value`) ||
    getRaw(map, `${prefix}.appraise_value`) ||
    getRaw(map, `${prefix}.appraiseValue`);
  if (appraise) setField(map, `pr_p_appraiseValue_${idx}`, appraise, 'currency');

  const performedBy =
    getRaw(map, `${prefix}.appraisal_performed_by`) ||
    getRaw(map, `pr_p_performedBy_${idx}`) ||
    getRaw(map, `pr_p_performeBy_${idx}`);
  if (performedBy) {
    setField(map, `pr_p_performedBy_${idx}`, performedBy);
    setField(map, `pr_p_performeBy_${idx}`, performedBy);
    const isBroker = performedBy.toLowerCase() === 'broker';
    setField(map, `pr_p_appraiserName_${idx}`, isBroker ? 'BPO Performed by Broker' : '');
    setField(map, `pr_p_appraiserAddress_${idx}`, isBroker ? 'N/A' : '');
  }

  const netRaw = getRaw(map, `${prefix}.net_monthly_income`);
  const net = netRaw ? parseAmt(netRaw) : 0;
  setField(map, `pr_p_netMonthlyIncome_${idx}`, String(net), 'number');
  setField(map, `pr_p_incomeGenerating_${idx}`, net > 0 ? 'Yes' : 'No');
  setField(map, `pr_p_grossAnnualIncome_${idx}`, String(net * 12), 'number');

  publishPropertyTypeCheckboxes(map, idx, prefix);
  publishPropertyTaxFields(map, idx, prefix);
  setField(map, `property_number_${idx}`, String(idx), 'number');
}

function rollupSeniorEncumbrances(map: FieldMap, propIndices: number[]): void {
  const normLbl = (v: unknown) =>
    String(v ?? '').toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
  const hasAmt = (raw: unknown) => parseAmt(raw) !== 0;

  const classify = (lp: string): 'anticipated' | 'remain' | 'payoff' | 'none' => {
    const get = (sfx: string) => map.get(`${lp}.${sfx}`)?.rawValue;
    const lbl = normLbl(get('condition'));
    if (lbl === 'existing - payoff' || lbl === 'payoff') return 'payoff';
    if (lbl === 'anticipated') return 'anticipated';
    if (lbl === 'will remain' || lbl === 'existing - remain' || lbl === 'remain') return 'remain';
    if (lbl === 'remain - paydown' || lbl === 'existing - paydown' || lbl === 'paydown') return 'remain';
    if (toBool(get('existing_payoff')) || toBool(get('existingPayoff'))) return 'payoff';
    if (toBool(get('existing_paydown')) || toBool(get('existingPaydown'))) return 'remain';
    if (toBool(get('existing_remain')) || toBool(get('existingRemain'))) return 'remain';
    if (toBool(get('anticipated'))) return 'anticipated';
    return 'none';
  };

  const lienIdxSet = new Set<number>();
  for (const key of map.keys()) {
    const m = key.match(/^lien(\d+)\./);
    if (m) lienIdxSet.add(parseInt(m[1], 10));
  }

  const normAddr = (s: unknown) =>
    String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const addrToProp = new Map<string, number>();
  for (const pi of propIndices) {
    const a = normAddr(map.get(`property${pi}.address`)?.rawValue);
    if (a) addrToProp.set(a, pi);
  }

  const remByProp = new Map<number, number>();
  const expByProp = new Map<number, number>();
  for (const pi of propIndices) {
    remByProp.set(pi, 0);
    expByProp.set(pi, 0);
  }

  for (const li of lienIdxSet) {
    const lp = `lien${li}`;
    const propName = normAddr(map.get(`${lp}.property`)?.rawValue);
    let pIdx: number | undefined;
    if (/^property\d+$/.test(propName)) {
      pIdx = parseInt(propName.replace('property', ''), 10);
    } else if (propName) {
      pIdx = addrToProp.get(propName);
    }
    if (!pIdx || !propIndices.includes(pIdx)) continue;

    const cond = classify(lp);
    if (cond === 'payoff' || cond === 'none') continue;
    if (cond === 'anticipated') {
      const antRaw =
        map.get(`${lp}.new_remaining_balance`)?.rawValue ??
        map.get(`${lp}.anticipated_amount`)?.rawValue;
      expByProp.set(pIdx, (expByProp.get(pIdx) ?? 0) + parseAmt(antRaw));
    } else {
      remByProp.set(pIdx, (remByProp.get(pIdx) ?? 0) + parseAmt(map.get(`${lp}.current_balance`)?.rawValue));
    }
  }

  const loanAmt = parseAmt(getRaw(map, 'ln_p_loanAmount') || getRaw(map, 'loan_terms.loan_amount'));

  for (const pi of propIndices) {
    const rem = remByProp.get(pi) ?? 0;
    const exp = expByProp.get(pi) ?? 0;
    const tot = rem + exp;
    setField(map, `ln_p_remainingEncumbrance_${pi}`, rem.toFixed(2), 'currency');
    setField(map, `ln_p_expectedEncumbrance_${pi}`, exp.toFixed(2), 'currency');
    setField(map, `ln_p_totalEncumbrance_${pi}`, tot.toFixed(2), 'currency');
    if (Number.isFinite(loanAmt)) {
      setField(map, `ln_p_totalWithLoan_${pi}`, (tot + loanAmt).toFixed(2), 'currency');
    }

    const mvRaw =
      getRaw(map, `pr_p_appraiseValue_${pi}`) ||
      getRaw(map, `property${pi}.appraised_value`);
    const hasMv = mvRaw !== '';
    const mv = hasMv ? parseAmt(mvRaw) : 0;
    setField(map, `ln_p_amountOfEquity_${pi}`, hasMv ? Math.max(0, mv - tot).toFixed(2) : '0.00', 'currency');

    const pledgedRaw =
      getRaw(map, `pr_p_pledgedEquity_${pi}`) || getRaw(map, `property${pi}.pledged_equity`);
    setField(map, `ln_p_equitySecuringLoan_${pi}`, pledgedRaw ? parseAmt(pledgedRaw).toFixed(2) : '0.00', 'currency');

    if (hasMv) {
      setField(map, `ln_p_loanToValueRatio_${pi}`, mv > 0 ? ((tot / mv) * 100).toFixed(2) : '0.00', 'percentage');
    }
  }

  let totalEquity = 0;
  for (const pi of propIndices) {
    totalEquity += parseAmt(getRaw(map, `ln_p_equitySecuringLoan_${pi}`) || getRaw(map, `ln_p_amountOfEquity_${pi}`));
  }
  setField(map, 'ln_totalEquitySecuringLoan', totalEquity.toFixed(2), 'currency');
  setField(map, 'ln_totalLoanAmountSecured', loanAmt.toFixed(2), 'currency');
}

function publishMultiplePropertiesGlyphs(map: FieldMap, realIndices: number[]): void {
  const isMultiple = realIndices.length > 1;
  const isSingle = !isMultiple;
  setBool(map, 'pr_p_multipleProperties_yes', isMultiple);
  setBool(map, 'pr_p_multipleProperties_no', isSingle);
  setGlyph(map, 'pr_p_multipleProperties_yes_glyph', isMultiple);
  setGlyph(map, 'pr_p_multipleProperties_no_glyph', isSingle);
}

/** Copy indexed value `key_N` → loop key without suffix. */
function copyIndexedToLoopKey(map: FieldMap, idx: number, loopKey: string): string {
  const indexed = `${loopKey}_${idx}`;
  const dottedIndexed = loopKey.includes('.') ? `${loopKey.replace(/\./g, '_')}_${idx}` : '';
  return (
    getRaw(map, indexed) ||
    getRaw(map, loopKey) ||
    (dottedIndexed ? getRaw(map, dottedIndexed) : '') ||
    ''
  );
}

function buildPropertyLoopObject(map: FieldMap, idx: number): Record<string, unknown> {
  const row: Record<string, unknown> = { property_number: idx };

  for (const key of RE851D_PROPERTY_LOOP_KEYS) {
    if (key === 'property_number') continue;
    const raw = copyIndexedToLoopKey(map, idx, key);
    if (raw) row[key] = raw;
  }

  for (const base of LIEN_SLOT_BASES) {
    for (let slot = 1; slot <= MAX_LIEN_SLOTS; slot++) {
      const raw = getRaw(map, `${base}_${idx}_${slot}`) || getRaw(map, `${base}_${idx}`);
      if (raw) row[`${base}_${slot}`] = raw;
    }
  }

  // Glyph/checkbox keys without _N in template
  const glyphKeys = [
    'property_type_sfr_owner',
    'property_type_sfr_non_owner',
    'property_type_sfr_zoned',
    'property_type_commercial',
    'property_type_land_zoned',
    'property_type_land_income',
    'property_type_other',
    'pr_pt_actual_glyph',
    'pr_pt_estimated_glyph',
    'propertytax.delinquent_yes_glyph',
    'propertytax.delinquent_no_glyph',
    'pr_li_currentDelinqu_yes_glyph',
    'pr_li_currentDelinqu_no_glyph',
    'pr_li_delinqu60day_yes_glyph',
    'pr_li_delinqu60day_no_glyph',
    'pr_li_delinquencyPaidByLoan_yes_glyph',
    'pr_li_delinquencyPaidByLoan_no_glyph',
    'pr_li_encumbranceOfRecord_yes_glyph',
    'pr_li_encumbranceOfRecord_no_glyph',
    'pr_li_sourceInfoBorrower_glyph',
    'pr_li_sourceInfoBroker_glyph',
    'pr_li_sourceInfoOther_glyph',
  ];
  for (const gk of glyphKeys) {
    const raw = getRaw(map, `${gk}_${idx}_glyph`) || getRaw(map, `${gk}_${idx}`);
    if (raw) row[gk] = raw;
  }

  return row;
}

/**
 * Publishes RE851D per-property indexed merge keys (internal; used to build properties[]).
 */
export function applyRe851dBridges(fieldValues: FieldMap): void {
  const allIndices = discoverPropertyIndices(fieldValues);
  const realIndices = realPropertyIndices(fieldValues, allIndices);

  for (const idx of allIndices) {
    bridgePropertyFields(fieldValues, idx);
  }
  rollupSeniorEncumbrances(fieldValues, allIndices);
  publishMultiplePropertiesGlyphs(fieldValues, realIndices);
}

/**
 * Build docxtemplater `properties[]` for all {{#properties}} loops.
 */
export function buildRe851dPropertiesArray(
  fieldValues: FieldMap,
  realIndices?: number[],
): Record<string, unknown>[] {
  const allIndices = discoverPropertyIndices(fieldValues);
  const indices = realIndices ?? realPropertyIndices(fieldValues, allIndices);
  if (indices.length === 0) return [];

  return indices.map((idx) => buildPropertyLoopObject(fieldValues, idx));
}
