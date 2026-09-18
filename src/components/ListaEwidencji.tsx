import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Ewidencja as TEwidencja, Profil } from '@/lib/types'
import { ETYKIETY_STATUSU, KOLORY_STATUSU, km, miesiacRok } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  profil: Profil
  otworz: (logId: string) => void
}

export function ListaEwidencji({ profil, otworz }: Props) {
  const [pozycje, setPozycje] = useState<(TEwidencja & { suma_km: number })[]>([])
  const [ladowanie, setLadowanie] = useState(true)

  useEffect(() => {
    async function wczytaj() {
      // RLS sam ogranicza wynik do pojazdów kierownika - nie filtrujemy tego po stronie
      // przeglądarki, żeby zakres dostępu miał jedno, wymuszone źródło prawdy.
      const { data } = await supabase
        .from('monthly_logs')
        .select('*, vehicles(*), trips(km)')
        .order('rok', { ascending: false })
        .order('miesiac', { ascending: false })

      const zsumowane = (data ?? []).map((p: any) => ({
        ...p,
        suma_km: (p.trips ?? []).reduce((s: number, t: any) => s + Number(t.km), 0),
      }))
      setPozycje(zsumowane)
      setLadowanie(false)
    }
    wczytaj()
  }, [])

  if (ladowanie) return <p className="text-slate-500">Wczytywanie ewidencji...</p>

  if (pozycje.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-600">
        Brak ewidencji do wyświetlenia.
        {profil.rola === 'kierownik' && ' Ewidencja pojawi się tutaj po wygenerowaniu jej z danych GPS.'}
      </div>
    )
  }

  const doPoprawki = pozycje.filter((p) => p.status === 'odeslana_do_poprawki')

  return (
    <div className="space-y-4">
      {doPoprawki.length > 0 && profil.rola === 'kierownik' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Do poprawki:</strong> {doPoprawki.length === 1 ? 'jedna ewidencja wymaga' : `${doPoprawki.length} ewidencje wymagają`} Twojej korekty.
        </div>
      )}

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
            {pozycje.map((p) => (
              <tr
                key={p.id}
                onClick={() => otworz(p.id)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-medium">{p.vehicles.nr_rejestracyjny}</td>
                <td className="px-4 py-3 text-slate-600">{p.vehicles.marka_model}</td>
                <td className="px-4 py-3">{miesiacRok(p.rok, p.miesiac)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{km(p.suma_km)}</td>
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
    </div>
  )
}
