// Powiadomienie "ewidencja za poprzedni miesiac jest gotowa".
//
// Wolane przez potok GPS (eksport_supabase.py -> powiadom_kierownikow) zaraz po udanym
// imporcie danych, czyli 1. dnia miesiaca po przebiegu GitHub Actions. NIE przez pg_cron,
// jak twierdzil poprzedni komentarz w tym pliku: wiadomosc ma wyjsc w momencie, w ktorym
// dane faktycznie sa w aplikacji, a nie w sztywno wyznaczonym dniu, kiedy potok moglby
// jeszcze nie przejsc.
//
// Kierownik dostaje spis SWOICH pojazdow, ksiegowosc - zbiorcze zestawienie calego taboru.
// Bez rok/miesiac w zadaniu funkcja sama liczy poprzedni miesiac.
//
// Jednokrotnosc pilnuje kolumna powiadomienie_wyslane_at: ponowne uruchomienie potoku dla
// tego samego miesiaca nie zawiadomi nikogo drugi raz.
//
// Od 2026-10-20 kazda wysylka - udana i nieudana - trafia do dziennika email_log
// (patrz dziennik.ts), zeby ksiegowosc widziala w aplikacji, kto i kiedy co dostal.
//
// Od 2026-10-21 wysylka idzie przez wlasna obsluge SMTP (poczta.ts), a nie przez
// denomailer. Biblioteka wstawiala naglowki MIME do TRESCI wiadomosci, wiec Gmail
// pokazywal odbiorcy surowe zrodlo z granicami multipart i "=c5=84" zamiast polskich
// znakow. To byla ostatnia z czterech funkcji na starej bibliotece - i jedyna, ktorej
// zepsuty format zobaczylby od razu caly tabor naraz.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { opisBledu, zapiszWDzienniku } from './dziennik.ts'
import { wyslijMaila } from './poczta.ts'
import { stopkaMaila, wczytajUstawienia } from './ustawienia.ts'
import {
  czyZapytanieWstepne, odpowiedzJSON as odpowiedz, odpowiedzWstepna, tylkoSerwis,
  ustalWolajacego,
} from './brama.ts'

// Parametry SMTP z sekretow, zeby zmiana skrzynki nadawczej nie wymagala zmiany kodu.
// trim() na nazwie serwera, porcie i loginie: wartosci sekretow wkleja sie recznie,
// a spacja na koncu jest w panelu niewidoczna. Potwierdzone na realnej konfiguracji
// 2026-10-21: SMTP_HOST mial koncowa spacje i wysylka padala na "invalid char found in
// FQDN". Hasla NIE obcinamy - gdyby naprawde konczylo sie spacja, obcinanie zepsuloby
// logowanie bez zadnego sladu.
const SMTP_HOST = (Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com').trim()
const SMTP_PORT = Number((Deno.env.get('SMTP_PORT') ?? '465').trim())
const SMTP_LOGIN = (Deno.env.get('EMAIL_USER') ?? '').trim()
const SMTP_HASLO = Deno.env.get('EMAIL_PASS') ?? ''

/** Czy skrzynka nadawcza jest w ogole skonfigurowana. Do 2026-10-20 sekretow EMAIL_USER
 *  i EMAIL_PASS nie bylo wcale, wiec z aplikacji nie wyszedl ani jeden mail. Sprawdzamy
 *  to PRZED proba wysylki, inaczej w dzienniku pojawiloby sie kilkanascie wpisow z tym
 *  samym bledem SMTP zamiast jednego czytelnego powodu. */
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

/** Jedna tresc dla kierownikow i dla ksiegowosci - ta sama wiadomosc o tym, ze
 *  ewidencja zostala wygenerowana i czeka na uzupelnienie. Rozni je wylacznie zakres
 *  pojazdow: kierownik dostaje swoje, ksiegowosc caly tabor z danego miesiaca. */
function trescPowiadomienia(
  imieNazwisko: string, okres: string, pojazdy: string[], stopka: string[],
) {
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
    ...stopka,
  ].join('\n')
}

