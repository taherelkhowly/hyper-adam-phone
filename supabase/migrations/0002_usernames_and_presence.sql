-- Hyper Adam Phone: usernames + online presence
-- SAFE TO RUN AFTER 0001. Does not recreate app_role or delete existing data.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_unique
  ON public.profiles (lower(username)) WHERE username IS NOT NULL;

-- Give the existing administrator a username, if the auth account exists.
UPDATE public.profiles AS p
SET username = 'msadevolebment'
FROM auth.users AS u
WHERE p.id = u.id
  AND lower(u.email) = lower('msadevolebment@gmail.com')
  AND (p.username IS NULL OR btrim(p.username) = '');

-- Function must exist before policies that call it.
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND active = true AND role IN ('admin','owner')
  );
$$;
REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.online_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  full_name text,
  current_page text NOT NULL DEFAULT 'لوحة التحكم',
  current_activity text NOT NULL DEFAULT 'نشط داخل النظام',
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.online_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own presence" ON public.online_sessions;
CREATE POLICY "users read own presence" ON public.online_sessions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "users insert own presence" ON public.online_sessions;
CREATE POLICY "users insert own presence" ON public.online_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "users update own presence" ON public.online_sessions;
CREATE POLICY "users update own presence" ON public.online_sessions
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "admins read all presence" ON public.online_sessions;
CREATE POLICY "admins read all presence" ON public.online_sessions
  FOR SELECT TO authenticated USING ((SELECT public.is_active_admin()));

DROP POLICY IF EXISTS "admins read staff profiles" ON public.profiles;
CREATE POLICY "admins read staff profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_active_admin()));
