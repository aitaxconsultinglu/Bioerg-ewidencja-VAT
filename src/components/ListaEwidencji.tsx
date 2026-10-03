import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Ewidencja as TEwidencja, Profil, Trasa } from '@/lib/types'
import { ETYKIETY_STATUSU, KOLORY_STATUSU, miesiacRok, sumaKm } from '@/lib/format'
import { cn } from '@/lib/utils'
import { nazwaPliku, pobierzPaczke, zbudujPdf, type PozycjaEksportu } from '@/lib/eksport'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

interface Props {
  profil: Profil
  otworz: (logId: string) => void
}

type Pozycja = TEwidencja & { suma_km: number }
interface Okres { rok: number; miesiac: number }

/** Ile miesięcy trzymamy w zakładkach - tyle realnie bywa naraz w obiegu. */
const WIDOCZNYCH_OKRESOW = 3

const klucz = (rok: number, miesiac: number) => rok * 12 + miesiac

/** Bieżący miesiąc i dwa poprzednie, od najstarszego. Liczone z kalendarza, a nie z
 *  danych - dzięki temu zakładka bieżącego miesiąca istnieje, zanim potok go pobierze,
 *  i widać wprost, że ewidencja jeszcze nie powstała. */
function ostatnieOkresy(ile: number): Okres[] {
  const dzis = new Date()
  const lista: Okres[] = []
  for (let i = ile - 1; i >= 0; i--) {
    const d = new Date(dzis.getFullYear(), dzis.getMonth() - i, 1)
    lista.push({ rok: d.getFullYear(), miesiac: d.getMonth() + 1 })
  }
  return lista
}

