-- Ustawienia, ktore nie moga stac w kodzie zrodlowym, bo repozytorium aplikacji jest
-- publiczne: nazwa firmy w podpisie maila, adres aplikacji (zawiera nazwe repozytorium)
-- i adres, na ktory idzie kopia powiadomien.
--
-- Dlaczego tabela, a nie sekrety funkcji brzegowych: sekrety ustawia sie recznie w panelu,
-- a tu wartosci da sie wpisac i poprawic z samej migracji - nie ma kroku, o ktorym mozna
-- zapomniec i obudzic sie z mailami bez linku do aplikacji.
--
-- RLS wlaczony i ZADNEJ polityki: tabela jest widoczna wylacznie dla service_role, czyli
-- dla funkcji brzegowych. Przegladarka - nawet zalogowanej ksiegowosci - nie ma do niej
-- dostepu, bo nie ma potrzeby.
--
-- UWAGA: wartosci wpisane ponizej sa przykladowe. W tym repozytorium NIE trzymamy nazwy
-- firmy ani adresow; produkcyjne wartosci sa wpisane bezposrednio w bazie.
create table if not exists public.ustawienia (
  klucz text primary key,
  wartosc text not null,
  opis text,
  zmieniono timestamptz not null default now()
);

alter table public.ustawienia enable row level security;

insert into public.ustawienia (klucz, wartosc, opis) values
  ('nazwa_podatnika', '(ustaw w bazie)',
   'Nazwa firmy - naglowek wydruku ewidencji i podpis wiadomosci.'),
  ('podpis_maila', 'automat ewidencji przebiegu pojazdu',
   'Podpis pod kazda wiadomoscia wychodzaca z automatu.'),
  ('adres_aplikacji', '',
   'Adres aplikacji podawany w mailach. Pusty = maile bez wiersza z linkiem.'),
  ('kopia_powiadomien', '',
   'Adres w kopii powiadomien dla kierownikow. Pusta wartosc = bez kopii.')
on conflict (klucz) do nothing;
