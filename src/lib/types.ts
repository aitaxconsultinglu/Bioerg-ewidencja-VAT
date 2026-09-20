export type Rola = 'kierownik' | 'ksiegowosc'

export type Status =
  | 'wygenerowana'
  | 'w_edycji'
  | 'wyslana_do_akceptacji'
  | 'odeslana_do_poprawki'
  | 'zaakceptowana'

export interface Profil {
  id: string
  email: string
  imie_nazwisko: string
  rola: Rola
}

export interface Pojazd {
  id: string
  nr_rejestracyjny: string
  marka_model: string
  oddzial: string | null
  kierownik_id: string | null
}

export interface Ewidencja {
  id: string
  vehicle_id: string
  rok: number
  miesiac: number
  status: Status
  dzien_rozpoczecia_ewidencji: string | null
  stan_rozpoczecia_ewidencji: number | null
  stan_licznika_poczatek: number | null
  stan_licznika_koniec: number | null
  podpis_imie_nazwisko: string | null
  podpis_at: string | null
  akceptacja_imie_nazwisko: string | null
  akceptacja_at: string | null
  komentarz_ksiegowosci: string | null
  pdf_path: string | null
  vehicles: Pojazd
}

export interface Trasa {
  id: string
  log_id: string
  lp: number
  data_wyjazdu: string
  km: number
  pewnosc: string | null
  cel_wyjazdu: string
  skad: string
  dokad: string
  kierowca: string
}

export interface WpisAudytu {
  id: number
  user_email: string | null
  akcja: string
  pole: string | null
  stara_wartosc: string | null
  nowa_wartosc: string | null
  utworzono: string
}

/** Kolumny, które kierownik może edytować. Data, km i Lp. pochodzą z potoku GPS. */
export type PoleEdytowalne = 'cel_wyjazdu' | 'skad' | 'dokad' | 'kierowca'