Deno.serve(async (req) => {
  if (czyZapytanieWstepne(req)) return odpowiedzWstepna()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Funkcje wola wylacznie potok GPS po imporcie danych. Do 2026-10-21 wystarczyl klucz
  // publishable z paczki aplikacji, zeby - przez `podglad_na` - wyslac spis calej floty
  // razem z nazwiskami kierownikow na dowolny adres.
  const wolajacy = await ustalWolajacego(req, supabase)
  const odmowa = tylkoSerwis(wolajacy)
  if (odmowa) return odmowa

  let rok: number | undefined
  let miesiac: number | undefined
  // { podglad_na: "adres" } to tryb PODGLADU: wszystko liczy sie na prawdziwych danych,
  // ale wiadomosci ida na ten jeden adres. Podglad NIE RUSZA powiadomienie_wyslane_at -
  // inaczej "zuzylby" powiadomienie i prawdziwa wysylka 1. dnia miesiaca by sie nie
  // odbyla. W dzienniku takie wpisy maja rodzaj z sufiksem _podglad.
  let podgladNa = ''
  // Domyslnie podglad wysyla po JEDNEJ probce kazdego wariantu (kierownik + ksiegowosc),
  // bo tresc rozni sie tylko lista pojazdow, a nie chcemy zasypac skrzynki testujacego
  // kilkunastoma niemal identycznymi mailami. { podglad_wszyscy: true } wysyla wszystkie.
  let podgladWszyscy = false
  try {
    const cialo = await req.json()
    rok = cialo?.rok
    miesiac = cialo?.miesiac
    podgladNa = String(cialo?.podglad_na ?? '').trim()
    podgladWszyscy = cialo?.podglad_wszyscy === true
  } catch {
    // Potok wola funkcje z rok/miesiac, ale puste cialo tez jest poprawne - wtedy
    // liczymy miesiac poprzedni.
  }
  const podglad = podgladNa !== ''

  if (!rok || !miesiac) {
    const teraz = new Date()
    const poprzedni = new Date(teraz.getFullYear(), teraz.getMonth() - 1, 1)
    rok = poprzedni.getFullYear()
    miesiac = poprzedni.getMonth() + 1
  }

  const brak = brakKonfiguracjiSMTP()
  if (brak) {
    console.error(brak)
    return odpowiedz({ wyslano: 0, powod: brak }, 500)
  }

  const ust = await wczytajUstawienia(supabase)
  const stopka = stopkaMaila(ust)
  const KOPIA = ust.kopiaPowiadomien

  const { data: ewidencje, error } = await supabase
    .from('monthly_logs')
    .select('id, vehicles(nr_rejestracyjny, kierownik_id)')
    .eq('rok', rok).eq('miesiac', miesiac)
    .is('powiadomienie_wyslane_at', null)

  if (error) return odpowiedz({ error: error.message }, 500)
  if (!ewidencje?.length) {
    return odpowiedz({
      wyslano: 0, rok, miesiac, powod: 'brak nowych ewidencji',
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

  const okres = `${MIESIACE_PL[miesiac - 1]} ${rok}`
  const temat = `Ewidencja przebiegu pojazdu za ${okres} jest gotowa do uzupełnienia`
  let doKierownikow = 0
  let doKsiegowosci = 0
  const bledy: string[] = []

  for (const [kierownikId, wpis] of wgKierownika) {
    const lista = [...new Set(wpis.pojazdy)].sort()
    const { data: profil } = await supabase
      .from('profiles').select('email, imie_nazwisko').eq('id', kierownikId).single()
    if (!profil?.email) {
      // Kierownik bez adresu to powod, dla ktorego ewidencja nie zostanie podjeta -
      // musi byc widoczny w dzienniku, a nie tylko w logach funkcji.
      await zapiszWDzienniku(supabase, {
        rodzaj: 'nowa_ewidencja', adresat: '(brak adresu e-mail)', profil_id: kierownikId,
        temat, pojazdy: lista, rok, miesiac,
        status: 'blad', blad: 'Kierownik nie ma zapisanego adresu e-mail',
      })
      continue
    }
    // W podgladzie wystarczy jedna probka wariantu "kierownik".
    if (podglad && !podgladWszyscy && doKierownikow > 0) continue

    const odbiorca = podglad ? podgladNa : profil.email
    const kopia = podglad || profil.email === KOPIA ? null : KOPIA
    // Prefiks z adresem kierownika, zeby w podgladzie bylo widac, czyj to mial byc mail.
    const tematWysylki = podglad ? `[PODGLĄD dla ${profil.email}] ${temat}` : temat
    const wpisDziennika = {
      rodzaj: podglad ? 'nowa_ewidencja_podglad' : 'nowa_ewidencja',
      adresat: odbiorca,
      adresat_nazwa: profil.imie_nazwisko,
      profil_id: kierownikId,
      kopia,
      temat: tematWysylki,
      pojazdy: lista,
      rok,
      miesiac,
    }
    try {
      await wyslijMaila({
        host: SMTP_HOST, port: SMTP_PORT, login: SMTP_LOGIN, haslo: SMTP_HASLO,
        od: SMTP_LOGIN, do_: odbiorca, kopia,
        temat: tematWysylki,
        tresc: trescPowiadomienia(profil.imie_nazwisko ?? '', okres, lista, stopka),
      })
      // Znacznik stawiamy DOPIERO po udanej wysylce i NIGDY w podgladzie.
      if (!podglad) {
        await supabase.from('monthly_logs')
          .update({ powiadomienie_wyslane_at: new Date().toISOString() }).in('id', wpis.logi)
      }
      await zapiszWDzienniku(supabase, { ...wpisDziennika, status: 'wyslany' })
      doKierownikow++
    } catch (err) {
      console.error(`Nie udalo sie powiadomic kierownika ${profil.email}:`, opisBledu(err))
      bledy.push(`${profil.email}: ${opisBledu(err)}`)
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
    .from('profiles').select('id, email, imie_nazwisko').eq('rola', 'ksiegowosc')

  for (const k of ksiegowi ?? []) {
    if (!k.email) continue
    // W podgladzie wystarczy jedna probka wariantu "ksiegowosc".
    if (podglad && !podgladWszyscy && doKsiegowosci > 0) continue

    const odbiorca = podglad ? podgladNa : k.email
    const tematWysylki = podglad ? `[PODGLĄD dla ${k.email}] ${temat}` : temat
    // Rodzaj 'nowa_ewidencja_ksiegowosc', zeby w dzienniku dalo sie odfiltrowac maile
    // do kierownikow od zbiorczej kopii dla ksiegowosci.
    const wpisDziennika = {
      rodzaj: podglad ? 'nowa_ewidencja_ksiegowosc_podglad' : 'nowa_ewidencja_ksiegowosc',
      adresat: odbiorca,
      adresat_nazwa: k.imie_nazwisko,
      profil_id: k.id,
      temat: tematWysylki,
      pojazdy: wszystkiePojazdy,
      rok,
      miesiac,
    }
    try {
      await wyslijMaila({
        host: SMTP_HOST, port: SMTP_PORT, login: SMTP_LOGIN, haslo: SMTP_HASLO,
        od: SMTP_LOGIN, do_: odbiorca,
        temat: tematWysylki,
        tresc: trescPowiadomienia(k.imie_nazwisko ?? '', okres, wszystkiePojazdy, stopka),
      })
      await zapiszWDzienniku(supabase, { ...wpisDziennika, status: 'wyslany' })
      doKsiegowosci++
    } catch (err) {
      console.error(`Nie udalo sie powiadomic ksiegowosci ${k.email}:`, opisBledu(err))
      bledy.push(`${k.email}: ${opisBledu(err)}`)
      await zapiszWDzienniku(supabase, {
        ...wpisDziennika, status: 'blad', blad: opisBledu(err),
      })
    }
  }

  return odpowiedz({
    okres, doKierownikow, doKsiegowosci,
    podglad: podglad ? podgladNa : undefined,
    bledy: bledy.length ? bledy : undefined,
  })
})
