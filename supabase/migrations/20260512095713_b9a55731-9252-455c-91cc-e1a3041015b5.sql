INSERT INTO public.field_dictionary (field_key, label, section, form_type, data_type, description, allowed_roles, read_only_roles)
VALUES
  ('of_801_desc', '801 Lender''s Loan Origination Fee – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 801', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('of_802_desc', '802 Lender''s Loan Discount Fee – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 802', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('of_803_desc', '803 Appraisal Fee – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 803', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('of_804_desc', '804 Credit Report – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 804', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('of_805_desc', '805 Lender''s Inspection Fee – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 805', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('of_806_desc', '806 Mortgage Broker Commission/Fee – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 806', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('of_809_desc', '809 Tax Service Fee – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 809', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('of_810_desc', '810 Processing Fee – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 810', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('of_811_desc', '811 Underwriting Fee – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 811', ARRAY['admin','csr'], ARRAY[]::text[]),
  ('of_812_desc', '812 Wire Transfer Fee – Description', 'origination_fees', 'fees', 'text', 'Description text for HUD-1 row 812', ARRAY['admin','csr'], ARRAY[]::text[])
ON CONFLICT (field_key) DO NOTHING;