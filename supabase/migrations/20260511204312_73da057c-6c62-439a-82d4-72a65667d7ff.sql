INSERT INTO public.field_dictionary (field_key, label, section, data_type, is_calculated, calculation_formula, calculation_dependencies, allowed_roles, read_only_roles, form_type, description)
VALUES (
  'ln_monthlyPayment_PI',
  'Monthly Payment (P&I)',
  'loan_terms',
  'currency',
  true,
  'amortization: P * r / (1 - (1 + r)^-n) where r = ln_p_noteRate/12/100, n = ln_p_loanTermMonths; if r=0 then P/n',
  ARRAY['ln_p_loanAmount','ln_p_noteRate','ln_p_loanTermMonths'],
  ARRAY['admin','csr']::text[],
  ARRAY[]::text[],
  'calculated',
  'Backend-only calculated field. Computed in document payload builder; not rendered in UI. Available for document mapping as {{ln_monthlyPayment_PI}}.'
)
ON CONFLICT (field_key) DO UPDATE SET
  label = EXCLUDED.label,
  section = EXCLUDED.section,
  data_type = EXCLUDED.data_type,
  is_calculated = EXCLUDED.is_calculated,
  calculation_formula = EXCLUDED.calculation_formula,
  calculation_dependencies = EXCLUDED.calculation_dependencies,
  description = EXCLUDED.description,
  updated_at = now();