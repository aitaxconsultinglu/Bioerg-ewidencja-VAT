-- Polityka email_log byla przypisana do roli `public`, czyli obejmowala takze `anon` -
-- niezalogowanego gościa z kluczem publishable. Dane i tak nie wyciekaly, bo warunek
-- jest_ksiegowoscia() dla anona zwraca false (w praktyce zapytanie konczylo sie bledem
-- "permission denied for function jest_ksiegowoscia"), ale polegac na tym nie chcemy:
-- ochrona ma wynikac z zakresu polityki, a nie z tego, ze funkcja pomocnicza przypadkiem
-- nie jest dostepna dla anona. Pozostale szesc tabel ma juz `authenticated`.
drop policy if exists email_log_select on public.email_log;

create policy email_log_select on public.email_log
  for select to authenticated
  using (jest_ksiegowoscia());
