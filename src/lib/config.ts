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
