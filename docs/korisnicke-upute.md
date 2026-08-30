# AlexiGEO — upute za korisnike

Aplikacija prati pojavu novih zgrada u Hrvatskoj i pomaže odvojiti stvarnu
novogradnju od zapisa koji samo *izgledaju* novo.

Postoje dva ekrana. Na računalu se otvara puni pregled, na telefonu terenski.
Prebacivanje ide preko izbornika pod ikonom korisnika gore desno; izbor se
pamti, pa te sljedeći put aplikacija otvori ondje gdje si zadnji put bio.

---

## Zašto uopće treba prosuđivati

Popis novih zgrada dolazi iz OpenStreetMapa, a OSM u Hrvatskoj je nepotpun i
ljudi ga postupno popunjavaju. Kad netko ucrta kuću staru trideset godina, za
naš sustav je to novi zapis — iako se ništa nije sagradilo.

Na uzorku od 200 zapisa pokazalo se da oko **93%** čine upravo takve, naknadno
ucrtane stare zgrade. Zbog toga aplikacija ne pokazuje samo popis, nego za
svaku lokaciju daje ocjenu i dokaze na kojima ta ocjena počiva.

---

## Ocjena

Svaka lokacija dobiva jedno od sedam stanja. Žetoni na vrhu popisa filtriraju
po njima; klik uključuje ili isključuje stanje, a može ih se odabrati više.

| Ocjena | Što znači |
|---|---|
| **Potvrđena novogradnja** | Ne vidi je ni Microsoft ni državni ortofoto, a dodijeljena je nova adresa. |
| **Vjerojatna novogradnja** | Microsoft je nema, ali drugi izvor ne može potvrditi. |
| **Promjena na postojećoj** | Objekt je proširen, prenamijenjen ili podijeljen na više jedinica. |
| **Adresiranje postojeće** | Objekt je postojao prije, tek sad je dobio kućni broj. |
| **Naknadno ucrtano** | Stara zgrada koju je netko tek sada unio u OpenStreetMap. |
| **Izvori proturječe** | Microsoft i ortofoto se ne slažu — traži ručnu provjeru. |
| **Nedovoljno podataka** | Nijedan izvor još nije dao nalaz. |

Zadano su odabrane **potvrđene novogradnje**, jer je to posao koji se stvarno
obilazi. Ostala stanja su jedan klik dalje.

Ako te zanima *zašto* neka lokacija ima određenu ocjenu, zadrži pokazivač nad
oznakom u retku — u opisu stoji obrazloženje.

---

## Izvori

Ispod žetona je popis od sedam izvora. Svaki ima **tri** stanja, ne dva:

| Klik | Značenje |
|---|---|
| prazan kvadratić | ne filtriraj po ovom izvoru |
| ✓ | prikaži samo one gdje izvor **ima** dokaz |
| ✕ | prikaži samo one gdje izvor **nema** dokaz |

Uz svaki izvor piše `24416 / 3699 (597 ?)` — koliko ih ima dokaz, koliko nema,
i u zagradi koliko je **nepoznato**.

**Nepoznato nije isto što i ne.** Izvor može biti nepoznat jer ortofoto nema
snimku za tu lokaciju, jer podatak još nije preuzet, ili jer se panel još
učitava. Takvi zapisi ne ulaze ni u ✓ ni u ✕.

Sedam izvora:

- **Novi OSM obris** — poligon je novo ucrtan, a ne postojeći kojemu se
  promijenio oblik
- **Microsoft obris** — zgrada postoji u Microsoftovom skupu (snimke do 2024.)
- **Ortofoto 2023./24.** — zgrada se vidi na državnoj snimci
- **Nova DGU adresa** — na lokaciji se pojavila nova adresa u DGU registru
- **Više DGU adresa** — na istom obrisu ima više kućnih brojeva
- **OSM promjena oznaka** — promijenjen tip zgrade, broj katova ili stanova
- **OSM promjena obrisa** — tlocrt promijenjen preko praga od 25%

Filtri po izvorima kombiniraju se **I-logikom**: svaki dodatni uvjet sužava
popis. Ako odjednom ne vidiš ništa, najčešće su dva uvjeta koja se međusobno
isključuju.

---

## Ručna provjera

Poseban red žetona, s crtkanim rubom: **Nepotvrđeno · Potvrđeno · Odbačeno**.

Crtkani rub razlikuje ono što ti presudiš od onoga što sustav zaključi. Ocjena
i izvori su strojni nalaz; status je ljudska odluka i ima prednost.

