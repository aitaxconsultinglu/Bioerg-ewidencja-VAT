import { ArrowLeft } from 'lucide-react'
import type { Profil } from '@/lib/types'

interface Props {
  profil: Profil
  naListe: () => void
}

/** Krótka instrukcja dla kierowników i księgowości: skąd biorą się dane, co trzeba
 *  uzupełnić, kiedy przychodzą maile.
 *
 *  Celowo bez liczb, progów i nazw pól z bazy. To ma odpowiadać na pytania, które ludzie
 *  zadają naprawdę ("dlaczego dostaję te maile", "czemu to świeci na czerwono"), a nie
 *  opisywać implementację - ta zmienia się częściej niż instrukcja i rozjechałaby się
 *  z nią po pierwszej poprawce. */
function Sekcja({ tytul, children }: { tytul: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="text-base font-semibold">{tytul}</h3>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  )
}

export function JakToDziala({ profil, naListe }: Props) {
  const ksiegowosc = profil.rola === 'ksiegowosc'
  const admin = profil.administrator
  const tylkoKierownik = profil.rola === 'kierownik' && !profil.administrator

  return (
    <div className="space-y-5">
      <button
        onClick={naListe}
        className="flex items-center gap-1.5 text-sm text-blekit-ciemny hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Wróć do listy
      </button>

      <div>
        <h2 className="text-lg font-semibold">Jak działa ewidencja przebiegu pojazdu</h2>
        <p className="mt-1 text-sm text-slate-600">
          Krótko: skąd biorą się dane, co trzeba uzupełnić i kiedy aplikacja wysyła maile.
        </p>
      </div>

      <Sekcja tytul="Skąd biorą się dane">
        <p>
          Pierwszego dnia każdego miesiąca system pobiera z urządzeń GPS trasy wszystkich
          pojazdów za miesiąc poprzedni i zakłada dla każdego auta osobną ewidencję.
          Data, trasa i liczba kilometrów pochodzą z GPS i <strong>nie da się ich zmienić</strong> —
          to one są dowodem przebiegu.
        </p>
        <p>
          Kolumny <strong>Cel wyjazdu</strong>, <strong>Skąd</strong>, <strong>Dokąd</strong> i{' '}
          <strong>Imię i nazwisko kierującego</strong> są do uzupełnienia. Część celów system
          podpowiada sam — rozpoznaje stałe miejsca, w których pracujemy, i wpisuje nazwę
          kontrahenta. Adresu, którego nie zna, nie zgaduje.
        </p>
      </Sekcja>

      <Sekcja tytul="Czerwone i bursztynowe pola">
        <p>
          <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">Czerwony</span>{' '}
          cel wyjazdu znaczy, że jest pusty albo zbyt ogólny. Sam zapis „prace remontowe”
          pasuje do każdego wyjazdu w firmie i nic nie wyjaśnia. Potrzebna jest{' '}
          <strong>nazwa kontrahenta i zadanie</strong> wykonane pod tym adresem.
        </p>
        <p>
          <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">Bursztynowy</span>{' '}
          znaczy po prostu puste pole — najczęściej brak nazwiska osoby kierującej.
        </p>
        <p>
          Księgowość może dodatkowo wskazać pojedyncze komórki do poprawy. Taka komórka jest{' '}
          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">czerwona z obwódką</span>{' '}
          i robi się{' '}
          <span className="rounded bg-green-50 px-1.5 py-0.5 font-medium text-green-800">zielona</span>,
          gdy jej treść faktycznie się zmieni. Kolory nie trafiają na wydruk ani do Excela
          i znikają po zatwierdzeniu ewidencji.
        </p>
      </Sekcja>

      <Sekcja tytul="Odczyt licznika i korekty">
        <p>
          Na górze każdej ewidencji jest miejsce na <strong>prawdziwy stan licznika</strong>{' '}
          odczytany z deski rozdzielczej, razem z dniem i godziną odczytu. Nie trzeba czekać
          na koniec miesiąca - odczyt można wpisać kiedykolwiek, choćby przy wymianie opon.
          Wpisane odczyty widać pod tabelą tras.
        </p>
        {/* Dalej jest mechanika dokumentu: po co jest rodzaj odczytu, jak liczy sie
            porownanie i co robi korekta. Kierownik ma wpisac liczbe z licznika i tyle
            (decyzja klienta 6.11.2026); dokument prowadzi ksiegowosc. */}
        {!tylkoKierownik && (<>
        <p>
          Odczyt ma <strong>rodzaj</strong>. <strong>Kontrolny</strong> tylko pokazuje, o ile
          ewidencja rozjeżdża się z licznikiem na ten moment - dokumentu nie rusza. Taki
          wpisuje się w trakcie miesiąca, choćby co piątek: dzięki temu widać, w którym
          tygodniu powstała rozbieżność, a w dokumencie nie przybywa pozycji.{' '}
          <strong>Na koniec miesiąca</strong> zamyka miesiąc - jeśli odczyt i GPS rozjeżdżają
          się o co najmniej kilometr, dopisuje w ewidencji <strong>pozycję korekcyjną</strong>{' '}
          wyróżnioną na niebiesko, żeby stan licznika w dokumencie zgadzał się z pojazdem.
          Korekta ma kilometry, więc wchodzi do sumy „Razem”, i bywa ujemna, gdy GPS naliczył
          więcej, niż auto faktycznie przejechało.
        </p>
        <p>
          Warto podać też <strong>godzinę odczytu</strong>. Bez niej porównanie obejmuje cały
          dzień - razem z kursami wykonanymi już PO spisaniu licznika, co przy aucie
          wracającym wieczorem do domu daje co tydzień ten sam, nieprawdziwy minus. Z godziną
          liczą się tylko trasy zakończone do tej pory. Trasy sprzed listopada 2026 nie mają
          w bazie godzin i liczą się całym dniem.
        </p>
        <p>
          Odczytu z miesiąca, którego danych GPS jeszcze nie ma, nic nie traci: zostaje
          zapisany, a korekta naliczy się sama po wgraniu danych. Pozycji korekcyjnej nie
          edytuje się w tabeli - zmienia się ją, poprawiając albo usuwając sam odczyt.
        </p>
        </>)}
      </Sekcja>

      <Sekcja tytul="Procedura rozliczania kilometrów (dokument wewnętrzny)">
        <p className="text-xs text-slate-500">
          Opis zasad, według których powstaje i jest weryfikowana ewidencja przebiegu
          pojazdu w Bioerg. Obowiązuje od ewidencji za listopad 2026.
        </p>

        <p><strong>1. Skąd biorą się kilometry.</strong> Trasy, daty i liczba kilometrów
        pochodzą z urządzeń GPS zamontowanych w pojazdach. Urządzenia nie są podłączone do
        komputera pokładowego ani do licznika - zasilane są wyłącznie z akumulatora, więc
        przebieg wyliczają z zarejestrowanych pozycji. Cel wyjazdu i osobę kierującą
        uzupełnia kierownik, i to on podpisuje ewidencję.</p>

        <p><strong>2. Znane ograniczenie urządzeń.</strong> Gdy pojazd stoi, odbiornik
        potrafi raportować kolejne pozycje nieco przesunięte względem siebie, a system
        dostawcy sumuje te przesunięcia do przebiegu. Dlatego przebieg przeliczamy
        samodzielnie i pomijamy odcinki, w których urządzenie raportuje zerową prędkość -
        prędkość mierzona jest niezależnie od pozycji i przy postoju wynosi zero. To
        ogranicza, ale nie usuwa całej rozbieżności, dlatego obowiązuje punkt 3.</p>

        <p><strong>3. Odczyt licznika jest obowiązkowy.</strong> Na ostatni dzień każdego
        miesiąca kierownik podaje stan licznika z deski rozdzielczej - w pełnych
        kilometrach, z godziną odczytu i ze zdjęciem licznika. Bez kompletu tych danych
        ewidencji nie da się wysłać do akceptacji. Godzina jest konieczna, bo porównanie
        obejmuje wyłącznie trasy zakończone do tej godziny; zdjęcie jest dowodem
        potwierdzającym odczyt, a aplikacja odczytuje z niego godzinę wykonania.</p>

        <p><strong>4. Jak rozliczana jest różnica.</strong> Aplikacja porównuje stan
        licznika z przebiegiem wynikającym z tras. Różnica poniżej jednego kilometra to
        zaokrąglenia i nie tworzy wpisu. Każda większa trafia do ewidencji jako osobna,
        wyróżniona <strong>pozycja korekcyjna</strong> z datą odczytu, nazwiskiem osoby,
        która go podała, i wskazaniem, że wynika z odczytu licznika. Dzięki temu stan
        licznika w dokumencie jest równy stanowi w pojeździe, a ślad po różnicy pozostaje
        widoczny. Różnic nie pomijamy i nie zaokrąglamy - korygujemy je jawnie.</p>

        <p><strong>5. Kontrola w trakcie miesiąca.</strong> Niezależnie od odczytu
        zamykającego miesiąc kierownicy podają odczyty kontrolne (co tydzień, w piątek po
        ostatnim przejeździe). Nie zmieniają one dokumentu - służą temu, żeby rozbieżność
        wykryć w tygodniu, w którym powstała, a nie dopiero po miesiącu.</p>

        <p><strong>6. Podział odpowiedzialności.</strong> Kierownik odpowiada za cel
        wyjazdu, osobę kierującą, odczyt licznika i podpis. Rozliczenie różnicy między
        licznikiem a danymi GPS należy do księgowości i administratora systemu - kierownik
        nie jest o nie pytany i nie może go obejść. Księgowość akceptuje ewidencję albo
        odsyła ją do poprawki ze wskazaniem konkretnych pozycji.</p>

        <p><strong>7. Ślad zmian.</strong> Każda zmiana w zaakceptowanej ewidencji wymaga
        uprawnień administratora, trafia do dziennika zmian wraz z poprzednią wartością
        i wymusza ponowne wygenerowanie archiwalnego pliku PDF.</p>
      </Sekcja>

      <Sekcja tytul="Droga ewidencji">
        <ol className="ml-4 list-decimal space-y-1">
          <li><strong>Wygenerowana</strong> — dane z GPS czekają na uzupełnienie.</li>
          <li><strong>W edycji</strong> — kierownik zaczął uzupełniać.</li>
          <li>
            <strong>Wysłana do akceptacji</strong> — kierownik uzupełnił cele i kierowców,
            wpisał stan licznika z deski rozdzielczej i podpisał się imieniem i nazwiskiem.
          </li>
          <li>
            <strong>Odesłana do poprawki</strong> — księgowość oddała ewidencję z komentarzem
            albo ze wskazanymi polami.
          </li>
          <li>
            <strong>Zaakceptowana</strong> — księgowość zatwierdziła. Powstaje podpisany PDF
            w archiwum, a ewidencja zostaje zablokowana do edycji.
          </li>
        </ol>
        <p>
          Przed wysłaniem do akceptacji aplikacja sprawdza, czy suma kilometrów z GPS zgadza
          się ze stanem licznika wpisanym przez kierownika. Duża różnica zwykle znaczy
          usterkę urządzenia GPS i wstrzymuje wysłanie, dopóki ktoś na to nie spojrzy.
        </p>
      </Sekcja>

      <Sekcja tytul="Maile z aplikacji">
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>Pierwszego dnia miesiąca</strong> — kierownik dostaje informację, że
            ewidencja za poprzedni miesiąc jest gotowa do uzupełnienia, ze spisem swoich
            pojazdów. Księgowość dostaje zestawienie całego taboru.
          </li>
          <li>
            <strong>Co dwa dni rano</strong> — przypomnienie dla kierownika, który ma coś do
            zrobienia: ewidencję nieoddaną albo odesłaną do poprawki. Przypomnienia nie
            wychodzą w niedziele ani w święta i kończą się same, gdy ewidencja trafi do
            akceptacji.
          </li>
          <li>
            <strong>Od razu po odesłaniu do poprawki</strong> — kierownik dostaje maila
            z komentarzem księgowości.
          </li>
          <li>
            <strong>Od razu po wysłaniu do akceptacji</strong> — księgowość dostaje
            informację, że jest co sprawdzić.
          </li>
        </ul>
        <p className="text-slate-600">
          Każdy mail dotyczy wyłącznie pojazdów przypisanych do danego kierownika. Wszystkie
          wychodzą z adresu <strong>ewidencjavat@bioerg.pl</strong> — warto dodać go do
          kontaktów, żeby nie trafiały do spamu.
        </p>
      </Sekcja>

      {ksiegowosc && (
        <Sekcja tytul="Co może księgowość">
          <ul className="ml-4 list-disc space-y-1">
            <li>Zatwierdzić ewidencję pojedynczo albo wszystkie naraz z poziomu listy.</li>
            <li>
              Odesłać do poprawki z komentarzem oraz wskazać konkretne komórki, które mają
              zostać poprawione.
            </li>
            <li>Pobrać wszystkie ewidencje okresu jako paczkę PDF albo Excel.</li>
            <li>
              Odblokować zatwierdzoną ewidencję — to usuwa podpis akceptacji i trzeba
              zatwierdzić ją ponownie.
            </li>
            <li>
              Odświeżyć archiwalny PDF, gdy dane poprawiono już po zatwierdzeniu. To nie
              rusza statusu ani podpisów.
            </li>
            <li>Zakładać i usuwać konta oraz podejrzeć historię wysłanych maili.</li>
            <li>
              Poprawiać pozycje <strong>bezpośrednio w tabeli</strong>, także gdy ewidencja
              jest już wysłana do akceptacji. Odsyłanie do poprawki ma sens, gdy czegoś nie
              wiadomo i musi to uzupełnić kierownik - literówkę szybciej poprawić samemu.
            </li>
            <li>Usuwać odczyty licznika razem z korektami, które z nich wynikły.</li>
          </ul>
        </Sekcja>
      )}

      {admin && (
        <Sekcja tytul="Uprawnienia administratora">
          <p>
            Konto administratora edytuje <strong>wszystkie kolumny na każdym etapie</strong>,
            również w ewidencji zaakceptowanej i również te pochodzące z GPS - datę wyjazdu
            i liczbę kilometrów. Komórki edytowalne tylko dla administratora mają bursztynową
            obwódkę.
          </p>
          <p>
            Dwie rzeczy dzieją się przy tym automatycznie: zmiana kilometrów{' '}
            <strong>przelicza stany licznika</strong> we wszystkich kolejnych miesiącach tego
            pojazdu, a każda poprawka trafia do dziennika zmian. Jedna rzecz nie dzieje się
            sama - po poprawce w ewidencji zaakceptowanej trzeba użyć{' '}
            <strong>„Odśwież PDF”</strong>, bo archiwalny plik powstał w chwili akceptacji
            i inaczej zostanie w starej wersji.
          </p>
        </Sekcja>
      )}

      <Sekcja tytul="Konto i hasło">
        <p>
          Logowanie służbowym adresem e-mail. Przy pierwszym logowaniu trzeba ustawić własne
          hasło. Hasło musi mieć co najmniej 10 znaków i jeden znak specjalny, a aplikacja
          odrzuca hasła, które pojawiły się w znanych wyciekach danych — sprawdza to tak, że
          samo hasło nigdy nie opuszcza przeglądarki.
        </p>
        <p>
          Zapomniane hasło odzyskuje się samodzielnie: na ekranie logowania jest „Nie pamiętam
          hasła”.
        </p>
      </Sekcja>
    </div>
  )
}
