// Przypomnienie o spisaniu stanu licznika - ostatniego dnia miesiaca o 13:00.
//
// PO CO. Od ewidencji za listopad 2026 odczyt licznika na ostatni dzien miesiaca jest
// elementem OBOWIAZKOWYM: bez niego (wraz z godzina odczytu i zdjeciem licznika) nie da
// sie wyslac ewidencji do akceptacji. Kierownik musi wiec spisac licznik tego samego
// dnia - przypomnienie o 13:00 daje mu na to resztę dnia roboczego, a jednoczesnie jest
// na tyle pozno, ze wiekszosc kursow juz sie odbyla.
//
// Przypominamy TYLKO o pojazdach, ktore odczytu jeszcze nie maja - kto wpisal go rano,
// nie dostaje maila. Dzien wolny nie zwalnia z odczytu (miesiac konczy sie niezaleznie
// od kalendarza swiat), wiec w odroznieniu od przypomnien o uzupelnianiu ewidencji
// wysylamy to takze w soboty, niedziele i swieta.
//
// Kazda wysylka - udana i nieudana - trafia do dziennika email_log.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { opisBledu, zapiszWDzienniku } from './dziennik.ts'
import { wyslijMaila } from './poczta.ts'
import { odczekaj, odstepSekund, stopkaMaila, wczytajUstawienia } from './ustawienia.ts'
import {
  czyZapytanieWstepne, odpowiedzJSON, odpowiedzWstepna, tylkoSerwis, ustalWolajacego,
} from './brama.ts'

const SMTP_HOST = (Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com').trim()
const SMTP_PORT = Number((Deno.env.get('SMTP_PORT') ?? '465').trim())
const SMTP_LOGIN = (Deno.env.get('EMAIL_USER') ?? '').trim()
const SMTP_HASLO = Deno.env.get('EMAIL_PASS') ?? ''

/** O ktorej godzinie CZASU POLSKIEGO wychodzi przypomnienie. */
const GODZINA_WYSYLKI = 13

function brakKonfiguracjiSMTP() {
  if (SMTP_LOGIN && SMTP_HASLO) return null
  return `Brak konfiguracji skrzynki nadawczej: ` +
    `EMAIL_USER ${SMTP_LOGIN ? 'ustawiony' : 'BRAK'}, ` +
    `EMAIL_PASS ${SMTP_HASLO ? 'ustawiony' : 'BRAK'}.`
}

/** Data w strefie Europe/Warsaw jako 'RRRR-MM-DD'. pg_cron zna wylacznie UTC, a nas
 *  obowiazuje doba polska - ostatni dzien miesiaca liczy sie tutaj, nie w Greenwich. */
function dzisPL(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function godzinaPL(d = new Date()) {
  return Number(new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false,
  }).format(d))
}

/** Czy podany dzien (RRRR-MM-DD) jest ostatnim dniem swojego miesiaca. */
function ostatniDzienMiesiaca(iso: string) {
  const [rok, miesiac, dzien] = iso.split('-').map(Number)
  return dzien === new Date(Date.UTC(rok, miesiac, 0)).getUTCDate()
}

