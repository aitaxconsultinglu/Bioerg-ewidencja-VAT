// Przypomnienie co dwa dni dla kierownikow, ktorzy nie wyslali jeszcze ewidencji do
// akceptacji. Zadanie cron chodzi codziennie, ale mail wychodzi dopiero gdy od
// poprzedniego minely 2 dni - dzieki temu odstep liczy sie od OSTATNIEGO przypomnienia
// dla danej ewidencji, a nie od sztywnego dnia tygodnia.
//
// Ksiegowosc nie dostaje przypomnien: to kierownik ma cos do zrobienia.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const MIESIACE_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

const ADRES_APLIKACJI = 'https://aitaxconsultinglu.github.io/Bioerg-ewidencja-VAT/'
const ODSTEP_DNI = 2

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

Deno.serve(async () => {
  // Poniedzialek-sobota, z pominieciem swiat. Zadanie cron chodzi tez w te dni, ale
  // sprawdzamy to rowniez tutaj: dzien wolny zalezy od daty (Wielkanoc, Boze Cialo),
  // czego harmonogram cron nie wyrazi, a przy recznym wywolaniu crona i tak nie ma.
  const dzis = new Date()
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const prog = new Date(Date.now() - ODSTEP_DNI * 86_400_000)

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
    return new Date(odniesienie) < prog
  })

  const wgKierownika = new Map<string, { logi: string[]; pozycje: string[] }>()
  for (const e of doWyslania) {
    const pojazd = (e as unknown as { vehicles: { nr_rejestracyjny: string; kierownik_id: string | null } }).vehicles
    if (!pojazd?.kierownik_id) continue
    const wpis = wgKierownika.get(pojazd.kierownik_id) ?? { logi: [], pozycje: [] }
    wpis.logi.push(e.id)
    wpis.pozycje.push(`${pojazd.nr_rejestracyjny} (${MIESIACE_PL[e.miesiac - 1]} ${e.rok})`)
    wgKierownika.set(pojazd.kierownik_id, wpis)
  }

  if (wgKierownika.size === 0) {
    return new Response(JSON.stringify({ wyslano: 0, powod: 'nic nie zalega' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const klient = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 587,
      tls: false,
      auth: { username: Deno.env.get('EMAIL_USER')!, password: Deno.env.get('EMAIL_PASS')! },
    },
  })

  const termin = terminRoboczy(2)
  let wyslano = 0

  for (const [kierownikId, wpis] of wgKierownika) {
    const { data: profil } = await supabase
      .from('profiles').select('email, imie_nazwisko').eq('id', kierownikId).single()
    if (!profil?.email) continue

    const lista = [...new Set(wpis.pozycje)].sort()
    try {
      await klient.send({
        from: Deno.env.get('EMAIL_USER')!,
        to: profil.email,
        // Nie dubluj, gdyby ponaglany byl sam adres kopii.
        cc: profil.email === KOPIA_PRZYPOMNIEN ? undefined : KOPIA_PRZYPOMNIEN,
        subject: `Przypomnienie: uzupełnij ewidencję przebiegu pojazdu (termin: ${termin})`,
        content: [
          `Dzień dobry${profil.imie_nazwisko ? ', ' + profil.imie_nazwisko : ''},`,
          '',
          'przypominamy, że poniższe ewidencje przebiegu nie zostały jeszcze wysłane',
          'do akceptacji:',
          ...lista.map((p) => `  - ${p}`),
          '',
          'Prosimy o uzupełnienie celu wyjazdu oraz imienia i nazwiska osoby kierującej',
          `pojazdem, podpisanie i wysłanie do akceptacji w terminie do ${termin}`,
          '(dwa dni robocze).',
          '',
          `Aplikacja: ${ADRES_APLIKACJI}`,
          '',
          'Jeżeli ewidencja nie zostanie wysłana, przypomnienie powtórzymy za dwa dni.',
          '',
          'Pozdrawiamy,',
          'AI Tax Consulting Sp. z o.o.',
        ].join('\n'),
      })
      await supabase.from('monthly_logs')
        .update({ last_reminder_sent_at: new Date().toISOString() }).in('id', wpis.logi)
      wyslano++
    } catch (err) {
      console.error(`Nie udalo sie wyslac przypomnienia do ${profil.email}:`, err)
    }
  }

  await klient.close()
  return new Response(JSON.stringify({
    wyslano, termin, okres: `${najnowszy.rok}-${String(najnowszy.miesiac).padStart(2, '0')}`,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
