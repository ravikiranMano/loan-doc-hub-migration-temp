INSERT INTO public.field_dictionary (field_key, label, section, data_type, is_calculated, allowed_roles, read_only_roles, calculation_dependencies, calculation_formula, description)
VALUES (
  'oo_netAnnualIncome',
  'Net Annual Income',
  'origination_fees',
  'currency',
  true,
  ARRAY[]::text[],
  ARRAY[]::text[],
  ARRAY['oo_totalIncome','oo_totalExpenses']::text[],
  '((oo_totalIncome || 0) * 12) - (oo_totalExpenses || 0)',
  'Backend-only calculated field: Net Annual Income = (Total Income * 12) - Total Expenses. Not visible in UI.'
)
ON CONFLICT (field_key) DO UPDATE SET
  label = EXCLUDED.label,
  section = EXCLUDED.section,
  data_type = EXCLUDED.data_type,
  is_calculated = EXCLUDED.is_calculated,
  allowed_roles = EXCLUDED.allowed_roles,
  read_only_roles = EXCLUDED.read_only_roles,
  calculation_dependencies = EXCLUDED.calculation_dependencies,
  calculation_formula = EXCLUDED.calculation_formula,
  description = EXCLUDED.description,
  updated_at = now();

INSERT INTO public.merge_tag_aliases (tag_name, field_key, tag_type, description, is_active)
VALUES (
  'oo_netAnnualIncome',
  'oo_netAnnualIncome',
  'merge_tag',
  'Net Annual Income = (Total Income * 12) - Total Expenses',
  true
)
ON CONFLICT DO NOTHING;