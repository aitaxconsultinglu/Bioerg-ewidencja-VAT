// Wysyła kierownikowi e-mail z komentarzem księgowości po odesłaniu ewidencji do
// poprawki. Sam komentarz jest już zapisany w bazie i widoczny w aplikacji - ta funkcja
// tylko go dostarcza mailem, więc jej błąd nie cofa odesłania do poprawki.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const MIESIACE_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

Deno.serve(async (req) => {
  const { log_id } = await req.json()
  if (!log_id) {
    return new Response(JSON.stringify({ error: 'Brak log_id' }), { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: e } = await supabase
    .from('monthly_logs')
    .select('rok, miesiac, komentarz_ksiegowosci, vehicles(nr_rejestracyjny, kierownik_id)')
    .eq('id', log_id)
    .single()

  const pojazd = (e as any)?.vehicles
  if (!e || !pojazd?.kierownik_id) {
    return new Response(JSON.stringify({ error: 'Nie znaleziono kierownika' }), { status: 404 })
  }

  const { data: profil } = await supabase
    .from('profiles').select('email, imie_nazwisko').eq('id', pojazd.kierownik_id).single()
  if (!profil?.email) {
    return new Response(JSON.stringify({ error: 'Kierownik bez adresu e-mail' }), { status: 404 })
  }

  const okres = `${MIESIACE_PL[e.miesiac - 1]} ${e.rok}`
  const klient = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 587,
      tls: false,
      auth: { username: Deno.env.get('EMAIL_USER')!, password: Deno.env.get('EMAIL_PASS')! },
    },
  })

  await klient.send({
    from: Deno.env.get('EMAIL_USER')!,
    to: profil.email,
    subject: `Ewidencja przebiegu pojazdu ${pojazd.nr_rejestracyjny} za ${okres} - odesłana do poprawki`,
    content: [
      `Dzień dobry${profil.imie_nazwisko ? ', ' + profil.imie_nazwisko : ''},`,
      '',
      `księgowość odesłała do poprawki ewidencję przebiegu pojazdu ${pojazd.nr_rejestracyjny} za ${okres}.`,
      '',
      'Komentarz księgowości:',
      e.komentarz_ksiegowosci ?? '(brak treści komentarza)',
      '',
      'Prosimy o naniesienie poprawek i ponowne wysłanie ewidencji do akceptacji.',
      '',
      'Pozdrawiamy,',
      'AI Tax Consulting Sp. z o.o.',
    ].join('\n'),
  })
  await klient.close()

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
