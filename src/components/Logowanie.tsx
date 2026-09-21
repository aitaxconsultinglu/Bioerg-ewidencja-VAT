import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { komunikatPL } from '@/lib/config'
import { Button } from './ui/button'

export function Logowanie() {
  const [adres, setAdres] = useState('')
  const [haslo, setHaslo] = useState('')
  const [resetowanie, setResetowanie] = useState(false)
  const [komunikat, setKomunikat] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [zajety, setZajety] = useState(false)

  async function zaloguj(e: React.FormEvent) {
    e.preventDefault()
    setBlad(null)
    setKomunikat(null)
    setZajety(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: adres.trim(), password: haslo,
    })
    setZajety(false)
    if (error) setBlad('Nieprawidłowy login lub hasło.')
  }

  async function wyslijReset(e: React.FormEvent) {
    e.preventDefault()
    setBlad(null)
    setKomunikat(null)
    setZajety(true)
    // Link z maila wraca na ten sam adres aplikacji - musi być dopisany w Supabase
    // w Authentication > URL Configuration, inaczej zostanie odrzucony.
    const { error } = await supabase.auth.resetPasswordForEmail(adres.trim(), {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
    })
    setZajety(false)
    if (error) {
      setBlad(komunikatPL(error.message))
    } else {
      // Celowo ten sam komunikat niezależnie od tego, czy konto istnieje - inaczej
      // formularz pozwalałby sprawdzać, kto pracuje w firmie.
      setKomunikat(
        `Jeśli konto ${adres} istnieje, wysłaliśmy na nie link do ustawienia nowego hasła. ` +
        'Sprawdź skrzynkę, także folder spam.',
      )
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={resetowanie ? wyslijReset : zaloguj}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
      >
        <img
          src={`${import.meta.env.BASE_URL}bioerg-logo.png`}
          alt="Bioerg"
          className="mx-auto h-10 w-auto"
        />
        <h1 className="mt-5 text-center text-lg font-semibold">Ewidencja przebiegu pojazdu</h1>
        <p className="mt-1 text-center text-sm text-slate-600">
          {resetowanie ? 'Odzyskiwanie dostępu' : 'Zaloguj się służbowym adresem e-mail'}
        </p>

        <label className="mt-6 block text-sm font-medium text-slate-700" htmlFor="adres">
          Adres e-mail
        </label>
        <input
          id="adres"
          type="email"
          required
          autoFocus
          autoComplete="username"
          placeholder="j.kowalski@bioerg.pl"
          value={adres}
          onChange={(e) => setAdres(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
        />

        {!resetowanie && (
          <>
            <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="haslo">
              Hasło
            </label>
            <input
              id="haslo"
              type="password"
              required
              autoComplete="current-password"
              value={haslo}
              onChange={(e) => setHaslo(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
            />
          </>
        )}

        {blad && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}
        {komunikat && (
          <p className="mt-4 rounded bg-limonka-jasna px-3 py-2 text-sm text-limonka-ciemna">{komunikat}</p>
        )}

        <Button type="submit" wariant="glowny" disabled={zajety} className="mt-6 w-full">
          {zajety ? 'Proszę czekać...' : resetowanie ? 'Wyślij link do zmiany hasła' : 'Zaloguj się'}
        </Button>

        <button
          type="button"
          onClick={() => { setResetowanie(!resetowanie); setBlad(null); setKomunikat(null) }}
          className="mt-4 w-full text-sm text-blekit-ciemny underline"
        >
          {resetowanie ? 'Wróć do logowania' : 'Nie pamiętam hasła'}
        </button>

        <p className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
          Konta zakłada księgowość. Jeśli nie masz jeszcze dostępu, zgłoś się do niej.
        </p>
      </form>
    </div>
  )
}
