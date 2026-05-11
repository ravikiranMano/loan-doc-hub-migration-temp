
INSERT INTO public.field_dictionary (field_key, label, section, data_type, allowed_roles, read_only_roles, is_calculated, is_repeatable)
VALUES ('oo_sa_servicingAgentName', 'Servicing Agent Name', 'origination_fees', 'text', ARRAY['admin','csr'], ARRAY[]::text[], false, false)
ON CONFLICT (field_key) DO NOTHING;

INSERT INTO public.merge_tag_aliases (tag_name, field_key, tag_type, is_active, description)
VALUES ('oo_sa_servicingAgentName', 'oo_sa_servicingAgentName', 'merge_tag', true, 'Servicing Agent Name (Other Origination)')
ON CONFLICT DO NOTHING;