export function ListaEwidencji({ profil, otworz }: Props) {
  const okresy = useMemo(() => ostatnieOkresy(WIDOCZNYCH_OKRESOW), [])
  const [pozycje, setPozycje] = useState<Pozycja[]>([])
  const [aktywny, setAktywny] = useState<number>(
    klucz(okresy[okresy.length - 1].rok, okresy[okresy.length - 1].miesiac),
  )
  const [ladowanie, setLadowanie] = useState(true)
  const [postep, setPostep] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [oknoAkceptacji, setOknoAkceptacji] = useState(false)

  async function wczytaj() {
    const { data } = await supabase
      .from('monthly_logs')
      .select('*, vehicles(*), trips(km)')
      .order('rok', { ascending: false })
      .order('miesiac', { ascending: false })

    const wszystkie = (data ?? []).map((p) => ({
      ...(p as unknown as TEwidencja),
      suma_km: sumaKm(((p as { trips?: { km: number }[] }).trips) ?? []),
    }))
    const widoczne = new Set(okresy.map((o) => klucz(o.rok, o.miesiac)))
    setPozycje(wszystkie.filter((p) => widoczne.has(klucz(p.rok, p.miesiac))))
    setLadowanie(false)
  }

  useEffect(() => { void wczytaj() }, [])

  // Bieżący miesiąc bywa pusty do czasu importu - wtedy otwieramy najnowszą zakładkę,
  // w której faktycznie coś jest, zamiast witać użytkownika pustym ekranem. Dzieje się
  // to TYLKO raz, po wczytaniu: inaczej każde wejście w pustą zakładkę byłoby
  // natychmiast cofane i nie dałoby się jej otworzyć ręcznie.
  const wybranoAutomatycznie = useRef(false)
  useEffect(() => {
    if (ladowanie || wybranoAutomatycznie.current) return
    wybranoAutomatycznie.current = true
    if (pozycje.some((p) => klucz(p.rok, p.miesiac) === aktywny)) return
    const zDanymi = okresy.filter((o) => pozycje.some((p) => p.rok === o.rok && p.miesiac === o.miesiac))
    if (zDanymi.length) {
      const ostatni = zDanymi[zDanymi.length - 1]
      setAktywny(klucz(ostatni.rok, ostatni.miesiac))
    }
  }, [ladowanie, pozycje, okresy, aktywny])

  if (ladowanie) return <p className="text-slate-500">Wczytywanie ewidencji...</p>

  const okresAktywny = okresy.find((o) => klucz(o.rok, o.miesiac) === aktywny) ?? okresy[okresy.length - 1]
  const wZakladce = pozycje.filter((p) => klucz(p.rok, p.miesiac) === aktywny)
  const doAkceptacji = wZakladce.filter((p) => p.status !== 'zaakceptowana')
  const ksiegowosc = profil.rola === 'ksiegowosc'
  const etykietaOkresu = miesiacRok(okresAktywny.rok, okresAktywny.miesiac)
  const doPoprawki = pozycje.filter((p) => p.status === 'odeslana_do_poprawki')

  async function pobierzTrasy(lista: Pozycja[]): Promise<PozycjaEksportu[]> {
    const { data } = await supabase
      .from('trips').select('*').in('log_id', lista.map((p) => p.id)).order('lp')
    const wg = new Map<string, Trasa[]>()
    for (const t of (data ?? []) as Trasa[]) {
      const tab = wg.get(t.log_id) ?? []
      tab.push(t)
      wg.set(t.log_id, tab)
    }
    return lista.map((ewidencja) => ({ ewidencja, trasy: wg.get(ewidencja.id) ?? [] }))
  }

  async function paczka(format: 'pdf' | 'xlsx') {
    setBlad(null)
    setPostep(`Przygotowuję ${wZakladce.length} plików...`)
    try {
      await pobierzPaczke(await pobierzTrasy(wZakladce), format, okresAktywny.rok, okresAktywny.miesiac)
    } catch (e) {
      setBlad(e instanceof Error ? e.message : String(e))
    } finally {
      setPostep(null)
    }
  }

  async function zaakceptujWszystkie() {
    setOknoAkceptacji(false)
    setBlad(null)
    const pozycjeZTrasami = await pobierzTrasy(doAkceptacji)
    let zrobione = 0
    try {
      for (const { ewidencja, trasy } of pozycjeZTrasami) {
        zrobione++
        setPostep(`Akceptuję ${zrobione} z ${pozycjeZTrasami.length}: ${ewidencja.vehicles.nr_rejestracyjny}...`)
        const teraz = new Date().toISOString()
        const pdf = await zbudujPdf(
          { ...ewidencja, akceptacja_imie_nazwisko: profil.imie_nazwisko, akceptacja_at: teraz },
          trasy,
        )
        const sciezka = `${ewidencja.rok}/${nazwaPliku(ewidencja, 'pdf')}`
        const { error: bladPliku } = await supabase.storage
          .from('ewidencje').upload(sciezka, pdf, { contentType: 'application/pdf', upsert: true })
        if (bladPliku) throw bladPliku

        const { error } = await supabase.from('monthly_logs').update({
          status: 'zaakceptowana',
          pdf_path: sciezka,
          akceptacja_imie_nazwisko: profil.imie_nazwisko,
          akceptacja_at: teraz,
          akceptacja_by: profil.id,
        }).eq('id', ewidencja.id)
        if (error) throw error
      }
      await wczytaj()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : String(e))
      await wczytaj()
    } finally {
      setPostep(null)
    }
  }

  return (
    <div className="space-y-4">
      {doPoprawki.length > 0 && profil.rola === 'kierownik' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Do poprawki:</strong> {doPoprawki.length === 1 ? 'jedna ewidencja wymaga' : `${doPoprawki.length} ewidencje wymagają`} Twojej korekty.
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {okresy.map((o) => {
          const k = klucz(o.rok, o.miesiac)
          const ile = pozycje.filter((p) => klucz(p.rok, p.miesiac) === k).length
          const czynny = k === aktywny
          return (
            <button
              key={k}
              onClick={() => setAktywny(k)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition-colors',
                czynny
                  ? 'border-limonka font-semibold text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {miesiacRok(o.rok, o.miesiac)}
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-xs',
                ile ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400',
              )}>
                {ile}
              </span>
            </button>
          )
        })}
      </div>

      {ksiegowosc && wZakladce.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <span className="text-sm font-medium">{etykietaOkresu} — {wZakladce.length} poj.</span>
          <Button wariant="glowny" disabled={!!postep || doAkceptacji.length === 0}
                  onClick={() => setOknoAkceptacji(true)}>
            Zaakceptuj wszystkie ({doAkceptacji.length})
          </Button>
          <Button disabled={!!postep} onClick={() => void paczka('pdf')}>
            <Download className="h-4 w-4" /> Wszystkie PDF (.zip)
          </Button>
          <Button disabled={!!postep} onClick={() => void paczka('xlsx')}>
            <FileSpreadsheet className="h-4 w-4" /> Wszystkie Excel (.zip)
          </Button>
          {postep && <span className="text-sm text-blekit-ciemny">{postep}</span>}
        </div>
      )}

      {blad && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{blad}</div>}

      {wZakladce.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-600">
          <p className="font-medium">Brak ewidencji za {etykietaOkresu}.</p>
          <p className="mt-1 text-sm text-slate-500">
            Ewidencja za dany miesiąc powstaje pierwszego dnia miesiąca następnego, po
            pobraniu danych z GPS.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Pojazd</th>
                <th className="px-4 py-3">Marka i model</th>
                <th className="px-4 py-3">Miesiąc</th>
                <th className="px-4 py-3 text-right">Razem km</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {wZakladce.map((p) => (
                <tr key={p.id} onClick={() => otworz(p.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{p.vehicles.nr_rejestracyjny}</td>
                  <td className="px-4 py-3 text-slate-600">{p.vehicles.marka_model}</td>
                  <td className="px-4 py-3">{miesiacRok(p.rok, p.miesiac)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.suma_km.toLocaleString('pl-PL')}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1', KOLORY_STATUSU[p.status])}>
                      {ETYKIETY_STATUSU[p.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={oknoAkceptacji} onOpenChange={setOknoAkceptacji}>
        <DialogContent>
          <DialogTitle>Zaakceptować wszystkie ewidencje?</DialogTitle>
          <DialogDescription>
            Zaakceptujesz {doAkceptacji.length} ewidencji za {etykietaOkresu}, podpisując je
            jako <strong>{profil.imie_nazwisko}</strong>. Dla każdej powstanie archiwalny PDF,
            a arkusz zostanie zablokowany do edycji.
          </DialogDescription>
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Wśród nich {doAkceptacji.filter((p) => p.status !== 'wyslana_do_akceptacji').length} nie
            zostało jeszcze wysłanych do akceptacji przez kierownika.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setOknoAkceptacji(false)}>Anuluj</Button>
            <Button wariant="glowny" onClick={() => void zaakceptujWszystkie()}>
              Zaakceptuj {doAkceptacji.length}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
