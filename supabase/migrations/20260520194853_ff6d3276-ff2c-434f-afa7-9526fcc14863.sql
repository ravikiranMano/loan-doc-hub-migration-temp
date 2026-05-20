UPDATE public.field_dictionary
SET field_key = 'bk_p_licenseeNameIfEntity',
    label = 'Licensee Name If Entity',
    canonical_key = COALESCE(canonical_key, 'bk_p_company'),
    updated_at = now()
WHERE field_key = 'bk_p_company';