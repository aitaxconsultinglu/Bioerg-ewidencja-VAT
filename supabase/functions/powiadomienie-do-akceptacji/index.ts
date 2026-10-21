// Powiadamia księgowość, że kierownik wysłał ewidencję do akceptacji.
//
// Po co: dotąd księgowość nie miała skąd wiedzieć, że coś na nią czeka - musiała sama
// zaglądać do aplikacji. Teraz dostaje maila w momencie, w którym kierownik zmienia
// status na "Wysłana do akceptacji".
//
// Wołane z aplikacji po udanej zmianie statusu. Błąd tej funkcji NIE cofa wysłania
// ewidencji - status jest już zapisany w bazie, a mail to tylko zawiadomienie.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { opisBledu, zapiszWDzienniku } from './dziennik.ts'
import { wyslijMaila } from './poczta.ts'

const SMTP_HOST = (Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com').trim()
const SMTP_PORT = Number((Deno.env.get('SMTP_PORT') ?? '465').trim())
const SMTP_LOGIN = (Deno.env.get('EMAIL_USER') ?? '').trim()
const SMTP_HASLO = Deno.env.get('EMAIL_PASS') ?? ''

const MIESIACE_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

const ADRES_APLIKACJI = 'https://aitaxconsultinglu.github.io/Bioerg-ewidencja-VAT/'

function odpowiedz(tresc: unknown, status = 200) {
  return new Response(JSON.stringify(tresc), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // { podglad_na: "adres" } przekierowuje wszystkie wiadomosci na podany adres zamiast
  // do ksiegowosci - do sprawdzenia formatu bez zawracania glowy prawdziwym odbiorcom.
  const { log_id, podglad_na } = await req.json()
  if (!log_id) return odpowiedz({ error: 'Brak log_id' }, 400)
  const podgladNa = String(podglad_na ?? '').trim()
  const podglad = podgladNa !== ''

  if (!SMTP_LOGIN || !SMTP_HASLO) {
    return odpowiedz({ error: 'Brak konfiguracji skrzynki nadawczej' }, 500)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: e } = await supabase
    .from('monthly_logs')
    .select('rok, miesiac, podpis_imie_nazwisko, stan_licznika_poczatek, '
          + 'vehicles(nr_rejestracyjny, kierownik_id)')
    .eq('id', log_id)
    .single()

  // deno-lint-ignore no-explicit-any
  const pojazd = (e as any)?.vehicles
  if (!e || !pojazd) return odpowiedz({ error: 'Nie znaleziono ewidencji' }, 404)

  // Suma kilometrów liczona tu, a nie brana z nagłówka: księgowość ma w mailu od razu
  // widzieć, o jakiej skali przebiegu mówimy, bez wchodzenia do aplikacji.
  const { data: trasy } = await supabase
    .from('trips').select('km').eq('log_id', log_id)
  const sumaKm = (trasy ?? []).reduce((s, t) => s + Number(t.km ?? 0), 0)

  const okres = `${MIESIACE_PL[e.miesiac - 1]} ${e.rok}`
  const temat = `Do akceptacji: ewidencja ${pojazd.nr_rejestracyjny} za ${okres}`

  // Wszyscy z rolą księgowości - nie wiemy z góry, kto akurat zajmuje się zamknięciem
  // miesiąca, więc zawiadamiamy cały zespół.
  const { data: ksiegowi } = await supabase
    .from('profiles').select('id, email, imie_nazwisko').eq('rola', 'ksiegowosc')

  if (!ksiegowi?.length) {
    return odpowiedz({ error: 'Brak kont z rolą księgowości' }, 404)
  }

  let wyslano = 0
  const bledy: string[] = []

  for (const k of ksiegowi) {
    if (!k.email) continue
    const odbiorca = podglad ? podgladNa : k.email
    const tematWysylki = podglad ? `[PODGLĄD dla ${k.email}] ${temat}` : temat
    const wpis = {
      rodzaj: podglad ? 'do_akceptacji_podglad' : 'do_akceptacji',
      adresat: odbiorca,
      adresat_nazwa: k.imie_nazwisko,
      profil_id: k.id,
      temat: tematWysylki,
      pojazdy: [pojazd.nr_rejestracyjny],
      rok: e.rok,
      miesiac: e.miesiac,
    }
    try {
      await wyslijMaila({
        host: SMTP_HOST, port: SMTP_PORT, login: SMTP_LOGIN, haslo: SMTP_HASLO,
        od: SMTP_LOGIN, do_: odbiorca,
        temat: tematWysylki,
        tresc: [
          `Dzień dobry${k.imie_nazwisko ? ', ' + k.imie_nazwisko : ''},`,
          '',
          'kierownik wysłał do akceptacji ewidencję przebiegu pojazdu:',
          '',
          `  Pojazd:    ${pojazd.nr_rejestracyjny}`,
          `  Okres:     ${okres}`,
          `  Podpisał:  ${e.podpis_imie_nazwisko ?? '(brak podpisu)'}`,
          `  Razem km:  ${sumaKm.toFixed(2).replace('.', ',')}`,
          '',
          'Prosimy o przejrzenie i zatwierdzenie albo odesłanie do poprawki',
          'z komentarzem dla kierownika.',
          '',
          `Aplikacja: ${ADRES_APLIKACJI}`,
          '',
          'Pozdrawiamy,',
          'automat Bioerg',
        ].join('\n'),
      })
      await zapiszWDzienniku(supabase, { ...wpis, status: 'wyslany' })
      wyslano++
    } catch (err) {
      bledy.push(`${k.email}: ${opisBledu(err)}`)
      await zapiszWDzienniku(supabase, {
        ...wpis, status: 'blad', blad: opisBledu(err),
      })
    }
  }

  // Zwracamy błąd tylko gdy NIE udało się zawiadomić nikogo - jeśli choć jedna osoba
  // z księgowości dostała maila, zadanie jest spełnione.
  if (!wyslano) return odpowiedz({ error: bledy.join('; ') || 'Nie wysłano nic' }, 502)
  return odpowiedz({ ok: true, wyslano, bledy: bledy.length ? bledy : undefined })
})
