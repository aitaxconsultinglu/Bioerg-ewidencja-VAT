import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Download, FileSpreadsheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type {
  Ewidencja as TEwidencja, OznaczeniePola, PoleEdytowalne, Profil, Trasa, WpisAudytu,
} from '@/lib/types'
import {
  ETYKIETY_STATUSU, KOLORY_STATUSU, celDoUzupelnienia,
  dataGodzinaPL, formatujKm, licznik, miesiacRok, sumaKm,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { nazwaPliku, pobierzExcel, pobierzPdf, zbudujPdf } from '@/lib/eksport'
import { TOLERANCJA_LICZNIKA_KM } from '@/lib/config'
import { TabelaTras } from './TabelaTras'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

interface Props {
  logId: string
  profil: Profil
  naListe: () => void
}

type TrybMasowy = 'wiersze' | 'kierowca' | 'cel'

/** WARSTWA 3 kontroli danych GPS: o ile faktyczny odczyt licznika rozjeżdża się ze stanem
 *  wyliczonym z ewidencji (licznik na początek + suma tras). Zwraca null, gdy kierownik
 *  jeszcze nic nie wpisał albo wpisał coś, co nie jest liczbą. Przecinek dziesiętny jest
 *  dopuszczalny - w polskiej klawiaturze numerycznej to on jest pod ręką. */
function roznicaZLicznikiem(wpisany: string, wyliczony: number): number | null {
  const tekst = wpisany.trim().replace(',', '.')
  if (tekst === '') return null
  const odczyt = Number(tekst)
  if (!Number.isFinite(odczyt)) return null
  return Math.round((odczyt - wyliczony) * 100) / 100
}

export function Ewidencja({ logId, profil, naListe }: Props) {
  const [ewidencja, setEwidencja] = useState<TEwidencja | null>(null)
  const [trasy, setTrasy] = useState<Trasa[]>([])
  const [audyt, setAudyt] = useState<WpisAudytu[]>([])
  const [oznaczenia, setOznaczenia] = useState<OznaczeniePola[]>([])
  const [trybOznaczania, setTrybOznaczania] = useState(false)
  const [podpis, setPodpis] = useState('')
  const [podpisAkceptacji, setPodpisAkceptacji] = useState('')
  const [tryb, setTryb] = useState<TrybMasowy>('wiersze')
  const [wartoscMasowa, setWartoscMasowa] = useState('')
  const [oknoPoprawki, setOknoPoprawki] = useState(false)
  const [komentarz, setKomentarz] = useState('')
  const [licznikRzeczywisty, setLicznikRzeczywisty] = useState('')
  const [zajety, setZajety] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)

  const wczytaj = useCallback(async () => {
    const { data: log } = await supabase
      .from('monthly_logs').select('*, vehicles(*)').eq('id', logId).single()
    const { data: t } = await supabase
      .from('trips').select('*').eq('log_id', logId).order('lp')
    const { data: a } = await supabase
      .from('audit_log').select('*').eq('log_id', logId).order('utworzono', { ascending: false }).limit(50)
    // Oznaczenia pol do poprawy. RLS wpuszcza tu ksiegowosc i kierownika tej ewidencji,
    // wiec jedno zapytanie obsluguje oba widoki.
    const { data: o } = await supabase
      .from('oznaczenia_pol').select('*').eq('log_id', logId)

    const e = log as TEwidencja
    setEwidencja(e)
    setTrasy((t ?? []) as Trasa[])
    setAudyt((a ?? []) as WpisAudytu[])
    setOznaczenia((o ?? []) as OznaczeniePola[])
    setPodpis(e?.podpis_imie_nazwisko ?? (profil.rola === 'kierownik' ? profil.imie_nazwisko : ''))
    setPodpisAkceptacji(e?.akceptacja_imie_nazwisko ?? (profil.rola === 'ksiegowosc' ? profil.imie_nazwisko : ''))
    const odczyt = e?.stan_licznika_koniec_rzeczywisty
    setLicznikRzeczywisty(odczyt === null || odczyt === undefined ? '' : String(odczyt))
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

  /** Wskazuje pole do poprawy albo zdejmuje wskazanie. Tylko ksiegowosc - RLS pilnuje
   *  tego po stronie bazy, ten warunek jest tylko po to, zeby nie wysylac zapytania,
   *  ktore i tak zostanie odrzucone. */
  async function przelaczOznaczenie(trasa: Trasa, pole: PoleEdytowalne) {
    if (!ksiegowosc) return
    const istniejace = oznaczenia.find((o) => o.trip_id === trasa.id && o.pole === pole)
    if (istniejace) {
      const { error } = await supabase.from('oznaczenia_pol').delete().eq('id', istniejace.id)
      if (error) { setBlad(error.message); return }
      setOznaczenia((p) => p.filter((o) => o.id !== istniejace.id))
      return
    }
    const { data, error } = await supabase.from('oznaczenia_pol').insert({
      log_id: logId,
      trip_id: trasa.id,
      pole,
      // Wartosc z chwili oznaczenia decyduje pozniej o tym, czy pole zostalo poprawione.
      wartosc_przy_oznaczeniu: String(trasa[pole] ?? ''),
      oznaczyl: profil.id,
    }).select().single()
    if (error) { setBlad(error.message); return }
    setOznaczenia((p) => [...p, data as OznaczeniePola])
  }

  async function zastosujMasowo() {
    if (!wartoscMasowa.trim()) return
    setZajety(true)
    const pole: PoleEdytowalne = tryb === 'cel' ? 'cel_wyjazdu' : 'kierowca'
    for (const t of trasy) {
      // Uzupełnianie masowe NIGDY nie nadpisuje tego, co już jest w komórce - ani
      // celu ustalonego przez potok GPS, ani nazwiska wpisanego wcześniej ręcznie.
      // Wypełnia wyłącznie puste pozycje, więc jest bezpieczne do użycia w dowolnym
      // momencie, także po ręcznym uzupełnieniu kilku pierwszych wierszy.
      const juzUzupelnione = pole === 'cel_wyjazdu'
        ? !celDoUzupelnienia(t.cel_wyjazdu)
        : String(t[pole] ?? '').trim() !== ''
      if (juzUzupelnione) continue
      await zapiszKomorke(t.id, pole, wartoscMasowa)
    }
    setZajety(false)
  }

  /** Zapisuje odczyt licznika od razu po wyjściu z pola - kierownik może wpisać go wcześniej
   *  niż podpis, a dane nie mogą zniknąć przy przeładowaniu widoku. */
  async function zapiszOdczytLicznika() {
    const tekst = licznikRzeczywisty.trim().replace(',', '.')
    if (tekst !== '' && !Number.isFinite(Number(tekst))) {
      setBlad('Stan licznika musi być liczbą, np. 576 albo 575,99.')
      return
    }
    const { error } = await supabase.from('monthly_logs')
      .update({ stan_licznika_koniec_rzeczywisty: tekst === '' ? null : Number(tekst) })
      .eq('id', logId)
    if (error) setBlad(error.message)
    else setBlad(null)
  }

  async function wyslijDoAkceptacji() {
    if (!podpis.trim()) { setBlad('Podpisz ewidencję, wpisując imię i nazwisko.'); return }
    const braki = trasy.filter((t) => !t.kierowca.trim() || celDoUzupelnienia(t.cel_wyjazdu))
    if (braki.length > 0) {
      setBlad(`Uzupełnij cel wyjazdu i kierowcę we wszystkich pozycjach (brakuje w ${braki.length}).`)
      return
    }
    // WARSTWA 3: ewidencja przebiegu musi zgadzać się z licznikiem pojazdu. Bez tego
    // usterka urządzenia GPS trafia do dokumentacji VAT z podpisem kierownika.
    const wyliczony = (ewidencja?.stan_licznika_poczatek ?? 0) + sumaKm(trasy)
    const roznica = roznicaZLicznikiem(licznikRzeczywisty, wyliczony)
    if (roznica === null) {
      setBlad('Wpisz faktyczny stan licznika pojazdu na koniec miesiąca - bez tego nie da się '
            + 'wysłać ewidencji do akceptacji.')
      return
    }
    if (Math.abs(roznica) > TOLERANCJA_LICZNIKA_KM) {
      setBlad(`Ewidencja nie zgadza się z licznikiem: z tras wychodzi ${licznik(wyliczony)} km, `
            + `a licznik pokazuje ${licznik(wyliczony + roznica)} km (różnica `
            + `${formatujKm(Math.abs(roznica))} km). Sprawdź, czy któraś trasa nie jest błędem `
            + 'GPS, i zgłoś to księgowości - nie podpisuj ewidencji, która nie zgadza się z pojazdem.')
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

    if (!error) {
      // Zawiadomienie księgowości, że coś na nią czeka. Błąd wysyłki NIE cofa wysłania
      // ewidencji - status jest już zapisany, a kierownik nie ma wpływu na pocztę.
      // Zamiast tłumić błąd po cichu (tak było z powiadomieniem o poprawce i przez
      // miesiąc nikt nie wiedział, że poczta nie działa) pokazujemy go kierownikowi
      // jako ostrzeżenie - ewidencja jest wysłana, ale warto dać znać księgowości.
      const { error: bladMaila } = await supabase.functions
        .invoke('powiadomienie-do-akceptacji', { body: { log_id: logId } })
      if (bladMaila) {
        setBlad('Ewidencja została wysłana do akceptacji, ale nie udało się powiadomić '
              + 'księgowości e-mailem. Warto poinformować ją bezpośrednio.')
      }
    }

    setZajety(false)
    if (error) setBlad(error.message)
    else await wczytaj()
  }

  /** Buduje PDF archiwalny na nowo dla ewidencji JUZ ZAAKCEPTOWANEJ, bez ruszania statusu,
   *  podpisu kierownika ani podpisu akceptacji.
   *
   *  Po co: zarchiwizowany plik powstaje w chwili akceptacji. Jesli dane trasy zostana
   *  pozniej poprawione - a 2026-10-22 poprawiono we wrzesniu nazwy kontrahentow w celach
   *  wyjazdu takze w ewidencjach zaakceptowanych - podpisany PDF przestaje sie zgadzac
   *  z tym, co jest w bazie. Dokument VAT i dane, z ktorych powstal, musza mowic to samo.
   *
   *  Alternatywa bylaby odblokowanie i ponowna akceptacja, ale to kasuje podpis
   *  akceptacji i kaze ksiegowosci podpisywac sie drugi raz pod czyms, co juz zatwierdzila. */
  async function odswiezPdf() {
    if (!ewidencja) return
    setZajety(true)
    setBlad(null)
    try {
      const pdf = await zbudujPdf(ewidencja, trasy)
      const sciezka = ewidencja.pdf_path ?? `${ewidencja.rok}/${nazwaPliku(ewidencja, 'pdf')}`
      const { error: bladPliku } = await supabase.storage
        .from('ewidencje').upload(sciezka, pdf, { contentType: 'application/pdf', upsert: true })
      if (bladPliku) throw bladPliku
      if (!ewidencja.pdf_path) {
        const { error } = await supabase.from('monthly_logs')
          .update({ pdf_path: sciezka }).eq('id', logId)
        if (error) throw error
      }
      await wczytaj()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : String(e))
    } finally {
      setZajety(false)
    }
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

    // Błąd wysyłki maila NIE cofa odesłania do poprawki - status jest już w bazie,
    // a mail to tylko zawiadomienie. Ale księgowość musi o nim wiedzieć, inaczej będzie
    // czekać na poprawkę, o której kierownik nie ma pojęcia. Do 2026-10-21 wyjątek był
    // tu tłumiony przez `.catch(() => undefined)`, więc nieudana wysyłka wyglądała
    // dokładnie tak samo jak udana - a wysyłka nie udawała się NIGDY, bo funkcja nie
    // odpowiadała na zapytanie wstępne przeglądarki i ta blokowała wywołanie.
    let bladMaila: string | null = null
    if (!error) {
      const { error: bladFunkcji } = await supabase.functions
        .invoke('powiadomienie-poprawka', { body: { log_id: logId } })
      if (bladFunkcji) bladMaila = bladFunkcji.message
    }
    setZajety(false)
    setOknoPoprawki(false)
    setKomentarz('')
    if (error) setBlad(error.message)
    else {
      if (bladMaila) {
        setBlad('Ewidencja została odesłana do poprawki, ale nie udało się powiadomić '
              + `kierownika e-mailem (${bladMaila}). Warto poinformować go bezpośrednio.`)
      }
      await wczytaj()
    }
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
  const licznikWyliczony = (ewidencja.stan_licznika_poczatek ?? 0) + sumaKm(trasy)
  const roznicaLicznika = roznicaZLicznikiem(licznikRzeczywisty, licznikWyliczony)
  const licznikRozjechany =
    roznicaLicznika !== null && Math.abs(roznicaLicznika) > TOLERANCJA_LICZNIKA_KM

  return (
    <div className="space-y-5">
      <button onClick={naListe} className="flex items-center gap-1.5 text-sm text-blekit-ciemny hover:underline">
        <ArrowLeft className="h-4 w-4" /> Wróć do listy
      </button>

      {/* Na gorze strony, nie na dole: ksiegowosc otwiera zablokowana ewidencje wlasnie po
          to, zeby ja odblokowac albo odswiezyc plik, a przy kilkuset wierszach tabeli
          przyciski na koncu strony sa praktycznie nie do znalezienia. */}
      {ksiegowosc && zablokowana && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="max-w-3xl text-sm text-amber-900">
            <span className="font-semibold">Ewidencja jest zaakceptowana i zablokowana.</span>{' '}
            Odblokowanie cofa ją do edycji i usuwa podpis akceptacji - po poprawkach trzeba
            zatwierdzić ją ponownie. „Odśwież PDF” buduje plik archiwalny na nowo z bieżących
            danych, nie ruszając statusu ani podpisów - do użycia, gdy dane poprawiono już
            po akceptacji.
          </p>
          <div className="flex gap-3">
            <Button wariant="zwykly" disabled={zajety} onClick={odswiezPdf}>
              Odśwież PDF
            </Button>
            <Button wariant="akcent" disabled={zajety} onClick={odblokuj}>
              Odblokuj do edycji
            </Button>
          </div>
        </div>
      )}

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

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-slate-500">Licznik - początek</dt>
            <dd className="font-medium tabular-nums">{licznik(ewidencja.stan_licznika_poczatek)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Licznik - koniec</dt>
            {/* Liczony jako początek + Razem, a nie brany z bazy: dzięki temu różnica
                stanów licznika zawsze równa się sumie z kolumny kilometrów, także po
                zaokrągleniu tras do 0,1 km. */}
            <dd className="font-medium tabular-nums">
              {licznik((ewidencja.stan_licznika_poczatek ?? 0) + sumaKm(trasy))}
            </dd>
          </div>
          <div>
            {/* Odczyt z deski rozdzielczej to jedyne, co pozwala stwierdzic, czy suma
                kilometrow z GPS odpowiada rzeczywistosci. Siedemnascie ewidencji za
                wrzesien przeszlo bez niego (kontrola byla wtedy tylko w przegladarce,
                wiec stara karta ja omijala) - ksiegowosc musi to widziec, zanim
                zatwierdzi dokument. */}
            <dt className="text-slate-500">Odczyt licznika</dt>
            <dd className="font-medium tabular-nums">
              {ewidencja.stan_licznika_koniec_rzeczywisty !== null
                && ewidencja.stan_licznika_koniec_rzeczywisty !== undefined
                ? licznik(ewidencja.stan_licznika_koniec_rzeczywisty)
                : <span className="text-sm font-medium text-amber-700">brak odczytu</span>}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Razem km</dt>
            <dd className="font-medium tabular-nums">{formatujKm(sumaKm(trasy))}</dd>
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
                  : 'Kierowca do wpisania w puste pozycje'}
                className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blekit focus:outline-none"
              />
              <Button wariant="glowny" disabled={zajety || !wartoscMasowa.trim()} onClick={zastosujMasowo}>
                Zastosuj do wszystkich pozycji
              </Button>
            </div>
          )}

          {tryb !== 'wiersze' && (
            <p className="w-full text-xs text-slate-500">
              Uzupełnione zostaną wyłącznie <strong>puste</strong> pozycje. To, co już
              wpisałeś ręcznie{tryb === 'cel' && ' lub ustalił automat z danych GPS'}, zostanie
              nietknięte - w razie potrzeby popraw to bezpośrednio w tabeli.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <TabelaTras
          trasy={trasy}
          zablokowana={zablokowana}
          zapisz={zapiszKomorke}
          // Po akceptacji ewidencja jest dokumentem, a nie lista uwag - kolory znikaja.
          oznaczenia={zablokowana ? [] : oznaczenia}
          trybOznaczania={trybOznaczania}
          przelaczOznaczenie={przelaczOznaczenie}
        />
      </div>

      {(mozeWyslac || ksiegowoscMozeDzialac) && (
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
        {mozeWyslac && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700" htmlFor="licznik-rzeczywisty">
                Stan licznika pojazdu na koniec miesiąca (odczyt z deski rozdzielczej)
              </label>
              <input
                id="licznik-rzeczywisty"
                inputMode="decimal"
                value={licznikRzeczywisty}
                onChange={(e) => setLicznikRzeczywisty(e.target.value)}
                onBlur={() => void zapiszOdczytLicznika()}
                className="mt-1 w-48 rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-blekit focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-500">
                Z tras w tabeli wychodzi {licznik(licznikWyliczony)} km.
              </p>
              {licznikRozjechany && roznicaLicznika !== null && (
                <p className="mt-2 max-w-xl rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-400">
                  Różnica {formatujKm(Math.abs(roznicaLicznika))} km
                  {roznicaLicznika > 0 ? ' (licznik pokazuje więcej)' : ' (licznik pokazuje mniej)'}.
                  Ewidencja musi zgadzać się z licznikiem pojazdu, więc nie da się jej teraz wysłać
                  do akceptacji. Najczęstsza przyczyna to błąd urządzenia GPS - sprawdź, czy któraś
                  trasa nie pokazuje kilometrów, których nie było, i zgłoś to księgowości.
                </p>
              )}
            </div>
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
            <div className="flex flex-wrap gap-3">
              <Button wariant="glowny" disabled={zajety || trybOznaczania} onClick={zaakceptuj}>
                Zaakceptuj i wygeneruj PDF
              </Button>
              <Button
                wariant={trybOznaczania ? 'akcent' : 'zwykly'}
                disabled={zajety}
                onClick={() => setTrybOznaczania((w) => !w)}
              >
                {trybOznaczania
                  ? 'Zakończ wskazywanie pól'
                  : `Wskaż pola do poprawy${oznaczenia.length ? ` (${oznaczenia.length})` : ''}`}
              </Button>
              <Button
                wariant="ostrzezenie"
                disabled={zajety || trybOznaczania}
                onClick={() => setOknoPoprawki(true)}
              >
                Odeślij do poprawki
              </Button>
            </div>
          </>
        )}
      </div>
      )}

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
