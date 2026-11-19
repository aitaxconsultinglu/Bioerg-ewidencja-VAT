// Zapis do dziennika wiadomości wychodzących (tabela email_log).
//
// Po co: do 2026-10-20 nie było ŻADNEGO zapisu wysyłek. Księgowość nie mogła sprawdzić,
// czy kierownik dostał powiadomienie o odesłaniu ewidencji do poprawki, a aplikacja
// dodatkowo przemilczała błąd wysyłki (`.catch(() => undefined)`), więc nieudana wysyłka
// wyglądała dokładnie tak samo jak udana.
//
// Rejestrujemy TAKŻE nieudane wysyłki, razem z treścią błędu - bez tego cisza w dzienniku
// jest nieodróżnialna od wiadomości, która nigdy nie wyszła.
//
// Błąd samego zapisu do dziennika NIGDY nie przerywa wysyłki ani nie cofa akcji
// użytkownika: dziennik służy do obserwowania, nie do blokowania.
//
// Plik jest skopiowany do katalogu każdej funkcji brzegowej, bo funkcje wdrażają się
// niezależnie i nie dzielą modułów.

// deno-lint-ignore no-explicit-any
type Klient = any

export interface WpisDziennika {
  /** 'przypomnienie' | 'nowa_ewidencja' | 'poprawka' */
  rodzaj: string
  adresat: string
  adresat_nazwa?: string | null
  profil_id?: string | null
  kopia?: string | null
  temat: string
  /** numery rejestracyjne pojazdów objętych wiadomością */
  pojazdy?: string[]
  rok?: number | null
  miesiac?: number | null
  /** 'wyslany' | 'blad' */
  status: string
  blad?: string | null
}

export async function zapiszWDzienniku(supabase: Klient, wpis: WpisDziennika) {
  try {
    const { error } = await supabase.from('email_log').insert({
      pojazdy: [],
      ...wpis,
      // Komunikaty bibliotek SMTP bywają bardzo długie, a w dzienniku interesuje nas
      // powód, nie cały stos wywołań.
      blad: wpis.blad ? String(wpis.blad).slice(0, 1000) : null,
    })
    if (error) console.error('Nie udało się zapisać do email_log:', error.message)
  } catch (err) {
    console.error('Nie udało się zapisać do email_log:', err)
  }
}

/** Zwięzły opis błędu do dziennika - Error albo cokolwiek, co rzuciło SMTP. */
export function opisBledu(err: unknown) {
  if (err instanceof Error) return err.message
  return String(err)
}
