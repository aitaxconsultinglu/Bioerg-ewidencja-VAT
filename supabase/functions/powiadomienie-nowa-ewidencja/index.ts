// Powiadomienie "ewidencja za poprzedni miesiac jest gotowa". Uruchamiane przez pg_cron
// 2. dnia miesiaca, juz po nocnym przebiegu potoku z 1. dnia.
//
// Kierownik dostaje spis SWOICH pojazdow, ksiegowosc - zbiorcze zestawienie. Bez rok/
// miesiac w zadaniu funkcja sama liczy poprzedni miesiac, wiec zadanie cron nie musi
// znac daty.
// Od 2026-10-20 kazda wysylka - udana i nieudana - trafia do dziennika email_log
// (patrz dziennik.ts), zeby ksiegowosc widziala w aplikacji, kto i kiedy co dostal.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { opisBledu, zapiszWDzienniku } from './dziennik.ts'

// Parametry SMTP z sekretow, zeby zmiana skrzynki nadawczej nie wymagala zmiany kodu.
// Domyslnie Gmail - tak dziala potok raportowy (smtp.gmail.com:587). Dla firmowej
// skrzynki w home.pl wystarczy ustawic SMTP_HOST i SMTP_PORT w sekretach funkcji
// brzegowych; dokladna nazwa serwera jest w panelu home.pl albo w mailu powitalnym
// (przy wlasnym certyfikacie SSL dla domeny bywa to po prostu bioerg.pl).
// Loginem w home.pl jest PELNY adres e-mail, nie sama nazwa konta.
// trim() na nazwie serwera, porcie i loginie: wartosci sekretow wkleja sie recznie,
// a spacja na koncu jest w panelu niewidoczna. Potwierdzone na realnej konfiguracji
// 2026-10-21: SMTP_HOST mial koncowa spacje i denomailer odrzucal nazwe komunikatem
// "invalid host 'serwer2269615.home.pl ': invalid char found in FQDN". Hasla NIE
// obcinamy - gdyby naprawde konczylo sie spacja, obcinanie zepsuloby logowanie bez
// zadnego sladu; zamiast tego funkcja test-poczty raportuje jego dlugosc.
const SMTP_HOST = (Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com').trim()
const SMTP_PORT = Number((Deno.env.get('SMTP_PORT') ?? '465').trim())
const SMTP_SZYFROWANIE_OD_RAZU = SMTP_PORT === 465
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

const ADRES_APLIKACJI = 'https://aitaxconsultinglu.github.io/Bioerg-ewidencja-VAT/'

/** Jedna tresc dla kierownikow i dla ksiegowosci - ta sama wiadomosc o tym, ze
 *  ewidencja zostala wygenerowana i czeka na uzupelnienie. Rozni je wylacznie zakres
 *  pojazdow: kierownik dostaje swoje, ksiegowosc caly tabor z danego miesiaca. */
function trescPowiadomienia(imieNazwisko: string, okres: string, pojazdy: string[]) {
  return [
    `Dzień dobry${imieNazwisko ? ', ' + imieNazwisko : ''},`,
    '',
    `ewidencja przebiegu za ${okres} została wygenerowana z danych GPS i czeka na`,
    'uzupełnienie oraz weryfikację.',
    '',
    pojazdy.length === 1 ? 'Dotyczy pojazdu:' : `Dotyczy pojazdów (${pojazdy.length}):`,
    ...pojazdy.map((r) => `  - ${r}`),
    '',
    'Do uzupełnienia w każdej pozycji:',
    '  - Cel wyjazdu',
    '  - Imię i nazwisko osoby kierującej pojazdem',
    '',
    'Pozostałe dane (data, trasa, liczba kilometrów) pochodzą z GPS i są już wypełnione.',
    'Po uzupełnieniu prosimy podpisać ewidencję i wysłać ją do akceptacji.',
    '',
    `Aplikacja: ${ADRES_APLIKACJI}`,
    '',
    'Pozdrawiamy,',
    'automat Bioerg',
  ].join('\n')
}

Deno.serve(async (req) => {
  let rok: number | undefined
  let miesiac: number | undefined
  try {
    const ciało = await req.json()
    rok = ciało?.rok
    miesiac = ciało?.miesiac
  } catch {
    // Zadanie cron wola funkcje z pustym cialem - to poprawny przypadek.
  }

  if (!rok || !miesiac) {
    const teraz = new Date()
    const poprzedni = new Date(teraz.getFullYear(), teraz.getMonth() - 1, 1)
    rok = poprzedni.getFullYear()
    miesiac = poprzedni.getMonth() + 1
  }

  const brak = brakKonfiguracjiSMTP()
  if (brak) {
    console.error(brak)
    return new Response(JSON.stringify({ wyslano: 0, powod: brak }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: ewidencje, error } = await supabase
    .from('monthly_logs')
    .select('id, vehicles(nr_rejestracyjny, kierownik_id)')
    .eq('rok', rok).eq('miesiac', miesiac)
    .is('powiadomienie_wyslane_at', null)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  if (!ewidencje?.length) {
    return new Response(JSON.stringify({ wyslano: 0, powod: 'brak nowych ewidencji' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const wgKierownika = new Map<string, { logi: string[]; pojazdy: string[] }>()
  for (const e of ewidencje) {
    const pojazd = (e as unknown as { vehicles: { nr_rejestracyjny: string; kierownik_id: string | null } }).vehicles
    if (!pojazd?.kierownik_id) continue
    const wpis = wgKierownika.get(pojazd.kierownik_id) ?? { logi: [], pojazdy: [] }
    wpis.logi.push(e.id)
    wpis.pojazdy.push(pojazd.nr_rejestracyjny)
    wgKierownika.set(pojazd.kierownik_id, wpis)
  }

  const klient = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      // Port 465 szyfruje od pierwszego bajtu (implicit TLS), 587 negocjuje STARTTLS.
      tls: SMTP_SZYFROWANIE_OD_RAZU,
      auth: { username: SMTP_LOGIN, password: SMTP_HASLO },
    },
  })

  const nadawca = SMTP_LOGIN
  const okres = `${MIESIACE_PL[miesiac - 1]} ${rok}`
  const temat = `Ewidencja przebiegu pojazdu za ${okres} jest gotowa do uzupełnienia`
  let doKierownikow = 0
  let doKsiegowosci = 0

  for (const [kierownikId, wpis] of wgKierownika) {
    const { data: profil } = await supabase
      .from('profiles').select('email, imie_nazwisko').eq('id', kierownikId).single()
    if (!profil?.email) continue

    const lista = [...new Set(wpis.pojazdy)].sort()
    const wpisDziennika = {
      rodzaj: 'nowa_ewidencja',
      adresat: profil.email,
      adresat_nazwa: profil.imie_nazwisko,
      profil_id: kierownikId,
      temat,
      pojazdy: lista,
      rok,
      miesiac,
    }
    try {
      await klient.send({
        from: nadawca,
        to: profil.email,
        subject: temat,
        content: trescPowiadomienia(profil.imie_nazwisko ?? '', okres, lista),
      })
      await supabase.from('monthly_logs')
        .update({ powiadomienie_wyslane_at: new Date().toISOString() }).in('id', wpis.logi)
      await zapiszWDzienniku(supabase, { ...wpisDziennika, status: 'wyslany' })
      doKierownikow++
    } catch (err) {
      console.error(`Nie udalo sie powiadomic kierownika ${profil.email}:`, err)
      await zapiszWDzienniku(supabase, {
        ...wpisDziennika, status: 'blad', blad: opisBledu(err),
      })
    }
  }

  // Ksiegowosc dostaje DOKLADNIE te sama wiadomosc co kierownicy - tyle ze o calym
  // taborze z danego miesiaca, bo nie ma przypisanych wlasnych pojazdow.
  const wszystkiePojazdy = [...new Set(
    ewidencje
      .map((e) => (e as unknown as { vehicles: { nr_rejestracyjny: string } }).vehicles?.nr_rejestracyjny)
      .filter(Boolean),
  )].sort()

  const { data: ksiegowi } = await supabase
    .from('profiles').select('email, imie_nazwisko').eq('rola', 'ksiegowosc')

  for (const k of ksiegowi ?? []) {
    if (!k.email) continue
    // Rodzaj 'nowa_ewidencja_ksiegowosc', zeby w dzienniku dalo sie odfiltrowac maile
    // do kierownikow od zbiorczej kopii dla ksiegowosci.
    const wpisDziennika = {
      rodzaj: 'nowa_ewidencja_ksiegowosc',
      adresat: k.email,
      adresat_nazwa: k.imie_nazwisko,
      temat,
      pojazdy: wszystkiePojazdy,
      rok,
      miesiac,
    }
    try {
      await klient.send({
        from: nadawca,
        to: k.email,
        subject: temat,
        content: trescPowiadomienia(k.imie_nazwisko ?? '', okres, wszystkiePojazdy),
      })
      await zapiszWDzienniku(supabase, { ...wpisDziennika, status: 'wyslany' })
      doKsiegowosci++
    } catch (err) {
      console.error(`Nie udalo sie powiadomic ksiegowosci ${k.email}:`, err)
      await zapiszWDzienniku(supabase, {
        ...wpisDziennika, status: 'blad', blad: opisBledu(err),
      })
    }
  }

  try { await klient.close() } catch { /* polaczenie moglo nie powstac */ }
  return new Response(JSON.stringify({ okres, doKierownikow, doKsiegowosci }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
