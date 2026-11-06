import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { OdczytLicznika, Profil, RodzajOdczytu, WynikOdczytu } from '@/lib/types'
import { MIESIACE_PL, dataPL, formatujKm, licznik } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

interface Props {
  vehicleId: string
  nrRejestracyjny: string
  /** Okres ewidencji, w której panel jest osadzony - wyznacza domyślną datę odczytu. */
  rok: number
  miesiac: number
  profil: Profil
  /** Wywoływane po każdej zmianie, która mogła ruszyć trasy albo stany licznika -
   *  widok ewidencji musi się wtedy przeładować. */
  poZmianie: () => void | Promise<void>
}

/** Dzisiejsza data w strefie polskiej, w formacie dla <input type="date">.
 *
 *  Nie `new Date().toISOString()`: ten zwraca UTC, więc po 23:00 czasu polskiego
 *  podpowiadałby dzień wcześniejszy. Kierownik wpisujący odczyt wieczorem dostałby
 *  domyślnie wczorajszą datę i niczego by nie zauważył. */
function dzisiajPL() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** Nazwa miesiąca małą literą - do wplecenia w zdanie. MIESIACE_PL są z wielkiej. */
function nazwaMiesiaca(miesiac: number) {
  return (MIESIACE_PL[miesiac - 1] ?? String(miesiac)).toLocaleLowerCase('pl')
}

function ostatniDzienMiesiaca(rok: number, miesiac: number) {
  const d = new Date(Date.UTC(rok, miesiac, 0))
  return d.toISOString().slice(0, 10)
}

/** Domyślna data odczytu: ostatni dzień miesiąca TEJ ewidencji, nie dzisiaj.
 *
 *  DLACZEGO. Korekta trafia do ewidencji za miesiąc, z którego pochodzi DATA odczytu.
 *  Kierownik zamykający październik odczytuje licznik 2 listopada i naturalnie wpisuje
 *  2 listopada - a wtedy korekta ląduje w listopadzie, którego ewidencji jeszcze nie ma,
 *  październik zostaje nietknięty i wysyłka do akceptacji nadal jest zablokowana.
 *  Dokładnie to zgłosił kierownik 3.11.2026. Podpowiadamy więc koniec miesiąca ewidencji,
 *  a gdy ten miesiąc jeszcze trwa - dzisiaj, bo przyszłej daty baza nie przyjmie. */
function domyslnaData(rok: number, miesiac: number) {
  const koniec = ostatniDzienMiesiaca(rok, miesiac)
  const dzis = dzisiajPL()
  return koniec < dzis ? koniec : dzis
}

/** Czy ten dzień jest ostatnim dniem swojego miesiąca - tylko do podpowiedzi. */
function toKoniecMiesiaca(data: string) {
  if (data === '') return false
  return data === ostatniDzienMiesiaca(Number(data.slice(0, 4)), Number(data.slice(5, 7)))
}

/** Bieżąca godzina w strefie polskiej, 'HH:MM' - do ograniczenia pola godziny, gdy
 *  odczyt jest z dzisiaj. Baza odrzuca godzinę z przyszłości. */
function terazPL() {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
}

const OPIS_WYNIKU: Record<WynikOdczytu, { tekst: string; klasa: string }> = {
  kontrolny: {
    tekst: 'kontrolny - bez zmian w ewidencji',
    klasa: 'bg-slate-100 text-slate-700 ring-slate-300',
  },
  zgodny: {
    tekst: 'zgodny z ewidencją',
    klasa: 'bg-green-50 text-green-800 ring-green-300',
  },
  skorygowany: {
    tekst: 'naniesiono korektę',
    klasa: 'bg-blue-50 text-blue-800 ring-blue-300',
  },
  oczekuje: {
    tekst: 'czeka na dane GPS',
    klasa: 'bg-slate-100 text-slate-600 ring-slate-300',
  },
  zablokowany: {
    tekst: 'ewidencja zaakceptowana',
    klasa: 'bg-amber-50 text-amber-800 ring-amber-400',
  },
}

