// Kto może wywołać funkcję brzegową - i odpowiedź na zapytanie wstępne przeglądarki.
//
// DLACZEGO TO ISTNIEJE. Ustawienie `verify_jwt: true` w Supabase sprawdza tylko tyle, że
// w nagłówku jest JAKIKOLWIEK poprawny token projektu - a kluczem publishable jest
// poprawny token. Ten klucz siedzi w paczce JavaScript aplikacji, czyli zna go każdy, kto
// otworzy stronę. Test z 2026-10-21 pokazał, że z samym tym kluczem dawało się wywołać
// `przypomnienia`, `powiadomienie-nowa-ewidencja` i `test-poczty`. To nie była teoria:
// wystarczyło dołożyć `podglad_na`, żeby nazwiska kierowników, ich adresy służbowe
// i numery rejestracyjne poszły mailem na dowolny adres, a `test-poczty` wysyłała
// dowolną treść z firmowej skrzynki na dowolny adres - czyli otwarty przekaźnik poczty.
//
// Funkcje brzegowe działają na kluczu service_role, więc omijają RLS. Tym bardziej muszą
// same pilnować, kto je woła.
//
// Plik jest skopiowany do katalogu każdej funkcji brzegowej, bo funkcje wdrażają się
// niezależnie i nie dzielą modułów.

// deno-lint-ignore no-explicit-any
type Klient = any

/** CORS na gwiazdkę jest tu bezpieczny i świadomy: ograniczenie pochodzenia zapytania
 *  NIE jest zabezpieczeniem - przeglądarka pilnuje go tylko u siebie, a curl ma je za nic.
 *  Zabezpieczeniem jest autoryzacja poniżej. Gwiazdka nie zdradza przy tym adresu
 *  aplikacji, którego w tym repozytorium nie trzymamy. */
export const NAGLOWKI_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Zapytanie wstępne przeglądarki. Bez tej odpowiedzi przeglądarka blokuje wywołanie
 *  funkcji z aplikacji - i to po cichu, bo błąd widzi tylko w konsoli. Tak było do
 *  2026-10-21 z powiadomieniami o poprawce i o wysłaniu do akceptacji: funkcje działały,
 *  ale żadne wywołanie z aplikacji do nich nie dochodziło. */
export function czyZapytanieWstepne(req: Request) {
  return req.method === 'OPTIONS'
}

export function odpowiedzWstepna() {
  return new Response('ok', { headers: NAGLOWKI_CORS })
}

export function odpowiedzJSON(tresc: unknown, status = 200) {
  return new Response(JSON.stringify(tresc), {
    status,
    headers: { ...NAGLOWKI_CORS, 'Content-Type': 'application/json' },
  })
}

export type Wolajacy =
  /** Potok GPS, zadanie cron albo ta sesja - token service_role. Pełne zaufanie. */
  | { rodzaj: 'serwis' }
  /** Zalogowany człowiek. */
  | { rodzaj: 'uzytkownik'; id: string; rola: string }
  /** Token nieznany albo tylko publishable - czyli nikt. */
  | { rodzaj: 'nikt' }

const KLUCZ_SERWISOWY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Porównanie w stałym czasie - przy zwykłym === długość wspólnego przedrostka da się
 *  wyczytać z czasu odpowiedzi. Przy jednym porównaniu na wywołanie to ostrożność
 *  teoretyczna, ale kosztuje trzy linijki. */
function takiSam(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** Rola z tokenu JWT.
 *
 *  DLACZEGO NIE SAMO PORÓWNANIE KLUCZA. Projekt ma dwa równoważne klucze service_role:
 *  nowy (`sb_secret_...`) w zmiennych funkcji brzegowych i stary, w formacie JWT, który
 *  siedzi w sejfie bazy i którym posługują się zadania cron oraz potok GPS. To nie ten
 *  sam ciąg znaków, więc samo porównanie odrzucało wywołania z crona - sprawdzone
 *  2026-10-21, zadanie dostawało 403 i żadne przypomnienie by nie wyszło.
 *
 *  CZYTAMY TU TYLKO TREŚĆ TOKENU, BEZ SPRAWDZANIA PODPISU - i wolno nam tak zrobić
 *  wyłącznie dlatego, że funkcja jest wdrożona z `verify_jwt: true`, czyli Supabase
 *  sprawdza podpis PRZED uruchomieniem naszego kodu (bez tokenu zapytanie dostaje 401
 *  i nigdy tu nie dochodzi). Gdyby ktoś kiedyś wyłączył `verify_jwt`, tę rolę dałoby się
 *  dopisać w tokenie samemu - dlatego to ustawienie musi zostać włączone. */
function rolaZTokenu(token: string): string | null {
  const czesci = token.split('.')
  if (czesci.length !== 3) return null
  try {
    const srodek = czesci[1].replace(/-/g, '+').replace(/_/g, '/')
    const dopelnione = srodek + '='.repeat((4 - srodek.length % 4) % 4)
    const tresc = JSON.parse(atob(dopelnione))
    return typeof tresc?.role === 'string' ? tresc.role : null
  } catch {
    return null
  }
}

export async function ustalWolajacego(req: Request, serwisowy: Klient): Promise<Wolajacy> {
  const naglowek = req.headers.get('Authorization') ?? ''
  const token = naglowek.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { rodzaj: 'nikt' }

  if (KLUCZ_SERWISOWY && takiSam(token, KLUCZ_SERWISOWY)) return { rodzaj: 'serwis' }
  if (rolaZTokenu(token) === 'service_role') return { rodzaj: 'serwis' }

  // Nie service_role - więc albo token zalogowanego człowieka, albo sam publishable.
  // getUser() odrzuci publishable, bo nie jest przypisany do żadnego konta.
  try {
    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const { data: { user } } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    ).auth.getUser()
    if (!user) return { rodzaj: 'nikt' }

    const { data: profil } = await serwisowy
      .from('profiles').select('rola').eq('id', user.id).single()
    return { rodzaj: 'uzytkownik', id: user.id, rola: String(profil?.rola ?? '') }
  } catch (err) {
    console.error('Nie udało się ustalić wołającego:', err)
    return { rodzaj: 'nikt' }
  }
}

/** Dla funkcji, które ma prawo wołać WYŁĄCZNIE potok albo zadanie cron: przypomnienia,
 *  powiadomienie o nowej ewidencji, diagnostyka poczty. Zwraca odpowiedź odmowną albo
 *  null, gdy wszystko w porządku. */
export function tylkoSerwis(w: Wolajacy) {
  if (w.rodzaj === 'serwis') return null
  // Celowo nie tłumaczymy wołającemu, czego mu brakuje.
  return odpowiedzJSON({ error: 'Brak uprawnień do tej operacji.' }, 403)
}
