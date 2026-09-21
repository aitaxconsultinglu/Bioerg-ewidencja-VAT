// Powiadomienie wysylane raz w miesiacu, zaraz po zaimportowaniu danych z Teltronica:
// "ewidencja za <miesiac> czeka na uzupelnienie". Jeden mail na kierownika, ze spisem
// jego pojazdow - nie jeden mail na pojazd.
//
// Zastepuje dotychczasowa wysylke arkusza .xlsx: caly obieg jest teraz w aplikacji,
// a mail sluzy juz tylko do zawiadomienia, ze jest co robic.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const MIESIACE_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

const ADRES_APLIKACJI = 'https://aitaxconsultinglu.github.io/Bioerg-ewidencja-VAT/'

Deno.serve(async (req) => {
  const { rok, miesiac } = await req.json()
  if (!rok || !miesiac) {
    return new Response(JSON.stringify({ error: 'Podaj rok i miesiac.' }), { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: ewidencje, error } = await supabase
    .from('monthly_logs')
    .select('id, vehicles(nr_rejestracyjny, kierownik_id)')
    .eq('rok', rok)
    .eq('miesiac', miesiac)
    .is('powiadomienie_wyslane_at', null)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  // Grupowanie po kierowniku: jeden mail z lista pojazdow zamiast kilku osobnych.
  const wgKierownika = new Map<string, { logi: string[]; pojazdy: string[] }>()
  for (const e of ewidencje ?? []) {
    const pojazd = (e as unknown as { vehicles: { nr_rejestracyjny: string; kierownik_id: string | null } }).vehicles
    if (!pojazd?.kierownik_id) continue
    const wpis = wgKierownika.get(pojazd.kierownik_id) ?? { logi: [], pojazdy: [] }
    wpis.logi.push(e.id)
    wpis.pojazdy.push(pojazd.nr_rejestracyjny)
    wgKierownika.set(pojazd.kierownik_id, wpis)
  }

  if (wgKierownika.size === 0) {
    return new Response(JSON.stringify({ wyslano: 0, powod: 'brak nowych ewidencji z kierownikiem' }), {
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

  const okres = `${MIESIACE_PL[miesiac - 1]} ${rok}`
  let wyslano = 0

  for (const [kierownikId, wpis] of wgKierownika) {
    const { data: profil } = await supabase
      .from('profiles').select('email, imie_nazwisko').eq('id', kierownikId).single()
    if (!profil?.email) continue

    const lista = [...new Set(wpis.pojazdy)].sort()
    try {
      await klient.send({
        from: Deno.env.get('EMAIL_USER')!,
        to: profil.email,
        subject: `Ewidencja przebiegu pojazdu za ${okres} czeka na uzupełnienie`,
        content: [
          `Dzień dobry${profil.imie_nazwisko ? ', ' + profil.imie_nazwisko : ''},`,
          '',
          `ewidencja przebiegu za ${okres} została wygenerowana z danych GPS i czeka na`,
          'uzupełnienie w aplikacji.',
          '',
          lista.length === 1 ? 'Dotyczy pojazdu:' : 'Dotyczy pojazdów:',
          ...lista.map((r) => `  - ${r}`),
          '',
          'Do uzupełnienia: cel wyjazdu oraz imię i nazwisko osoby kierującej pojazdem.',
          'Po uzupełnieniu podpisz ewidencję i wyślij ją do akceptacji.',
          '',
          ADRES_APLIKACJI,
          '',
          'Pozdrawiamy,',
          'AI Tax Consulting Sp. z o.o.',
        ].join('\n'),
      })
      await supabase.from('monthly_logs')
        .update({ powiadomienie_wyslane_at: new Date().toISOString() })
        .in('id', wpis.logi)
      wyslano++
    } catch (err) {
      console.error(`Nie udalo sie powiadomic ${profil.email}:`, err)
    }
  }

  await klient.close()
  return new Response(JSON.stringify({ wyslano, kierownikow: wgKierownika.size }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
