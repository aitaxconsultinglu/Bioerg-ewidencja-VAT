import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profil } from '@/lib/types'
import { Logowanie } from './components/Logowanie'
import { ListaEwidencji } from './components/ListaEwidencji'
import { Ewidencja } from './components/Ewidencja'
import { Button } from './components/ui/button'

export default function App() {
  const [sesja, setSesja] = useState<Session | null>(null)
  const [profil, setProfil] = useState<Profil | null>(null)
  const [ladowanie, setLadowanie] = useState(true)
  const [otwartaEwidencja, setOtwartaEwidencja] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesja(data.session)
      setLadowanie(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_zdarzenie, s) => {
      setSesja(s)
      if (!s) {
        setProfil(null)
        setOtwartaEwidencja(null)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sesja) return
    supabase
      .from('profiles')
      .select('id, email, imie_nazwisko, rola')
      .eq('id', sesja.user.id)
      .maybeSingle()
      .then(({ data }) => setProfil(data as Profil | null))
  }, [sesja])

  if (ladowanie) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Wczytywanie...</div>
  }

  if (!sesja) return <Logowanie />

  if (!profil) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="max-w-md text-slate-700">
          Konto <strong>{sesja.user.email}</strong> nie ma jeszcze przypisanego profilu w ewidencji.
          Skontaktuj się z księgowością, aby dodać ten adres do listy dostępu.
        </p>
        <Button onClick={() => supabase.auth.signOut()}>Wyloguj</Button>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1.5 rounded bg-limonka" />
            <div>
              <h1 className="text-sm font-semibold leading-tight">Ewidencja przebiegu pojazdu</h1>
              <p className="text-xs text-slate-500">Bioerg Sp. z o.o.</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">{profil.imie_nazwisko}</p>
              <p className="text-xs text-slate-500">
                {profil.rola === 'ksiegowosc' ? 'księgowość' : 'kierownik'}
              </p>
            </div>
            <Button onClick={() => supabase.auth.signOut()}>Wyloguj</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {otwartaEwidencja ? (
          <Ewidencja
            logId={otwartaEwidencja}
            profil={profil}
            naListe={() => setOtwartaEwidencja(null)}
          />
        ) : (
          <ListaEwidencji profil={profil} otworz={setOtwartaEwidencja} />
        )}
      </main>
    </div>
  )
}
