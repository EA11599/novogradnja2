Prenosim saznanja iz paralelne sesije (radili smo istraživanje dok je glavni razvoj tekao ovdje kod tebe) — nastavljam odavde.

## Nalaz 1: Kućni broj se dodjeljuje NAKON izgradnje, ne prije — pretpostavka o brzini DGU-a je obrnuta

Provjereno na gov.hr i Grad Rijeka: *"Svakoj zgradi NAKON izgradnje potrebno je... odrediti pripadajući kućni broj."* Kućni broj se traži tek kad je zgrada fizički gotova (barem "pod krovom" — postoji čak i članak s tim doslovnim naslovom o toj specifičnoj situaciji), i to **na zahtjev vlasnika** ili po službenoj dužnosti — nije automatski. Čak i bespravna gradnja dobiva kućni broj (dodjela nema veze s legalizacijom).

**Praktična posljedica:** DGU adresa NIJE rani indikator gradnje. Satelitska/AI detekcija (Microsoft) može uhvatiti zgradu čim je fizički vidljiva odozgo; DGU adresa čeka da vlasnik aktivno podnese zahtjev, što može potrajati tjednima/mjesecima nakon što je zgrada gotova. DGU treba tretirati kao **kasniju potvrdu visoke pouzdanosti**, ne kao ranu detekciju. Ovo mijenja prioritet — DGU delta je vrijedna za potvrdu, ne za najavu.

## Nalaz 2: Ideja o "posuđivanju" DGU ID-ja za Microsoft/ESM poligone — izvediva, ali ograničenog dosega

Konkretna ideja koju je [ime/korisnik] predložio: pošto Microsoft/ESM building footprint poligoni **nemaju stalan ID** (svaki novi AI-snimak generira nove, neovisne poligone čak i za nepromijenjenu zgradu — za razliku od OSM-a gdje isti objekt zadržava ID kroz uređivanja), predloženo je prostorno spajanje: DGU adresna točka (koja IMA stalan, službeni ID) unutar/blizu Microsoft poligona → taj poligon "posuđuje" DGU-in `address_id` kao svoj stalan identifikator za praćenje kroz vrijeme.

**Zaključak: tehnički zdrava ideja, vrijedi je implementirati, ALI:**
- Radi samo za poligone koji **već imaju** dodijeljenu DGU adresu
- Zbog Nalaza 1 (DGU kasni za izgradnjom), upravo **najnovije, netom detektirane zgrade** (one koje najviše zanimaju za "novogradnja" use-case) **vjerojatno još nemaju** DGU adresu u trenutku prve satelitske/AI detekcije
- Za taj "prazan hod" (zgrada fizički postoji, detektirana AI-jem, ali još nema DGU ID) i dalje treba neki oblik **geometrijskog praćenja bez stalnog ID-ja** (npr. privremeno praćenje kao "kandidat" dok/ako kasnije ne dobije DGU adresu, trenutak kad preuzima njen ID i postaje "potvrđeno")
- Postojeći kod već ima obrazac tolerancije za ovakvo prostorno podudaranje (`TOLERANCIJA_M = 8` u `scripts/proba-ms-obrisi.js`, korišteno za MS↔OSM podudaranje) — isti pristup/toleranciju vrijedi ponovno iskoristiti za MS↔DGU podudaranje, radi dosljednosti

## Nalaz 3: Postojeći MS-vs-OSM test (uzorak200.json) — kvantitativna potvrda problema pokrivenosti

Test na 200 nasumičnih Microsoft-detektiranih zgrada: samo **15 (7,5%)** ima odgovarajuću OSM zgradu unutar tolerancije. Ovo brojčano potvrđuje ono što smo vizualno vidjeli u Požegi (OSM nedostaje cijela lijeva strana ulice) — Microsoft pokrivenost je značajno bolja od OSM-a za Hrvatsku, barem u tom uzorku.

## Nalaz 4: Google Solar API kao dodatni izvor (već testiran, `test-solar-api.js`, `kontrola.json`)

Usput sam saznao (i vrijedno je zapamtiti kao ispravak moje ranije tvrdnje da "Google nema javni footprint API") — **Google Solar API** (namijenjen za procjenu solarnih panela) usput vraća i obris zgrade + datum satelitske snimke korištene za tu procjenu. Test na 20 DGU adresa: 5 pronađeno preko Google-a, s podacima o datumu snimke i kvaliteti. Ovo je već integrirano kao treći sloj provjere (uz MS i OSM).

## Sljedeći korak (nije još implementirano)

Dizajnirati "hibridni" pristup: nova zgrada bez OSM/DGU podataka → detektira se preko MS/ESM geometrije (bez stalnog ID-ja, praćena privremeno) → kad/ako dobije DGU adresu, prostorno se spaja i "promovira" u trajno praćenu, potvrđenu zgradu s pravim ID-jem. Treba odlučiti kako prikazati taj "prijelazni" status na korisničkom sučelju (treća kategorija uz postojeće "potvrđena novogradnja" / "novi zapis").
