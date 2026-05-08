INSERT INTO public.field_dictionary (field_key, label, data_type, section, form_type, allowed_roles, description)
VALUES ('ld_fd_baseFee', 'Base Fee', 'currency', 'lender', 'funding', ARRAY['admin','csr','lender'], 'Enter amount')
ON CONFLICT DO NOTHING;