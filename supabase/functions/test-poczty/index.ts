// Diagnostyka skrzynki nadawczej: wysyla JEDEN przykladowy mail na podany adres
// i zwraca doslowny blad SMTP, jesli sie nie uda. Osobna funkcja, zeby sprawdzic
// konfiguracje bez ponaglania calej floty. Przydaje sie po kazdej zmianie skrzynki,
// hasla albo serwera.
//
// Uzyty serwer i nadawca sa w ODPOWIEDZI funkcji, a nie w tresci maila.
//
// TYLKO DLA WOLAJACEGO SERWISOWEGO. Do 2026-10-21 funkcja przyjmowala dowolny adres
// od kazdego, kto mial klucz publishable - a ten klucz jest w paczce JavaScript
// aplikacji, czyli zna go kazdy. Byl to otwarty przekaznik poczty: dowolna osoba mogla
// wysylac wiadomosci z firmowej skrzynki na dowolny adres. Tresc jest tu stala, wiec
// nie dalo sie wysylac czegokolwiek, ale sama mozliwosc wysylki z firmowego adresu
// wystarcza do nadużycia (i do zepsucia reputacji domeny).
import { wyslijMaila } from './poczta.ts'
import {
  czyZapytanieWstepne, odpowiedzJSON, odpowiedzWstepna, tylkoSerwis, ustalWolajacego,
} from './brama.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// trim(): wartosci sekretow wkleja sie recznie, a spacja na koncu jest w panelu
// niewidoczna. Potwierdzone 2026-10-21 - SMTP_HOST mial koncowa spacje i wysylka
// padala na "invalid char found in FQDN". Hasla NIE obcinamy, zeby nie zepsuc
// logowania bez sladu; raportujemy tylko jego dlugosc.
const HOST = (Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com').trim()
const PORT = Number((Deno.env.get('SMTP_PORT') ?? '465').trim())
const LOGIN = (Deno.env.get('EMAIL_USER') ?? '').trim()
const HASLO = Deno.env.get('EMAIL_PASS') ?? ''

Deno.serve(async (req) => {
  if (czyZapytanieWstepne(req)) return odpowiedzWstepna()

  const serwisowy = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const odmowa = tylkoSerwis(await ustalWolajacego(req, serwisowy))
  if (odmowa) return odmowa

  let adres = ''
  try {
    const c = await req.json()
    adres = String(c?.do ?? '').trim()
  } catch { /* brak ciala */ }
  if (!adres) return odpowiedzJSON({ error: 'Podaj adres w polu do' }, 400)

  const konf = {
    host: HOST,
    port: PORT,
    login: LOGIN || 'BRAK',
    haslo: HASLO ? `ustawione (${HASLO.length} zn.)` : 'BRAK',
  }
  if (!LOGIN || !HASLO) return odpowiedzJSON({ ok: false, powod: 'brak sekretow', konf }, 500)

  try {
    await wyslijMaila({
      host: HOST, port: PORT, login: LOGIN, haslo: HASLO,
      od: LOGIN, do_: adres,
      temat: 'Test skrzynki nadawczej - ewidencja przebiegu pojazdu',
      tresc: [
        'Dzień dobry,',
        '',
        'to wiadomość testowa z automatu ewidencji przebiegu pojazdu.',
        'Jeżeli widzisz ją poprawnie - razem z polskimi znakami w temacie',
        'i w treści - skrzynka nadawcza jest skonfigurowana dobrze.',
        '',
        'Ta wiadomość nie dotyczy żadnej konkretnej ewidencji ani pojazdu.',
        '',
        'Pozdrawiamy,',
        'automat ewidencji przebiegu pojazdu',
      ].join('\n'),
    })
    return odpowiedzJSON({ ok: true, wyslano_na: adres, konf })
  } catch (err) {
    const opis = err instanceof Error ? err.message : String(err)
    return odpowiedzJSON({ ok: false, blad: opis, konf }, 502)
  }
})
