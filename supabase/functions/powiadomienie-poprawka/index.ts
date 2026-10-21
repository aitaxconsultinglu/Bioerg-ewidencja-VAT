// Wysyła kierownikowi e-mail z komentarzem księgowości po odesłaniu ewidencji do
// poprawki. Sam komentarz jest już zapisany w bazie i widoczny w aplikacji - ta funkcja
// tylko go dostarcza mailem, więc jej błąd nie cofa odesłania do poprawki.
//
// Od 2026-10-20 każda próba wysyłki - udana i nieudana - trafia do dziennika email_log
// (patrz dziennik.ts), a funkcja zwraca błąd zamiast cichego "ok". Wcześniej aplikacja
// tłumiła wyjątek, więc księgowość nie miała jak stwierdzić, czy kierownik dostał
// wiadomość, czy wysyłka przepadła.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { opisBledu, zapiszWDzienniku } from './dziennik.ts'
import { wyslijMaila } from './poczta.ts'
import { stopkaMaila, wczytajUstawienia } from './ustawienia.ts'

// Parametry SMTP z sekretow, zeby zmiana skrzynki nadawczej nie wymagala zmiany kodu.
// Domyslnie Gmail - tak dziala potok raportowy (smtp.gmail.com:587). Dla firmowej
// skrzynki w home.pl wystarczy ustawic SMTP_HOST i SMTP_PORT w sekretach funkcji
// brzegowych; dokladna nazwa serwera jest w panelu home.pl albo w mailu powitalnym
// (przy wlasnym certyfikacie SSL dla domeny bywa to po prostu nazwa domeny).
// Loginem w home.pl jest PELNY adres e-mail, nie sama nazwa konta.
// trim() na nazwie serwera, porcie i loginie: wartosci sekretow wkleja sie recznie,
// a spacja na koncu jest w panelu niewidoczna. Potwierdzone na realnej konfiguracji
// 2026-10-21: SMTP_HOST mial koncowa spacje i wysylka padala na "invalid char found in
// FQDN". Hasla NIE obcinamy - gdyby naprawde konczylo sie spacja, obcinanie zepsuloby
// logowanie bez zadnego sladu; zamiast tego funkcja test-poczty raportuje jego dlugosc.
const SMTP_HOST = (Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com').trim()
const SMTP_PORT = Number((Deno.env.get('SMTP_PORT') ?? '465').trim())
const SMTP_LOGIN = (Deno.env.get('EMAIL_USER') ?? '').trim()
const SMTP_HASLO = Deno.env.get('EMAIL_PASS') ?? ''

/** Czy skrzynka nadawcza jest w ogole skonfigurowana. Do 2026-10-20 sekretow EMAIL_USER
 *  i EMAIL_PASS nie bylo wcale, wiec z aplikacji nie wyszedl ani jeden mail - a denomailer
 *  wywracal sie wtedy na nieczytelnym "Cannot read properties of undefined (reading
 *  'mail')". Sprawdzamy to PRZED proba wysylki i zapisujemy czytelny powod w dzienniku. */
function brakKonfiguracjiSMTP() {
  if (SMTP_LOGIN && SMTP_HASLO) return null
  return `Brak konfiguracji skrzynki nadawczej: ` +
    `EMAIL_USER ${SMTP_LOGIN ? 'ustawiony' : 'BRAK'}, ` +
    `EMAIL_PASS ${SMTP_HASLO ? 'ustawiony' : 'BRAK'}. ` +
    `Ustaw sekrety funkcji brzegowych w panelu Supabase.`
}

const MIESIACE_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

function odpowiedz(tresc: unknown, status = 200) {
  return new Response(JSON.stringify(tresc), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // { podglad_na: "adres" } przekierowuje wiadomosc na podany adres zamiast do
  // kierownika - do sprawdzenia formatu bez zawracania glowy prawdziwym odbiorcom.
  const { log_id, podglad_na } = await req.json()
  if (!log_id) return odpowiedz({ error: 'Brak log_id' }, 400)
  const podgladNa = String(podglad_na ?? '').trim()
  const podglad = podgladNa !== ''

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const ust = await wczytajUstawienia(supabase)

  const { data: e } = await supabase
    .from('monthly_logs')
    .select('rok, miesiac, komentarz_ksiegowosci, vehicles(nr_rejestracyjny, kierownik_id)')
    .eq('id', log_id)
    .single()

  // deno-lint-ignore no-explicit-any
  const pojazd = (e as any)?.vehicles
  if (!e || !pojazd?.kierownik_id) {
    return odpowiedz({ error: 'Nie znaleziono kierownika' }, 404)
  }

  const { data: profil } = await supabase
    .from('profiles').select('email, imie_nazwisko').eq('id', pojazd.kierownik_id).single()
  if (!profil?.email) {
    // Zapisujemy nawet to: brak adresu u kierownika jest powodem, dla którego
    // wiadomość nie wyszła, i księgowość musi to zobaczyć w dzienniku.
    await zapiszWDzienniku(supabase, {
      rodzaj: 'poprawka',
      adresat: '(brak adresu e-mail)',
      profil_id: pojazd.kierownik_id,
      temat: `Ewidencja ${pojazd.nr_rejestracyjny} - odesłana do poprawki`,
      pojazdy: [pojazd.nr_rejestracyjny],
      rok: e.rok,
      miesiac: e.miesiac,
      status: 'blad',
      blad: 'Kierownik nie ma zapisanego adresu e-mail',
    })
    return odpowiedz({ error: 'Kierownik bez adresu e-mail' }, 404)
  }

  const okres = `${MIESIACE_PL[e.miesiac - 1]} ${e.rok}`
  const temat =
    `Ewidencja przebiegu pojazdu ${pojazd.nr_rejestracyjny} za ${okres} - odesłana do poprawki`

  // W podgladzie wiadomosc idzie na wskazany adres, a nie do kierownika, i dostaje
  // prefiks z jego adresem, zeby bylo widac, czyj to mial byc mail.
  const odbiorca = podglad ? podgladNa : profil.email
  const tematWysylki = podglad ? `[PODGLĄD dla ${profil.email}] ${temat}` : temat
  const wpis = {
    rodzaj: podglad ? 'poprawka_podglad' : 'poprawka',
    adresat: odbiorca,
    adresat_nazwa: profil.imie_nazwisko,
    profil_id: pojazd.kierownik_id,
    temat: tematWysylki,
    pojazdy: [pojazd.nr_rejestracyjny],
    rok: e.rok,
    miesiac: e.miesiac,
  }

  const brak = brakKonfiguracjiSMTP()
  if (brak) {
    await zapiszWDzienniku(supabase, { ...wpis, status: 'blad', blad: brak })
    return odpowiedz({ error: brak }, 500)
  }

  try {
    await wyslijMaila({
      host: SMTP_HOST, port: SMTP_PORT, login: SMTP_LOGIN, haslo: SMTP_HASLO,
      od: SMTP_LOGIN, do_: odbiorca,
      temat: tematWysylki,
      tresc: [
        `Dzień dobry${profil.imie_nazwisko ? ', ' + profil.imie_nazwisko : ''},`,
        '',
        `księgowość odesłała do poprawki ewidencję przebiegu pojazdu ${pojazd.nr_rejestracyjny} za ${okres}.`,
        '',
        'Komentarz księgowości:',
        e.komentarz_ksiegowosci ?? '(brak treści komentarza)',
        '',
        'Prosimy o naniesienie poprawek i ponowne wysłanie ewidencji do akceptacji.',
        '',
        ...stopkaMaila(ust),
      ].join('\n'),
    })
    await zapiszWDzienniku(supabase, { ...wpis, status: 'wyslany' })
    return odpowiedz({ ok: true, adresat: odbiorca })
  } catch (err) {
    await zapiszWDzienniku(supabase, { ...wpis, status: 'blad', blad: opisBledu(err) })
    // Zwracamy blad, zeby aplikacja mogla powiedziec ksiegowosci, ze mail nie wyszedl.
    return odpowiedz({ error: `Nie udalo sie wyslac wiadomosci: ${opisBledu(err)}` }, 502)
  }
})