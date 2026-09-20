import * as XLSX from 'xlsx-js-style'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'
import type { Ewidencja, Trasa } from './types'
import { NAZWA_PODATNIKA } from './config'
import { dataPL, km, kmLiczba, licznik, miesiacRok, sumaKm } from './format'

const RAMKA = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' },
} as const

export interface PozycjaEksportu {
  ewidencja: Ewidencja
  trasy: Trasa[]
}

function etykietyNaglowka(e: Ewidencja): [string, string][] {
  return [
    ['Nazwa podatnika:', NAZWA_PODATNIKA],
    ['Marka i model pojazdu samochodowego:', e.vehicles.marka_model],
    ['Numer rejestracyjny pojazdu samochodowego:', e.vehicles.nr_rejestracyjny],
    ['Miesiąc i rok, którego dotyczy ewidencja:', miesiacRok(e.rok, e.miesiac)],
    ['Dzień rozpoczęcia prowadzenia ewidencji:', dataPL(e.dzien_rozpoczecia_ewidencji)],
    ['Dzień zakończenia prowadzenia ewidencji:', ''],
    ['Stan licznika na początek miesiąca:', licznik(e.stan_licznika_poczatek)],
    ['Stan licznika na koniec miesiąca:', licznik(e.stan_licznika_koniec)],
    ['Stan licznika na dzień rozpoczęcia prowadzenia ewidencji:', licznik(e.stan_rozpoczecia_ewidencji)],
    ['Stan licznika na dzień zakończenia prowadzenia ewidencji:', ''],
  ]
}

const NAGLOWKI_TABELI = [
  'Lp.', 'Data wyjazdu ', 'Cel wyjazdu', 'Skąd', 'Dokąd',
  'Liczba przejechanych kilometrów', 'Imię i nazwisko osoby kierującej pojazdem',
]

const PODPIS_KIEROWNIKA = 'podpis osoby potwierdzającej wpisy   (bezpośredni przełożony kierowcy)'
const PODPIS_ZATWIERDZAJACEGO = 'Zatwierdził   (Podatnik - Zarząd Spółki)'
const KRESKI = '………………………………………………'

export function nazwaPliku(e: Ewidencja, rozszerzenie: string) {
  const mm = String(e.miesiac).padStart(2, '0')
  return `Ewidencja_${e.vehicles.nr_rejestracyjny}_${e.rok}-${mm}.${rozszerzenie}`
}

export function nazwaPaczki(rok: number, miesiac: number) {
  return `Bioerg_ewidencja przebiegu_Vat_${miesiacRok(rok, miesiac).replace(' ', '.')}`
}

