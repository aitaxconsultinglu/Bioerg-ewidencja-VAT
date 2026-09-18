import type { Status } from './types'

export const MIESIACE_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

export const CEL_DO_UZUPELNIENIA = '(do uzupełnienia przez kierownika)'

/** Trzy kategorie celu wyjazdu ustalone po stronie potoku (trasy_logika.py). */
export const KATEGORIE_CELU = ['Prace remontowe', 'Auto u mechanika', CEL_DO_UZUPELNIENIA]

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

export function km(wartosc: number | null) {
  if (wartosc === null || wartosc === undefined) return ''
  return wartosc.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function licznik(wartosc: number | null) {
  if (wartosc === null || wartosc === undefined) return ''
  return Math.round(wartosc).toLocaleString('pl-PL')
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
