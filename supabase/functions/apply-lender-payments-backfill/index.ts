// Transactional apply: recompute regularPayment for every lender row using the
// canonical formula; writes activity_log snapshot per deal for reversal.
// Idempotent (re-running on already-corrected deals is a no-op).
// Requires { confirm: true } in body. Optional { dealIds: string[] } to scope.
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
  regular_pi: '8b883c6a-64b2-487f-98ee-8ed1de70f334',
};

function readField(fv: Record<string, any>, id: string): string {
  const c = fv?.[id]; if (!c) return '';
  if (typeof c === 'string') return c;
  return c.value_text ?? c.value_number?.toString?.() ?? '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    if (!body?.confirm) {
      return new Response(
        JSON.stringify({ error: "Pass { confirm: true } to apply. Run audit-lender-payments first." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const scopedDealIds: string[] | null = Array.isArray(body?.dealIds) ? body.dealIds : null;

    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    // Resolve actor for activity_log
    let actorUserId: string | null = null;
    if (authHeader) {
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data } = await userClient.auth.getUser();
      actorUserId = data?.user?.id ?? null;
    }
    if (!actorUserId) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let q = supabase.from('deal_section_values')
      .select('id, deal_id, field_values')
      .eq('section', 'loan_terms');
    if (scopedDealIds && scopedDealIds.length) q = q.in('deal_id', scopedDealIds);
    const { data: sections, error } = await q;
    if (error) throw error;

    const updatedDeals: Array<{ deal_id: string; changedRows: number }> = [];
    let skippedNoInputs = 0, skippedNoChange = 0;

    for (const sec of sections ?? []) {
      const fv = (sec.field_values ?? {}) as Record<string, any>;
      const cell = fv[DICT.funding_records];
      if (!cell) continue;
      const frText = typeof cell === 'string' ? cell : (cell.value_text ?? '');
      if (!frText) continue;
      let funding: any[];
      try { funding = JSON.parse(frText); } catch { continue; }
      if (!Array.isArray(funding) || !funding.length) continue;

      const noteRate = readField(fv, DICT.note_rate);
      const regularPI = readField(fv, DICT.regular_pi);
      const loanAmount = readField(fv, DICT.loan_amount);
      const principal = (() => {
        const n = parseFloat(String(loanAmount).replace(/[$,]/g, ''));
        if (Number.isFinite(n) && n > 0) return n;
        return funding.reduce((a, b) => a + (parseFloat(String(b.originalAmount).replace(/[$,]/g, '')) || 0), 0);
      })();

      let corrected: number[];
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
        if (e instanceof LenderPaymentInputsMissingError) { skippedNoInputs++; continue; }
        throw e;
      }

      const before = JSON.parse(JSON.stringify(funding));
      const changedRows: Array<{ idx: number; lender: string; before: number; after: number }> = [];
      const nowYear = new Date().getUTCFullYear();
      const next = funding.map((row, i) => {
        const lrNum = parseFloat(String(row.rateLenderValue ?? row.lenderRate ?? '').replace(/[%]/g, ''));
        const nrNum = parseFloat(String(noteRate).replace(/[%]/g, ''));
        if (Number.isFinite(lrNum) && Number.isFinite(nrNum) && Math.abs(lrNum - nrNum) < 1e-9) return row;
        const d1 = new Date(row.fundingDate ?? '');
        const d2 = new Date(row.interestFrom ?? row.fundingDate ?? '');
        const yBad = [d1, d2].some((d) => !isFinite(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > nowYear + 10);
        if (yBad) return row;
        if (row.lenderRateOverride === true || row.paymentManualOverride === true) return row;
        const stored = Number(row.regularPayment ?? 0);
        const after = corrected[i];
        if (Math.abs(after - stored) < 0.01) return row;
        changedRows.push({ idx: i, lender: row.lenderName ?? row.lenderAccount ?? `row${i}`, before: stored, after });
        return { ...row, regularPayment: after };
      });

      if (!changedRows.length) { skippedNoChange++; continue; }

      const newFv = { ...fv };
      if (typeof cell === 'string') {
        newFv[DICT.funding_records] = JSON.stringify(next);
      } else {
        newFv[DICT.funding_records] = { ...cell, value_text: JSON.stringify(next) };
      }

      const { error: updErr } = await supabase
        .from('deal_section_values')
        .update({ field_values: newFv, updated_at: new Date().toISOString() })
        .eq('id', sec.id);
      if (updErr) throw updErr;

      await supabase.from('activity_log').insert({
        deal_id: sec.deal_id,
        actor_user_id: actorUserId,
        action_type: 'funding_payment_backfill',
        action_details: { before, after: next, changedRows, sectionId: sec.id },
      });

      updatedDeals.push({ deal_id: sec.deal_id, changedRows: changedRows.length });
    }

    return new Response(
      JSON.stringify({
        updatedDeals: updatedDeals.length,
        totalChangedRows: updatedDeals.reduce((a, b) => a + b.changedRows, 0),
        skippedNoInputs, skippedNoChange,
        details: updatedDeals,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
