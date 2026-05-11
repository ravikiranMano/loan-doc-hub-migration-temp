-- Backend-only calculated field for Total Expenses, available for document mapping.
INSERT INTO public.field_dictionary (
  field_key, label, section, data_type, is_calculated, is_repeatable,
  description, calculation_formula, calculation_dependencies,
  allowed_roles, read_only_roles, form_type, is_mandatory
) VALUES (
  'oo_totalExpenses',
  'Total Expenses',
  'origination_fees',
  'currency',
  true,
  false,
  'Backend-only calculated sum of Other Origination expense components (credit_card + mortgage + spousal_child_support + insurance + automobile + other). Not exposed in UI; available for document mapping via {{oo_totalExpenses}}.',
  '{origination_app.expense.credit_card} + {origination_app.expense.mortgage} + {origination_app.expense.spousal_child_support} + {origination_app.expense.insurance} + {origination_app.expense.automobile} + {origination_app.expense.other}',
  ARRAY[
    'origination_app.expense.credit_card',
    'origination_app.expense.mortgage',
    'origination_app.expense.spousal_child_support',
    'origination_app.expense.insurance',
    'origination_app.expense.automobile',
    'origination_app.expense.other'
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

-- Merge tag alias so {{oo_totalExpenses}} resolves to the canonical computed key
INSERT INTO public.merge_tag_aliases (tag_name, field_key, tag_type, is_active, description)
VALUES (
  'oo_totalExpenses',
  'oo_totalExpenses',
  'merge_tag',
  true,
  'Backend-only Total Expenses alias (sum of Other Origination expense components).'
)
ON CONFLICT DO NOTHING;
