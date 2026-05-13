INSERT INTO public.field_dictionary (
  field_key, label, section, data_type, is_calculated,
  calculation_formula, calculation_dependencies, description
) VALUES (
  'ln_p_proRataPayment',
  'Pro Rata Payment',
  'loan_terms',
  'currency',
  true,
  '({ln_p_estimateBallooPaymen} + {ln_p_regularPaymen}) / {loan_terms.pro_rata}',
  ARRAY['ln_p_estimateBallooPaymen','ln_p_regularPaymen','loan_terms.pro_rata'],
  'Calculated: (Estimated Balloon Payment + Regular Payment) / Pro Rata'
);