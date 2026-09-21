// Zakladanie i usuwanie kont. Operacje na auth.users wymagaja klucza service_role,
// ktory nie moze trafic do przegladarki - dlatego siedzi wylacznie tutaj, a funkcja
// sama sprawdza, czy wywolujacy jest ksiegowoscia. Sam fakt posiadania waznego tokenu
// NIE wystarcza: token kierownika przejdzie weryfikacje JWT, ale zostanie odrzucony
// przy sprawdzeniu roli.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const NAGLOWKI_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function odpowiedz(tresc: unknown, status = 200) {
  return new Response(JSON.stringify(tresc), {
    status,
    headers: { ...NAGLOWKI_CORS, 'Content-Type': 'application/json' },
  })
}

/** Haslo tymczasowe spelniajace wymagania aplikacji: min. 6 znakow, min. 1 specjalny. */
function hasloTymczasowe() {
  const znaki = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const losowe = new Uint32Array(8)
  crypto.getRandomValues(losowe)
  const rdzen = [...losowe].map((n) => znaki[n % znaki.length]).join('')
  return `Bioerg-${rdzen}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: NAGLOWKI_CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const serwisowy = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const naglowek = req.headers.get('Authorization')
  if (!naglowek) return odpowiedz({ error: 'Brak autoryzacji' }, 401)

  const { data: { user } } = await createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: naglowek } },
  }).auth.getUser()
  if (!user) return odpowiedz({ error: 'Brak autoryzacji' }, 401)

  const { data: profilWolajacego } = await serwisowy
    .from('profiles').select('rola').eq('id', user.id).single()
  if (profilWolajacego?.rola !== 'ksiegowosc') {
    return odpowiedz({ error: 'Tylko księgowość może zarządzać kontami.' }, 403)
  }

  const { akcja, email, imie_nazwisko, rola, user_id } = await req.json()

  if (akcja === 'dodaj') {
    const adres = String(email ?? '').trim().toLowerCase()
    if (!adres.includes('@')) return odpowiedz({ error: 'Nieprawidłowy adres e-mail.' }, 400)
    if (!String(imie_nazwisko ?? '').trim()) {
      return odpowiedz({ error: 'Podaj imię i nazwisko.' }, 400)
    }
    const rolaDocelowa = rola === 'ksiegowosc' ? 'ksiegowosc' : 'kierownik'
    const haslo = hasloTymczasowe()

    // Wpis na liscie dostepu MUSI powstac przed kontem: wyzwalacz przy zakladaniu
    // uzytkownika czyta z niej role i nazwisko, a takze podpina czekajace pojazdy.
    const { error: bladListy } = await serwisowy.from('uprawnienia_startowe').upsert({
      email: adres, imie_nazwisko: String(imie_nazwisko).trim(), rola: rolaDocelowa,
    })
    if (bladListy) return odpowiedz({ error: bladListy.message }, 400)

    const { error } = await serwisowy.auth.admin.createUser({
      email: adres,
      password: haslo,
      email_confirm: true,
    })
    if (error) return odpowiedz({ error: error.message }, 400)

    // Haslo wraca JEDEN raz, do przekazania pracownikowi. Nigdzie go nie zapisujemy -
    // w bazie jest juz tylko hash, a przy pierwszym logowaniu i tak zostanie zmienione.
    return odpowiedz({ ok: true, email: adres, haslo_tymczasowe: haslo })
  }

  if (akcja === 'usun') {
    if (!user_id) return odpowiedz({ error: 'Brak identyfikatora konta.' }, 400)
    if (user_id === user.id) {
      return odpowiedz({ error: 'Nie możesz usunąć własnego konta.' }, 400)
    }

    const { data: doUsuniecia } = await serwisowy
      .from('profiles').select('email, rola').eq('id', user_id).single()
    if (!doUsuniecia) return odpowiedz({ error: 'Nie znaleziono konta.' }, 404)

    // Usuniecie ostatniej ksiegowosci zamykaloby aplikacje dla wszystkich - nikt nie
    // moglby juz zakladac kont ani akceptowac ewidencji.
    if (doUsuniecia.rola === 'ksiegowosc') {
      const { count } = await serwisowy
        .from('profiles').select('id', { count: 'exact', head: true }).eq('rola', 'ksiegowosc')
      if ((count ?? 0) <= 1) {
        return odpowiedz({ error: 'To ostatnie konto księgowości - nie można go usunąć.' }, 400)
      }
    }

    const { error } = await serwisowy.auth.admin.deleteUser(user_id)
    if (error) return odpowiedz({ error: error.message }, 400)

    await serwisowy.from('uprawnienia_startowe').delete().eq('email', doUsuniecia.email)
    return odpowiedz({ ok: true })
  }

  return odpowiedz({ error: 'Nieznana akcja.' }, 400)
})
