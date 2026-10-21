-- chron_konto_administratora() i chron_role_administratora() to funkcje WYZWALACZY.
-- Supabase wystawia kazda funkcje ze schematu public jako /rest/v1/rpc/..., wiec dotad
-- mogl je wywolac kazdy - nawet niezalogowany - mimo ze sa SECURITY DEFINER.
-- Praktycznie nic to nie dawalo (odwoluja sie do OLD/NEW, wiec bezposrednie wywolanie
-- konczy sie bledem), ale funkcja z podniesionymi uprawnieniami nie ma powodu byc
-- osiagalna z API. Wyzwalacze dzialaja dalej - one nie przechodza przez GRANT EXECUTE.
revoke execute on function public.chron_konto_administratora() from anon, authenticated, public;
revoke execute on function public.chron_role_administratora() from anon, authenticated, public;

comment on table public.ustawienia is
  'RLS wlaczony BEZ zadnej polityki - celowo. Tabele czytaja wylacznie funkcje brzegowe '
  'na service_role; przegladarka nie ma tu czego szukac. Linter Supabase zglasza to jako '
  'rls_enabled_no_policy (poziom INFO) i w tym przypadku jest to stan pozadany.';
