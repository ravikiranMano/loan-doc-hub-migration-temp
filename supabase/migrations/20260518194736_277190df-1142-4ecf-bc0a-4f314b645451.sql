INSERT INTO public.field_dictionary (field_key, label, section, data_type, form_type)
SELECT v.field_key, v.label, 'loan_terms'::field_section, 'text'::field_data_type, 'primary'
FROM (VALUES
  ('loan_terms.penalties.default_interest.distribution.other_entity_id', 'Default Interest - Other Entity ID'),
  ('loan_terms.penalties.default_interest.distribution.other_entity_type', 'Default Interest - Other Entity Type'),
  ('loan_terms.penalties.default_interest.distribution.other_entity_name', 'Default Interest - Other Entity Name'),
  ('loan_terms.penalties.interest_guarantee.distribution.other_entity_id', 'Interest Guarantee - Other Entity ID'),
  ('loan_terms.penalties.interest_guarantee.distribution.other_entity_type', 'Interest Guarantee - Other Entity Type'),
  ('loan_terms.penalties.interest_guarantee.distribution.other_entity_name', 'Interest Guarantee - Other Entity Name'),
  ('loan_terms.penalties.prepayment.distribution.other_entity_id', 'Prepayment - Other Entity ID'),
  ('loan_terms.penalties.prepayment.distribution.other_entity_type', 'Prepayment - Other Entity Type'),
  ('loan_terms.penalties.prepayment.distribution.other_entity_name', 'Prepayment - Other Entity Name'),
  ('loan_terms.penalties.maturity.distribution.other_entity_id', 'Maturity - Other Entity ID'),
  ('loan_terms.penalties.maturity.distribution.other_entity_type', 'Maturity - Other Entity Type'),
  ('loan_terms.penalties.maturity.distribution.other_entity_name', 'Maturity - Other Entity Name'),
  ('loan_terms.penalties.late_charge_1.distribution.other_entity_id', 'Late Charge 1 - Other Entity ID'),
  ('loan_terms.penalties.late_charge_1.distribution.other_entity_type', 'Late Charge 1 - Other Entity Type'),
  ('loan_terms.penalties.late_charge_1.distribution.other_entity_name', 'Late Charge 1 - Other Entity Name'),
  ('loan_terms.penalties.late_charge_2.distribution.other_entity_id', 'Late Charge 2 - Other Entity ID'),
  ('loan_terms.penalties.late_charge_2.distribution.other_entity_type', 'Late Charge 2 - Other Entity Type'),
  ('loan_terms.penalties.late_charge_2.distribution.other_entity_name', 'Late Charge 2 - Other Entity Name')
) AS v(field_key, label)
ON CONFLICT (field_key) DO NOTHING;