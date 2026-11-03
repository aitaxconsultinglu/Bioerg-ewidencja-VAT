import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { OdczytLicznika, Profil, WynikOdczytu } from '@/lib/types'
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

const OPIS_WYNIKU: Record<WynikOdczytu, { tekst: string; klasa: string }> = {
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
  const [stan, setStan] = useState('')
  const [uwaga, setUwaga] = useState('')
  const [zajety, setZajety] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [komunikat, setKomunikat] = useState<string | null>(null)
  const [rozwinieta, setRozwinieta] = useState(false)

  const wczytaj = useCallback(async () => {
    const { data: o } = await supabase
      .from('odczyty_licznika').select('*')
      .eq('vehicle_id', vehicleId)
      .order('data_odczytu', { ascending: false })
    setOdczyty((o ?? []) as OdczytLicznika[])
  }, [vehicleId])

  useEffect(() => { void wczytaj() }, [wczytaj])

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
    })
    setZajety(false)
    if (error) { setBlad(error.message); return }

    const w = wynik as { wynik: WynikOdczytu; stan_wyliczony: number | null; korekta_km: number | null }
    setStan('')
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
      case 'zgodny':
        return `Odczyt zgodny z ewidencją${roznica !== null ? ` (różnica ${formatujKm(roznica)} km, poniżej progu korekty)` : ''}.`
      case 'skorygowany':
        return `Z ewidencji wychodziło ${licznik(w.stan_wyliczony)} km. Dopisano pozycję `
             + `korekcyjną ${w.korekta_km !== null && w.korekta_km > 0 ? '+' : ''}`
             + `${formatujKm(w.korekta_km ?? 0)} km, żeby stan licznika zgadzał się z pojazdem.`
      case 'oczekuje':
        return 'Odczyt zapisany. Danych GPS za ten miesiąc jeszcze nie ma, więc korekta '
             + 'naliczy się sama po ich wgraniu.'
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
  const ostatni = odczyty[0]
  // Korekta trafia do ewidencji za miesiąc z DATY odczytu. Gdy data wypada poza
  // miesiącem tej ewidencji, mówimy o tym OD RAZU - inaczej kierownik zapisuje odczyt,
  // nic się nie zmienia i nie wie dlaczego.
  const innyMiesiac = data !== '' && (
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
        <Button wariant="glowny" disabled={zajety} onClick={zapisz}>
          Zapisz odczyt licznika
        </Button>
      </div>

      <p className="mt-2 text-xs text-slate-600">
        Wpisz tu prawdziwy stan licznika {nrRejestracyjny}, kiedy go odczytasz - nie musi to
        być koniec miesiąca. Aplikacja porówna go z kilometrami naliczonymi z GPS i, jeśli
        się rozjeżdżają, dopisze w ewidencji pozycję korekcyjną na ten dzień, żeby licznik
        w dokumencie zgadzał się z pojazdem.
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
              </span>
            )}
          </button>

          {rozwinieta && (
            <table className="mt-2 w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Dzień odczytu</th>
                  <th className="py-1 pr-3">Licznik</th>
                  <th className="py-1 pr-3">Z ewidencji</th>
                  <th className="py-1 pr-3">Różnica</th>
                  <th className="py-1 pr-3">Wynik</th>
                  <th className="py-1 pr-3">Wpisał</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {odczyty.map((o) => (
                  <tr key={o.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">{dataPL(o.data_odczytu)}</td>
                    <td className="py-1 pr-3 tabular-nums">{licznik(o.stan)}</td>
                    <td className="py-1 pr-3 tabular-nums text-slate-600">
                      {o.stan_wyliczony === null ? '—' : licznik(o.stan_wyliczony)}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      {o.korekta_km === null
                        ? '—'
                        : `${o.korekta_km > 0 ? '+' : ''}${formatujKm(o.korekta_km)}`}
                    </td>
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
