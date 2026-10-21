// Przypomnienia dla kierownikow, ktorzy maja cos do zrobienia z ewidencja.
//
// Dwa rytmy (od 2026-10-20):
//  - ewidencja NIEWYSLANA (wygenerowana / w edycji) - co dwa dni, jak dotad;
//  - ewidencja ODESLANA DO POPRAWKI - CODZIENNIE, bo ksiegowosc czeka na konkretna
//    poprawke i zwleka z zamknieciem miesiaca, a nie na pierwsze wypelnienie.
// Odstep liczy sie od OSTATNIEGO przypomnienia dla danej ewidencji, a nie od sztywnego
// dnia tygodnia.
//
// Ksiegowosc nie dostaje przypomnien: to kierownik ma cos do zrobienia.
//
// Kazda wysylka - udana i nieudana - trafia do dziennika email_log (patrz dziennik.ts),
// zeby ksiegowosc mogla sprawdzic, kto i kiedy co dostal.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { opisBledu, zapiszWDzienniku } from './dziennik.ts'
import { wyslijMaila } from './poczta.ts'

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
const ODSTEP_DNI = 2

/** Ewidencje odeslane do poprawki ponaglamy codziennie. Prog 20 godzin, a nie 24, zeby
 *  przesuniecie uruchomienia o kilka minut nie kazalo czekac calej doby. */
const ODSTEP_GODZIN_POPRAWKA = 20

/** O ktorej godzinie CZASU POLSKIEGO wychodza maile. */
const GODZINA_WYSYLKI = 6

/** Godzina w strefie Europe/Warsaw. pg_cron zna wylacznie UTC i nie obsluguje zmiany
 *  czasu, dlatego zadanie chodzi o 04:30 i 05:30 UTC, a ten warunek przepuszcza tylko
 *  to uruchomienie, ktore faktycznie wypada o 6:xx w Polsce - czyli latem pierwsze,
 *  zima drugie. Bez tego godzina wysylki wedrowalaby miedzy 6:30 i 7:30 dwa razy w roku. */
function godzinaWPolsce(d: Date) {
  return Number(new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false,
  }).format(d))
}

/** Kopia kazdego przypomnienia, zeby bylo widac kto i o co jest ponaglany bez
 *  zagladania do logow funkcji. */
const KOPIA_PRZYPOMNIEN = 'aitaxconsultinglu@gmail.com'

/** Niedziela Wielkanocna metoda Meeusa/Jonesa/Butchera - od niej liczy sie Poniedzialek
 *  Wielkanocny i Boze Cialo, jedyne ruchome swieta wolne wypadajace w dzien roboczy. */
function wielkanoc(rok: number) {
  const a = rok % 19
  const b = Math.floor(rok / 100)
  const c = rok % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const miesiac = Math.floor((h + l - 7 * m + 114) / 31)
  const dzien = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(rok, miesiac - 1, dzien))
}

function mmdd(d: Date) {
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Dni ustawowo wolne od pracy w Polsce. Niedziele obslugujemy osobno. */
function dzienWolny(d: Date) {
  const STALE = ['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26']
  if (STALE.includes(mmdd(d))) return true

  const w = wielkanoc(d.getUTCFullYear())
  const poniedzialekWielkanocny = new Date(w.getTime() + 1 * 86_400_000)
  const bozeCialo = new Date(w.getTime() + 60 * 86_400_000)
  return mmdd(d) === mmdd(poniedzialekWielkanocny) || mmdd(d) === mmdd(bozeCialo)
}

/** Termin wyznaczany w dniach ROBOCZYCH - przypomnienie wysłane w piątek daje czas do
 *  wtorku, a nie do niedzieli. Pomija też święta, żeby nie wyznaczyć terminu na dzień,
 *  w którym nikt nie pracuje. */
function terminRoboczy(dniRoboczych: number) {
  const d = new Date()
  let dodane = 0
  while (dodane < dniRoboczych) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dzien = d.getUTCDay()
    if (dzien !== 0 && dzien !== 6 && !dzienWolny(d)) dodane++
  }
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
}

