import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Download, FileSpreadsheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Ewidencja as TEwidencja, PoleEdytowalne, Profil, Trasa, WpisAudytu } from '@/lib/types'
import { ETYKIETY_STATUSU, KOLORY_STATUSU, dataGodzinaPL, km, licznik, miesiacRok } from '@/lib/format'
import { cn } from '@/lib/utils'
import { nazwaPliku, pobierzExcel, zbudujPdf } from '@/lib/eksport'
import { TabelaTras } from './TabelaTras'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

interface Props {
  logId: string
  profil: Profil
  naListe: () => void
}

export function Ewidencja({ logId, profil, naListe }: Props) {
  const [ewidencja, setEwidencja] = useState<TEwidencja | null>(null)
  const [trasy, setTrasy] = useState<Trasa[]>([])
  const [audyt, setAudyt] = useState<WpisAudytu[]>([])
  const [podpis, setPodpis] = useState('')
  const [trybMasowy, setTrybMasowy] = useState(false)
  const [kierowcaMasowo, setKierowcaMasowo] = useState('')
  const [oknoPoprawki, setOknoPoprawki] = useState(false)
  const [komentarz, setKomentarz] = useState('')
  const [zajety, setZajety] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)

  const wczytaj = useCallback(async () => {
    const { data: log } = await supabase
      .from('monthly_logs').select('*, vehicles(*)').eq('id', logId).single()
    const { data: t } = await supabase
      .from('trips').select('*').eq('log_id', logId).order('lp')
    const { data: a } = await supabase
      .from('audit_log').select('*').eq('log_id', logId).order('utworzono', { ascending: false }).limit(50)

    setEwidencja(log as TEwidencja)
    setTrasy((t ?? []) as Trasa[])
    setAudyt((a ?? []) as WpisAudytu[])
    setPodpis((log as TEwidencja)?.podpis_imie_nazwisko ?? profil.imie_nazwisko)
  }, [logId, profil.imie_nazwisko])

  useEffect(() => { void wczytaj() }, [wczytaj])

  const zablokowana = ewidencja?.status === 'zaakceptowana'

  async function zapiszKomorke(tripId: string, pole: PoleEdytowalne, wartosc: string) {
    const { error } = await supabase.from('trips').update({ [pole]: wartosc }).eq('id', tripId)
    if (error) { setBlad(error.message); return }
    setTrasy((p) => p.map((t) => (t.id === tripId ? { ...t, [pole]: wartosc } : t)))

    // Pierwsza zmiana przestawia ewidencję z "wygenerowana" na "w edycji" - dzięki temu
    // przypomnienie o uzupełnieniu wie, że kierownik już się nią zajął.
    if (ewidencja?.status === 'wygenerowana') {
      await supabase.from('monthly_logs').update({ status: 'w_edycji' }).eq('id', logId)
      setEwidencja((e) => (e ? { ...e, status: 'w_edycji' } : e))
    }
  }

  async function zastosujKierowcePoCalym() {
    if (!kierowcaMasowo.trim()) return
    setZajety(true)
    for (const t of trasy) {
      if (t.kierowca !== kierowcaMasowo) await zapiszKomorke(t.id, 'kierowca', kierowcaMasowo)
    }
    setZajety(false)
  }

  async function wyslijDoAkceptacji() {
    if (!podpis.trim()) { setBlad('Podpisz ewidencję, wpisując imię i nazwisko.'); return }
    const braki = trasy.filter((t) => !t.kierowca.trim() || t.cel_wyjazdu.startsWith('(do uzupełnienia'))
    if (braki.length > 0) {
      setBlad(`Uzupełnij cel wyjazdu i kierowcę we wszystkich pozycjach (brakuje w ${braki.length}).`)
      return
    }
    setZajety(true)
    setBlad(null)
    const { error } = await supabase.from('monthly_logs').update({
      status: 'wyslana_do_akceptacji',
      podpis_imie_nazwisko: podpis,
      podpis_at: new Date().toISOString(),
      podpis_by: profil.id,
      komentarz_ksiegowosci: null,
    }).eq('id', logId)
    setZajety(false)
    if (error) setBlad(error.message)
    else await wczytaj()
  }

  async function zaakceptuj() {
    if (!ewidencja) return
    setZajety(true)
    setBlad(null)
    try {
      const pdf = await zbudujPdf(ewidencja, trasy, false)
      const sciezka = `${ewidencja.rok}/${nazwaPliku(ewidencja, 'pdf')}`
      const { error: bladPliku } = await supabase.storage
        .from('ewidencje').upload(sciezka, pdf, { contentType: 'application/pdf', upsert: true })
      if (bladPliku) throw bladPliku

      const { error } = await supabase.from('monthly_logs')
        .update({ status: 'zaakceptowana', pdf_path: sciezka }).eq('id', logId)
      if (error) throw error
      await wczytaj()
    } catch (e: any) {
      setBlad(e.message ?? String(e))
    } finally {
      setZajety(false)
    }
  }

  async function odeslijDoPoprawki() {
    if (!komentarz.trim()) return
    setZajety(true)
    const { error } = await supabase.from('monthly_logs').update({
      status: 'odeslana_do_poprawki',
      komentarz_ksiegowosci: komentarz,
    }).eq('id', logId)

    if (!error) {
      // Komentarz widać w aplikacji natychmiast; e-mail do kierownika wysyła funkcja
      // brzegowa. Nieudana wysyłka nie może cofnąć samego odesłania do poprawki.
      await supabase.functions.invoke('powiadomienie-poprawka', { body: { log_id: logId } })
        .catch(() => undefined)
    }
    setZajety(false)
    setOknoPoprawki(false)
    setKomentarz('')
    if (error) setBlad(error.message)
    else await wczytaj()
  }

  async function odblokuj() {
    setZajety(true)
    await supabase.from('monthly_logs').update({ status: 'w_edycji' }).eq('id', logId)
    setZajety(false)
    await wczytaj()
  }

  async function pobierzArchiwalnyPdf() {
    if (!ewidencja?.pdf_path) return
    const { data } = await supabase.storage.from('ewidencje').createSignedUrl(ewidencja.pdf_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  if (!ewidencja) return <p className="text-slate-500">Wczytywanie...</p>

  const kierownik = profil.rola === 'kierownik'
  const ksiegowosc = profil.rola === 'ksiegowosc'
  const mozeWyslac = !zablokowana && ewidencja.status !== 'wyslana_do_akceptacji'

  return (
    <div className="space-y-5">
      <button onClick={naListe} className="flex items-center gap-1.5 text-sm text-blekit-ciemny hover:underline">
        <ArrowLeft className="h-4 w-4" /> Wróć do listy
      </button>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">
                {ewidencja.vehicles.nr_rejestracyjny} — {ewidencja.vehicles.marka_model}
              </h2>
              <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1', KOLORY_STATUSU[ewidencja.status])}>
                {ETYKIETY_STATUSU[ewidencja.status]}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{miesiacRok(ewidencja.rok, ewidencja.miesiac)}</p>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => pobierzExcel(ewidencja, trasy)}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button onClick={() => void zbudujPdf(ewidencja, trasy, true)}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            {ewidencja.pdf_path && (
              <Button wariant="akcent" onClick={pobierzArchiwalnyPdf}>Archiwalny PDF</Button>
            )}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Stan licznika na początek miesiąca</dt>
            <dd className="font-medium tabular-nums">{licznik(ewidencja.stan_licznika_poczatek)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Stan licznika na koniec miesiąca</dt>
            <dd className="font-medium tabular-nums">{licznik(ewidencja.stan_licznika_koniec)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Razem km</dt>
            <dd className="font-medium tabular-nums">{km(trasy.reduce((s, t) => s + Number(t.km), 0))}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Podpis</dt>
            <dd className="font-medium">
              {ewidencja.podpis_imie_nazwisko
                ? `${ewidencja.podpis_imie_nazwisko} (${dataGodzinaPL(ewidencja.podpis_at)})`
                : '—'}
            </dd>
          </div>
        </dl>
      </div>

      {ewidencja.status === 'odeslana_do_poprawki' && ewidencja.komentarz_ksiegowosci && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Odesłane do poprawki przez księgowość:</p>
          <p className="mt-1 text-sm text-amber-900">{ewidencja.komentarz_ksiegowosci}</p>
        </div>
      )}

      {blad && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{blad}</div>}

      {!zablokowana && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex rounded-md ring-1 ring-slate-300">
            <button
              onClick={() => setTrybMasowy(false)}
              className={cn('rounded-l-md px-3 py-1.5 text-sm', !trybMasowy && 'bg-limonka font-medium')}
            >
              Edycja wiersz po wierszu
            </button>
            <button
              onClick={() => setTrybMasowy(true)}
              className={cn('rounded-r-md px-3 py-1.5 text-sm', trybMasowy && 'bg-limonka font-medium')}
            >
              Jeden kierowca na cały miesiąc
            </button>
          </div>

          {trybMasowy && (
            <div className="flex flex-1 items-center gap-2">
              <input
                value={kierowcaMasowo}
                onChange={(e) => setKierowcaMasowo(e.target.value)}
                placeholder="Imię i nazwisko osoby kierującej pojazdem"
                className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blekit focus:outline-none"
              />
              <Button wariant="glowny" disabled={zajety || !kierowcaMasowo.trim()} onClick={zastosujKierowcePoCalym}>
                Zastosuj do wszystkich pozycji
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <TabelaTras trasy={trasy} zablokowana={zablokowana} zapisz={zapiszKomorke} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
        {kierownik && mozeWyslac && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700" htmlFor="podpis">
                Podpis (imię i nazwisko)
              </label>
              <input
                id="podpis"
                value={podpis}
                onChange={(e) => setPodpis(e.target.value)}
                className="mt-1 w-72 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
              />
            </div>
            <Button wariant="glowny" disabled={zajety} onClick={wyslijDoAkceptacji}>
              Wyślij do akceptacji
            </Button>
          </>
        )}

        {ksiegowosc && ewidencja.status === 'wyslana_do_akceptacji' && (
          <div className="flex gap-3">
            <Button wariant="glowny" disabled={zajety} onClick={zaakceptuj}>
              Zaakceptuj i wygeneruj PDF
            </Button>
            <Button wariant="ostrzezenie" disabled={zajety} onClick={() => setOknoPoprawki(true)}>
              Odeślij do poprawki
            </Button>
          </div>
        )}

        {ksiegowosc && zablokowana && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-slate-600">
              Ewidencja jest zaakceptowana i zablokowana. Aby wprowadzić zmiany, odblokuj ją.
            </p>
            <Button wariant="akcent" disabled={zajety} onClick={odblokuj}>Odblokuj do edycji</Button>
          </div>
        )}
      </div>

      <details className="rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium">Dziennik zmian ({audyt.length})</summary>
        <table className="mt-3 w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-3">Kiedy</th>
              <th className="py-1 pr-3">Kto</th>
              <th className="py-1 pr-3">Akcja</th>
              <th className="py-1 pr-3">Pole</th>
              <th className="py-1 pr-3">Było</th>
              <th className="py-1">Jest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {audyt.map((w) => (
              <tr key={w.id}>
                <td className="py-1 pr-3 whitespace-nowrap">{dataGodzinaPL(w.utworzono)}</td>
                <td className="py-1 pr-3">{w.user_email ?? '—'}</td>
                <td className="py-1 pr-3">{w.akcja}</td>
                <td className="py-1 pr-3">{w.pole ?? ''}</td>
                <td className="py-1 pr-3 text-slate-500">{w.stara_wartosc ?? ''}</td>
                <td className="py-1">{w.nowa_wartosc ?? ''}</td>
              </tr>
            ))}
            {audyt.length === 0 && (
              <tr><td colSpan={6} className="py-2 text-slate-500">Brak zapisanych zmian.</td></tr>
            )}
          </tbody>
        </table>
      </details>

      <Dialog open={oknoPoprawki} onOpenChange={setOknoPoprawki}>
        <DialogContent>
          <DialogTitle>Odeślij do poprawki</DialogTitle>
          <DialogDescription>
            Komentarz zobaczy kierownik w aplikacji i otrzyma go e-mailem. Pole jest wymagane.
          </DialogDescription>
          <textarea
            value={komentarz}
            onChange={(e) => setKomentarz(e.target.value)}
            rows={4}
            className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
            placeholder="Co należy poprawić?"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setOknoPoprawki(false)}>Anuluj</Button>
            <Button wariant="ostrzezenie" disabled={!komentarz.trim() || zajety} onClick={odeslijDoPoprawki}>
              Odeślij do poprawki
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
