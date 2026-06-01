INSERT INTO public.field_dictionary (field_key, section, data_type, form_type, label) VALUES
  ('loan_terms.arm_index_rate', 'loan_terms', 'percentage', 'primary', 'Index Rate'),
  ('loan_terms.arm_margin', 'loan_terms', 'percentage', 'primary', 'Margin'),
  ('loan_terms.arm_rate_floor', 'loan_terms', 'percentage', 'primary', 'Rate Floor'),
  ('loan_terms.adj_initial_rate_months', 'loan_terms', 'number', 'primary', 'Initial Adjustable Rate in effect for (Months)'),
  ('loan_terms.adj_fully_indexed_rate', 'loan_terms', 'percentage', 'primary', 'Fully Indexed Interest Rate'),
  ('loan_terms.adj_max_interest_rate', 'loan_terms', 'percentage', 'primary', 'Maximum Interest Rate'),
  ('loan_terms.adj_proposed_initial_payment', 'loan_terms', 'currency', 'primary', 'Proposed Initial (Minimum) Loan Payment'),
  ('loan_terms.adj_rate_increase_percent', 'loan_terms', 'percentage', 'primary', 'Interest Rate can Increase (%)'),
  ('loan_terms.adj_rate_increase_months', 'loan_terms', 'number', 'primary', 'Interest Rate can Increase each (Months)'),
  ('loan_terms.adj_payment_options_end_months', 'loan_terms', 'number', 'primary', 'Payment Options end after (Months)'),
  ('loan_terms.adj_payment_options_end_percent', 'loan_terms', 'percentage', 'primary', 'Payment Options end after (% of Original Balance)')
ON CONFLICT (field_key) DO NOTHING;