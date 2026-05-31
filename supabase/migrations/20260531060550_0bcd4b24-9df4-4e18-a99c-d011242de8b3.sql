DROP POLICY IF EXISTS "CSRs and Admins can view magic links" ON public.magic_links;

CREATE POLICY "Creators can view their own magic links"
ON public.magic_links
FOR SELECT
TO authenticated
USING (auth.uid() = created_by);