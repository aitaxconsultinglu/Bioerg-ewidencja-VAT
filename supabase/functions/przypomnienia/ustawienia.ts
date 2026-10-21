// Wartości, które nie mogą stać w kodzie źródłowym, bo repozytorium aplikacji jest
// publiczne: nazwa firmy, jej podpis pod wiadomościami, adres aplikacji (zawiera nazwę
// repozytorium) i adres, na który idzie kopia powiadomień.
//
// Czytane z tabeli `ustawienia`, widocznej wyłącznie dla service_role - czyli dla funkcji
// brzegowych i dla nikogo więcej. Przeglądarka nie ma do niej dostępu, bo nie ma potrzeby.
//
// Gdy odczyt się nie uda, wiadomość i tak wychodzi: podpis jest wtedy neutralny, a wiersza
// z adresem aplikacji po prostu nie ma. Lepiej dostarczyć mail bez linku niż nie dostarczyć
// go wcale - treść mówi, co trzeba zrobić, a odbiorca i tak zna adres z poprzednich.
//
// Plik jest skopiowany do katalogu każdej funkcji brzegowej, bo funkcje wdrażają się
// niezależnie i nie dzielą modułów.

// deno-lint-ignore no-explicit-any
type Klient = any

export interface Ustawienia {
  /** Nazwa firmy. Pusty ciąg, gdy nieustawiona. */
  nazwaPodatnika: string
  /** Podpis pod wiadomością, np. "automat Bioerg". */
  podpisMaila: string
  /** Adres aplikacji albo pusty ciąg - wtedy nie dodajemy wiersza z linkiem. */
  adresAplikacji: string
  /** Adres w kopii powiadomień albo null. */
  kopiaPowiadomien: string | null
  /** Przerwa między kolejnymi wiadomościami jednej wysyłki, w sekundach. */
  odstepMiedzyMailamiS: number
}

const DOMYSLNE: Ustawienia = {
  nazwaPodatnika: '',
  podpisMaila: 'automat ewidencji przebiegu pojazdu',
  adresAplikacji: '',
  kopiaPowiadomien: null,
  odstepMiedzyMailamiS: 8,
}

/** Ile sekund odczekać przed KOLEJNĄ wiadomością.
 *
 *  Po co: 2026-10-21 trzynaście niemal identycznych wiadomości wyszło w trzynaście
 *  sekund i Gmail wrzucił je do spamu jako wysyłkę masową. Rozciągnięcie serii nie
 *  zastąpi poprawnego DMARC/DKIM, ale usuwa najbardziej rzucający się w oczy sygnał.
 *
 *  Odstęp jest skracany, gdy wiadomości jest dużo: całe wywołanie funkcji brzegowej ma
 *  twardy limit czasu (ok. 150 s), a potok GPS czeka na odpowiedź tylko kilka minut.
 *  Lepiej wysłać trzynaście maili co 6 sekund niż stracić połowę na przekroczeniu
 *  limitu w połowie serii. */
export function odstepSekund(u: Ustawienia, ileWiadomosci: number) {
  if (ileWiadomosci <= 1) return 0
  const BUDZET_S = 80
  return Math.max(0, Math.min(u.odstepMiedzyMailamiS, BUDZET_S / (ileWiadomosci - 1)))
}

export function odczekaj(sekundy: number) {
  if (sekundy <= 0) return Promise.resolve()
  return new Promise((gotowe) => setTimeout(gotowe, sekundy * 1000))
}

export async function wczytajUstawienia(supabase: Klient): Promise<Ustawienia> {
  try {
    const { data, error } = await supabase.from('ustawienia').select('klucz, wartosc')
    if (error || !data) {
      console.error('Nie udało się wczytać ustawień:', error?.message ?? 'brak danych')
      return DOMYSLNE
    }
    const m = new Map<string, string>(
      (data as { klucz: string; wartosc: string }[]).map((w) => [w.klucz, (w.wartosc ?? '').trim()]),
    )
    const kopia = m.get('kopia_powiadomien') ?? ''
    const odstep = Number(m.get('odstep_miedzy_mailami_s'))
    return {
      nazwaPodatnika: m.get('nazwa_podatnika') ?? DOMYSLNE.nazwaPodatnika,
      podpisMaila: m.get('podpis_maila') || DOMYSLNE.podpisMaila,
      adresAplikacji: m.get('adres_aplikacji') ?? DOMYSLNE.adresAplikacji,
      kopiaPowiadomien: kopia === '' ? null : kopia,
      odstepMiedzyMailamiS: Number.isFinite(odstep) && odstep >= 0
        ? odstep : DOMYSLNE.odstepMiedzyMailamiS,
    }
  } catch (err) {
    console.error('Nie udało się wczytać ustawień:', err)
    return DOMYSLNE
  }
}

/** Zakończenie każdej wiadomości: link do aplikacji (jeśli znany) i podpis. */
export function stopkaMaila(u: Ustawienia) {
  const linie: string[] = []
  if (u.adresAplikacji) linie.push(`Aplikacja: ${u.adresAplikacji}`, '')
  linie.push('Pozdrawiamy,', u.podpisMaila)
  return linie
}
