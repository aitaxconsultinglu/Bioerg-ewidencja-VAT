import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MIN_DLUGOSC_HASLA, komunikatPL, sprawdzHaslo } from '@/lib/config'
import { Button } from './ui/button'

interface Props {
  powod: 'pierwsze-logowanie' | 'odzyskiwanie'
  email: string
  /** Wywoływane po udanej zmianie, żeby aplikacja odświeżyła profil. */
  gotowe: () => void
}

export function UstawHaslo({ powod, email, gotowe }: Props) {
  const [haslo, setHaslo] = useState('')
  const [powtorzone, setPowtorzone] = useState('')
  const [blad, setBlad] = useState<string | null>(null)
  const [zajety, setZajety] = useState(false)

  async function zapisz(e: React.FormEvent) {
    e.preventDefault()
    setBlad(null)

    const problem = sprawdzHaslo(haslo)
    if (problem) { setBlad(problem); return }
    if (haslo !== powtorzone) { setBlad('Hasła nie są takie same.'); return }

    setZajety(true)
    const { error } = await supabase.auth.updateUser({ password: haslo })
    if (error) {
      setZajety(false)
      setBlad(komunikatPL(error.message))
      return
    }
    // Zdejmuje wymuszenie zmiany hasła. Osobna funkcja, bo tabela profili nie ma
    // polityki UPDATE - inaczej użytkownik mógłby zmienić sobie także rolę.
    await supabase.rpc('potwierdz_ustawienie_hasla')
    setZajety(false)
    gotowe()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form onSubmit={zapisz} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <img
          src={`${import.meta.env.BASE_URL}bioerg-logo.png`}
          alt="Bioerg"
          className="mx-auto h-10 w-auto"
        />
        <h1 className="mt-5 text-center text-lg font-semibold">
          {powod === 'pierwsze-logowanie' ? 'Ustaw własne hasło' : 'Nowe hasło'}
        </h1>
        <p className="mt-2 text-center text-sm text-slate-600">
          {powod === 'pierwsze-logowanie'
            ? 'To Twoje pierwsze logowanie. Zanim przejdziesz dalej, ustaw hasło znane tylko Tobie.'
            : 'Ustaw nowe hasło do swojego konta.'}
        </p>
        <p className="mt-1 text-center text-xs text-slate-500">{email}</p>

        <label className="mt-6 block text-sm font-medium text-slate-700" htmlFor="nowe-haslo">
          Nowe hasło
        </label>
        <input
          id="nowe-haslo"
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          value={haslo}
          onChange={(e) => setHaslo(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
        />

        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="powtorz-haslo">
          Powtórz hasło
        </label>
        <input
          id="powtorz-haslo"
          type="password"
          required
          autoComplete="new-password"
          value={powtorzone}
          onChange={(e) => setPowtorzone(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
        />

        <ul className="mt-3 space-y-1 text-xs text-slate-500">
          <li className={haslo.length >= MIN_DLUGOSC_HASLA ? 'text-limonka-ciemna' : undefined}>
            {haslo.length >= MIN_DLUGOSC_HASLA ? '✓' : '•'} co najmniej {MIN_DLUGOSC_HASLA} znaków
          </li>
          <li className={/[^A-Za-z0-9]/.test(haslo) ? 'text-limonka-ciemna' : undefined}>
            {/[^A-Za-z0-9]/.test(haslo) ? '✓' : '•'} co najmniej jeden znak specjalny (np. ! @ # ? -)
          </li>
        </ul>

        {blad && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}

        <Button type="submit" wariant="glowny" disabled={zajety} className="mt-6 w-full">
          {zajety ? 'Zapisuję...' : 'Zapisz hasło i przejdź dalej'}
        </Button>

        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="mt-4 w-full text-sm text-slate-500 underline"
        >
          Wyloguj
        </button>
      </form>
    </div>
  )
}
