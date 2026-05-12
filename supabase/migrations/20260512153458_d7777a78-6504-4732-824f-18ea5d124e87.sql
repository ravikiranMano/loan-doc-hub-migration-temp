INSERT INTO field_dictionary (field_key, label, section, data_type, form_type, is_calculated, is_repeatable, canonical_key)
VALUES
  ('of_fe_estimatedCashPayableToYou', 'Estimated Cash at closing Payable to you', 'origination_fees', 'boolean', 'fees', false, false, 'origination_fees.re885_cash_payable_to_you'),
  ('of_fe_estimatedCashYouMustPay',   'Estimated Cash at closing You must pay',   'origination_fees', 'boolean', 'fees', false, false, 'origination_fees.re885_cash_you_must_pay')
ON CONFLICT (field_key) DO NOTHING;