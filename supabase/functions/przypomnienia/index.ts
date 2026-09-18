// Codzienne przypomnienie dla kierownika, który nie wysłał jeszcze ewidencji do
// akceptacji. Uruchamiane przez pg_cron raz dziennie - patrz migracja
// harmonogram_przypomnien. Jedna ewidencja = najwyżej jedno przypomnienie na dobę.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const MIESIACE_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

const DNI_ZWLOKI = 2

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const prog = new Date(Date.now() - DNI_ZWLOKI * 86_400_000).toISOString()
  const poczatekDnia = new Date()
  poczatekDnia.setHours(0, 0, 0, 0)

  const { data: ewidencje, error } = await supabase
    .from('monthly_logs')
    .select('id, rok, miesiac, last_reminder_sent_at, vehicles(nr_rejestracyjny, kierownik_id)')
    .in('status', ['wygenerowana', 'w_edycji', 'odeslana_do_poprawki'])
    .lt('utworzono', prog)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  const doWyslania = (ewidencje ?? []).filter((e: any) =>
    !e.last_reminder_sent_at || new Date(e.last_reminder_sent_at) < poczatekDnia
  )

  if (doWyslania.length === 0) {
    return new Response(JSON.stringify({ wyslano: 0 }), {
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

  let wyslano = 0
  for (const e of doWyslania) {
    const pojazd = (e as any).vehicles
    if (!pojazd?.kierownik_id) continue

    const { data: profil } = await supabase
      .from('profiles').select('email, imie_nazwisko').eq('id', pojazd.kierownik_id).single()
    if (!profil?.email) continue

    const okres = `${MIESIACE_PL[e.miesiac - 1]} ${e.rok}`
    try {
      await klient.send({
        from: Deno.env.get('EMAIL_USER')!,
        to: profil.email,
        subject: `Przypomnienie: uzupełnij ewidencję przebiegu pojazdu ${pojazd.nr_rejestracyjny} za ${okres}`,
        content: [
          `Dzień dobry${profil.imie_nazwisko ? ', ' + profil.imie_nazwisko : ''},`,
          '',
          `ewidencja przebiegu pojazdu ${pojazd.nr_rejestracyjny} za ${okres} nadal czeka na uzupełnienie`,
          'i wysłanie do akceptacji. Prosimy o uzupełnienie celu wyjazdu oraz imienia i nazwiska',
          'osoby kierującej pojazdem.',
          '',
          'Pozdrawiamy,',
          'AI Tax Consulting Sp. z o.o.',
        ].join('\n'),
      })
      await supabase.from('monthly_logs')
        .update({ last_reminder_sent_at: new Date().toISOString() }).eq('id', e.id)
      wyslano++
    } catch (err) {
      console.error(`Nie udało się wysłać przypomnienia dla ${pojazd.nr_rejestracyjny}:`, err)
    }
  }

  await klient.close()
  return new Response(JSON.stringify({ wyslano }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
