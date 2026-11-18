/** Odczyt godziny wykonania zdjęcia z danych EXIF, bez żadnej biblioteki.
 *
 *  PO CO. Zdjęcie licznika jest dowodem dodatkowym do ewidencji przebiegu - ale dowodem
 *  jest dopiero wtedy, gdy wiadomo, KIEDY je zrobiono. Aparat zapisuje to w polu
 *  DateTimeOriginal. Czytamy je w przeglądarce, podpowiadamy z niego godzinę odczytu
 *  i zapisujemy obok tej podanej przez kierownika, żeby administrator widział,
 *  czy się zgadzają.
 *
 *  Czytamy tylko to jedno pole (plus strefę czasową, jeśli aparat ją zapisał). Pełna
 *  biblioteka EXIF to kilkadziesiąt kilobajtów na jedną datę - tu wystarczy przejść
 *  po segmentach JPEG-a.
 */

/** Tagi EXIF, których szukamy. */
const TAG_EXIF_IFD = 0x8769
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_DATE_TIME_DIGITIZED = 0x9004
const TAG_OFFSET_TIME_ORIGINAL = 0x9011

interface Odczytane {
  /** Moment wykonania zdjęcia. */
  kiedy: Date
  /** Czy aparat zapisał strefę czasową. Bez niej przyjmujemy czas lokalny przeglądarki. */
  zeStrefa: boolean
}

/** Treść pola tekstowego EXIF spod podanego offsetu. */
function tekst(dv: DataView, offset: number, dlugosc: number) {
  let s = ''
  for (let i = 0; i < dlugosc; i++) {
    const kod = dv.getUint8(offset + i)
    if (kod === 0) break
    s += String.fromCharCode(kod)
  }
  return s.trim()
}

/** Przechodzi po wpisach jednego IFD i zwraca mapę tag -> wartość tekstowa/liczbowa. */
function czytajIfd(dv: DataView, tiff: number, ifd: number, le: boolean) {
  const wynik = new Map<number, string | number>()
  if (ifd + 2 > dv.byteLength) return wynik
  const ile = dv.getUint16(ifd, le)
  for (let i = 0; i < ile; i++) {
    const wpis = ifd + 2 + i * 12
    if (wpis + 12 > dv.byteLength) break
    const tag = dv.getUint16(wpis, le)
    const typ = dv.getUint16(wpis + 2, le)
    const licznosc = dv.getUint32(wpis + 4, le)
    if (typ === 2) {
      // ASCII: do czterech znaków mieści się w samym wpisie, dłuższe są pod offsetem.
      const gdzie = licznosc <= 4 ? wpis + 8 : tiff + dv.getUint32(wpis + 8, le)
      if (gdzie + licznosc <= dv.byteLength) wynik.set(tag, tekst(dv, gdzie, licznosc))
    } else if (typ === 4) {
      wynik.set(tag, dv.getUint32(wpis + 8, le))
    }
  }
  return wynik
}

/** 'YYYY:MM:DD HH:MM:SS' (+ opcjonalne '+01:00') -> Date. Null, gdy zapis jest inny. */
function naDate(wartosc: string, strefa?: string): Date | null {
  const m = wartosc.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const [, r, mi, d, g, min, s] = m
  const iso = `${r}-${mi}-${d}T${g}:${min}:${s}`
  // Bez strefy z aparatu zostawiamy czas lokalny przeglądarki - zdjęcie licznika robi
  // kierownik w Polsce tym samym telefonem, z którego potem wpisuje odczyt.
  const data = new Date(strefa ? `${iso}${strefa}` : iso)
  return Number.isNaN(data.getTime()) ? null : data
}

/** Godzina wykonania zdjęcia albo null, gdy pliku nie da się odczytać lub nie ma EXIF. */
export async function kiedyZrobionoZdjecie(plik: File): Promise<Odczytane | null> {
  let bufor: ArrayBuffer
  try {
    // Dane EXIF są na początku pliku; nie wczytujemy całego zdjęcia do pamięci.
    bufor = await plik.slice(0, 256 * 1024).arrayBuffer()
  } catch {
    return null
  }
  const dv = new DataView(bufor)
  if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) return null // to nie JPEG

  let p = 2
  while (p + 4 < dv.byteLength) {
    if (dv.getUint8(p) !== 0xff) { p++; continue }
    const znacznik = dv.getUint8(p + 1)
    if (znacznik === 0xd8 || znacznik === 0x01 || (znacznik >= 0xd0 && znacznik <= 0xd7)) {
      p += 2; continue
    }
    if (znacznik === 0xda) break // początek danych obrazu - dalej EXIF-u nie ma
    const dlugosc = dv.getUint16(p + 2)
    if (znacznik === 0xe1 && p + 10 < dv.byteLength && tekst(dv, p + 4, 4) === 'Exif') {
      const tiff = p + 10
      if (tiff + 8 > dv.byteLength) return null
      const le = dv.getUint16(tiff) === 0x4949 // 'II' = little endian, 'MM' = big
      const ifd0 = czytajIfd(dv, tiff, tiff + dv.getUint32(tiff + 4, le), le)
      const wskaznik = ifd0.get(TAG_EXIF_IFD)
      const exif = typeof wskaznik === 'number'
        ? czytajIfd(dv, tiff, tiff + wskaznik, le)
        : new Map<number, string | number>()

      const kiedy = exif.get(TAG_DATE_TIME_ORIGINAL) ?? exif.get(TAG_DATE_TIME_DIGITIZED)
      if (typeof kiedy !== 'string') return null
      const strefa = exif.get(TAG_OFFSET_TIME_ORIGINAL)
      const zeStrefa = typeof strefa === 'string' && /^[+-]\d{2}:\d{2}$/.test(strefa)
      const data = naDate(kiedy, zeStrefa ? (strefa as string) : undefined)
      return data ? { kiedy: data, zeStrefa } : null
    }
    p += 2 + dlugosc
  }
  return null
}

/** 'HH:MM' w strefie polskiej - do podpowiedzi w polu godziny odczytu. */
export function godzinaPL(data: Date) {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(data)
}

/** 'RRRR-MM-DD' w strefie polskiej - do podpowiedzi w polu daty odczytu. */
export function dataISOPL(data: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(data)
}
