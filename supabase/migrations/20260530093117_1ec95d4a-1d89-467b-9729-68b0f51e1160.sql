
WITH new_fields(field_key, label, data_type) AS (
  VALUES
    ('origination_fees.800_custom1_description',     '800 Custom Row 1 – Description',     'text'),
    ('origination_fees.800_custom1_others',          '800 Custom Row 1 – Paid to Others',  'currency'),
    ('origination_fees.800_custom1_broker',          '800 Custom Row 1 – Paid to Broker',  'currency'),
    ('origination_fees.800_custom1_apr',             '800 Custom Row 1 – Include in APR',  'boolean'),
    ('origination_fees.800_custom1_paid_to_company', '800 Custom Row 1 – Paid to Company', 'boolean'),
    ('origination_fees.800_custom2_description',     '800 Custom Row 2 – Description',     'text'),
    ('origination_fees.800_custom2_others',          '800 Custom Row 2 – Paid to Others',  'currency'),
    ('origination_fees.800_custom2_broker',          '800 Custom Row 2 – Paid to Broker',  'currency'),
    ('origination_fees.800_custom2_apr',             '800 Custom Row 2 – Include in APR',  'boolean'),
    ('origination_fees.800_custom2_paid_to_company', '800 Custom Row 2 – Paid to Company', 'boolean'),
    ('origination_fees.900_custom1_description',     '900 Custom Row 1 – Description',     'text'),
    ('origination_fees.900_custom1_others',          '900 Custom Row 1 – Paid to Others',  'currency'),
    ('origination_fees.900_custom1_broker',          '900 Custom Row 1 – Paid to Broker',  'currency'),
    ('origination_fees.900_custom1_apr',             '900 Custom Row 1 – Include in APR',  'boolean'),
    ('origination_fees.900_custom1_paid_to_company', '900 Custom Row 1 – Paid to Company', 'boolean'),
    ('origination_fees.900_custom2_description',     '900 Custom Row 2 – Description',     'text'),
    ('origination_fees.900_custom2_others',          '900 Custom Row 2 – Paid to Others',  'currency'),
    ('origination_fees.900_custom2_broker',          '900 Custom Row 2 – Paid to Broker',  'currency'),
    ('origination_fees.900_custom2_apr',             '900 Custom Row 2 – Include in APR',  'boolean'),
    ('origination_fees.900_custom2_paid_to_company', '900 Custom Row 2 – Paid to Company', 'boolean'),
    ('origination_fees.1100_custom1_description',    '1100 Custom Row 1 – Description',    'text'),
    ('origination_fees.1100_custom1_others',         '1100 Custom Row 1 – Paid to Others', 'currency'),
    ('origination_fees.1100_custom1_broker',         '1100 Custom Row 1 – Paid to Broker', 'currency'),
    ('origination_fees.1100_custom1_apr',            '1100 Custom Row 1 – Include in APR', 'boolean'),
    ('origination_fees.1100_custom1_paid_to_company','1100 Custom Row 1 – Paid to Company','boolean'),
    ('origination_fees.1100_custom2_description',    '1100 Custom Row 2 – Description',    'text'),
    ('origination_fees.1100_custom2_others',         '1100 Custom Row 2 – Paid to Others', 'currency'),
    ('origination_fees.1100_custom2_broker',         '1100 Custom Row 2 – Paid to Broker', 'currency'),
    ('origination_fees.1100_custom2_apr',            '1100 Custom Row 2 – Include in APR', 'boolean'),
    ('origination_fees.1100_custom2_paid_to_company','1100 Custom Row 2 – Paid to Company','boolean')
)
INSERT INTO public.field_dictionary (field_key, label, section, data_type)
SELECT nf.field_key, nf.label, 'origination_fees'::field_section, nf.data_type::field_data_type
FROM new_fields nf
WHERE NOT EXISTS (SELECT 1 FROM public.field_dictionary fd WHERE fd.field_key = nf.field_key);

WITH new_aliases(tag_name, field_key) AS (
  VALUES
    ('hud800_custom1_description',     'origination_fees.800_custom1_description'),
    ('hud800_custom1_paid_to_others',  'origination_fees.800_custom1_others'),
    ('hud800_custom1_paid_to_broker',  'origination_fees.800_custom1_broker'),
    ('hud800_custom1_include_apr',     'origination_fees.800_custom1_apr'),
    ('hud800_custom1_paid_to_company', 'origination_fees.800_custom1_paid_to_company'),
    ('hud800_custom2_description',     'origination_fees.800_custom2_description'),
    ('hud800_custom2_paid_to_others',  'origination_fees.800_custom2_others'),
    ('hud800_custom2_paid_to_broker',  'origination_fees.800_custom2_broker'),
    ('hud800_custom2_include_apr',     'origination_fees.800_custom2_apr'),
    ('hud800_custom2_paid_to_company', 'origination_fees.800_custom2_paid_to_company'),
    ('hud900_custom1_description',     'origination_fees.900_custom1_description'),
    ('hud900_custom1_paid_to_others',  'origination_fees.900_custom1_others'),
    ('hud900_custom1_paid_to_broker', 'origination_fees.900_custom1_broker'),
    ('hud900_custom1_include_apr',     'origination_fees.900_custom1_apr'),
    ('hud900_custom1_paid_to_company', 'origination_fees.900_custom1_paid_to_company'),
    ('hud900_custom2_description',     'origination_fees.900_custom2_description'),
    ('hud900_custom2_paid_to_others',  'origination_fees.900_custom2_others'),
    ('hud900_custom2_paid_to_broker',  'origination_fees.900_custom2_broker'),
    ('hud900_custom2_include_apr',     'origination_fees.900_custom2_apr'),
    ('hud900_custom2_paid_to_company', 'origination_fees.900_custom2_paid_to_company'),
    ('hud1100_custom1_description',    'origination_fees.1100_custom1_description'),
    ('hud1100_custom1_paid_to_others', 'origination_fees.1100_custom1_others'),
    ('hud1100_custom1_paid_to_broker', 'origination_fees.1100_custom1_broker'),
    ('hud1100_custom1_include_apr',    'origination_fees.1100_custom1_apr'),
    ('hud1100_custom1_paid_to_company','origination_fees.1100_custom1_paid_to_company'),
    ('hud1100_custom2_description',    'origination_fees.1100_custom2_description'),
    ('hud1100_custom2_paid_to_others', 'origination_fees.1100_custom2_others'),
    ('hud1100_custom2_paid_to_broker', 'origination_fees.1100_custom2_broker'),
    ('hud1100_custom2_include_apr',    'origination_fees.1100_custom2_apr'),
    ('hud1100_custom2_paid_to_company','origination_fees.1100_custom2_paid_to_company')
)
INSERT INTO public.merge_tag_aliases (tag_name, field_key, tag_type, is_active)
SELECT na.tag_name, na.field_key, 'merge_tag'::merge_tag_type, true
FROM new_aliases na
WHERE NOT EXISTS (SELECT 1 FROM public.merge_tag_aliases ma WHERE ma.tag_name = na.tag_name);
