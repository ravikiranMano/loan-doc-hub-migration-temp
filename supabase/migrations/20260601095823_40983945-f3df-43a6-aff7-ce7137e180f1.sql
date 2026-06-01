INSERT INTO public.field_dictionary (field_key, label, section, data_type, form_type)
VALUES
  ('loan.nsf_prev_12mo', 'NSF Previous 12 Months', 'loan_terms', 'number', 'primary'),
  ('loan.thirty_days_plus', '30-days Plus', 'loan_terms', 'number', 'primary')
ON CONFLICT (field_key) DO NOTHING;