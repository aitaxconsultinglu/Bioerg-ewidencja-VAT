// Wysyłka poczty przez SMTP, bez biblioteki zewnętrznej.
//
// DLACZEGO WŁASNA IMPLEMENTACJA. Używany wcześniej denomailer 1.6.0 zawiódł w tym
// środowisku trzy razy, za każdym razem w sposób widoczny dla odbiorcy albo całkowicie
// blokujący wysyłkę:
//   1. "Error: invalid cmd" z SMTPConnection.assertCode przy pustych poświadczeniach -
//      komunikat nie mówił nic o prawdziwej przyczynie;
//   2. close() nie zawsze zwracało obietnicę, więc .catch() na niej wywracał funkcję
//      JUŻ PO wysłaniu wiadomości ("Cannot read properties of undefined");
//   3. 2026-10-21: biblioteka wstawiła nagłówki (From, To, Date, MIME-Version,
//      Content-Type) do TREŚCI wiadomości, więc Gmail pokazał odbiorcy surowe źródło
//      MIME wraz z granicami multipart, a temat złożyła niepoprawnie - przełamała
//      słowo kodowane RFC 2047 miękkim przeniesieniem quoted-printable, czego ten
//      standard nie dopuszcza. Maile do kierowników wyglądały jak awaria systemu.
//
// Protokół SMTP dla jednej wiadomości tekstowej to kilkadziesiąt linii, więc własna
// obsługa jest tu tańsza niż walka z cudzym błędem - i daje pewność, co dokładnie
// idzie na serwer.
//
// DWIE DECYZJE, KTÓRE ELIMINUJĄ CAŁĄ KLASĘ PROBLEMÓW Z KODOWANIEM:
//   - temat kodujemy jako JEDNO słowo kodowane base64 (=?UTF-8?B?...?=), a nie
//     quoted-printable. Base64 nie ma miękkich przeniesień, więc nie da się go
//     przełamać tak, jak zrobił to denomailer;
//   - treść wysyłamy jako base64 w liniach po 76 znaków. Dzięki temu polskie znaki
//     nigdy nie pojawią się u odbiorcy jako "=c5=84", a długie wiersze nie wymagają
//     przenoszenia.

const KONIEC = '\r\n'

/** Kodowanie nagłówka wg RFC 2047. ASCII zostaje bez zmian - niepotrzebne kodowanie
 *  utrudniałoby czytanie nagłówków w logach serwera. */
function naglowek(tekst: string) {
  if (/^[\x20-\x7E]*$/.test(tekst)) return tekst
  const bajty = new TextEncoder().encode(tekst)
  let binarnie = ''
  for (const b of bajty) binarnie += String.fromCharCode(b)
  return `=?UTF-8?B?${btoa(binarnie)}?=`
}

/** Treść jako base64 w liniach po 76 znaków - wymóg RFC 2045 dla tego kodowania. */
function trescBase64(tekst: string) {
  const bajty = new TextEncoder().encode(tekst)
  let binarnie = ''
  for (const b of bajty) binarnie += String.fromCharCode(b)
  const b64 = btoa(binarnie)
  const linie: string[] = []
  for (let i = 0; i < b64.length; i += 76) linie.push(b64.slice(i, i + 76))
  return linie.join(KONIEC)
}

function base64(tekst: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(tekst)))
}

class Polaczenie {
  #conn: Deno.Conn
  #bufor = ''
  #dekoder = new TextDecoder()
  #koder = new TextEncoder()

  constructor(conn: Deno.Conn) {
    this.#conn = conn
  }

  /** Czyta jedną pełną odpowiedź SMTP. Serwer może odpowiedzieć wieloma liniami
   *  (np. na EHLO) - ostatnia ma spację po kodzie, pośrednie myślnik. */
  async odczytaj(): Promise<{ kod: number; tekst: string }> {
    for (;;) {
      const linie = this.#bufor.split(KONIEC)
      for (let i = 0; i < linie.length - 1; i++) {
        if (/^\d{3} /.test(linie[i])) {
          const pelna = linie.slice(0, i + 1).join('\n')
          this.#bufor = linie.slice(i + 1).join(KONIEC)
          return { kod: Number(linie[i].slice(0, 3)), tekst: pelna }
        }
      }
      const kawalek = new Uint8Array(4096)
      const ile = await this.#conn.read(kawalek)
      if (ile === null) throw new Error('Serwer SMTP zamknął połączenie przedwcześnie')
      this.#bufor += this.#dekoder.decode(kawalek.subarray(0, ile))
    }
  }

