import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profil } from '@/lib/types'
import { Logowanie } from './components/Logowanie'
import { UstawHaslo } from './components/UstawHaslo'
import { ListaEwidencji } from './components/ListaEwidencji'
import { Ewidencja } from './components/Ewidencja'
import { Uzytkownicy } from './components/Uzytkownicy'
import { Button } from './components/ui/button'

export default function App() {
  const [sesja, setSesja] = useState<Session | null>(null)
  const [profil, setProfil] = useState<Profil | null>(null)
  const [ladowanie, setLadowanie] = useState(true)
  const [otwartaEwidencja, setOtwartaEwidencja] = useState<string | null>(null)
  const [odzyskiwanie, setOdzyskiwanie] = useState(false)
  const [zmianaHasla, setZmianaHasla] = useState(false)
  const [ekranUzytkownikow, setEkranUzytkownikow] = useState(false)

  const wczytajProfil = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, imie_nazwisko, rola, wymaga_zmiany_hasla')
      .eq('id', userId)
      .maybeSingle()
    setProfil(data as Profil | null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesja(data.session)
      setLadowanie(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((zdarzenie, s) => {
      // Klik w link z maila loguje użytkownika i od razu zgłasza PASSWORD_RECOVERY -
      // zamiast wpuścić go do aplikacji, pokazujemy ekran ustawienia hasła.
      if (zdarzenie === 'PASSWORD_RECOVERY') setOdzyskiwanie(true)
      setSesja(s)
      if (!s) {
        setProfil(null)
        setOtwartaEwidencja(null)
        setOdzyskiwanie(false)
        setZmianaHasla(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (sesja) void wczytajProfil(sesja.user.id)
  }, [sesja, wczytajProfil])

  if (ladowanie) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Wczytywanie...</div>
  }

  if (!sesja) return <Logowanie />

  if (odzyskiwanie || zmianaHasla) {
    return (
      <UstawHaslo
        powod="odzyskiwanie"
        email={sesja.user.email ?? ''}
        gotowe={() => {
          setOdzyskiwanie(false)
          setZmianaHasla(false)
          void wczytajProfil(sesja.user.id)
        }}
      />
    )
  }

  if (profil?.wymaga_zmiany_hasla) {
    return (
      <UstawHaslo
        powod="pierwsze-logowanie"
        email={sesja.user.email ?? ''}
        gotowe={() => void wczytajProfil(sesja.user.id)}
      />
    )
  }

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
        <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1.5 rounded bg-limonka" />
            <div>
              <h1 className="text-sm font-semibold leading-tight">Ewidencja przebiegu pojazdu</h1>
              <p className="text-xs text-slate-500">Bioerg Sp. z o.o.</p>
            </div>
          </div>
          <img
            src={`${import.meta.env.BASE_URL}bioerg-logo.png`}
            alt="Bioerg"
            className="h-8 w-auto justify-self-center"
          />
          <div className="flex items-center justify-end gap-4">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">{profil.imie_nazwisko}</p>
              <p className="text-xs text-slate-500">
                {profil.rola === 'ksiegowosc' ? 'księgowość' : 'kierownik'}
              </p>
            </div>
            {profil.rola === 'ksiegowosc' && (
              <Button onClick={() => { setEkranUzytkownikow(true); setOtwartaEwidencja(null) }}>
                Użytkownicy
              </Button>
            )}
            <Button onClick={() => setZmianaHasla(true)}>Zmień hasło</Button>
            <Button onClick={() => supabase.auth.signOut()}>Wyloguj</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {ekranUzytkownikow && profil.rola === 'ksiegowosc' ? (
          <Uzytkownicy profil={profil} naListe={() => setEkranUzytkownikow(false)} />
        ) : otwartaEwidencja ? (
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