/** Odczyty licznika pojazdu i korekty, które z nich wynikają.
 *
 *  Po co osobny panel, a nie jedno pole w ewidencji: odczyt należy do POJAZDU i może
 *  dotyczyć dnia z dowolnego miesiąca, także takiego, którego danych GPS jeszcze nie ma.
 *  Kierownik wpisuje go „od czasu do czasu”, a każda ewidencja bierze z tej listy to,
 *  co dotyczy jej okresu.
 *
 *  Zapis idzie przez funkcję bazy `zapisz_odczyt_licznika`, bo sam wiersz to połowa
 *  roboty: druga połowa to naliczenie pozycji korekcyjnej i przeliczenie stanów licznika
 *  w kolejnych miesiącach. Tabela nie ma polityki INSERT właśnie dlatego, żeby nie dało
 *  się zapisać odczytu bez tych dwóch kroków. */
export function OdczytyLicznika({
  vehicleId, nrRejestracyjny, rok, miesiac, profil, poZmianie,
}: Props) {
  const [odczyty, setOdczyty] = useState<OdczytLicznika[]>([])
  const [data, setData] = useState(() => domyslnaData(rok, miesiac))
  const [godzina, setGodzina] = useState('')
  // ZAWSZE kontrolny, niezależnie od daty. Odczyt kontrolny niczego w dokumencie nie
  // zmienia, więc pomyłka jest bez konsekwencji - a odwrotnie już nie: podpowiedziane
  // „koniec miesiąca” dopisałoby kierownikowi pozycję korekcyjną, której nie planował.
  // Zamknięcie miesiąca to świadoma decyzja i wymaga przestawienia tego pola.
  const [rodzaj, setRodzaj] = useState<RodzajOdczytu>('kontrolny')
  const [stan, setStan] = useState('')
  const [uwaga, setUwaga] = useState('')
  const [zajety, setZajety] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [komunikat, setKomunikat] = useState<string | null>(null)
  const [rozwinieta, setRozwinieta] = useState(false)

  const wczytaj = useCallback(async () => {
    // Kolumny porównania pobiera tylko administrator. Ukrycie ich wyłącznie w widoku
    // zostawiałoby je w odpowiedzi API - a chodzi o to, żeby kierownik ich nie miał,
    // a nie o to, żeby ich nie wyświetlać.
    const kolumny = profil.administrator
      ? '*'
      : 'id, vehicle_id, data_odczytu, godzina_odczytu, stan, rodzaj, uwaga, '
        + 'wpisal_nazwa, wynik, utworzono'
    const { data: o } = await supabase
      .from('odczyty_licznika').select(kolumny)
      .eq('vehicle_id', vehicleId)
      .order('data_odczytu', { ascending: false })
    setOdczyty((o ?? []) as unknown as OdczytLicznika[])
  }, [vehicleId, profil.administrator])

  useEffect(() => { void wczytaj() }, [wczytaj])

  // Zmiana dnia wraca do odczytu kontrolnego: ustawienie „koniec miesiąca” z poprzedniego
  // wpisu nie może po cichu dopisać korekty do odczytu z zupełnie innego dnia.
  useEffect(() => { setRodzaj('kontrolny') }, [data])

  async function zapisz() {
    const tekst = stan.trim().replace(',', '.')
    if (tekst === '' || !Number.isFinite(Number(tekst)) || Number(tekst) < 0) {
      setBlad('Stan licznika musi być liczbą nieujemną, np. 209465 albo 209465,4.')
      return
    }
    if (!data) {
      setBlad('Podaj dzień, w którym odczytałeś licznik.')
      return
    }
    setZajety(true)
    setBlad(null)
    setKomunikat(null)
    const { data: wynik, error } = await supabase.rpc('zapisz_odczyt_licznika', {
      p_vehicle_id: vehicleId,
      p_data: data,
      p_stan: Number(tekst),
      p_uwaga: uwaga.trim() || null,
      // Pusta godzina to null, nie '': brak godziny znaczy „odczyt dotyczy całego dnia”
      // i tak właśnie liczy to baza.
      p_godzina: godzina || null,
      p_rodzaj: rodzaj,
    })
    setZajety(false)
    if (error) { setBlad(error.message); return }

    const w = wynik as {
      wynik: WynikOdczytu; stan_wyliczony: number | null; korekta_km: number | null
    }
    setStan('')
    setGodzina('')
    setUwaga('')
    setKomunikat(opisZapisu(w))
    await wczytaj()
    // Korekta to nowa pozycja w tabeli tras i inny stan licznika - widok ewidencji
    // musi się przeładować, inaczej pokazywałby dane sprzed korekty.
    await poZmianie()
  }

  function opisZapisu(w: {
    wynik: WynikOdczytu; stan_wyliczony: number | null; korekta_km: number | null
  }) {
    const roznica = w.korekta_km === null ? null : Math.abs(w.korekta_km)
    switch (w.wynik) {
      case 'kontrolny':
        // Rozbieżność widzi wyłącznie administrator - patrz pokazujRoznice.
        if (!pokazujRoznice) {
          return 'Odczyt kontrolny zapisany. W ewidencji nic się nie zmienia - '
               + 'to tylko zapis stanu licznika na ten dzień.'
        }
        return roznica === null || roznica < 1
          ? `Odczyt kontrolny zapisany. Ewidencja pokazuje na ten moment `
            + `${licznik(w.stan_wyliczony)} km - zgadza się z licznikiem.`
          : `Odczyt kontrolny zapisany. Ewidencja pokazuje na ten moment `
            + `${licznik(w.stan_wyliczony)} km, czyli `
            + `${formatujKm(roznica)} km ${(w.korekta_km ?? 0) > 0 ? 'mniej' : 'więcej'} `
            + 'niż licznik. Dokument zostaje bez zmian - rozbieżność zamknie dopiero '
            + 'odczyt na koniec miesiąca.'
      case 'zgodny':
        return `Odczyt zgodny z ewidencją${roznica !== null ? ` (różnica ${formatujKm(roznica)} km, poniżej progu korekty)` : ''}.`
      case 'skorygowany':
        return `Z ewidencji wychodziło ${licznik(w.stan_wyliczony)} km. Dopisano pozycję `
             + `korekcyjną ${w.korekta_km !== null && w.korekta_km > 0 ? '+' : ''}`
             + `${formatujKm(w.korekta_km ?? 0)} km, żeby stan licznika zgadzał się z pojazdem.`
      case 'oczekuje':
        // Normalna sytuacja dla odczytu z BIEŻĄCEGO miesiąca: ewidencję generuje się
        // pierwszego dnia następnego, więc cotygodniowe odczyty czekają tu do końca
        // miesiąca i przeliczają się same po wgraniu danych.
        return 'Odczyt zapisany. Ewidencji za ten miesiąc jeszcze nie ma - porównanie '
             + 'z GPS naliczy się samo po wgraniu danych, pierwszego dnia następnego '
             + 'miesiąca.'
      case 'zablokowany':
        return 'Odczyt zapisany, ale ewidencja za ten miesiąc jest już zaakceptowana. '
             + 'Korektę może nanieść tylko administrator.'
    }
  }

  async function usun(id: string) {
    setZajety(true)
    setBlad(null)
    const { error } = await supabase.rpc('usun_odczyt_licznika', { p_odczyt_id: id })
    setZajety(false)
    if (error) { setBlad(error.message); return }
    setKomunikat('Odczyt usunięty razem z jego pozycją korekcyjną.')
    await wczytaj()
    await poZmianie()
  }

  const ksiegowosc = profil.rola === 'ksiegowosc'
  /** Czy pokazywać, o ile odczyt rozjechał się z ewidencją.
   *
   *  Tylko administrator. Kierownik, który widzi różnicę w chwili wpisywania, ma
   *  naturalną pokusę „poprawić” odczyt tak, żeby się zgadzał - a wtedy cotygodniowa
   *  kontrola przestaje cokolwiek mierzyć i zostaje nam potwierdzenie własnych danych.
   *  Sam odczyt i jego zapis widzi normalnie, patrz PodsumowanieOdczytow. */
  const pokazujRoznice = profil.administrator === true
  const ostatni = odczyty[0]
  const zamykaMiesiac = rodzaj === 'koniec_miesiaca'
  // Data z ostatniego dnia miesiąca przy odczycie kontrolnym: najpewniej ktoś zamyka
  // miesiąc i nie zauważył pola rodzaju. Nie przestawiamy za niego - samo zamknięcie
  // dopisuje pozycję do dokumentu podatkowego i ma być świadome - ale pytamy wprost.
  const moznaZamknac = !zamykaMiesiac && toKoniecMiesiaca(data)
  // Korekta trafia do ewidencji za miesiąc z DATY odczytu. Gdy data wypada poza
  // miesiącem tej ewidencji, mówimy o tym OD RAZU - inaczej kierownik zapisuje odczyt,
  // nic się nie zmienia i nie wie dlaczego.
  // Dotyczy to wyłącznie odczytu zamykającego miesiąc - kontrolny z definicji bywa
  // z dowolnego dnia i niczego nie przesuwa.
  const innyMiesiac = zamykaMiesiac && data !== '' && (
    Number(data.slice(0, 4)) !== rok || Number(data.slice(5, 7)) !== miesiac
  )

  return (
    // Panel neutralny, nie w kolorach marki: te sa zarezerwowane na akcenty, a nie na
    // duze wypelnienia tla (patrz komentarz w tailwind.config.js).
    <div className="rounded-lg border border-slate-300 bg-slate-50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700" htmlFor="odczyt-data">
            Dzień odczytu
          </label>
          <input
            id="odczyt-data"
            type="date"
            value={data}
            max={dzisiajPL()}
            onChange={(e) => setData(e.target.value)}
            className="mt-1 w-40 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700" htmlFor="odczyt-godzina">
            Godzina odczytu
          </label>
          {/* Bez godziny odczyt porównuje się z całym dniem, więc kurs wykonany PO
              odczycie zawyża ewidencję. Przy aucie dojeżdżającym z kwatery to co tydzień
              ten sam, nieprawdziwy minus wielkości drogi powrotnej. */}
          <input
            id="odczyt-godzina"
            type="time"
            value={godzina}
            max={data === dzisiajPL() ? terazPL() : undefined}
            onChange={(e) => setGodzina(e.target.value)}
            className="mt-1 w-28 rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-blekit focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700" htmlFor="odczyt-stan">
            Stan licznika z deski rozdzielczej (km)
          </label>
          <input
            id="odczyt-stan"
            inputMode="decimal"
            value={stan}
            onChange={(e) => setStan(e.target.value)}
            placeholder="np. 209465"
            className="mt-1 w-48 rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-blekit focus:outline-none"
          />
        </div>
        <div className="min-w-48 flex-1">
          <label className="block text-xs font-medium text-slate-700" htmlFor="odczyt-uwaga">
            Uwaga (opcjonalnie)
          </label>
          <input
            id="odczyt-uwaga"
            value={uwaga}
            onChange={(e) => setUwaga(e.target.value)}
            placeholder="np. odczyt przy wymianie opon"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700" htmlFor="odczyt-rodzaj">
            Rodzaj odczytu
          </label>
          <select
            id="odczyt-rodzaj"
            value={rodzaj}
            onChange={(e) => setRodzaj(e.target.value as RodzajOdczytu)}
            className="mt-1 w-56 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blekit focus:outline-none"
          >
            <option value="kontrolny">Kontrolny (w trakcie miesiąca)</option>
            <option value="koniec_miesiaca">Na koniec miesiąca (zamyka miesiąc)</option>
          </select>
        </div>
        <Button wariant="glowny" disabled={zajety} onClick={zapisz}>
          Zapisz odczyt licznika
        </Button>
      </div>

      <p className="mt-2 text-xs text-slate-600">
        Wpisz tu prawdziwy stan licznika {nrRejestracyjny}, kiedy go odczytasz.{' '}
        {zamykaMiesiac ? (
          <>
            <span className="font-medium">Odczyt na koniec miesiąca</span> zamyka miesiąc:
            aplikacja porówna go z kilometrami z GPS i, jeśli się rozjeżdżają, dopisze
            w ewidencji pozycję korekcyjną, żeby licznik w dokumencie zgadzał się
            z pojazdem.
          </>
        ) : (
          <>
            <span className="font-medium">Odczyt kontrolny</span> niczego w dokumencie nie
            zmienia - tylko pokazuje, o ile ewidencja rozjeżdża się z licznikiem na ten
            moment. Dzięki temu cotygodniowa kontrola nie zostawia w ewidencji czterech
            pozycji korekcyjnych, a rozbieżność widać już w trakcie miesiąca i wiadomo,
            w którym tygodniu powstała.
          </>
        )}{' '}
        Podaj godzinę, jeśli po odczycie auto jeszcze tego dnia jeździło - bez niej
        porównanie obejmuje cały dzień razem z późniejszymi kursami.
      </p>

      {innyMiesiac && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-300">
          <span className="font-medium">Uwaga: ta data jest spoza okresu tej ewidencji.</span>{' '}
          Korekta trafi do ewidencji za {nazwaMiesiaca(Number(data.slice(5, 7)))}{' '}
          {data.slice(0, 4)}, a nie do {nazwaMiesiaca(miesiac)} {rok} - a jeśli tamtej
          ewidencji jeszcze nie ma, odczyt poczeka na dane GPS i w tym miesiącu nic się nie
          zmieni. Zamykasz {nazwaMiesiaca(miesiac)}? Wpisz stan licznika{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setData(domyslnaData(rok, miesiac))}
          >
            na {dataPL(ostatniDzienMiesiaca(rok, miesiac))}
          </button>.
        </p>
      )}

      {moznaZamknac && (
        <p className="mt-2 rounded-md bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-300">
          To ostatni dzień miesiąca. Zapisany teraz odczyt będzie <strong>kontrolny</strong>,
          czyli nie zmieni ewidencji. Jeśli zamykasz miesiąc,{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setRodzaj('koniec_miesiaca')}
          >
            ustaw rodzaj „na koniec miesiąca”
          </button>.
        </p>
      )}

      {blad && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>
      )}
      {komunikat && (
        <p className="mt-2 rounded-md bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
          {komunikat}
        </p>
      )}

      {odczyty.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setRozwinieta((r) => !r)}
            className="text-xs font-medium text-blekit-ciemny hover:underline"
          >
            {rozwinieta
              ? 'Ukryj historię odczytów'
              : `Historia odczytów (${odczyty.length})`}
            {!rozwinieta && ostatni && (
              <span className="ml-1 font-normal text-slate-600">
                - ostatni {dataPL(ostatni.data_odczytu)}: {licznik(ostatni.stan)} km
                {ostatni.rodzaj === 'kontrolny' && ' (kontrolny)'}
              </span>
            )}
          </button>

          {rozwinieta && (
            <table className="mt-2 w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Dzień odczytu</th>
                  <th className="py-1 pr-3">Godz.</th>
                  <th className="py-1 pr-3">Licznik</th>
                  {pokazujRoznice && <th className="py-1 pr-3">Z ewidencji</th>}
                  {pokazujRoznice && <th className="py-1 pr-3">Różnica</th>}
                  <th className="py-1 pr-3">Wynik</th>
                  <th className="py-1 pr-3">Wpisał</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {odczyty.map((o) => (
                  <tr key={o.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">{dataPL(o.data_odczytu)}</td>
                    <td className="py-1 pr-3 tabular-nums text-slate-600">
                      {o.godzina_odczytu ? o.godzina_odczytu.slice(0, 5) : 'cały dzień'}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">{licznik(o.stan)}</td>
                    {pokazujRoznice && (
                      <td className="py-1 pr-3 tabular-nums text-slate-600">
                        {o.stan_wyliczony === null ? '—' : licznik(o.stan_wyliczony)}
                      </td>
                    )}
                    {pokazujRoznice && (
                      <td className="py-1 pr-3 tabular-nums">
                        {o.korekta_km === null
                          ? '—'
                          : `${o.korekta_km > 0 ? '+' : ''}${formatujKm(o.korekta_km)}`}
                      </td>
                    )}
                    <td className="py-1 pr-3">
                      <span className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
                        OPIS_WYNIKU[o.wynik].klasa,
                      )}>
                        {OPIS_WYNIKU[o.wynik].tekst}
                      </span>
                      {o.uwaga && <span className="ml-2 text-slate-500">{o.uwaga}</span>}
                    </td>
                    <td className="py-1 pr-3 text-slate-600">{o.wpisal_nazwa || '—'}</td>
                    <td className="py-1 text-right">
                      {ksiegowosc && (
                        <button
                          disabled={zajety}
                          onClick={() => void usun(o.id)}
                          className="text-slate-400 hover:text-red-700 hover:underline disabled:opacity-50"
                          title="Usuwa odczyt razem z jego pozycją korekcyjną i przelicza licznik"
                        >
                          usuń
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

/** Potwierdzenie pod tabelą tras: co kierownik wpisał jako stan licznika.
 *
 *  PO CO OSOBNO. Panel wpisywania jest na górze strony, a kierownik po uzupełnieniu
 *  kilkuset wierszy kończy pracę na dole - i nie ma stamtąd żadnego sygnału, że jego
 *  odczyt w ogóle się zapisał. Tu widzi własne wpisy: dzień, godzinę i liczbę
 *  z licznika.
 *
 *  CZEGO TU NIE MA. Różnicy między odczytem a ewidencją. Widzi ją wyłącznie
 *  administrator, w panelu na górze - patrz pokazujRoznice w OdczytyLicznika. */
export function PodsumowanieOdczytow({ vehicleId }: { vehicleId: string }) {
  const [odczyty, setOdczyty] = useState<OdczytLicznika[]>([])

  useEffect(() => {
    let aktualne = true
    void (async () => {
      const { data } = await supabase
        .from('odczyty_licznika')
        .select('id, data_odczytu, godzina_odczytu, stan, rodzaj, wpisal_nazwa')
        .eq('vehicle_id', vehicleId)
        .order('data_odczytu', { ascending: false })
        .limit(8)
      if (aktualne) setOdczyty((data ?? []) as OdczytLicznika[])
    })()
    return () => { aktualne = false }
  }, [vehicleId])

  if (odczyty.length === 0) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">Zapisane stany licznika</h3>
      <p className="mt-1 text-xs text-slate-500">
        Odczyty wpisane dla tego pojazdu. Kontrolny jest tylko zapisem stanu licznika
        i niczego w ewidencji nie zmienia.
      </p>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">
        {odczyty.map((o) => (
          <li key={o.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
            <span className="w-24 tabular-nums text-slate-700">{dataPL(o.data_odczytu)}</span>
            <span className="w-14 tabular-nums text-slate-500">
              {o.godzina_odczytu ? o.godzina_odczytu.slice(0, 5) : '—'}
            </span>
            <span className="tabular-nums font-medium text-slate-900">
              {licznik(o.stan)} km
            </span>
            <span className="text-xs text-slate-500">
              {o.rodzaj === 'kontrolny' ? 'odczyt kontrolny' : 'stan na koniec miesiąca'}
              {o.wpisal_nazwa ? ` · ${o.wpisal_nazwa}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
