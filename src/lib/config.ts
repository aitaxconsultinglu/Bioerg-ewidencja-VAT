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

export const NAZWA_PODATNIKA = 'Bioerg Sp. z o.o.'

/** Domena firmowa dopisywana automatycznie na ekranie logowania. */
export const DOMENA_FIRMOWA = '@bioerg.pl'

export const MIN_DLUGOSC_HASLA = 6
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

/** Konta testowe działają na własnych adresach, więc pełny adres z "@" przechodzi
 *  bez zmian, a sama nazwa użytkownika dostaje domenę firmową. */
export function pelnyAdres(wpisane: string) {
  const t = wpisane.trim()
  return t.includes('@') ? t : `${t}${DOMENA_FIRMOWA}`
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
