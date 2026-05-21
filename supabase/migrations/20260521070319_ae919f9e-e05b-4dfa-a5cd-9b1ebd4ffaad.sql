INSERT INTO public.field_dictionary (field_key, label, section, data_type, form_type, allowed_roles, read_only_roles)
VALUES
  ('origination_ins.policy_other', 'Policy Endorsement Other', 'origination_fees', 'boolean', 'insurance_conditions', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('origination_ins.policy_other_amount', 'Policy Endorsement Other Amount', 'origination_fees', 'currency', 'insurance_conditions', ARRAY['admin','csr'], ARRAY[]::text[])
ON CONFLICT (field_key) DO NOTHING;