Status se mijenja u prozoru pojedine lokacije, uz neobaveznu napomenu. Zapisuje
se tko je i kad presudio.

---

## Stupac Izvor

| Oznaka | Odakle redak dolazi |
|---|---|
| **OSM** | zgrada ucrtana u OpenStreetMap |
| **DGU** | adresna točka iz državnog registra, bez ucrtane zgrade |

DGU retci nemaju obris ni tip zgrade — to nisu poligoni nego točke. Za njih je
često najzanimljivije upravo to što OSM na toj lokaciji **nema ništa**.

---

## Prozor pojedine lokacije

Klik na redak otvara prozor s kartom i tri podloge koje se prebacuju:

- **DGU ortofoto 2023./24.** — zadano, službena snimka na 25 cm
- **DGU ortofoto 2021./22.** — prethodna epoha
- **OSM** — pokazuje točno onaj poligon koji je mapper ucrtao

Uz njih ide i preklop **DGU adresne točke** koji crta sve službene adrese u
okolici.

Prebacivanje između dvije ortofoto epohe je najjači dokaz koji imaš: ako je
2021. livada, a 2023./24. krov, novogradnja je nedvojbena i znaš razdoblje
unutar dvije godine.

Gumb ⛶ u kutu razvuče kartu preko cijelog zaslona. Esc je vraća, drugi Esc
zatvara prozor. Crveni ✕ na karti zatvara oboje odjednom.

Ispod karte su podaci iz DGU registra prostornih jedinica. Kad je broj adresnih
točaka veći od jedan, uz njega piše **više jedinica** — za telekom je to broj
priključaka na jednom objektu.

Google Maps ostaje kao poveznica, ne kao sloj. Njegove snimke Hrvatske dolaze
od Airbusa i Maxara i znaju biti stare i po desetljeće.

---

## Razdoblje i ostali filtri

Gumbi **1 tjedan / 4 tjedna / 3 mjeseca / Sve** sužavaju popis po datumu
otkrivanja. Zadano je "Sve" — kandidat od prije deset tjedana koji nitko nije
provjerio vredniji je od jučerašnjeg koji je već odbačen, a uzak prozor taj
zaostatak skriva.

**Tip zgrade / katovi** i **Županije** otvaraju padajuće panele. Sve što
odabereš prikazuje se kao žeton ispod, s × za pojedinačno uklanjanje.

---

## Terenski ekran

Otvara se sam na telefonu. Tri načina rada:

**Blizu mene** — zgrade unutar odabranog radijusa, najbliže prve. Traži
dopuštenje za lokaciju.

**Cijeli popis** — sve što odgovara filtrima.

**Karta** — sve rezultate na jednoj karti, obojene po ocjeni. Ovo popis ne može
pokazati: dvadeset adresa u istoj ulici izgleda isto kao dvadeset razbacanih po
županiji, a za planiranje obilaska je razlika presudna. Dodir na točku izvlači
karticu odozdo; karta ostaje vidljiva iznad.

**Sortiranje** je u panelu filtera: zadano, najbliže, najnovije, adresa A–Ž ili
po ocjeni.

Kartica se otvara dodirom i sadrži istu kartu s tri sloja, podatke, gumbe
Potvrdi i Odbaci, polje za napomenu te poveznice na navigaciju i Street View.

Sve se sprema odmah i vidljivo je i na punom pregledu.

---

## Izvoz

Gumb **Izvoz u Excel** nudi izvoz trenutne liste sa svim aktivnim filtrima,
ili po županijama u zasebne listove.

---

## Česta pitanja

**Zašto piše "Naknadno ucrtano" kad je zgrada nova u popisu?**
Popis prati kad je zgrada ušla u OpenStreetMap, a ne kad je sagrađena.

**Zašto "Izvori proturječe"?**
Dva su slučaja. Microsoft ima zgradu a ortofoto je ne pokazuje — rušenje ili
lažna detekcija. Ortofoto pokazuje a Microsoft nema — rupa u Microsoftovoj
pokrivenosti, najčešća u Istri, Lici i Sisačko-moslavačkoj.

**Koliko je Microsoft pouzdan?**
Na kontrolnom uzorku od 100 postojećih adresa prepoznao je zgradu u 94 slučaja.
Google Solar API je na istom testu prepoznao 25.

**Znači li "Microsoft nema zgradu" da je zgrada sigurno nova?**
Ne. Znači samo da je nema na snimkama do 2024. Očekivana pogreška je oko 6%.

**Je li ocjena presuda o legalnosti gradnje?**
Nije. Govori o vidljivosti na snimkama i evidenciji adresa, ne o dozvolama.
