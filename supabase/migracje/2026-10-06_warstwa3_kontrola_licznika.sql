-- WARSTWA 3 kontroli danych GPS - uzgodnienie ewidencji z licznikiem pojazdu.
--
-- Powod: wrzesien 2026. Trzy nowo zamontowane urzadzenia GPS (Toyota ProAce SC349GF,
-- SC451GF, SC452GF) naliczyly lacznie 1393 km, ktorych pojazdy nie przejechaly - transport
-- urzadzenia z miejsca montazu zapisany jako jazda oraz sumowany szum GPS na postoju na
-- terenie zakladu. Jedna z tych ewidencji byla juz podpisana przez kierownika i czekala na
-- akceptacje ksiegowosci. Nic w aplikacji nie porownywalo ewidencji z licznikiem pojazdu,
-- wiec usterka nie miala gdzie sie zatrzymac.
--
-- Po tej zmianie kierownik wpisuje faktyczny odczyt licznika na koniec miesiaca, a aplikacja
-- nie pozwala wyslac ewidencji do akceptacji, gdy roznica wobec sumy tras przekracza
-- TOLERANCJA_LICZNIKA_KM (patrz src/lib/config.ts).
--
-- Kolumna jest NULLABLE celowo: ewidencje za sierpien i wrzesien 2026 powstaly przed
-- wprowadzeniem tej kontroli i nie moga sie przez nia zablokowac wstecz.

ALTER TABLE monthly_logs
  ADD COLUMN IF NOT EXISTS stan_licznika_koniec_rzeczywisty numeric(10,2);

COMMENT ON COLUMN monthly_logs.stan_licznika_koniec_rzeczywisty IS
  'WARSTWA 3: faktyczny odczyt z licznika pojazdu na koniec miesiaca, wpisywany przez '
  'kierownika. Aplikacja porownuje go ze stanem wyliczonym (stan_licznika_poczatek + suma '
  'tras) i blokuje wyslanie do akceptacji przy roznicy powyzej tolerancji.';
