INSERT INTO public.field_dictionary (field_key, label, section, form_type, data_type, allowed_roles, read_only_roles, is_mandatory, is_calculated, description) VALUES
  ('of_901_desc',  '901 Interest for Days – Description',            'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 901'),
  ('of_902_desc',  '902 Mortgage Insurance Premiums – Description',  'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 902'),
  ('of_903_desc',  '903 Hazard Insurance Premiums – Description',    'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 903'),
  ('of_904_desc',  '904 County Property Taxes – Description',        'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 904'),
  ('of_905_desc',  '905 VA Funding Fee – Description',               'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 905'),
  ('of_1001_desc', '1001 Hazard Insurance – Description',            'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1001'),
  ('of_1002_desc', '1002 Mortgage Insurance – Description',          'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1002'),
  ('of_1004_desc', '1004 Co. Property Taxes – Description',          'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1004'),
  ('of_1101_desc', '1101 Settlement/Closing Fee – Description',      'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1101'),
  ('of_1105_desc', '1105 Document Preparation Fee – Description',    'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1105'),
  ('of_1106_desc', '1106 Notary Fee – Description',                  'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1106'),
  ('of_1108_desc', '1108 Title Insurance – Description',             'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1108'),
  ('of_1201_desc', '1201 Recording Fees – Description',              'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1201'),
  ('of_1202_desc', '1202 City/County Tax/Stamps – Description',      'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1202'),
  ('of_1302_desc', '1302 Pest Inspection – Description',             'origination_fees', 'fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false, 'Description/comment for line 1302');

-- Also add a migration entry so old data can be migrated if needed
INSERT INTO public.field_key_migrations (old_key, new_key, status, migrated_at) VALUES
  ('origination_fees.901_interest_for_days_d', 'of_901_desc', 'migrated', now()),
  ('origination_fees.902_mortgage_insurance_premiums_d', 'of_902_desc', 'migrated', now()),
  ('origination_fees.903_hazard_insurance_premiums_d', 'of_903_desc', 'migrated', now()),
  ('origination_fees.904_county_property_taxes_d', 'of_904_desc', 'migrated', now()),
  ('origination_fees.905_va_funding_fee_d', 'of_905_desc', 'migrated', now()),
  ('origination_fees.1001_hazard_insurance_charge', 'of_1001_desc', 'migrated', now()),
  ('origination_fees.1002_mortgage_insurance_charge', 'of_1002_desc', 'migrated', now()),
  ('origination_fees.1004_co_property_taxes_charge', 'of_1004_desc', 'migrated', now()),
  ('origination_fees.1101_settlement_closing_fee_d', 'of_1101_desc', 'migrated', now()),
  ('origination_fees.1105_doc_preparation_fee_d', 'of_1105_desc', 'migrated', now()),
  ('origination_fees.1106_notary_fee_d', 'of_1106_desc', 'migrated', now()),
  ('origination_fees.1108_title_insurance_d', 'of_1108_desc', 'migrated', now()),
  ('origination_fees.1201_recording_fees_d', 'of_1201_desc', 'migrated', now()),
  ('origination_fees.1202_city_county_tax_stamps_d', 'of_1202_desc', 'migrated', now()),
  ('origination_fees.1302_pest_inspection_d', 'of_1302_desc', 'migrated', now())
ON CONFLICT (old_key, new_key) DO NOTHING;

-- Update the canonical keys for the new description fields to point to themselves
UPDATE public.field_dictionary SET canonical_key = field_key WHERE field_key IN (
  'of_901_desc','of_902_desc','of_903_desc','of_904_desc','of_905_desc',
  'of_1001_desc','of_1002_desc','of_1004_desc',
  'of_1101_desc','of_1105_desc','of_1106_desc','of_1108_desc',
  'of_1201_desc','of_1202_desc','of_1302_desc'
);