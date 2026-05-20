
-- Remove the previously inserted flat ld1..ld5 lender rows.
DELETE FROM public.field_dictionary
WHERE field_key ~ '^ld[1-5]_p_(firstName|middleName|lastName|fullName|vesting)$';

-- Insert repeatable canonical lender rows (lien-style pattern).
INSERT INTO public.field_dictionary (field_key, label, section, data_type, is_repeatable, is_calculated)
VALUES
  ('ld_p_firstName',  'Lender First Name',  'lender', 'text', true, false),
  ('ld_p_middleName', 'Lender Middle Name', 'lender', 'text', true, false),
  ('ld_p_lastName',   'Lender Last Name',   'lender', 'text', true, false),
  ('ld_p_fullName',   'Lender Full Name',   'lender', 'text', true, true),
  ('ld_p_vesting',    'Lender Vesting',     'lender', 'text', true, false)
ON CONFLICT DO NOTHING;
