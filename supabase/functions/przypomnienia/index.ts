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

/** Termin wyznaczany w dniach ROBOCZYCH - przypomnienie wysłane w piątek daje czas
 *  do wtorku, a nie do niedzieli. */
function terminRoboczy(dniRoboczych: number) {
  const d = new Date()
  let dodane = 0
  while (dodane < dniRoboczych) {
    d.setDate(d.getDate() + 1)
    const dzien = d.getDay()
    if (dzien !== 0 && dzien !== 6) dodane++
  }
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const prog = new Date(Date.now() - ODSTEP_DNI * 86_400_000)

  // Statusy oznaczajace "kierownik jeszcze tego nie oddal". Ewidencja wyslana do
  // akceptacji albo juz zaakceptowana wypada z przypomnien automatycznie.
  const { data: ewidencje, error } = await supabase
    .from('monthly_logs')
    .select('id, rok, miesiac, status, last_reminder_sent_at, powiadomienie_wyslane_at, utworzono, vehicles(nr_rejestracyjny, kierownik_id)')
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
  return new Response(JSON.stringify({ wyslano, termin }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
