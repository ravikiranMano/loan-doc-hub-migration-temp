INSERT INTO public.field_dictionary (field_key, label, section, data_type, description, is_calculated, is_repeatable, allowed_roles, read_only_roles)
VALUES ('br2_p_fullName', 'Second Borrower Full Name', 'borrower', 'text',
  'Full name of the second borrower (First + Middle + Last). Returns blank when the loan has only one borrower.',
  false, false, ARRAY['admin','csr'], ARRAY[]::text[])
ON CONFLICT (field_key) DO NOTHING;