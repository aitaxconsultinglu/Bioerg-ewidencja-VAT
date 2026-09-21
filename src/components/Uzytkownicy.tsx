import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ShieldCheck, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { komunikatPL } from '@/lib/config'
import { dataGodzinaPL } from '@/lib/format'
import type { Pojazd, Profil, Rola } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

interface WierszUzytkownika {
  id: string
  email: string
  imie_nazwisko: string
  rola: Rola
  wymaga_zmiany_hasla: boolean
  chroniony: boolean
  ostatnie_logowanie: string | null
  liczba_pojazdow: number
}

interface Props {
  profil: Profil
  naListe: () => void
}

export function Uzytkownicy({ profil, naListe }: Props) {
  const [uzytkownicy, setUzytkownicy] = useState<WierszUzytkownika[]>([])
  const [pojazdy, setPojazdy] = useState<Pojazd[]>([])
  const [wybrany, setWybrany] = useState<WierszUzytkownika | null>(null)
  const [doUsuniecia, setDoUsuniecia] = useState<WierszUzytkownika | null>(null)
  const [nowy, setNowy] = useState({ email: '', imie_nazwisko: '', rola: 'kierownik' as Rola })
  const [hasloDoPrzekazania, setHasloDoPrzekazania] = useState<{ email: string; haslo: string } | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [zajety, setZajety] = useState(false)

  const wczytaj = useCallback(async () => {
    const [{ data: lista }, { data: poj }] = await Promise.all([
      supabase.rpc('lista_uzytkownikow'),
      supabase.from('vehicles').select('*').order('nr_rejestracyjny'),
    ])
    setUzytkownicy((lista ?? []) as WierszUzytkownika[])
    setPojazdy((poj ?? []) as Pojazd[])
  }, [])

  useEffect(() => { void wczytaj() }, [wczytaj])

  async function dodaj(e: React.FormEvent) {
    e.preventDefault()
    setBlad(null)
    setZajety(true)
    const { data, error } = await supabase.functions.invoke('zarzadzanie-uzytkownikami', {
      body: {
        akcja: 'dodaj',
        email: nowy.email.trim(),
        imie_nazwisko: nowy.imie_nazwisko,
        rola: nowy.rola,
      },
    })
    setZajety(false)
    const odp = data as { error?: string; haslo_tymczasowe?: string; email?: string } | null
    if (error || odp?.error) {
      setBlad(komunikatPL(odp?.error ?? error?.message ?? 'Nie udało się dodać konta.'))
      return
    }
    setHasloDoPrzekazania({ email: odp!.email!, haslo: odp!.haslo_tymczasowe! })
    setNowy({ email: '', imie_nazwisko: '', rola: 'kierownik' })
    await wczytaj()
  }

  async function usun() {
    if (!doUsuniecia) return
    setZajety(true)
    setBlad(null)
    const { data, error } = await supabase.functions.invoke('zarzadzanie-uzytkownikami', {
      body: { akcja: 'usun', user_id: doUsuniecia.id },
    })
    setZajety(false)
    const odp = data as { error?: string } | null
    if (error || odp?.error) {
      setBlad(komunikatPL(odp?.error ?? error?.message ?? 'Nie udało się usunąć konta.'))
    }
    setDoUsuniecia(null)
    if (wybrany?.id === doUsuniecia.id) setWybrany(null)
    await wczytaj()
  }

  async function przepnijPojazd(pojazd: Pojazd, przypisz: boolean) {
    if (!wybrany) return
    const { error } = await supabase.from('vehicles').update({
      kierownik_id: przypisz ? wybrany.id : null,
      kierownik_email: przypisz ? wybrany.email : null,
    }).eq('id', pojazd.id)
    if (error) { setBlad(komunikatPL(error.message)); return }
    await wczytaj()
  }

  return (
    <div className="space-y-5">
      <button onClick={naListe} className="flex items-center gap-1.5 text-sm text-blekit-ciemny hover:underline">
        <ArrowLeft className="h-4 w-4" /> Wróć do ewidencji
      </button>

      {blad && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{blad}</div>}

      <form onSubmit={dodaj} className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Dodaj użytkownika</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="nowy-email">
              Adres e-mail
            </label>
            <input
              id="nowy-email"
              type="email"
              required
              placeholder="j.kowalski@bioerg.pl"
              value={nowy.email}
              onChange={(e) => setNowy({ ...nowy, email: e.target.value })}
              className="mt-1 w-60 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="nowy-nazwisko">Imię i nazwisko</label>
            <input
              id="nowy-nazwisko"
              required
              placeholder="Jan Kowalski"
              value={nowy.imie_nazwisko}
              onChange={(e) => setNowy({ ...nowy, imie_nazwisko: e.target.value })}
              className="mt-1 w-56 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="nowa-rola">Rola</label>
            <select
              id="nowa-rola"
              value={nowy.rola}
              onChange={(e) => setNowy({ ...nowy, rola: e.target.value as Rola })}
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blekit focus:outline-none"
            >
              <option value="kierownik">kierownik</option>
              <option value="ksiegowosc">księgowość</option>
            </select>
          </div>
          <Button type="submit" wariant="glowny" disabled={zajety}>Dodaj konto</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Konto dostanie hasło tymczasowe, które pokażemy raz po utworzeniu. Przy pierwszym
          logowaniu użytkownik musi ustawić własne.
        </p>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">Imię i nazwisko</th>
              <th className="px-4 py-3">Login</th>
              <th className="px-4 py-3">Rola</th>
              <th className="px-4 py-3 text-right">Pojazdy</th>
              <th className="px-4 py-3">Ostatnie logowanie</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {uzytkownicy.map((u) => (
              <tr
                key={u.id}
                className={cn('hover:bg-slate-50', wybrany?.id === u.id && 'bg-limonka-jasna/50')}
              >
                <td className="px-4 py-3 font-medium">
                  {u.imie_nazwisko}
                  {u.id === profil.id && <span className="ml-2 text-xs text-slate-400">(Ty)</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3">
                  {u.chroniony ? (
                    <span
                      title="Konto administratora - nie można go usunąć ani zmienić mu roli"
                      className="inline-flex items-center gap-1 rounded-full bg-limonka-jasna px-2.5 py-0.5 text-xs font-medium text-limonka-ciemna ring-1 ring-limonka"
                    >
                      <ShieldCheck className="h-3 w-3" /> administrator
                    </span>
                  ) : (
                    u.rola === 'ksiegowosc' ? 'księgowość' : 'kierownik'
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {u.rola === 'ksiegowosc' ? 'wszystkie' : u.liczba_pojazdow}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {u.ostatnie_logowanie
                    ? dataGodzinaPL(u.ostatnie_logowanie)
                    : <span className="text-amber-700">nigdy się nie logował</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {u.rola === 'kierownik' && (
                      <Button onClick={() => setWybrany(wybrany?.id === u.id ? null : u)}>
                        Pojazdy
                      </Button>
                    )}
                    <Button
                      wariant="ostrzezenie"
                      disabled={u.id === profil.id || u.chroniony}
                      title={u.chroniony
                        ? 'Konta administratora nie można usunąć'
                        : u.id === profil.id ? 'Nie możesz usunąć własnego konta' : 'Usuń konto'}
                      onClick={() => setDoUsuniecia(u)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {wybrany && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold">
            Pojazdy przypisane do: {wybrany.imie_nazwisko}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Kierownik widzi wyłącznie zaznaczone pojazdy. Odznaczenie nie kasuje żadnych
            danych - pojazd przestaje być tylko widoczny dla tej osoby.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {pojazdy.map((p) => {
              const moj = p.kierownik_id === wybrany.id
              const czyjs = !!p.kierownik_id && !moj
              return (
                <label
                  key={p.id}
                  className={cn(
                    'flex items-center gap-2 rounded border px-2 py-1.5 text-sm',
                    moj ? 'border-limonka bg-limonka-jasna' : 'border-slate-200',
                    czyjs && 'opacity-50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={moj}
                    disabled={czyjs}
                    onChange={(e) => void przepnijPojazd(p, e.target.checked)}
                  />
                  <span>
                    {p.nr_rejestracyjny}
                    {czyjs && <span className="block text-xs text-slate-500">zajęty</span>}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      <Dialog
        open={!!hasloDoPrzekazania}
        onOpenChange={(o) => !o && setHasloDoPrzekazania(null)}
      >
        <DialogContent>
          <DialogTitle>Konto utworzone</DialogTitle>
          <DialogDescription>
            Przekaż te dane pracownikowi. <strong>Hasło pokazujemy tylko teraz</strong> - nie
            da się go później odczytać, można je jedynie zresetować.
          </DialogDescription>
          <div className="mt-4 space-y-2 rounded-md bg-slate-50 p-4 font-mono text-sm">
            <div><span className="text-slate-500">Login:</span> {hasloDoPrzekazania?.email}</div>
            <div><span className="text-slate-500">Hasło:</span> {hasloDoPrzekazania?.haslo}</div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button wariant="glowny" onClick={() => setHasloDoPrzekazania(null)}>
              Zapisałem, zamknij
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!doUsuniecia} onOpenChange={(o) => !o && setDoUsuniecia(null)}>
        <DialogContent>
          <DialogTitle>Usunąć konto {doUsuniecia?.imie_nazwisko}?</DialogTitle>
          <DialogDescription>
            Użytkownik straci dostęp do aplikacji, a jego pojazdy zostaną bez kierownika.
          </DialogDescription>
          <p className="mt-3 rounded bg-limonka-jasna px-3 py-2 text-sm text-limonka-ciemna">
            Ewidencje, podpisy i dziennik zmian <strong>zostają nienaruszone</strong> - podpis
            pod dokumentem VAT to zapisane imię i nazwisko, a nie odnośnik do konta.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setDoUsuniecia(null)}>Anuluj</Button>
            <Button wariant="ostrzezenie" disabled={zajety} onClick={() => void usun()}>
              Usuń konto
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