Deno.serve(async (req) => {
  if (czyZapytanieWstepne(req)) return odpowiedzWstepna()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const odmowa = tylkoSerwis(await ustalWolajacego(req, supabase))
  if (odmowa) return odmowa

  // { wymuszone: true } pomija warunek dnia i godziny - do recznego uruchomienia.
  // { podglad_na: "adres" } liczy wszystko na prawdziwych danych, ale kazda wiadomosc
  // kieruje na podany adres zamiast do kierownika; w dzienniku ma wtedy osobny rodzaj.
  let wymuszone = false
  let podgladNa = ''
  try {
    const cialo = await req.json()
    wymuszone = cialo?.wymuszone === true
    podgladNa = String(cialo?.podglad_na ?? '').trim()
  } catch { /* puste cialo - zwykle wywolanie z crona */ }
  const podglad = podgladNa !== ''
  if (podglad) wymuszone = true

  const dzien = dzisPL()
  if (!wymuszone) {
    if (godzinaPL() !== GODZINA_WYSYLKI) {
      return odpowiedzJSON({
        wyslano: 0,
        powod: `nie ta godzina (w Polsce ${godzinaPL()}:xx, wysylamy o ${GODZINA_WYSYLKI}:00)`,
      })
    }
    if (!ostatniDzienMiesiaca(dzien)) {
      return odpowiedzJSON({ wyslano: 0, powod: `${dzien} to nie ostatni dzien miesiaca` })
    }
  }

  const brak = brakKonfiguracjiSMTP()
  if (brak) {
    console.error(brak)
    return odpowiedzJSON({ wyslano: 0, powod: brak }, 500)
  }

  const ust = await wczytajUstawienia(supabase)

  // Pojazdy objete ewidencja to te, ktore maja ewidencje za NAJNOWSZY zaimportowany
  // okres. Ewidencji za biezacy miesiac jeszcze nie ma (powstaje pierwszego dnia
  // nastepnego), wiec po niej nie da sie tego ustalic - a lista pojazdow w rejestrze
  // floty zmienia sie rzadko i ten sposob sam odsiewa auta wykreslone z ewidencji.
  const { data: najnowszy } = await supabase
    .from('monthly_logs').select('rok, miesiac')
    .order('rok', { ascending: false }).order('miesiac', { ascending: false })
    .limit(1).maybeSingle()
  if (!najnowszy) return odpowiedzJSON({ wyslano: 0, powod: 'brak jakichkolwiek ewidencji' })

  const { data: logi, error } = await supabase
    .from('monthly_logs')
    .select('vehicle_id, vehicles(id, nr_rejestracyjny, kierownik_id)')
    .eq('rok', najnowszy.rok).eq('miesiac', najnowszy.miesiac)
  if (error) return odpowiedzJSON({ error: error.message }, 500)

  // Pojazdy, dla ktorych odczyt na dzis juz jest - o nich nie przypominamy.
  const { data: maja } = await supabase
    .from('odczyty_licznika').select('vehicle_id').eq('data_odczytu', dzien)
  const juzMa = new Set((maja ?? []).map((o: { vehicle_id: string }) => o.vehicle_id))

  const wgKierownika = new Map<string, string[]>()
  for (const l of logi ?? []) {
    const p = (l as unknown as {
      vehicles: { id: string; nr_rejestracyjny: string; kierownik_id: string | null }
    }).vehicles
    if (!p?.kierownik_id || juzMa.has(p.id)) continue
    const lista = wgKierownika.get(p.kierownik_id) ?? []
    lista.push(p.nr_rejestracyjny)
    wgKierownika.set(p.kierownik_id, lista)
  }

  if (wgKierownika.size === 0) {
    return odpowiedzJSON({ wyslano: 0, powod: 'wszystkie pojazdy maja juz odczyt na dzis' })
  }

  const odstep = odstepSekund(ust, wgKierownika.size)
  let pierwsza = true
  let wyslano = 0

  for (const [kierownikId, pojazdyNieposortowane] of wgKierownika) {
    const { data: profil } = await supabase
      .from('profiles').select('email, imie_nazwisko, bez_powiadomien')
      .eq('id', kierownikId).single()
    if (!profil?.email || profil.bez_powiadomien) continue

    if (!pierwsza) await odczekaj(odstep)
    pierwsza = false

    const pojazdy = [...new Set(pojazdyNieposortowane)].sort()
    const temat = 'Dziś spisz stan licznika - ostatni dzień miesiąca'

    // Krotko i konkretnie: co zrobic, dla ktorych aut, i dlaczego dzis.
    const tresc = [
      `Dzień dobry${profil.imie_nazwisko ? ', ' + profil.imie_nazwisko : ''},`,
      '',
      'dziś ostatni dzień miesiąca - prosimy spisać stan licznika:',
      ...pojazdy.map((p) => `  - ${p}`),
      '',
      'Co zrobić: zrobić zdjęcie licznika i wpisać jego stan w aplikacji,',
      'w panelu "Odczyt licznika" na górze ewidencji pojazdu. Potrzebne są',
      'trzy rzeczy: stan licznika w pełnych kilometrach, godzina odczytu',
      'i zdjęcie licznika.',
      '',
      'Bez tego ewidencji za ten miesiąc nie da się wysłać do akceptacji.',
      '',
      ...stopkaMaila(ust),
    ]

    const odbiorca = podglad ? podgladNa : profil.email
    const kopia = podglad || profil.email === ust.kopiaPowiadomien ? null : ust.kopiaPowiadomien
    const tematWysylki = podglad ? `[PODGLĄD dla ${profil.email}] ${temat}` : temat
    const wpisDziennika = {
      rodzaj: podglad ? 'przypomnienie_licznik_podglad' : 'przypomnienie_licznik',
      adresat: odbiorca,
      adresat_nazwa: profil.imie_nazwisko,
      profil_id: kierownikId,
      kopia,
      temat: tematWysylki,
      pojazdy,
      rok: Number(dzien.slice(0, 4)),
      miesiac: Number(dzien.slice(5, 7)),
    }
    try {
      await wyslijMaila({
        host: SMTP_HOST, port: SMTP_PORT, login: SMTP_LOGIN, haslo: SMTP_HASLO,
        od: SMTP_LOGIN, do_: odbiorca, kopia,
        temat: tematWysylki, tresc: tresc.join('\n'),
      })
      await zapiszWDzienniku(supabase, { ...wpisDziennika, status: 'wyslany' })
      wyslano++
    } catch (err) {
      console.error(`Nie udalo sie wyslac przypomnienia o liczniku do ${profil.email}:`, err)
      await zapiszWDzienniku(supabase, {
        ...wpisDziennika, status: 'blad', blad: opisBledu(err),
      })
    }
  }

  return odpowiedzJSON({
    wyslano, dzien, odstep_s: odstep, podglad: podglad ? podgladNa : undefined,
  })
})
