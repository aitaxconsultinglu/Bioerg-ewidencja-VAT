import { useEffect, useRef, useState } from 'react'
import type { PoleEdytowalne, Trasa } from '@/lib/types'
import { KATEGORIE_CELU, dataPL, km } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  trasy: Trasa[]
  zablokowana: boolean
  zapisz: (tripId: string, pole: PoleEdytowalne, wartosc: string) => Promise<void>
}

interface Zakres {
  pole: PoleEdytowalne
  od: number
  do_: number
}

export function TabelaTras({ trasy, zablokowana, zapisz }: Props) {
  const [aktywna, setAktywna] = useState<{ wiersz: number; pole: PoleEdytowalne } | null>(null)
  const [zakres, setZakres] = useState<Zakres | null>(null)
  const [edytowana, setEdytowana] = useState<{ wiersz: number; pole: PoleEdytowalne } | null>(null)
  const [projekt, setProjekt] = useState('')
  const przeciaganie = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (edytowana) inputRef.current?.focus()
  }, [edytowana])

  // Uchwyt wypełniania puszczony gdziekolwiek poza tabelą też musi zakończyć
  // przeciąganie, inaczej zaznaczenie "przykleja się" do kursora.
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
    if (projekt !== obecna) await zapisz(t.id, edytowana.pole, projekt)
    setEdytowana(null)
  }

  function komorkaEdytowalna(wiersz: number, pole: PoleEdytowalne, klasa?: string) {
    const trasa = trasy[wiersz]
    const wEdycji = edytowana?.wiersz === wiersz && edytowana.pole === pole
    const wZaznaczeniu = zaznaczona(wiersz, pole)
    const wartosc = String(trasa[pole] ?? '')
    const doUzupelnienia = pole === 'cel_wyjazdu' && wartosc.startsWith('(do uzupełnienia')
    const pustyKierowca = pole === 'kierowca' && wartosc.trim() === ''

    return (
      <td
        className={cn(
          'komorka relative',
          !zablokowana && 'komorka-edytowalna',
          wZaznaczeniu && 'ring-2 ring-inset ring-blekit-ciemny',
          (doUzupelnienia || pustyKierowca) && 'bg-amber-50',
          klasa,
        )}
        onMouseDown={(e) => {
          if (zablokowana) return
          // Bez preventDefault przeciąganie po komórkach uruchamia natywne zaznaczanie
          // tekstu przeglądarki, które wizualnie zjada zaznaczenie zakresu.
          if (!wEdycji) e.preventDefault()
          setAktywna({ wiersz, pole })
          setZakres(null)
        }}
        onMouseEnter={() => {
          if (przeciaganie.current && aktywna?.pole === pole) {
            setZakres({ pole, od: aktywna.wiersz, do_: wiersz })
          }
        }}
        onDoubleClick={() => rozpocznijEdycje(wiersz, pole)}
      >
        {wEdycji ? (
          pole === 'cel_wyjazdu' ? (
            <select
              autoFocus
              value={projekt}
              onChange={(e) => setProjekt(e.target.value)}
              onBlur={zatwierdz}
              className="w-full bg-white text-sm outline-none"
            >
              {[...new Set([...KATEGORIE_CELU, projekt])].filter(Boolean).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          ) : (
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
          )
        ) : (
          <span className={cn(doUzupelnienia && 'italic text-amber-700')}>{wartosc}</span>
        )}

        {/* Uchwyt wypełniania - przeciągnij w dół, żeby skopiować wartość na kolejne wiersze. */}
        {!zablokowana && !wEdycji && aktywna?.wiersz === wiersz && aktywna.pole === pole && (
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

  const suma = trasy.reduce((s, t) => s + Number(t.km), 0)

  return (
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
        </thead>
        <tbody>
          {trasy.map((t, i) => (
            <tr key={t.id}>
              <td className="komorka text-center text-slate-500">{t.lp}</td>
              <td className="komorka whitespace-nowrap text-center">{dataPL(t.data_wyjazdu)}</td>
              {komorkaEdytowalna(i, 'cel_wyjazdu')}
              {komorkaEdytowalna(i, 'skad')}
              {komorkaEdytowalna(i, 'dokad')}
              <td className="komorka text-right tabular-nums">{km(t.km)}</td>
              {komorkaEdytowalna(i, 'kierowca')}
            </tr>
          ))}
          <tr className="bg-slate-50 font-semibold">
            <td className="komorka" colSpan={5}>Razem:</td>
            <td className="komorka text-right tabular-nums">{km(suma)}</td>
            <td className="komorka" />
          </tr>
        </tbody>
      </table>

      {!zablokowana && (
        <p className="mt-2 text-xs text-slate-500">
          Kliknij komórkę, aby ją zaznaczyć, kliknij dwukrotnie, aby edytować. Niebieski
          kwadrat w rogu zaznaczenia przeciągnij w dół, aby skopiować wartość na kolejne wiersze.
        </p>
      )}
    </div>
  )
}
