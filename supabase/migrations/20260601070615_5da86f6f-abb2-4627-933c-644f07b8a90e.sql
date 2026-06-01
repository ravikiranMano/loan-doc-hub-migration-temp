
INSERT INTO storage.buckets (id, name, public)
VALUES ('audits', 'audits', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins and CSRs can read audit files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'audits' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'csr'::app_role)));

CREATE POLICY "Admins can write audit files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'audits' AND has_role(auth.uid(), 'admin'::app_role));
