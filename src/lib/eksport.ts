import * as XLSX from 'xlsx-js-style'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Ewidencja, Trasa } from './types'
import { NAZWA_PODATNIKA } from './config'
import { dataPL, km, licznik, miesiacRok } from './format'

const RAMKA = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' },
} as const

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

/**
 * Układ arkusza jest odwzorowaniem zbuduj_arkusz_ewidencji z raport_vat.py: ten sam
 * tytuł w scalonym A1:H1, ten sam blok dziesięciu pól nagłówka (etykieta w A:F,
 * wartość w G), nagłówek tabeli w wierszu 14 i wiersz "Razem:" scalony A:E - dzięki
 * temu plik pobrany z aplikacji wygląda tak samo jak ten, który klient dostaje mailem.
 */
export function pobierzExcel(e: Ewidencja, trasy: Trasa[]) {
  const suma = trasy.reduce((s, t) => s + Number(t.km), 0)
  const naglowek = etykietyNaglowka(e)

  const aoa: (string | number | null)[][] = []
  aoa.push(['Miesięczna ewidencja przebiegu pojazdu', null, null, null, null, null, null, null])
  naglowek.forEach(([etykieta, wartosc]) => aoa.push([etykieta, null, null, null, null, null, wartosc, null]))
  aoa.push([], [])
  aoa.push([...NAGLOWKI_TABELI, null])
  trasy.forEach((t) => aoa.push([
    t.lp, dataPL(t.data_wyjazdu), t.cel_wyjazdu, t.skad, t.dokad, Number(t.km), t.kierowca, null,
  ]))
  aoa.push(['Razem:', null, null, null, null, suma, null, null])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wierszNaglowkaTabeli = 13 // 0-indeksowany: wiersz 14 w Excelu
  const pierwszyWierszDanych = wierszNaglowkaTabeli + 1
  const wierszRazem = pierwszyWierszDanych + trasy.length

  ws['!cols'] = [
    { wch: 4.5 }, { wch: 12 }, { wch: 24 }, { wch: 38 },
    { wch: 38 }, { wch: 12 }, { wch: 34 }, { wch: 16 },
  ]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    ...naglowek.map((_, i) => ({ s: { r: 1 + i, c: 0 }, e: { r: 1 + i, c: 5 } })),
    { s: { r: wierszNaglowkaTabeli, c: 6 }, e: { r: wierszNaglowkaTabeli, c: 7 } },
    ...trasy.map((_, i) => ({
      s: { r: pierwszyWierszDanych + i, c: 6 }, e: { r: pierwszyWierszDanych + i, c: 7 },
    })),
    { s: { r: wierszRazem, c: 0 }, e: { r: wierszRazem, c: 4 } },
    { s: { r: wierszRazem, c: 6 }, e: { r: wierszRazem, c: 7 } },
  ]
  ws['!rows'] = []
  ws['!rows'][0] = { hpt: 39 }
  ws['!rows'][wierszNaglowkaTabeli] = { hpt: 48.75 }
  trasy.forEach((_, i) => { ws['!rows']![pierwszyWierszDanych + i] = { hpt: 40 } })

  function styl(r: number, c: number, s: any) {
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

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${e.vehicles.nr_rejestracyjny}`.slice(0, 31))
  XLSX.writeFile(wb, nazwaPliku(e, 'xlsx'))
}

export function nazwaPliku(e: Ewidencja, rozszerzenie: string) {
  const mm = String(e.miesiac).padStart(2, '0')
  return `Ewidencja_${e.vehicles.nr_rejestracyjny}_${e.rok}-${mm}.${rozszerzenie}`
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
        ;(window as any).__fontBase64 = btoa(binarne)
        return true
      } catch {
        return false
      }
    })()
  }
  const ok = await fontZaladowany
  if (ok) {
    doc.addFileToVFS('DejaVuSans.ttf', (window as any).__fontBase64)
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal')
    doc.setFont('DejaVuSans')
  }
  return ok
}

/** Zwraca Blob (do archiwum) i opcjonalnie od razu pobiera plik. */
export async function zbudujPdf(e: Ewidencja, trasy: Trasa[], pobierz: boolean): Promise<Blob> {
  const suma = trasy.reduce((s, t) => s + Number(t.km), 0)
  // A4 poziomo - tak samo jak wydruk arkusza w raport_vat.py (fitToWidth=1).
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
    foot: [['Razem:', '', '', '', '', km(suma), '']],
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

  const koniec = (doc as any).lastAutoTable.finalY + 14
  doc.setFontSize(9)
  doc.text(e.podpis_imie_nazwisko ?? '', 12, koniec)
  doc.text('………………………………………………', 190, koniec)
  doc.setFontSize(8)
  doc.text('podpis osoby potwierdzającej wpisy (bezpośredni przełożony kierowcy)', 12, koniec + 5)
  doc.text('Zatwierdził (Podatnik - Zarząd Spółki)', 190, koniec + 5)

  if (pobierz) doc.save(nazwaPliku(e, 'pdf'))
  return doc.output('blob')
}