Deno.serve(async (req) => {
  // { wymuszone: true } pomija warunek godziny - do recznego uruchomienia z panelu albo
  // z tej sesji. Zakaz niedziel i swiat obowiazuje nadal, takze przy wymuszeniu.
  //
  // { podglad_na: "adres" } to tryb PODGLADU: wszystko liczy sie na prawdziwych danych
  // i grupuje po kierownikach dokladnie tak jak zwykle, ale kazda wiadomosc idzie na
  // podany adres zamiast do kierownika. Znacznik last_reminder_sent_at NIE jest wtedy
  // ruszany - inaczej podglad "zuzylby" dzisiejsze przypomnienie i prawdziwa wysylka
  // by sie nie odbyla. W dzienniku takie wpisy maja rodzaj 'przypomnienie_podglad',
  // zeby nie mieszaly sie z faktycznymi wysylkami do kierownikow.
  let wymuszone = false
  let podgladNa = ''
  try {
    const cialo = await req.json()
    wymuszone = cialo?.wymuszone === true
    podgladNa = String(cialo?.podglad_na ?? '').trim()
  } catch {
    wymuszone = false
  }
  const podglad = podgladNa !== ''
  if (podglad) wymuszone = true

  // Poniedzialek-sobota, z pominieciem swiat. Zadanie cron chodzi tez w te dni, ale
  // sprawdzamy to rowniez tutaj: dzien wolny zalezy od daty (Wielkanoc, Boze Cialo),
  // czego harmonogram cron nie wyrazi, a przy recznym wywolaniu crona i tak nie ma.
  const dzis = new Date()
  if (!wymuszone && godzinaWPolsce(dzis) !== GODZINA_WYSYLKI) {
    return new Response(JSON.stringify({
      wyslano: 0,
      powod: `nie ta godzina (w Polsce ${godzinaWPolsce(dzis)}:xx, wysylamy o ${GODZINA_WYSYLKI}:30)`,
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  if (dzis.getUTCDay() === 0) {
    return new Response(JSON.stringify({ wyslano: 0, powod: 'niedziela' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (dzienWolny(dzis)) {
    return new Response(JSON.stringify({ wyslano: 0, powod: 'dzien ustawowo wolny' }), {
      headers: { 'Content-Type': 'application/json' },
    })
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

  const progNiewyslane = new Date(Date.now() - ODSTEP_DNI * 86_400_000)
  const progPoprawki = new Date(Date.now() - ODSTEP_GODZIN_POPRAWKA * 3_600_000)

  // Ponaglamy WYLACZNIE najnowszy zaimportowany okres. Bez tego ograniczenia zadanie
  // sciagaloby kierownika takze za miesiace sprzed pol roku, mieszajac je w jednym
  // mailu z biezacym - a zalegly, stary miesiac to sprawa do wyjasnienia z ksiegowoscia,
  // nie do codziennego ponaglania automatem.
  const { data: najnowszy } = await supabase
    .from('monthly_logs')
    .select('rok, miesiac')
    .order('rok', { ascending: false })
    .order('miesiac', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!najnowszy) {
    return new Response(JSON.stringify({ wyslano: 0, powod: 'brak jakichkolwiek ewidencji' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Statusy oznaczajace "kierownik jeszcze tego nie oddal". Ewidencja wyslana do
  // akceptacji albo juz zaakceptowana wypada z przypomnien automatycznie.
  const { data: ewidencje, error } = await supabase
    .from('monthly_logs')
    .select('id, rok, miesiac, status, last_reminder_sent_at, powiadomienie_wyslane_at, utworzono, vehicles(nr_rejestracyjny, kierownik_id)')
    .eq('rok', najnowszy.rok)
    .eq('miesiac', najnowszy.miesiac)
    .in('status', ['wygenerowana', 'w_edycji', 'odeslana_do_poprawki'])

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const doWyslania = (ewidencje ?? []).filter((e) => {
    // Odstep liczymy od ostatniego przypomnienia, a jesli go nie bylo - od powiadomienia
    // o nowej ewidencji (albo od jej utworzenia, gdy powiadomienie nie poszlo).
    const odniesienie = e.last_reminder_sent_at ?? e.powiadomienie_wyslane_at ?? e.utworzono
    const prog = e.status === 'odeslana_do_poprawki' ? progPoprawki : progNiewyslane
    return new Date(odniesienie) < prog
  })

  // Pozycje rozdzielone na dwie listy, bo w mailu znacza co innego: jedna to "jeszcze
  // tego nie oddales", druga to "ksiegowosc odeslala i czeka na poprawke".
  const wgKierownika = new Map<string, {
    logi: string[]; pozycje: string[]; poprawki: string[]; pojazdy: string[]
  }>()
  for (const e of doWyslania) {
    const pojazd = (e as unknown as { vehicles: { nr_rejestracyjny: string; kierownik_id: string | null } }).vehicles
    if (!pojazd?.kierownik_id) continue
    const wpis = wgKierownika.get(pojazd.kierownik_id)
      ?? { logi: [], pozycje: [], poprawki: [], pojazdy: [] }
    wpis.logi.push(e.id)
    wpis.pojazdy.push(pojazd.nr_rejestracyjny)
    const opis = `${pojazd.nr_rejestracyjny} (${MIESIACE_PL[e.miesiac - 1]} ${e.rok})`
    if (e.status === 'odeslana_do_poprawki') wpis.poprawki.push(opis)
    else wpis.pozycje.push(opis)
    wgKierownika.set(pojazd.kierownik_id, wpis)
  }

  if (wgKierownika.size === 0) {
    return new Response(JSON.stringify({ wyslano: 0, powod: 'nic nie zalega' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const termin = terminRoboczy(2)
  let wyslano = 0

  for (const [kierownikId, wpis] of wgKierownika) {
    const { data: profil } = await supabase
      .from('profiles').select('email, imie_nazwisko').eq('id', kierownikId).single()
    if (!profil?.email) continue

    const lista = [...new Set(wpis.pozycje)].sort()
    const poprawki = [...new Set(wpis.poprawki)].sort()
    const pojazdy = [...new Set(wpis.pojazdy)].sort()

    // Poprawka jest pilniejsza od pierwszego wypelnienia - ksiegowosc juz czeka -
    // dlatego ona decyduje o temacie wiadomosci.
    const temat = poprawki.length
      ? 'Pilne: ewidencja przebiegu pojazdu odesłana do poprawki'
      : `Przypomnienie: uzupełnij ewidencję przebiegu pojazdu (termin: ${termin})`

    const tresc = [`Dzień dobry${profil.imie_nazwisko ? ', ' + profil.imie_nazwisko : ''},`, '']
    if (poprawki.length) {
      tresc.push(
        'księgowość odesłała do poprawki poniższe ewidencje przebiegu i czeka na zmiany:',
        ...poprawki.map((x) => `  - ${x}`),
        '',
        'Treść uwag księgowości widać w aplikacji, w nagłówku każdej z tych ewidencji.',
        'Po naniesieniu poprawek prosimy wysłać ewidencję ponownie do akceptacji.',
        '',
        'To przypomnienie będziemy powtarzać CODZIENNIE, dopóki ewidencja nie wróci',
        'do akceptacji.',
        '',
      )
    }
    if (lista.length) {
      tresc.push(
        'Poniższe ewidencje przebiegu nie zostały jeszcze wysłane do akceptacji:',
        ...lista.map((x) => `  - ${x}`),
        '',
        'Prosimy o uzupełnienie celu wyjazdu oraz imienia i nazwiska osoby kierującej',
        `pojazdem, podpisanie i wysłanie do akceptacji w terminie do ${termin}`,
        '(dwa dni robocze).',
        '',
        'Jeżeli ewidencja nie zostanie wysłana, przypomnienie powtórzymy za dwa dni.',
        '',
      )
    }
    tresc.push(`Aplikacja: ${ADRES_APLIKACJI}`, '', 'Pozdrawiamy,', 'automat Bioerg')

    // W podgladzie nie dublujemy kopii - i tak wszystko idzie na ten jeden adres.
    const odbiorca = podglad ? podgladNa : profil.email
    const kopia = podglad || profil.email === KOPIA_PRZYPOMNIEN ? null : KOPIA_PRZYPOMNIEN
    // Prefiks z adresem kierownika, zeby w podgladzie bylo widac, czyj to mial byc mail.
    const tematWysylki = podglad ? `[PODGLĄD dla ${profil.email}] ${temat}` : temat
    const wpisDziennika = {
      rodzaj: podglad ? 'przypomnienie_podglad' : 'przypomnienie',
      adresat: odbiorca,
      adresat_nazwa: profil.imie_nazwisko,
      profil_id: kierownikId,
      kopia,
      temat: tematWysylki,
      pojazdy,
      rok: najnowszy.rok,
      miesiac: najnowszy.miesiac,
    }
    try {
      await wyslijMaila({
        host: SMTP_HOST,
        port: SMTP_PORT,
        login: SMTP_LOGIN,
        haslo: SMTP_HASLO,
        od: SMTP_LOGIN,
        do_: odbiorca,
        // Nie dubluj, gdyby ponaglany byl sam adres kopii.
        kopia,
        temat: tematWysylki,
        tresc: tresc.join('\n'),
      })
      // Podglad nie zuzywa dzisiejszego przypomnienia - prawdziwa wysylka musi sie odbyc.
      if (!podglad) {
        await supabase.from('monthly_logs')
          .update({ last_reminder_sent_at: new Date().toISOString() }).in('id', wpis.logi)
      }
      await zapiszWDzienniku(supabase, { ...wpisDziennika, status: 'wyslany' })
      wyslano++
    } catch (err) {
      console.error(`Nie udalo sie wyslac przypomnienia do ${profil.email}:`, err)
      await zapiszWDzienniku(supabase, {
        ...wpisDziennika, status: 'blad', blad: opisBledu(err),
      })
    }
  }

  return new Response(JSON.stringify({
    wyslano, termin, podglad: podglad ? podgladNa : undefined,
    okres: `${najnowszy.rok}-${String(najnowszy.miesiac).padStart(2, '0')}`,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
