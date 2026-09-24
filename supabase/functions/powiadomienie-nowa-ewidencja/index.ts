// Powiadomienie "ewidencja za poprzedni miesiac jest gotowa". Uruchamiane przez pg_cron
// 2. dnia miesiaca, juz po nocnym przebiegu potoku z 1. dnia.
//
// Kierownik dostaje spis SWOICH pojazdow, ksiegowosc - zbiorcze zestawienie. Bez rok/
// miesiac w zadaniu funkcja sama liczy poprzedni miesiac, wiec zadanie cron nie musi
// znac daty.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const MIESIACE_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

const ADRES_APLIKACJI = 'https://aitaxconsultinglu.github.io/Bioerg-ewidencja-VAT/'

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
      hostname: 'smtp.gmail.com',
      port: 587,
      tls: false,
      auth: { username: Deno.env.get('EMAIL_USER')!, password: Deno.env.get('EMAIL_PASS')! },
    },
  })

  const nadawca = Deno.env.get('EMAIL_USER')!
  const okres = `${MIESIACE_PL[miesiac - 1]} ${rok}`
  let doKierownikow = 0
  let doKsiegowosci = 0

  for (const [kierownikId, wpis] of wgKierownika) {
    const { data: profil } = await supabase
      .from('profiles').select('email, imie_nazwisko').eq('id', kierownikId).single()
    if (!profil?.email) continue

    const lista = [...new Set(wpis.pojazdy)].sort()
    try {
      await klient.send({
        from: nadawca,
        to: profil.email,
        subject: `Ewidencja przebiegu pojazdu za ${okres} jest gotowa do uzupełnienia`,
        content: [
          `Dzień dobry${profil.imie_nazwisko ? ', ' + profil.imie_nazwisko : ''},`,
          '',
          `ewidencja przebiegu za ${okres} została wygenerowana z danych GPS i czeka na`,
          'uzupełnienie oraz weryfikację.',
          '',
          lista.length === 1 ? 'Dotyczy pojazdu:' : 'Dotyczy pojazdów:',
          ...lista.map((r) => `  - ${r}`),
          '',
          'Prosimy o uzupełnienie dwóch kolumn:',
          '  - Cel wyjazdu',
          '  - Imię i nazwisko osoby kierującej pojazdem',
          '',
          'Pozostałe dane (data, trasa, liczba kilometrów) pochodzą z GPS i są już wypełnione.',
          'Po uzupełnieniu prosimy podpisać ewidencję i wysłać ją do akceptacji.',
          '',
          `Aplikacja: ${ADRES_APLIKACJI}`,
          '',
          'Pozdrawiamy,',
          'AI Tax Consulting Sp. z o.o.',
        ].join('\n'),
      })
      await supabase.from('monthly_logs')
        .update({ powiadomienie_wyslane_at: new Date().toISOString() }).in('id', wpis.logi)
      doKierownikow++
    } catch (err) {
      console.error(`Nie udalo sie powiadomic kierownika ${profil.email}:`, err)
    }
  }

  // Ksiegowosc dostaje jedno zbiorcze zawiadomienie, ze miesiac zostal zaimportowany.
  const { data: ksiegowi } = await supabase
    .from('profiles').select('email, imie_nazwisko').eq('rola', 'ksiegowosc')

  for (const k of ksiegowi ?? []) {
    if (!k.email) continue
    try {
      await klient.send({
        from: nadawca,
        to: k.email,
        subject: `Ewidencja przebiegu pojazdów za ${okres} - zaimportowana`,
        content: [
          'Dzień dobry,',
          '',
          `ewidencja przebiegu za ${okres} została wygenerowana z danych GPS i udostępniona`,
          `kierownikom do uzupełnienia. Dotyczy ${ewidencje.length} pojazdów.`,
          '',
          'Kierownicy zostali poproszeni o uzupełnienie celu wyjazdu oraz imienia i nazwiska',
          'osoby kierującej pojazdem, a następnie o wysłanie ewidencji do akceptacji.',
          '',
          `Aplikacja: ${ADRES_APLIKACJI}`,
          '',
          'Pozdrawiamy,',
          'AI Tax Consulting Sp. z o.o.',
        ].join('\n'),
      })
      doKsiegowosci++
    } catch (err) {
      console.error(`Nie udalo sie powiadomic ksiegowosci ${k.email}:`, err)
    }
  }

  await klient.close()
  return new Response(JSON.stringify({ okres, doKierownikow, doKsiegowosci }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
