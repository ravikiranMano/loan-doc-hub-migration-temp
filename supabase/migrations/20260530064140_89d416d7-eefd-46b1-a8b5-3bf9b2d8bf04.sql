
-- Add Apply to Payment Amount ($) and Apply to Payment Percent (%) field dictionary entries
INSERT INTO public.field_dictionary (field_key, label, section, data_type, form_type, description)
VALUES
  ('ln_p_applyToPaymentAmount', 'Apply to Payment Amount', 'loan_terms', 'currency', 'primary', 'Dollar amount applied when Short Payment Handling is "Apply to Payment"'),
  ('ln_p_applyToPaymentPercent', 'Apply to Payment Percent', 'loan_terms', 'percentage', 'primary', 'Percentage of Regular P&I Payment applied when Short Payment Handling is "Apply to Payment"')
ON CONFLICT (field_key) DO NOTHING;

-- Convert Day Due field to integer (1-31)
UPDATE public.field_dictionary
SET data_type = 'integer',
    validation_rule = 'min:1;max:31'
WHERE field_key = 'ln_p_dayDue';
