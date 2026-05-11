-- Backend-only calculated field for Total Income, available for document mapping.
INSERT INTO public.field_dictionary (
  field_key, label, section, data_type, is_calculated, is_repeatable,
  description, calculation_formula, calculation_dependencies,
  allowed_roles, read_only_roles, form_type, is_mandatory
) VALUES (
  'oo_totalIncome',
  'Total Income',
  'origination_fees',
  'currency',
  true,
  false,
  'Backend-only calculated sum of Other Origination income components (salary + interest + dividend + rental + other). Not exposed in UI; available for document mapping via {{oo_totalIncome}}.',
  '{origination_app.income.salary} + {origination_app.income.interest} + {origination_app.income.dividend} + {origination_app.income.rental} + {origination_app.income.other}',
  ARRAY[
    'origination_app.income.salary',
    'origination_app.income.interest',
    'origination_app.income.dividend',
    'origination_app.income.rental',
    'origination_app.income.other'
  ]::text[],
  ARRAY[]::text[],
  ARRAY[]::text[],
  'primary',
  false
)
ON CONFLICT (field_key) DO UPDATE
SET label = EXCLUDED.label,
    section = EXCLUDED.section,
    data_type = EXCLUDED.data_type,
    is_calculated = EXCLUDED.is_calculated,
    description = EXCLUDED.description,
    calculation_formula = EXCLUDED.calculation_formula,
    calculation_dependencies = EXCLUDED.calculation_dependencies,
    allowed_roles = EXCLUDED.allowed_roles,
    read_only_roles = EXCLUDED.read_only_roles,
    updated_at = now();

-- Merge tag alias so {{oo_totalIncome}} resolves to the canonical computed key
INSERT INTO public.merge_tag_aliases (tag_name, field_key, tag_type, is_active, description)
VALUES (
  'oo_totalIncome',
  'oo_totalIncome',
  'merge_tag',
  true,
  'Backend-only Total Income alias (sum of Other Origination income components).'
)
ON CONFLICT DO NOTHING;
