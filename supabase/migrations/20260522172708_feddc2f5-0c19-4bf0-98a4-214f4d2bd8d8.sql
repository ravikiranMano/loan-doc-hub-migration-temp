INSERT INTO public.field_dictionary (field_key, label, section, data_type)
VALUES ('origination_ins.oc_loss_of_rents_amount', 'Loss of Rents Amount', 'origination_fees', 'currency')
ON CONFLICT (field_key) DO NOTHING;