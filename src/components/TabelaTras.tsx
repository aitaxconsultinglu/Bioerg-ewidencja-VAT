import { useEffect, useRef, useState } from 'react'
import type { OznaczeniePola, PoleEdytowalne, Trasa } from '@/lib/types'
import {
  OSTRZEZENIE_OGOLNY_CEL, celDoUzupelnienia, celZbytOgolny, dataPL, formatujKm, km, sumaKm,
} from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  trasy: Trasa[]
  zablokowana: boolean
  zapisz: (tripId: string, pole: PoleEdytowalne, wartosc: string) => Promise<void>
  /** Pola wskazane przez księgowość do poprawy. Pusta tablica, gdy nic nie wskazano. */
  oznaczenia?: OznaczeniePola[]
  /** Księgowość włączyła wskazywanie pól - kliknięcie komórki zaznacza ją do poprawy
   *  zamiast zwykłego zaznaczania. */
  trybOznaczania?: boolean
  przelaczOznaczenie?: (trasa: Trasa, pole: PoleEdytowalne) => void
}

interface Zakres {
  pole: PoleEdytowalne
  od: number
  do_: number
}

export function TabelaTras({
  trasy, zablokowana, zapisz,
  oznaczenia = [], trybOznaczania = false, przelaczOznaczenie,
}: Props) {
  const [aktywna, setAktywna] = useState<{ wiersz: number; pole: PoleEdytowalne } | null>(null)
  const [zakres, setZakres] = useState<Zakres | null>(null)
  const [edytowana, setEdytowana] = useState<{ wiersz: number; pole: PoleEdytowalne } | null>(null)
  const [projekt, setProjekt] = useState('')
  const przeciaganie = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (edytowana) inputRef.current?.focus()
  }, [edytowana])

  useEffect(() => {
    function koniec() {
      if (przeciaganie.current) {
        przeciaganie.current = false
        void wypelnijZakres()
      }
    }
    window.addEventListener('mouseup', koniec)
    return () => window.removeEventListener('mouseup', koniec)
  })

  async function wypelnijZakres() {
    if (!zakres || !aktywna) return
    const zrodlo = trasy[aktywna.wiersz]
    if (!zrodlo) return
    const wartosc = String(zrodlo[zakres.pole] ?? '')
    const od = Math.min(zakres.od, zakres.do_)
    const do_ = Math.max(zakres.od, zakres.do_)
    for (let i = od; i <= do_; i++) {
      const t = trasy[i]
      if (t && String(t[zakres.pole] ?? '') !== wartosc) {
        await zapisz(t.id, zakres.pole, wartosc)
      }
    }
    setZakres(null)
  }

  function zaznaczona(wiersz: number, pole: PoleEdytowalne) {
    if (aktywna?.wiersz === wiersz && aktywna.pole === pole) return true
    if (!zakres || zakres.pole !== pole) return false
    return wiersz >= Math.min(zakres.od, zakres.do_) && wiersz <= Math.max(zakres.od, zakres.do_)
  }

  function rozpocznijEdycje(wiersz: number, pole: PoleEdytowalne) {
    if (zablokowana) return
    setEdytowana({ wiersz, pole })
    setProjekt(String(trasy[wiersz][pole] ?? ''))
  }

  async function zatwierdz() {
    if (!edytowana) return
    const t = trasy[edytowana.wiersz]
    const obecna = String(t[edytowana.pole] ?? '')
    setEdytowana(null)
    if (projekt !== obecna) await zapisz(t.id, edytowana.pole, projekt)
  }

  function komorkaEdytowalna(wiersz: number, pole: PoleEdytowalne) {
    const trasa = trasy[wiersz]
    const wEdycji = edytowana?.wiersz === wiersz && edytowana.pole === pole
    const wZaznaczeniu = zaznaczona(wiersz, pole)
    const wartosc = String(trasa[pole] ?? '')
    // Brak nazwiska kierowcy to zwykla luka do wypelnienia - bursztynowa.
    const brakKierowcy = pole === 'kierowca' && wartosc.trim() === ''
    // Cel pusty ALBO tak ogolny, ze nic nie mowi - jedno i drugie na czerwono. Klient
    // poprosil 2026-10-22, zeby puste cele pod nierozpoznanymi adresami tez swiecily:
    // kierownik ma tam dopisac i cel, i nazwe firmy, a bursztyn czytano jako "to moze
    // zostac". Zapis w rodzaju "prace remontowe" jest o tyle gorszy od pustego, ze
    // wyglada na wypelniony i wlasnie dlatego przechodzi bez zastanowienia.
    const celPusty = pole === 'cel_wyjazdu' && celDoUzupelnienia(wartosc)
    const celOgolny = pole === 'cel_wyjazdu' && celZbytOgolny(wartosc)

    // Pole wskazane przez ksiegowosc. Czerwone, dopoki wartosc sie nie zmieni; zielone,
    // gdy kierownik ja poprawil - patrz OznaczeniePola w types.ts.
    const oznaczenie = oznaczenia.find((o) => o.trip_id === trasa.id && o.pole === pole)
    const doPoprawy = !!oznaczenie && wartosc === oznaczenie.wartosc_przy_oznaczeniu
    const poprawione = !!oznaczenie && !doPoprawy

    const podpowiedz = doPoprawy
      ? (oznaczenie?.uwaga || 'Księgowość prosi o poprawienie tego pola.')
      : poprawione
        ? `Poprawione. Wcześniej: „${oznaczenie?.wartosc_przy_oznaczeniu || '(puste)'}”`
        : celOgolny
          ? OSTRZEZENIE_OGOLNY_CEL
          : celPusty
            ? 'Uzupełnij cel wyjazdu - podaj nazwę firmy i zadanie wykonane pod tym adresem.'
            : undefined

    return (
      <td
        title={podpowiedz}
        className={cn(
          'komorka relative',
          !zablokowana && !trybOznaczania && 'komorka-edytowalna',
          trybOznaczania && 'cursor-pointer',
          wZaznaczeniu && 'ring-2 ring-inset ring-blekit-ciemny',
          brakKierowcy && 'bg-amber-50',
          (celPusty || celOgolny) && 'bg-red-50',
          // Oznaczenie ksiegowosci jest najwazniejsze - przykrywa pozostale kolory.
          doPoprawy && 'bg-red-100 ring-2 ring-inset ring-red-400',
          poprawione && 'bg-green-50 ring-2 ring-inset ring-green-400',
        )}
        onMouseDown={(e) => {
          if (trybOznaczania) {
            e.preventDefault()
            przelaczOznaczenie?.(trasa, pole)
            return
          }
          if (zablokowana) return
          // preventDefault blokuje natywne zaznaczanie tekstu przy przeciaganiu, ale
          // NIE wolno go wywolac gdy trwa edycja innej komorki - zabilby zdarzenie
          // blur, przez co wpisany tekst przepadal bez zapisu.
          if (!edytowana) e.preventDefault()
          setAktywna({ wiersz, pole })
          setZakres(null)
        }}
        onMouseEnter={() => {
          if (przeciaganie.current && aktywna?.pole === pole) {
            setZakres({ pole, od: aktywna.wiersz, do_: wiersz })
          }
        }}
        onDoubleClick={() => { if (!trybOznaczania) rozpocznijEdycje(wiersz, pole) }}
      >
        {wEdycji ? (
          <input
            ref={inputRef}
            value={projekt}
            onChange={(e) => setProjekt(e.target.value)}
            onBlur={zatwierdz}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void zatwierdz()
              if (e.key === 'Escape') setEdytowana(null)
            }}
            className="w-full select-text bg-white text-sm outline-none"
          />
        ) : (
          <span
            className={cn(
              brakKierowcy && 'italic text-amber-700',
              (celPusty || celOgolny) && 'italic text-red-700',
              doPoprawy && 'font-medium not-italic text-red-800',
              poprawione && 'not-italic text-green-800',
            )}
          >
            {wartosc}
            {(celOgolny || celPusty) && !oznaczenie && (
              <span className="ml-1 font-semibold" aria-hidden>!</span>
            )}
            {doPoprawy && <span className="ml-1 font-semibold" aria-hidden>✗</span>}
            {poprawione && <span className="ml-1 font-semibold" aria-hidden>✓</span>}
          </span>
        )}

        {!zablokowana && !trybOznaczania && !wEdycji
          && aktywna?.wiersz === wiersz && aktywna.pole === pole && (
          <span
            title="Przeciągnij w dół, aby skopiować wartość"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              przeciaganie.current = true
              setZakres({ pole, od: wiersz, do_: wiersz })
            }}
            className="absolute -bottom-1 -right-1 z-20 h-3 w-3 cursor-crosshair rounded-sm bg-blekit-ciemny ring-1 ring-white"
          />
        )}
      </td>
    )
  }

  // Liczone przy kazdym renderze, ale to kilkaset wierszy i jedno porownanie tekstu -
  // taniej niz pilnowanie, kiedy uniewaznic zapamietany wynik.
  const zbytOgolne = trasy.filter(
    (t) => celZbytOgolny(t.cel_wyjazdu) || celDoUzupelnienia(t.cel_wyjazdu),
  ).length
  const wartosciTras = new Map(trasy.map((t) => [t.id, t]))
  const doPoprawy = oznaczenia.filter((o) => {
    const t = wartosciTras.get(o.trip_id)
    return t && String(t[o.pole] ?? '') === o.wartosc_przy_oznaczeniu
  }).length
  const poprawione = oznaczenia.length - doPoprawy

  return (
    <div>
      {trybOznaczania && (
        <p className="mb-2 rounded border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-900">
          <span className="font-semibold">Wskazywanie pól do poprawy jest włączone.</span>{' '}
          Klikaj komórki, które kierownik ma poprawić - zaznaczone podświetlą się na czerwono
          także w jego widoku. Ponowne kliknięcie zdejmuje oznaczenie. Edycja tabeli jest
          w tym trybie wyłączona.
        </p>
      )}

      {oznaczenia.length > 0 && !trybOznaczania && (
        <p className="mb-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Księgowość wskazała pola do poprawy:{' '}
          <span className="font-semibold text-red-700">{doPoprawy} do poprawienia</span>
          {poprawione > 0 && (
            <> , <span className="font-semibold text-green-700">{poprawione} już poprawione</span></>
          )}
          . Pole staje się zielone, gdy jego treść faktycznie się zmieni.
        </p>
      )}

      {!zablokowana && !trybOznaczania && (
        <p className="mb-2 text-xs text-slate-500">
          Kliknij komórkę, aby ją zaznaczyć, kliknij dwukrotnie, aby edytować. Niebieski
          kwadrat w rogu zaznaczenia przeciągnij w dół, aby skopiować wartość na kolejne wiersze.
        </p>
      )}

      {zbytOgolne > 0 && (
        <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span className="font-semibold">
            {zbytOgolne === 1
              ? 'Jedna pozycja ma pusty albo zbyt ogólny cel wyjazdu'
              : `Pozycji z pustym albo zbyt ogólnym celem wyjazdu: ${zbytOgolne}`}
          </span>{' '}
          (zaznaczone na czerwono). {OSTRZEZENIE_OGOLNY_CEL} Sam zapis „prace remontowe”
          pasuje do każdego wyjazdu i przy kontroli nie broni ani jednego kilometra.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full select-none border-collapse bg-white">
          <thead>
            <tr className="bg-slate-100 text-xs font-semibold">
              <th className="komorka w-12">Lp.</th>
              <th className="komorka w-28">Data wyjazdu</th>
              <th className="komorka w-56">Cel wyjazdu</th>
              <th className="komorka">Skąd</th>
              <th className="komorka">Dokąd</th>
              <th className="komorka w-28">Liczba przejechanych kilometrów</th>
              <th className="komorka w-52">Imię i nazwisko osoby kierującej pojazdem</th>
            </tr>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
              <td className="komorka-tylko-odczyt border border-slate-300 px-2 py-0.5 text-center">z GPS</td>
              <td className="komorka-tylko-odczyt border border-slate-300 px-2 py-0.5 text-center">z GPS</td>
              <td className="border border-slate-300 px-2 py-0.5 text-center text-limonka-ciemna">do uzupełnienia</td>
              <td className="border border-slate-300 px-2 py-0.5 text-center text-limonka-ciemna">do uzupełnienia</td>
              <td className="border border-slate-300 px-2 py-0.5 text-center text-limonka-ciemna">do uzupełnienia</td>
              <td className="komorka-tylko-odczyt border border-slate-300 px-2 py-0.5 text-center">z GPS</td>
              <td className="border border-slate-300 px-2 py-0.5 text-center text-limonka-ciemna">do uzupełnienia</td>
            </tr>
          </thead>
          <tbody>
            {trasy.map((t, i) => (
              <tr key={t.id}>
                <td className="komorka komorka-tylko-odczyt text-center">{t.lp}</td>
                <td
                  title="Data pochodzi z danych GPS i nie podlega edycji"
                  className="komorka komorka-tylko-odczyt whitespace-nowrap text-center"
                >
                  {dataPL(t.data_wyjazdu)}
                </td>
                {komorkaEdytowalna(i, 'cel_wyjazdu')}
                {komorkaEdytowalna(i, 'skad')}
                {komorkaEdytowalna(i, 'dokad')}
                <td
                  title="Liczba kilometrów pochodzi z danych GPS i nie podlega edycji"
                  className="komorka komorka-tylko-odczyt text-right tabular-nums"
                >
                  {km(t.km)}
                </td>
                {komorkaEdytowalna(i, 'kierowca')}
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td className="komorka" colSpan={5}>Razem:</td>
              <td className="komorka text-right tabular-nums">{formatujKm(sumaKm(trasy))}</td>
              <td className="komorka" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
