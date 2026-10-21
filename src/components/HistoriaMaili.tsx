import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Profil, WpisMaila } from '@/lib/types'
import { dataGodzinaPL, ETYKIETY_RODZAJU_MAILA, miesiacRok } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

interface Props {
  profil: Profil
  naListe: () => void
}

/** Ile ostatnich wpisów wczytujemy. Dziennik rośnie o kilkanaście wpisów miesięcznie,
 *  więc 500 to kilka lat historii - a jednocześnie nie ładujemy bez potrzeby całej
 *  tabeli, gdyby kiedyś spuchła. */
const LIMIT = 500

export function HistoriaMaili({ profil, naListe }: Props) {
  const [wpisy, setWpisy] = useState<WpisMaila[]>([])
  const [ladowanie, setLadowanie] = useState(true)
  const [blad, setBlad] = useState<string | null>(null)
  const [filtrRodzaju, setFiltrRodzaju] = useState('')
  const [filtrStatusu, setFiltrStatusu] = useState('')
  const [szukaj, setSzukaj] = useState('')

  const wczytaj = useCallback(async () => {
    setLadowanie(true)
    const { data, error } = await supabase
      .from('email_log')
      .select('*')
      .order('utworzono', { ascending: false })
      .limit(LIMIT)
    setLadowanie(false)
    if (error) { setBlad(error.message); return }
    setBlad(null)
    setWpisy((data ?? []) as WpisMaila[])
  }, [])

  useEffect(() => { void wczytaj() }, [wczytaj])

  const widoczne = useMemo(() => {
    const fraza = szukaj.trim().toLowerCase()
    return wpisy.filter((w) => {
      if (filtrRodzaju && w.rodzaj !== filtrRodzaju) return false
      if (filtrStatusu && w.status !== filtrStatusu) return false
      if (!fraza) return true
      // Szukamy po tym, czego księgowość faktycznie szuka: po osobie i po pojeździe.
      return [w.adresat, w.adresat_nazwa ?? '', w.temat, ...(w.pojazdy ?? [])]
        .join(' ').toLowerCase().includes(fraza)
    })
  }, [wpisy, filtrRodzaju, filtrStatusu, szukaj])

  const rodzaje = useMemo(
    () => [...new Set(wpisy.map((w) => w.rodzaj))].sort(),
    [wpisy],
  )
  const bledy = widoczne.filter((w) => w.status === 'blad').length

  if (profil.rola !== 'ksiegowosc') {
    // Zabezpieczenie na wypadek pomyłki w routingu. Prawdziwą barierą jest RLS:
    // tabela email_log ma politykę SELECT wyłącznie dla księgowości, więc kierownik
    // nie zobaczy tych danych nawet przy bezpośrednim zapytaniu do bazy.
    return <p className="text-slate-500">Ten widok jest dostępny tylko dla księgowości.</p>
  }

  return (
    <div className="space-y-5">
      <button onClick={naListe} className="flex items-center gap-1.5 text-sm text-blekit-ciemny hover:underline">
        <ArrowLeft className="h-4 w-4" /> Wróć do ewidencji
      </button>

      {blad && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{blad}</div>}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Historia wysłanych wiadomości</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Każda próba wysyłki do kierowników - udana i nieudana. Nieudane mają zapisaną
              treść błędu, więc cisza w skrzynce kierownika nie jest już nieodróżnialna od
              wiadomości, która nigdy nie wyszła. Wpisy tworzą wyłącznie automaty; z aplikacji
              nie da się ich dodać ani usunąć.
            </p>
          </div>
          <Button wariant="akcent" onClick={() => void wczytaj()} disabled={ladowanie}>
            <RefreshCw className={cn('h-4 w-4', ladowanie && 'animate-spin')} /> Odśwież
          </Button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Wpisów w dzienniku</dt>
            <dd className="font-medium tabular-nums">{wpisy.length}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Widocznych po filtrach</dt>
            <dd className="font-medium tabular-nums">{widoczne.length}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Nieudanych wysyłek</dt>
            <dd className={cn('font-medium tabular-nums', bledy > 0 && 'text-red-700')}>
              {bledy}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Ostatnia wysyłka</dt>
            <dd className="font-medium">
              {wpisy.length ? dataGodzinaPL(wpisy[0].utworzono) : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor="filtr-rodzaju">
            Rodzaj wiadomości
          </label>
          <select
            id="filtr-rodzaju"
            value={filtrRodzaju}
            onChange={(e) => setFiltrRodzaju(e.target.value)}
            className="mt-1 w-64 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
          >
            <option value="">wszystkie</option>
            {rodzaje.map((r) => (
              <option key={r} value={r}>{ETYKIETY_RODZAJU_MAILA[r] ?? r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor="filtr-statusu">
            Status
          </label>
          <select
            id="filtr-statusu"
            value={filtrStatusu}
            onChange={(e) => setFiltrStatusu(e.target.value)}
            className="mt-1 w-40 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
          >
            <option value="">wszystkie</option>
            <option value="wyslany">wysłane</option>
            <option value="blad">nieudane</option>
          </select>
        </div>
        <div className="grow">
          <label className="block text-xs font-medium text-slate-600" htmlFor="szukaj-maila">
            Szukaj (kierownik, adres, pojazd, temat)
          </label>
          <input
            id="szukaj-maila"
            value={szukaj}
            onChange={(e) => setSzukaj(e.target.value)}
            placeholder="nazwisko, adres e-mail albo numer rejestracyjny"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">Data i godzina</th>
              <th className="px-4 py-3">Rodzaj</th>
              <th className="px-4 py-3">Odbiorca</th>
              <th className="px-4 py-3">Pojazdy</th>
              <th className="px-4 py-3">Okres</th>
              <th className="px-4 py-3">Temat</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm">
            {widoczne.map((w) => (
              <tr key={w.id} className={cn(w.status === 'blad' && 'bg-red-50')}>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                  {dataGodzinaPL(w.utworzono)}
                </td>
                <td className="px-4 py-3">{ETYKIETY_RODZAJU_MAILA[w.rodzaj] ?? w.rodzaj}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{w.adresat_nazwa ?? '—'}</div>
                  <div className="text-xs text-slate-500">{w.adresat}</div>
                  {w.kopia && <div className="text-xs text-slate-400">kopia: {w.kopia}</div>}
                </td>
                <td className="px-4 py-3 text-xs">
                  {w.pojazdy?.length ? w.pojazdy.join(', ') : '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs">
                  {w.rok && w.miesiac ? miesiacRok(w.rok, w.miesiac) : '—'}
                </td>
                <td className="px-4 py-3 text-xs">{w.temat}</td>
                <td className="px-4 py-3">
                  {w.status === 'wyslany' ? (
                    <span className="inline-flex rounded-full bg-limonka-jasna px-2 py-0.5 text-xs font-medium text-limonka-ciemna ring-1 ring-limonka">
                      wysłany
                    </span>
                  ) : (
                    <div>
                      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 ring-1 ring-red-300">
                        nieudany
                      </span>
                      {w.blad && <p className="mt-1 max-w-sm text-xs text-red-700">{w.blad}</p>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!widoczne.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  {ladowanie ? 'Wczytywanie...' : 'Brak wiadomości spełniających filtry.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {wpisy.length === LIMIT && (
        <p className="text-xs text-slate-500">
          Pokazano {LIMIT} najnowszych wpisów. Starsze są w bazie, ale nie są tu wczytywane.
        </p>
      )}
    </div>
  )
}