function pobierzBlob(blob: Blob, nazwa: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nazwa
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * xlsx-js-style zapisuje wyłącznie <pageMargins> i ignoruje !pageSetup (sprawdzone na
 * wygenerowanym pliku), więc ustawienia wydruku dokładamy do gotowego arkusza. Kolejność
 * elementów w <worksheet> jest wg schematu OOXML nienegocjowalna: <sheetPr> musi być
 * pierwszym dzieckiem, a <pageSetup> wystąpić zaraz po <pageMargins> - inaczej Excel
 * uzna plik za uszkodzony.
 */
async function ustawWydrukNaJednaStroneA4(bufor: ArrayBuffer): Promise<Blob> {
  const zip = await JSZip.loadAsync(bufor)
  const sciezka = 'xl/worksheets/sheet1.xml'
  const plik = zip.file(sciezka)
  if (!plik) return new Blob([bufor], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

  let xml = await plik.async('string')
  if (!xml.includes('<sheetPr>')) {
    xml = xml.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
  }
  if (!xml.includes('<pageSetup')) {
    xml = xml.replace(
      /(<pageMargins[^>]*\/>)/,
      '$1<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>',
    )
  }
  zip.file(sciezka, xml)
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Układ arkusza odwzorowuje zbuduj_arkusz_ewidencji z raport_vat.py: ten sam tytuł w
 * scalonym A1:H1, ten sam blok dziesięciu pól nagłówka, nagłówek tabeli w wierszu 14 i
 * wiersz "Razem:" scalony A:E.
 */
export async function zbudujExcel(e: Ewidencja, trasy: Trasa[]): Promise<Blob> {
  const suma = sumaKm(trasy)
  const naglowek = etykietyNaglowka(e)

  const aoa: (string | number | null)[][] = []
  aoa.push(['Miesięczna ewidencja przebiegu pojazdu', null, null, null, null, null, null, null])
  naglowek.forEach(([etykieta, wartosc]) => aoa.push([etykieta, null, null, null, null, null, wartosc, null]))
  aoa.push([], [])
  aoa.push([...NAGLOWKI_TABELI, null])
  trasy.forEach((t) => aoa.push([
    t.lp, dataPL(t.data_wyjazdu), t.cel_wyjazdu, t.skad, t.dokad, kmLiczba(t.km), t.kierowca, null,
  ]))
  aoa.push(['Razem:', null, null, null, null, suma, null, null])
  aoa.push([e.podpis_imie_nazwisko ?? '', null, null, null, null, e.akceptacja_imie_nazwisko ?? '', null, null])
  aoa.push([PODPIS_KIEROWNIKA, null, null, null, null, PODPIS_ZATWIERDZAJACEGO, null, null])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wierszNaglowkaTabeli = 13
  const pierwszyWierszDanych = wierszNaglowkaTabeli + 1
  const wierszRazem = pierwszyWierszDanych + trasy.length
  const wierszPodpisow = wierszRazem + 1
  const wierszOpisow = wierszRazem + 2

  ws['!cols'] = [
    { wch: 4.5 }, { wch: 12 }, { wch: 24 }, { wch: 38 },
    { wch: 38 }, { wch: 12 }, { wch: 34 }, { wch: 16 },
  ]
  ws['!margins'] = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    ...naglowek.map((_, i) => ({ s: { r: 1 + i, c: 0 }, e: { r: 1 + i, c: 5 } })),
    { s: { r: wierszNaglowkaTabeli, c: 6 }, e: { r: wierszNaglowkaTabeli, c: 7 } },
    ...trasy.map((_, i) => ({
      s: { r: pierwszyWierszDanych + i, c: 6 }, e: { r: pierwszyWierszDanych + i, c: 7 },
    })),
    { s: { r: wierszRazem, c: 0 }, e: { r: wierszRazem, c: 4 } },
    { s: { r: wierszRazem, c: 6 }, e: { r: wierszRazem, c: 7 } },
    { s: { r: wierszPodpisow, c: 0 }, e: { r: wierszPodpisow, c: 3 } },
    { s: { r: wierszPodpisow, c: 5 }, e: { r: wierszPodpisow, c: 7 } },
    { s: { r: wierszOpisow, c: 0 }, e: { r: wierszOpisow, c: 3 } },
    { s: { r: wierszOpisow, c: 5 }, e: { r: wierszOpisow, c: 7 } },
  ]
  ws['!rows'] = []
  ws['!rows'][0] = { hpt: 39 }
  ws['!rows'][wierszNaglowkaTabeli] = { hpt: 48.75 }
  trasy.forEach((_, i) => { ws['!rows']![pierwszyWierszDanych + i] = { hpt: 30 } })
  ws['!rows'][wierszOpisow] = { hpt: 42.6 }

  function styl(r: number, c: number, s: Record<string, unknown>) {
    const adres = XLSX.utils.encode_cell({ r, c })
    if (!ws[adres]) ws[adres] = { t: 'z', v: null }
    ws[adres].s = { ...(ws[adres].s ?? {}), ...s }
  }

  styl(0, 0, {
    font: { name: 'Calibri', sz: 16, bold: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  })
  naglowek.forEach((_, i) => {
    styl(1 + i, 0, { font: { name: 'Calibri', sz: 11, bold: true }, border: RAMKA })
    styl(1 + i, 6, {
      font: { name: 'Calibri', sz: 11, bold: true },
      alignment: { horizontal: 'center' }, border: RAMKA,
    })
    styl(1 + i, 7, { border: RAMKA })
  })
  for (let c = 0; c <= 7; c++) {
    styl(wierszNaglowkaTabeli, c, {
      font: { name: 'Calibri', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      fill: { fgColor: { rgb: 'F1F5F9' } }, border: RAMKA,
    })
  }
  trasy.forEach((_, i) => {
    for (let c = 0; c <= 7; c++) {
      styl(pierwszyWierszDanych + i, c, {
        font: { name: 'Calibri', sz: 11 },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: [3, 4, 6].includes(c) },
        border: RAMKA,
      })
    }
  })
  for (let c = 0; c <= 7; c++) {
    styl(wierszRazem, c, { font: { name: 'Calibri', sz: 11, bold: true }, border: RAMKA })
  }
  styl(wierszRazem, 5, {
    font: { name: 'Calibri', sz: 11, bold: true },
    alignment: { horizontal: 'center', vertical: 'center' }, border: RAMKA,
  })
  for (const c of [0, 5]) {
    styl(wierszPodpisow, c, {
      font: { name: 'Calibri', sz: 11, bold: true },
      alignment: { horizontal: 'center' },
    })
    styl(wierszOpisow, c, {
      font: { name: 'Calibri', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    })
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${e.vehicles.nr_rejestracyjny}`.slice(0, 31))
  const bufor = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return ustawWydrukNaJednaStroneA4(bufor)
}

export async function pobierzExcel(e: Ewidencja, trasy: Trasa[]) {
  pobierzBlob(await zbudujExcel(e, trasy), nazwaPliku(e, 'xlsx'))
}

// jsPDF nie ma wbudowanego kroju z polskimi znakami - bez tego "ą", "ł" czy "ż"
// wychodzą w PDF jako krzaki. Font leży w public/fonts i jest dociągany z tego samego
// hosta co aplikacja, więc nie ma zależności od zewnętrznego CDN.
let fontZaladowany: Promise<boolean> | null = null

async function zaladujFont(doc: jsPDF): Promise<boolean> {
  if (!fontZaladowany) {
    fontZaladowany = (async () => {
      try {
        const odp = await fetch(`${import.meta.env.BASE_URL}fonts/DejaVuSans.ttf`)
        if (!odp.ok) return false
        const bufor = await odp.arrayBuffer()
        let binarne = ''
        const bajty = new Uint8Array(bufor)
        for (let i = 0; i < bajty.length; i += 8192) {
          binarne += String.fromCharCode(...bajty.subarray(i, i + 8192))
        }
        ;(window as unknown as Record<string, string>).__fontBase64 = btoa(binarne)
        return true
      } catch {
        return false
      }
    })()
  }
  const ok = await fontZaladowany
  if (ok) {
    doc.addFileToVFS('DejaVuSans.ttf', (window as unknown as Record<string, string>).__fontBase64)
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal')
    doc.setFont('DejaVuSans')
  }
  return ok
}

export async function zbudujPdf(e: Ewidencja, trasy: Trasa[]): Promise<Blob> {
  const suma = sumaKm(trasy)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const maUnicode = await zaladujFont(doc)
  const krój = maUnicode ? 'DejaVuSans' : 'helvetica'

  doc.setFont(krój, 'normal')
  doc.setFontSize(16)
  doc.text('Miesięczna ewidencja przebiegu pojazdu', 148.5, 15, { align: 'center' })

  doc.setFontSize(9)
  let y = 24
  etykietyNaglowka(e).forEach(([etykieta, wartosc]) => {
    doc.text(etykieta, 12, y)
    doc.text(String(wartosc ?? ''), 150, y)
    y += 5
  })

  autoTable(doc, {
    startY: y + 4,
    head: [NAGLOWKI_TABELI],
    body: trasy.map((t) => [
      t.lp, dataPL(t.data_wyjazdu), t.cel_wyjazdu, t.skad, t.dokad, km(t.km), t.kierowca,
    ]),
    foot: [['Razem:', '', '', '', '', suma.toLocaleString('pl-PL'), '']],
    // Podsumowanie ma wystąpić RAZ, pod ostatnim wierszem - nie powtarzać się na
    // każdej stronie, bo dokument przestaje wtedy czytać się jak jedna ciągła tabela.
    showFoot: 'lastPage',
    showHead: 'everyPage',
    styles: { font: krój, fontSize: 8, cellPadding: 1.6, lineColor: [100, 116, 139], lineWidth: 0.1 },
    headStyles: { font: krój, fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'normal' },
    footStyles: { font: krój, fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'normal' },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 22, halign: 'center' },
      2: { cellWidth: 40 },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 45 },
    },
    margin: { left: 12, right: 12 },
  })

  const koniec = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14
  doc.setFontSize(9)
  doc.text(e.podpis_imie_nazwisko ?? KRESKI, 12, koniec)
  doc.text(e.akceptacja_imie_nazwisko ?? KRESKI, 180, koniec)
  doc.setFontSize(8)
  doc.text(PODPIS_KIEROWNIKA, 12, koniec + 5)
  doc.text(PODPIS_ZATWIERDZAJACEGO, 180, koniec + 5)

  return doc.output('blob')
}

export async function pobierzPdf(e: Ewidencja, trasy: Trasa[]) {
  pobierzBlob(await zbudujPdf(e, trasy), nazwaPliku(e, 'pdf'))
}

/** Wszystkie ewidencje okresu w jednym .zip. Pliki powstają na bieżąco z aktualnych
 *  danych, więc zawsze odpowiadają ostatniej wersji - także po ponownej edycji. */
export async function pobierzPaczke(
  pozycje: PozycjaEksportu[],
  format: 'pdf' | 'xlsx',
  rok: number,
  miesiac: number,
) {
  const zip = new JSZip()
  for (const { ewidencja, trasy } of pozycje) {
    const blob = format === 'pdf'
      ? await zbudujPdf(ewidencja, trasy)
      : await zbudujExcel(ewidencja, trasy)
    zip.file(nazwaPliku(ewidencja, format), blob)
  }
  const paczka = await zip.generateAsync({ type: 'blob' })
  pobierzBlob(paczka, `${nazwaPaczki(rok, miesiac)}.zip`)
}
