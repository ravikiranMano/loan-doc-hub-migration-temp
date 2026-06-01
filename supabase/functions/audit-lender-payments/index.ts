// Dry-run audit: report every lender row where stored regularPayment != recomputed.
// NO WRITES. Returns CSV + counts.
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import {
  computeLenderPaymentsRounded,
  LenderPaymentInputsMissingError,
} from '../_shared/lenderPaymentFormula.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DICT = {
  funding_records: '4f76135d-042f-4367-bebc-5db66a06e0ae',
  note_rate: '969b2029-d56f-4789-8d77-1f9aecc88f2b',
  loan_amount: '163cd0b4-7cc0-4975-bcfb-43aa4be9c5c8',
  regular_pi: '8b883c6a-64b2-487f-98ee-8ed1de70f334', // ln_p_regularPaymen
};

function readField(field_values: Record<string, any>, id: string): string {
  const cell = field_values?.[id];
  if (!cell) return '';
  if (typeof cell === 'string') return cell;
  return cell.value_text ?? cell.value_number?.toString?.() ?? '';
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: rows, error } = await supabase
      .from('deal_section_values')
      .select('deal_id, field_values, updated_at')
      .eq('section', 'loan_terms');
    if (error) throw error;

    const { data: deals } = await supabase
      .from('deals')
      .select('id, deal_number')
      .in('id', (rows ?? []).map((r) => r.deal_id));
    const dealNumber = new Map((deals ?? []).map((d) => [d.id, d.deal_number]));

    const out: string[] = [];
    out.push([
      'deal_number','deal_id','lender_account','lender_name',
      'originalAmount','noteRate','lenderRate',
      'storedPayment','correctedPayment','delta','reason',
    ].map(csvCell).join(','));

    const counts: Record<string, number> = {
      changed: 0, unchanged: 0,
      skipped_equal_rates: 0, skipped_bad_date: 0,
      skipped_manual_override: 0, skipped_missing_inputs: 0,
      skipped_no_funding: 0,
    };

    const runId = crypto.randomUUID();
    const nowYear = new Date().getUTCFullYear();

    for (const r of rows ?? []) {
      const fv = (r.field_values ?? {}) as Record<string, any>;
      const frText = readField(fv, DICT.funding_records);
      if (!frText) { counts.skipped_no_funding++; continue; }
      let funding: any[];
      try { funding = JSON.parse(frText); } catch { counts.skipped_no_funding++; continue; }
      if (!Array.isArray(funding) || !funding.length) { counts.skipped_no_funding++; continue; }

      const noteRate = readField(fv, DICT.note_rate);
      const regularPI = readField(fv, DICT.regular_pi);
      const loanAmount = readField(fv, DICT.loan_amount);
      const principal = (() => {
        const n = parseFloat(String(loanAmount).replace(/[$,]/g, ''));
        if (Number.isFinite(n) && n > 0) return n;
        return funding.reduce((a, b) => a + (parseFloat(String(b.originalAmount).replace(/[$,]/g, '')) || 0), 0);
      })();

      let corrected: number[] | null = null;
      try {
        corrected = computeLenderPaymentsRounded(
          funding.map((f) => ({
            originalAmount: f.originalAmount,
            lenderRate: f.rateLenderValue ?? f.lenderRate,
            roundingAdjustment: !!f.roundingError,
          })),
          { loanPrincipal: principal, regularPI, noteRate },
        );
      } catch (e) {
        if (!(e instanceof LenderPaymentInputsMissingError)) throw e;
      }

      const dn = dealNumber.get(r.deal_id) ?? '';

      funding.forEach((row, i) => {
        const stored = Number(row.regularPayment ?? 0);
        const lenderRate = row.rateLenderValue ?? row.lenderRate ?? '';
        const lrNum = parseFloat(String(lenderRate).replace(/[%]/g, ''));
        const nrNum = parseFloat(String(noteRate).replace(/[%]/g, ''));

        // Skip flags
        let reason: string | null = null;
        if (!corrected) reason = 'skipped_missing_inputs';
        else if (Number.isFinite(lrNum) && Number.isFinite(nrNum) && Math.abs(lrNum - nrNum) < 1e-9) {
          reason = 'skipped_equal_rates';
        } else {
          const d1 = new Date(row.fundingDate ?? '');
          const d2 = new Date(row.interestFrom ?? row.fundingDate ?? '');
          const y = (d: Date) => d.getUTCFullYear();
          if ([d1, d2].some((d) => !isFinite(d.getTime()) || y(d) < 2000 || y(d) > nowYear + 10)) {
            reason = 'skipped_bad_date';
          } else if (row.lenderRateOverride === true || row.paymentManualOverride === true) {
            reason = 'skipped_manual_override';
          }
        }

        const correctedVal = corrected ? corrected[i] : null;
        const delta = correctedVal !== null ? Number((correctedVal - stored).toFixed(2)) : null;

        if (!reason) {
          if (delta !== null && Math.abs(delta) >= 0.01) {
            counts.changed++;
            reason = 'changed';
          } else {
            counts.unchanged++;
            reason = 'unchanged';
          }
        } else {
          counts[reason] = (counts[reason] ?? 0) + 1;
        }

        out.push([
          dn, r.deal_id, row.lenderAccount ?? '', row.lenderName ?? '',
          row.originalAmount ?? '', noteRate, lenderRate,
          stored, correctedVal ?? '', delta ?? '', reason,
        ].map(csvCell).join(','));
      });
    }

    const csv = out.join('\n');
    const path = `lender-payments/${runId}.csv`;
    const { error: upErr } = await supabase.storage
      .from('audits')
      .upload(path, new Blob([csv], { type: 'text/csv' }), { upsert: true, contentType: 'text/csv' });

    let signedUrl: string | null = null;
    if (!upErr) {
      const { data: sig } = await supabase.storage.from('audits').createSignedUrl(path, 60 * 60 * 24 * 7);
      signedUrl = sig?.signedUrl ?? null;
    }

    return new Response(
      JSON.stringify({ runId, counts, csvPath: path, signedUrl, storageError: upErr?.message, rowCount: out.length - 1 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
