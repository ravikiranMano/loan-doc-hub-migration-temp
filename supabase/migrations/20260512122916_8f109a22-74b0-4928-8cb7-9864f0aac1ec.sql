INSERT INTO public.field_key_migrations (old_key, new_key, status, migrated_at)
VALUES ('loan_terms.added_to_regular_payment', 'ln_p_addedToRegulaPaymen', 'pending', now())
ON CONFLICT DO NOTHING;