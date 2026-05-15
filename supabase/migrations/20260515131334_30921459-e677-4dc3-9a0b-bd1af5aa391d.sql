INSERT INTO public.field_dictionary
  (field_key, label, section, data_type, is_calculated, is_repeatable,
   calculation_formula, calculation_dependencies, description, form_type)
VALUES
  ('ln_p_regularPlusBalloonPaymen',
   'Regular + Estimated Balloon Payment',
   'loan_terms',
   'currency',
   true,
   false,
   '{ln_p_regularPaymen} + {ln_p_estimateBallooPaymen}',
   ARRAY['ln_p_regularPaymen','ln_p_estimateBallooPaymen'],
   'Auto-calculated sum of Regular Payment and Estimated Balloon Payment. Used in document generation.',
   'primary')
ON CONFLICT (field_key) DO UPDATE
  SET is_calculated = EXCLUDED.is_calculated,
      calculation_formula = EXCLUDED.calculation_formula,
      calculation_dependencies = EXCLUDED.calculation_dependencies,
      data_type = EXCLUDED.data_type,
      label = EXCLUDED.label,
      section = EXCLUDED.section,
      description = EXCLUDED.description,
      updated_at = now();

INSERT INTO public.merge_tag_aliases (tag_name, field_key, tag_type, is_active, description)
VALUES
  ('ln_p_regularPlusBalloonPaymen', 'ln_p_regularPlusBalloonPaymen', 'merge_tag', true,
   'Calculated: Regular Payment + Estimated Balloon Payment')
ON CONFLICT DO NOTHING;