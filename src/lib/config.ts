// Klucz "publishable" jest z założenia jawny - cały dostęp do danych ogranicza RLS po
// stronie Supabase, a nie utajnienie tego ciągu. Klucz service_role NIGDY tu nie trafia:
// żyje wyłącznie jako sekret GitHub Actions w repozytorium potoku (teltronic-gps-reports).
// Celowo || zamiast ??: nieustawiona zmienna w GitHub Actions podstawia pusty ciąg,
// a nie undefined, więc ?? nie sięgnęłoby po wartość domyślną i build wyszedłby z
// pustym adresem projektu.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://qizwbwyuzgzohgstrshv.supabase.co'

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_TC7FvZ7TI5AweSSSjbfU4g_bXSYB8dw'

// Nazwa podatnika trafia na wydruk ewidencji (wymóg formalny), ale NIE do kodu
// źródłowego: repozytorium jest publiczne, a nazwa firmy razem z nazwiskami kierowników
// i numerami rejestracyjnymi złożyłaby się na gotowy zestaw danych o konkretnym
// przedsiębiorstwie. Wartość podstawia się przy budowaniu z ustawienia repozytorium
// (zmienna NAZWA_PODATNIKA w GitHub Actions). Przy pustej zmiennej na wydruku zostaje
// neutralny tekst zastępczy - lepiej niż zdradzić firmę każdemu, kto zajrzy do kodu.
export const NAZWA_PODATNIKA =
  import.meta.env.VITE_NAZWA_PODATNIKA || '(nazwa podatnika - ustaw w konfiguracji)'

// WARSTWA 3 kontroli danych GPS. O tyle kilometrów ewidencja może różnić się od faktycznego
// odczytu licznika, zanim przestaniemy pozwalać wysłać ją do akceptacji. Kilka kilometrów
// bierze się z zaokrągleń i z tego, że licznik pojazdu odczytuje się ręcznie, nie co do metra.
// Większa różnica to sygnał usterki urządzenia GPS, a nie niedokładność: wrzesień 2026, trzy
// nowe Toyoty ProAce - urządzenia naliczyły 1393 km, których pojazdy nie przejechały
// (sumowany szum GPS na postoju + transport urządzenia z miejsca montażu).
export const TOLERANCJA_LICZNIKA_KM = 5

// 2026-10-21 podniesione z 6 na 10. Sześć znaków to dla hasła stałego dostępu do danych
// osobowych za mało, a wymaganie dotyczy wyłącznie haseł ustawianych OD TERAZ - nikomu
// nie unieważnia dotychczasowego i nikogo nie wylogowuje.
export const MIN_DLUGOSC_HASLA = 10
const ZNAKI_SPECJALNE = /[^A-Za-z0-9]/

/** Zwraca komunikat o błędzie albo null, gdy hasło spełnia wymagania. */
export function sprawdzHaslo(haslo: string): string | null {
  if (haslo.length < MIN_DLUGOSC_HASLA) {
    return `Hasło musi mieć co najmniej ${MIN_DLUGOSC_HASLA} znaków.`
  }
  if (!ZNAKI_SPECJALNE.test(haslo)) {
    return 'Hasło musi zawierać co najmniej jeden znak specjalny (np. ! @ # ? -).'
  }
  return null
}

// Supabase zwraca komunikaty po angielsku, a cały interfejs jest polski. Tłumaczymy
// te, które użytkownik faktycznie może zobaczyć; reszta przechodzi bez zmian.
const KOMUNIKATY: [RegExp, string][] = [
  [/different from the old password/i, 'Nowe hasło musi różnić się od dotychczasowego.'],
  [/should be at least (\d+) characters/i, 'Hasło jest za krótkie.'],
  [/invalid login credentials/i, 'Nieprawidłowy login lub hasło.'],
  [/email rate limit exceeded/i, 'Za dużo wiadomości w krótkim czasie. Spróbuj ponownie za kilka minut.'],
  [/you can only request this after (\d+) seconds/i, 'Odczekaj chwilę przed kolejną próbą.'],
  [/token has expired or is invalid/i, 'Link wygasł lub został już użyty. Poproś o nowy.'],
  [/unable to validate email address/i, 'Nieprawidłowy adres e-mail.'],
  [/password is known to be weak|pwned/i, 'To hasło wyciekło w znanych naruszeniach danych. Wybierz inne.'],
]

export function komunikatPL(wiadomosc: string) {
  for (const [wzorzec, tlumaczenie] of KOMUNIKATY) {
    if (wzorzec.test(wiadomosc)) return tlumaczenie
  }
  return wiadomosc
}