  async wyslij(linia: string) {
    await this.#conn.write(this.#koder.encode(linia + KONIEC))
  }

  /** Wysyła polecenie i sprawdza kod odpowiedzi. Treść polecenia NIE trafia do
   *  komunikatu błędu - inaczej hasło z AUTH wylądowałoby w dzienniku. */
  async polecenie(linia: string, oczekiwany: number, opis: string) {
    await this.wyslij(linia)
    const odp = await this.odczytaj()
    if (odp.kod !== oczekiwany) {
      throw new Error(`SMTP ${opis}: serwer odpowiedział ${odp.kod} ${odp.tekst.trim()}`)
    }
    return odp
  }

  zamknij() {
    try { this.#conn.close() } catch { /* mogło już być zamknięte */ }
  }
}

export interface Wiadomosc {
  host: string
  port: number
  login: string
  haslo: string
  od: string
  do_: string
  kopia?: string | null
  temat: string
  tresc: string
}

export async function wyslijMaila(w: Wiadomosc) {
  // Port 465 szyfruje od pierwszego bajtu. Dla 587 trzeba by najpierw STARTTLS -
  // świadomie tego nie implementuję, bo konfiguracja produkcyjna to 465, a martwy
  // kod na wszelki wypadek bywa gorszy niż jego brak.
  if (w.port !== 465) {
    throw new Error(`Obsługiwany jest wyłącznie port 465 (szyfrowanie od razu), podano ${w.port}`)
  }
  const conn = await Deno.connectTls({ hostname: w.host, port: w.port })
  const p = new Polaczenie(conn)
  try {
    const powitanie = await p.odczytaj()
    if (powitanie.kod !== 220) {
      throw new Error(`SMTP powitanie: ${powitanie.kod} ${powitanie.tekst.trim()}`)
    }
    await p.polecenie(`EHLO ${w.host}`, 250, 'EHLO')
    await p.polecenie('AUTH LOGIN', 334, 'AUTH LOGIN')
    await p.polecenie(base64(w.login), 334, 'nazwa użytkownika')
    await p.polecenie(base64(w.haslo), 235, 'uwierzytelnienie (sprawdź login i hasło skrzynki)')
    await p.polecenie(`MAIL FROM:<${w.od}>`, 250, 'MAIL FROM')
    await p.polecenie(`RCPT TO:<${w.do_}>`, 250, 'RCPT TO')
    if (w.kopia) await p.polecenie(`RCPT TO:<${w.kopia}>`, 250, 'RCPT TO (kopia)')
    await p.polecenie('DATA', 354, 'DATA')

    const naglowki = [
      `From: ${w.od}`,
      `To: ${w.do_}`,
      ...(w.kopia ? [`Cc: ${w.kopia}`] : []),
      `Subject: ${naglowek(w.temat)}`,
      `Date: ${new Date().toUTCString()}`,
      // Message-ID jest OBOWIAZKOWY. Bez niego Gmail nie ma jak rozroznic wiadomosci
      // i sklada w jeden watek maile, ktore nie maja ze soba nic wspolnego - klient
      // zglosil 2026-10-21, ze przypomnienia dla dwoch roznych kierownikow pokazaly sie
      // jako jedna, podwojna wiadomosc. Brak tego naglowka obniza tez dostarczalnosc,
      // bo czesc serwerow traktuje go jako oznake spamu.
      `Message-ID: <${crypto.randomUUID()}@${w.od.split('@')[1] ?? 'localhost'}>`,
      'MIME-Version: 1.0',
      // Jeden, prosty blok tekstowy. Zadna wiadomosc w tej aplikacji nie ma zalacznikow
      // ani wersji HTML, wiec multipart tylko dodawalby miejsca na blad - dokladnie taki,
      // jaki popelnil denomailer.
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ]
    // Pusta linia rozdziela naglowki od tresci. To jej brak (albo naglowki po niej)
    // sprawial, ze Gmail pokazywal odbiorcy surowe zrodlo wiadomosci.
    await p.wyslij(naglowki.join(KONIEC) + KONIEC + KONIEC + trescBase64(w.tresc))
    // Kropka w osobnej linii konczy DATA. Tresc jest w base64, wiec zadna jej linia
    // nie moze zaczynac sie od kropki i nie trzeba stosowac dot-stuffingu.
    await p.polecenie('.', 250, 'zakończenie wiadomości')
    try { await p.polecenie('QUIT', 221, 'QUIT') } catch { /* rozłączenie bez QUIT nie szkodzi */ }
  } finally {
    p.zamknij()
  }
}
