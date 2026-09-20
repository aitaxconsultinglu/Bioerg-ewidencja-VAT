import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Download, FileSpreadsheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Ewidencja as TEwidencja, PoleEdytowalne, Profil, Trasa, WpisAudytu } from '@/lib/types'
import {
  ETYKIETY_STATUSU, KOLORY_STATUSU, celDoUzupelnienia,
  dataGodzinaPL, licznik, miesiacRok, sumaKm,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { nazwaPliku, pobierzExcel, pobierzPdf, zbudujPdf } from '@/lib/eksport'
import { TabelaTras } from './TabelaTras'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

interface Props {
  logId: string
  profil: Profil
  naListe: () => void
}

type TrybMasowy = 'wiersze' | 'kierowca' | 'cel'

export function Ewidencja({ logId, profil, naListe }: Props) {
  const [ewidencja, setEwidencja] = useState<TEwidencja | null>(null)
  const [trasy, setTrasy] = useState<Trasa[]>([])
  const [audyt, setAudyt] = useState<WpisAudytu[]>([])
  const [podpis, setPodpis] = useState('')
  const [podpisAkceptacji, setPodpisAkceptacji] = useState('')
  const [tryb, setTryb] = useState<TrybMasowy>('wiersze')
  const [wartoscMasowa, setWartoscMasowa] = useState('')
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

    const e = log as TEwidencja
    setEwidencja(e)
    setTrasy((t ?? []) as Trasa[])
    setAudyt((a ?? []) as WpisAudytu[])
    setPodpis(e?.podpis_imie_nazwisko ?? (profil.rola === 'kierownik' ? profil.imie_nazwisko : ''))
    setPodpisAkceptacji(e?.akceptacja_imie_nazwisko ?? (profil.rola === 'ksiegowosc' ? profil.imie_nazwisko : ''))
  }, [logId, profil.imie_nazwisko, profil.rola])

  useEffect(() => { void wczytaj() }, [wczytaj])

  const zablokowana = ewidencja?.status === 'zaakceptowana'

  async function zapiszKomorke(tripId: string, pole: PoleEdytowalne, wartosc: string) {
    const { error } = await supabase.from('trips').update({ [pole]: wartosc }).eq('id', tripId)
    if (error) { setBlad(error.message); return }
    setTrasy((p) => p.map((t) => (t.id === tripId ? { ...t, [pole]: wartosc } : t)))

    if (ewidencja?.status === 'wygenerowana') {
      await supabase.from('monthly_logs').update({ status: 'w_edycji' }).eq('id', logId)
      setEwidencja((e) => (e ? { ...e, status: 'w_edycji' } : e))
    }
  }

  async function zastosujMasowo() {
    if (!wartoscMasowa.trim()) return
    setZajety(true)
    const pole: PoleEdytowalne = tryb === 'cel' ? 'cel_wyjazdu' : 'kierowca'
    for (const t of trasy) {
      // Cel ustalony automatycznie przez potok GPS zostaje nietknięty - masowe
      // uzupełnianie dotyczy wyłącznie pozycji "(do uzupełnienia przez kierownika)".
      // Ręczna edycja takiej komórki nadal jest możliwa.
      if (pole === 'cel_wyjazdu' && !celDoUzupelnienia(t.cel_wyjazdu)) continue
      if (String(t[pole] ?? '') !== wartoscMasowa) await zapiszKomorke(t.id, pole, wartoscMasowa)
    }
    setZajety(false)
  }

  async function wyslijDoAkceptacji() {
    if (!podpis.trim()) { setBlad('Podpisz ewidencję, wpisując imię i nazwisko.'); return }
    const braki = trasy.filter((t) => !t.kierowca.trim() || celDoUzupelnienia(t.cel_wyjazdu))
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
    if (!podpisAkceptacji.trim()) {
      setBlad('Wpisz imię i nazwisko osoby akceptującej.')
      return
    }
    setZajety(true)
    setBlad(null)
    try {
      // PDF archiwalny budujemy z danych PO wpisaniu podpisu akceptacji, żeby podpis
      // znalazł się w zarchiwizowanym pliku, a nie dopiero przy kolejnym pobraniu.
      const doArchiwum: TEwidencja = {
        ...ewidencja,
        akceptacja_imie_nazwisko: podpisAkceptacji,
        akceptacja_at: new Date().toISOString(),
      }
      const pdf = await zbudujPdf(doArchiwum, trasy)
      const sciezka = `${ewidencja.rok}/${nazwaPliku(ewidencja, 'pdf')}`
      const { error: bladPliku } = await supabase.storage
        .from('ewidencje').upload(sciezka, pdf, { contentType: 'application/pdf', upsert: true })
      if (bladPliku) throw bladPliku

      const { error } = await supabase.from('monthly_logs').update({
        status: 'zaakceptowana',
        pdf_path: sciezka,
        akceptacja_imie_nazwisko: podpisAkceptacji,
        akceptacja_at: doArchiwum.akceptacja_at,
        akceptacja_by: profil.id,
      }).eq('id', logId)
      if (error) throw error
      await wczytaj()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : String(e))
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
    // Odblokowanie czyści podpis akceptacji - po ponownej edycji ewidencja musi zostać
    // zaakceptowana na nowo, a stary podpis nie może zostać pod zmienionym dokumentem.
    await supabase.from('monthly_logs').update({
      status: 'w_edycji',
      akceptacja_imie_nazwisko: null,
      akceptacja_at: null,
      akceptacja_by: null,
    }).eq('id', logId)
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
  const mozeWyslac = kierownik && !zablokowana && ewidencja.status !== 'wyslana_do_akceptacji'
  // Księgowość może zatwierdzić albo odesłać na każdym etapie poza już zablokowanym -
  // także po odblokowaniu i ponownej edycji.
  const ksiegowoscMozeDzialac = ksiegowosc && !zablokowana

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
            <Button onClick={() => void pobierzExcel(ewidencja, trasy)}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button onClick={() => void pobierzPdf(ewidencja, trasy)}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            {ewidencja.pdf_path && (
              <Button wariant="akcent" onClick={pobierzArchiwalnyPdf}>Archiwalny PDF</Button>
            )}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-slate-500">Licznik - początek</dt>
            <dd className="font-medium tabular-nums">{licznik(ewidencja.stan_licznika_poczatek)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Licznik - koniec</dt>
            <dd className="font-medium tabular-nums">{licznik(ewidencja.stan_licznika_koniec)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Razem km</dt>
            <dd className="font-medium tabular-nums">{sumaKm(trasy).toLocaleString('pl-PL')}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Podpis kierownika</dt>
            <dd className="font-medium">
              {ewidencja.podpis_imie_nazwisko
                ? `${ewidencja.podpis_imie_nazwisko} (${dataGodzinaPL(ewidencja.podpis_at)})`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Zatwierdził</dt>
            <dd className="font-medium">
              {ewidencja.akceptacja_imie_nazwisko
                ? `${ewidencja.akceptacja_imie_nazwisko} (${dataGodzinaPL(ewidencja.akceptacja_at)})`
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
            {([
              ['wiersze', 'Edycja wiersz po wierszu'],
              ['kierowca', 'Jeden kierowca na cały miesiąc'],
              ['cel', 'Jeden cel wyjazdu na cały miesiąc'],
            ] as [TrybMasowy, string][]).map(([w, etykieta], i, tab) => (
              <button
                key={w}
                onClick={() => { setTryb(w); setWartoscMasowa('') }}
                className={cn(
                  'px-3 py-1.5 text-sm',
                  i === 0 && 'rounded-l-md',
                  i === tab.length - 1 && 'rounded-r-md',
                  tryb === w && 'bg-limonka font-medium',
                )}
              >
                {etykieta}
              </button>
            ))}
          </div>

          {tryb !== 'wiersze' && (
            <div className="flex flex-1 items-center gap-2">
              <input
                value={wartoscMasowa}
                onChange={(e) => setWartoscMasowa(e.target.value)}
                placeholder={tryb === 'cel'
                  ? 'Cel wyjazdu do wpisania w puste pozycje'
                  : 'Imię i nazwisko osoby kierującej pojazdem'}
                className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blekit focus:outline-none"
              />
              <Button wariant="glowny" disabled={zajety || !wartoscMasowa.trim()} onClick={zastosujMasowo}>
                Zastosuj do wszystkich pozycji
              </Button>
            </div>
          )}

          {tryb === 'cel' && (
            <p className="w-full text-xs text-slate-500">
              Pozycje, w których cel wyjazdu ustalił automat na podstawie danych GPS, zostaną
              pominięte - nadal można je poprawić ręcznie w tabeli.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <TabelaTras trasy={trasy} zablokowana={zablokowana} zapisz={zapiszKomorke} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
        {mozeWyslac && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700" htmlFor="podpis">
                Podpis kierownika (imię i nazwisko)
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

        {ksiegowoscMozeDzialac && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700" htmlFor="podpis-akceptacji">
                Zatwierdził (imię i nazwisko osoby akceptującej)
              </label>
              <input
                id="podpis-akceptacji"
                value={podpisAkceptacji}
                onChange={(e) => setPodpisAkceptacji(e.target.value)}
                className="mt-1 w-72 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
              />
            </div>
            <div className="flex gap-3">
              <Button wariant="glowny" disabled={zajety} onClick={zaakceptuj}>
                Zaakceptuj i wygeneruj PDF
              </Button>
              <Button wariant="ostrzezenie" disabled={zajety} onClick={() => setOknoPoprawki(true)}>
                Odeślij do poprawki
              </Button>
            </div>
          </>
        )}

        {ksiegowosc && zablokowana && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-slate-600">
              Ewidencja jest zaakceptowana i zablokowana. Odblokowanie cofa ją do edycji i
              usuwa podpis akceptacji - po poprawkach trzeba zatwierdzić ją ponownie.
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
