INSERT INTO public.field_dictionary (field_key, label, section, data_type, is_calculated, description)
VALUES
  ('ag_p_fullName', 'Additional Guarantor Full Name', 'borrower', 'text', true, 'Auto-populated from the first Additional Guarantor participant on the loan file.'),
  ('ag_p_first',    'Additional Guarantor First Name', 'borrower', 'text', true, 'Auto-populated from the first Additional Guarantor participant on the loan file.'),
  ('ag_p_middle',   'Additional Guarantor Middle Name', 'borrower', 'text', true, 'Auto-populated from the first Additional Guarantor participant on the loan file.'),
  ('ag_p_last',     'Additional Guarantor Last Name', 'borrower', 'text', true, 'Auto-populated from the first Additional Guarantor participant on the loan file.')
ON CONFLICT (field_key) DO NOTHING;