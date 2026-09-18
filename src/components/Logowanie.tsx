import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from './ui/button'

export function Logowanie() {
  const [email, setEmail] = useState('')
  const [haslo, setHaslo] = useState('')
  const [rejestracja, setRejestracja] = useState(false)
  const [komunikat, setKomunikat] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [zajety, setZajety] = useState(false)

  async function wyslij(e: React.FormEvent) {
    e.preventDefault()
    setBlad(null)
    setKomunikat(null)
    setZajety(true)

    const { error } = rejestracja
      ? await supabase.auth.signUp({ email, password: haslo })
      : await supabase.auth.signInWithPassword({ email, password: haslo })

    setZajety(false)
    if (error) {
      setBlad(error.message)
    } else if (rejestracja) {
      setKomunikat('Konto założone. Sprawdź skrzynkę i potwierdź adres e-mail, a następnie zaloguj się.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form onSubmit={wyslij} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <div className="h-1.5 w-16 rounded bg-limonka" />
          <h1 className="mt-4 text-xl font-semibold">Ewidencja przebiegu pojazdu</h1>
          <p className="mt-1 text-sm text-slate-600">Bioerg Sp. z o.o.</p>
        </div>

        <label className="block text-sm font-medium text-slate-700" htmlFor="email">Adres e-mail</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
        />

        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="haslo">Hasło</label>
        <input
          id="haslo"
          type="password"
          required
          value={haslo}
          onChange={(e) => setHaslo(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
        />

        {blad && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}
        {komunikat && <p className="mt-4 rounded bg-limonka-jasna px-3 py-2 text-sm text-limonka-ciemna">{komunikat}</p>}

        <Button type="submit" wariant="glowny" disabled={zajety} className="mt-6 w-full">
          {zajety ? 'Proszę czekać...' : rejestracja ? 'Załóż konto' : 'Zaloguj się'}
        </Button>

        <button
          type="button"
          onClick={() => { setRejestracja(!rejestracja); setBlad(null); setKomunikat(null) }}
          className="mt-4 w-full text-sm text-blekit-ciemny underline"
        >
          {rejestracja ? 'Mam już konto - zaloguj się' : 'Pierwsze logowanie - załóż konto'}
        </button>
      </form>
    </div>
  )
}
