INSERT INTO public.field_dictionary (field_key, label, section, data_type, is_calculated, is_repeatable, description)
VALUES
  ('pr_pt_annualTaxes', 'Annual Property Tax (per property)', 'property', 'currency', true, true, 'RE851D merge tag pr_pt_annualTaxes_N — currency value of annual property tax for property N. Source: Property Tax → Annual Payment (with property fallbacks). Generated at document-generation time.'),
  ('pr_pt_actual',      'Annual Tax Confidence — ACTUAL',     'property', 'boolean',  true, true, 'RE851D merge tag pr_pt_actual_N (boolean) and pr_pt_actual_N_glyph (☑/☐). True when Property Tax → Confidence = "Actual" for property N.'),
  ('pr_pt_estimated',   'Annual Tax Confidence — ESTIMATED',  'property', 'boolean',  true, true, 'RE851D merge tag pr_pt_estimated_N (boolean) and pr_pt_estimated_N_glyph (☑/☐). True when Property Tax → Confidence = "Estimated" for property N.')
ON CONFLICT (field_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  data_type = EXCLUDED.data_type,
  is_calculated = EXCLUDED.is_calculated,
  is_repeatable = EXCLUDED.is_repeatable,
  updated_at = now();