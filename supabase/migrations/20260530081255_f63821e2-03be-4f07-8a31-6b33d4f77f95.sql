CREATE OR REPLACE FUNCTION public.validate_broker_license_numbers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  license_key text;
  raw_value text;
  trimmed_value text;
BEGIN
  IF NEW.contact_type <> 'broker' OR NEW.contact_data IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH license_key IN ARRAY ARRAY['License', 'license', 'rep_license', 'repLicense']
  LOOP
    IF NEW.contact_data ? license_key THEN
      raw_value := COALESCE(NEW.contact_data ->> license_key, '');
      trimmed_value := btrim(raw_value);

      NEW.contact_data := jsonb_set(NEW.contact_data, ARRAY[license_key], to_jsonb(trimmed_value), true);

      IF trimmed_value <> '' AND (length(trimmed_value) > 50 OR trimmed_value !~ '^[A-Za-z0-9\- ]{1,50}$') THEN
        RAISE EXCEPTION 'Invalid broker license number. Use letters, numbers, hyphens, and spaces only, up to 50 characters.';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_broker_license_numbers_before_save ON public.contacts;

CREATE TRIGGER validate_broker_license_numbers_before_save
BEFORE INSERT OR UPDATE ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.validate_broker_license_numbers();