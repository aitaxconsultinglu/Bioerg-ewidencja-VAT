import { useEffect, useRef, useState } from 'react'
import type { PoleEdytowalne, Trasa } from '@/lib/types'
import { celDoUzupelnienia, dataPL, km, sumaKm } from '@/lib/format'
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
    const brakuje =
      (pole === 'cel_wyjazdu' && celDoUzupelnienia(wartosc)) ||
      (pole === 'kierowca' && wartosc.trim() === '')

    return (
      <td
        className={cn(
          'komorka relative',
          !zablokowana && 'komorka-edytowalna',
          wZaznaczeniu && 'ring-2 ring-inset ring-blekit-ciemny',
          brakuje && 'bg-amber-50',
        )}
        onMouseDown={(e) => {
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
        onDoubleClick={() => rozpocznijEdycje(wiersz, pole)}
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
          <span className={cn(brakuje && 'italic text-amber-700')}>{wartosc}</span>
        )}

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

  return (
    <div>
      {!zablokowana && (
        <p className="mb-2 text-xs text-slate-500">
          Kliknij komórkę, aby ją zaznaczyć, kliknij dwukrotnie, aby edytować. Niebieski
          kwadrat w rogu zaznaczenia przeciągnij w dół, aby skopiować wartość na kolejne wiersze.
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
              <td className="komorka text-right tabular-nums">{sumaKm(trasy).toLocaleString('pl-PL')}</td>
              <td className="komorka" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
