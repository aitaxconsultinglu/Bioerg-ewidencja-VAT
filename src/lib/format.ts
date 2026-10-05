import type { Status } from './types'

export const MIESIACE_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

export const CEL_DO_UZUPELNIENIA = '(do uzupełnienia przez kierownika)'

/** Czy cel wyjazdu ustalił potok GPS, czy zostawił go kierownikowi do wpisania. */
export function celDoUzupelnienia(cel: string | null | undefined) {
  return !cel || cel.trim() === '' || cel.startsWith('(do uzupełnienia')
}

export function miesiacRok(rok: number, miesiac: number) {
  return `${MIESIACE_PL[miesiac - 1]} ${rok}`
}

export function dataPL(iso: string | null) {
  if (!iso) return ''
  const [r, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${r}`
}

export function dataGodzinaPL(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

/** Najkrótszy dystans, jaki ewidencja wykazuje. Przejazd, który faktycznie się odbył,
 *  nie może figurować jako zero kilometrów. */
const MINIMALNY_DYSTANS = 0.01

/** Kilometry pokazujemy z dokładnością do 0,01 km - czyli dokładnie taką, z jaką
 *  trafiają do bazy (kolumna numeric(10,2)). Nic się więc po drodze nie gubi i suma
 *  z kolumny równa się co do grosza sumie surowej z GPS. Podłoga na MINIMALNY_DYSTANS
 *  zabezpiecza przed hipotetycznym przejazdem krótszym niż 0,005 km, który po
 *  zaokrągleniu dałby zero. */
export function kmLiczba(wartosc: number | null | undefined) {
  const x = Number(wartosc ?? 0)
  if (!(x > 0)) return 0
  return Math.max(MINIMALNY_DYSTANS, Math.round(x * 100) / 100)
}

export function formatujKm(wartosc: number) {
  return wartosc.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function km(wartosc: number | null) {
  if (wartosc === null || wartosc === undefined) return ''
  return formatujKm(kmLiczba(wartosc))
}

/** Suma liczona z wartości JUŻ zaokrąglonych, żeby "Razem" zgadzało się z tym, co widać
 *  w kolumnie. Sumujemy setne jako liczby całkowite - dodawanie ułamków dziesiętnych
 *  w arytmetyce zmiennoprzecinkowej kumuluje błąd i przy kilkudziesięciu trasach daje
 *  końcówki w rodzaju 2302,2599999997. */
export function sumaKm(trasy: { km: number }[]) {
  return Math.round(trasy.reduce((s, t) => s + kmLiczba(t.km) * 100, 0)) / 100
}

/** Stan licznika. Odczyt z licznika jest liczbą całkowitą i tak go pokazujemy, ale stan
 *  wyliczony (początek + suma tras) ma część ułamkową - wtedy pokazujemy dwa miejsca,
 *  żeby różnica stanów licznika zgadzała się co do setnej z wierszem "Razem". */
export function licznik(wartosc: number | null) {
  if (wartosc === null || wartosc === undefined) return ''
  const x = Math.round(Number(wartosc) * 100) / 100
  return Number.isInteger(x)
    ? x.toLocaleString('pl-PL')
    : x.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const ETYKIETY_STATUSU: Record<Status, string> = {
  wygenerowana: 'Wygenerowana',
  w_edycji: 'W edycji',
  wyslana_do_akceptacji: 'Wysłana do akceptacji',
  odeslana_do_poprawki: 'Odesłana do poprawki',
  zaakceptowana: 'Zaakceptowana',
}

/** Limonka = zaakceptowane, błękit = w toku, bursztyn = wymaga reakcji kierownika. */
export const KOLORY_STATUSU: Record<Status, string> = {
  wygenerowana: 'bg-slate-100 text-slate-700 ring-slate-300',
  w_edycji: 'bg-blekit-jasny text-blekit-ciemny ring-blekit',
  wyslana_do_akceptacji: 'bg-blekit-jasny text-blekit-ciemny ring-blekit',
  odeslana_do_poprawki: 'bg-amber-50 text-amber-800 ring-amber-400',
  zaakceptowana: 'bg-limonka-jasna text-limonka-ciemna ring-limonka',
}
