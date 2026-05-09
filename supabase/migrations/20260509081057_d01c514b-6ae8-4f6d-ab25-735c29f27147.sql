INSERT INTO public.field_dictionary (field_key, label, section, data_type, is_calculated, is_repeatable, allowed_roles, read_only_roles, canonical_key, form_type, is_mandatory)
VALUES ('pr_p_origination_ltv', 'Origination LTV', 'property', 'percentage', false, false, ARRAY['admin','csr'], ARRAY[]::text[], 'pr_p_origination_ltv', 'primary', false)
ON CONFLICT (field_key) DO NOTHING;