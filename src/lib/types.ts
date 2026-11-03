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
  wymaga_zmiany_hasla: boolean
  /** Konto administratora: edycja wszystkich pozycji na kazdym etapie, takze w ewidencji
   *  zaakceptowanej, i ponowne zbudowanie archiwalnego PDF. Flagi nie da sie przestawic
   *  z aplikacji - pilnuje tego trigger chron_role_administratora. */
  administrator: boolean
}

export interface Pojazd {
  id: string
  nr_rejestracyjny: string
  marka_model: string
  oddzial: string | null
  kierownik_id: string | null
  /** Doczytywane tylko tam, gdzie lista pokazuje osobę odpowiedzialną za pojazd. */
  kierownik?: { imie_nazwisko: string } | null
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
  /** WARSTWA 3: faktyczny odczyt z licznika pojazdu na koniec miesiąca, wpisany przez
   *  kierownika. Opcjonalny w typie, bo stare wiersze go nie mają. */
  stan_licznika_koniec_rzeczywisty?: number | null
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
  /** Pozycja korekcyjna wyliczona z odczytu licznika, a nie trasa z GPS. Nie podlega
   *  edycji recznej: powstaje i znika razem z odczytem. */
  korekta?: boolean
  odczyt_id?: string | null
}

/** Odczyt licznika z deski rozdzielczej, wpisywany przez kierownika w dowolnym dniu.
 *
 *  Nalezy do POJAZDU, nie do miesiaca - dlatego jeden odczyt moze dotyczyc okresu,
 *  ktorego danych GPS jeszcze nie ma (wynik 'oczekuje'). Wiersze tworzy wylacznie
 *  funkcja zapisz_odczyt_licznika, ktora przy okazji nalicza korekte. */
export interface OdczytLicznika {
  id: string
  vehicle_id: string
  data_odczytu: string
  stan: number
  uwaga: string | null
  wpisal_nazwa: string
  stan_wyliczony: number | null
  korekta_km: number | null
  korekta_trip_id: string | null
  log_id: string | null
  wynik: WynikOdczytu
  naliczono_at: string | null
  utworzono: string
}

export type WynikOdczytu = 'zgodny' | 'skorygowany' | 'oczekuje' | 'zablokowany'

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

/** Kolumny z danymi GPS, ktore moze poprawic WYLACZNIE administrator. Dla wszystkich
 *  pozostalych sa dowodem przebiegu i pozostaja tylko do odczytu. Kazda taka zmiana
 *  trafia do dziennika zmian (trigger audytuj_trips). */
export type PoleGPS = 'data_wyjazdu' | 'km'

export type PoleTabeli = PoleEdytowalne | PoleGPS

export const POLA_GPS: PoleGPS[] = ['data_wyjazdu', 'km']

export function jestPolemGPS(pole: PoleTabeli): pole is PoleGPS {
  return (POLA_GPS as string[]).includes(pole)
}

/** Pole wskazane przez księgowość do poprawy.
 *
 *  Nie ma tu znacznika "poprawione" - stan wynika z porównania bieżącej wartości pola
 *  z `wartosc_przy_oznaczeniu`. Równe = jeszcze nie poprawione (czerwone), różne =
 *  poprawione (zielone). Dzięki temu kierownik nie może "zaliczyć" oznaczenia bez
 *  faktycznej zmiany, a tabela nie potrzebuje polityki UPDATE. */
export interface OznaczeniePola {
  id: string
  log_id: string
  trip_id: string
  pole: PoleEdytowalne
  wartosc_przy_oznaczeniu: string
  uwaga: string | null
  oznaczono: string
}

/** Wpis dziennika wiadomości wychodzących (tabela email_log). Tworzą go wyłącznie
 *  funkcje brzegowe; aplikacja tylko czyta, i tylko jako księgowość (RLS). */
export interface WpisMaila {
  id: string
  rodzaj: string
  adresat: string
  adresat_nazwa: string | null
  profil_id: string | null
  kopia: string | null
  temat: string
  pojazdy: string[] | null
  rok: number | null
  miesiac: number | null
  /** 'wyslany' | 'blad' */
  status: string
  blad: string | null
  utworzono: string
}
