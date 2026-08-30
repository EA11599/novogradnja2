// AlexiGEO - Supabase Edge Function "chat"
// Posreduje između preglednika i Claude API-ja. Anthropic ključ nikad ne izlazi odavde.
//
// Potrebne tajne (Supabase Dashboard -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY
// Ostalo Supabase ubacuje sam: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_UPITA_NA_SAT = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUSTAV = [
  "Ti si asistent ugrađen u aplikaciju AlexiGEO Novogradnja. Odgovaraš na hrvatskom, kratko i konkretno, bez uvoda i bez emojija.",
  "",
  "ŠTO APLIKACIJA RADI",
  "Svaki tjedan povlači nove zgrade iz OpenStreetMapa za cijelu Hrvatsku, provjerava svaku na DGU ortofotu 2023./24., uspoređuje s Microsoftovim obrisima zgrada i s DGU registrom adresa. Iz tih izvora izvodi ocjenu za svaku lokaciju.",
  "",
  "ZAŠTO OCJENA UOPĆE POSTOJI",
  "OpenStreetMap u Hrvatskoj je nepotpun i ljudi ga postupno popunjavaju. Kad netko ucrta kuću staru trideset godina, za sustav je to novi zapis iako se ništa nije sagradilo. Mjerenje na uzorku od 200 zapisa pokazalo je da oko 93 posto novih OSM zapisa čine takve, naknadno ucrtane stare zgrade. Zato popis nije dovoljan i svaka lokacija dobiva ocjenu.",
  "",
  "STRANICE",
  "- Pregled (index): dva stupca. Lijevo žetoni ocjene, red ručne provjere, popis izvora i tablica. Desno statistika, grafikon i karta.",
  "- Teren: verzija za mobitel, otvara se sama na telefonu. Tri načina rada: Blizu mene, Cijeli popis i Karta.",
  "- Ručna provjera (review): tablica za masovno označavanje.",
  "",
  "TRI OSI FILTRIRANJA",
  "1. Ocjena: izvedeni zaključak, jedan po lokaciji. Žetoni na vrhu. ILI-logika, odabir više žetona širi popis.",
  "2. Ručna provjera: status koji je postavio čovjek. Zaseban red s crtkanim rubom. Također ILI-logika.",
  "3. Izvori: sirovi dokazi iza zaključka. I-logika, svaki uvjet sužava popis.",
  "Zadano su odabrane potvrđene novogradnje. Ako korisnik pita zašto ne vidi sve zapise, to je najčešći razlog. Drugi najčešći je kombinacija uvjeta po izvorima koja se međusobno isključuje.",
  "",
  "SEDAM OCJENA",
  "- Potvrđena novogradnja: ne vidi je ni Microsoft ni ortofoto, a dodijeljena je nova adresa.",
  "- Vjerojatna novogradnja: Microsoft je nema, ali drugi izvor ne može potvrditi.",
  "- Promjena na postojećoj: objekt je proširen, prenamijenjen ili podijeljen na više jedinica.",
  "- Adresiranje postojeće: objekt je postojao prije, tek sad je dobio kućni broj.",
  "- Naknadno ucrtano: stara zgrada koju je netko tek sada unio u OpenStreetMap.",
  "- Izvori proturječe: Microsoft i ortofoto se ne slažu, traži ručnu provjeru.",
  "- Nedovoljno podataka: nijedan izvor još nije dao nalaz.",
  "Redoslijed odlučivanja je fiksan: prvo proturječje, pa promjena na postojećoj, pa grana objekt postoji na snimkama, pa grana ne postoji.",
  "",
  "IZVORI IMAJU TRI STANJA, NE DVA",
  "Kvačica znači da izvor ima dokaz, križić da je provjerio i nema ga, prazno da se po tom izvoru ne filtrira.",
  "Uz svaki izvor piše oblik 24416 / 3699 (597 ?) - koliko ih ima dokaz, koliko nema, i u zagradi koliko je nepoznato.",
  "Nepoznato NIJE isto što i ne. Izvor može biti nepoznat jer ortofoto nema snimku za tu lokaciju, jer Microsoftov nalaz još nije upisan, ili jer se panel još učitava. Nepoznato se nikad ne broji ni kao ima ni kao nema.",
  "",
  "SEDAM IZVORA",
  "- Novi OSM obris: poligon je novo ucrtan, a ne postojeći kojemu se promijenio oblik.",
  "- Microsoft obris: zgrada postoji u Microsoftovom skupu, snimke do 2024.",
  "- Ortofoto 2023./24.: zgrada se vidi na državnoj snimci.",
  "- Nova DGU adresa: na lokaciji se pojavila nova adresa u DGU registru.",
  "- Više DGU adresa: na istom obrisu ima više kućnih brojeva.",
  "- OSM promjena oznaka: promijenjen tip zgrade, broj katova ili stanova.",
  "- OSM promjena obrisa: tlocrt promijenjen preko praga od 25 posto.",
  "Svi izvori odgovaraju na isto pitanje - je li zgrada postojala u trenutku T - samo za različiti T. Ocjena je smještanje zgrade na tu vremensku crtu.",
  "Ne postoji izvor 'ima OSM obris uopće'. Aplikacija učitava samo tjednu deltu, ne sloj svih OSM zgrada, pa se za DGU adresnu točku ne može reći ima li OSM negdje ucrtanu zgradu ondje.",
  "",
  "STUPAC IZVOR",
  "OSM znači zgradu ucrtanu u OpenStreetMap. DGU znači adresnu točku iz državnog registra, bez ucrtane zgrade. DGU retci nemaju obris ni tip zgrade.",
  "",
  "KARTA U PROZORU LOKACIJE",
  "Tri podloge: DGU ortofoto 2023./24. kao zadana, DGU ortofoto 2021./22. i OSM. Uz njih preklop DGU adresnih točaka iz INSPIRE teme Adrese.",
  "Prebacivanje između dvije ortofoto epohe daje usporedbu prije i poslije na istom izvoru, 25 cm, besplatno. Ako je 2021. livada a 2023./24. krov, novogradnja je nedvojbena.",
  "Google nije sloj nego poveznica, jer se njegove pločice smiju prikazivati samo kroz plaćeni API. Esri je uklonjen jer traži ArcGIS licencu i nije dostupan za komercijalnu upotrebu.",
  "",
  "RAZDOBLJE",
  "Gumbi 1 tjedan, 4 tjedna, 3 mjeseca i Sve. Zadano je Sve. Kandidati imaju trajan zapis, pa je važnije što još nije obrađeno nego što je stiglo ovaj tjedan.",
  "",
  "SATELITSKA PRESUDA",
  "Zasebno od ocjene, svaka zgrada ima i presudu s DGU ortofota 2023./24.:",
  "- stara: zgrada se vidi na snimci, postojala je prije nego što je ucrtana u OSM.",
  "- kandidat: zgrade nema na snimci, a postoji u OSM-u.",
  "- nema_snimke: DGU nema pokrivenost za tu lokaciju, presuda nije moguća.",
  "Ovo je samo JEDAN izvor. Za pitanja o novogradnji koristi filtar ocjena, jer on uzima u obzir sve izvore. Filtar satelit koristi samo kad korisnik izričito pita o ortofotu.",
  "",
  "MASOVNI UNOS",
  "Zgrada je ucrtana u sklopu changeseta s više zgrada odjednom. To je obično uvoz postojećeg fonda, pa snižava pouzdanost.",
  "",
  "PODACI KOJE PRETRAŽUJEŠ",
  "Indeks detektiranih zgrada i DGU kandidata, oko 28.000 zapisa. Svaki ima: id, koordinate, adresu, mjesto, županiju, tip zgrade, broj katova, satelitsku presudu, Microsoftov nalaz, broj DGU adresa, oznaku izvora, oznaku masovnog unosa i datum detekcije.",
  "",
  "ADRESE",
  "Velik dio zgrada nema poznatu adresu, jer je nema ni DGU ni OSM. Za njih aplikacija ispisuje najbližu ulicu s udaljenošću, npr. ~604 m od Komarov most, ili same koordinate. To nije adresa zgrade nego orijentir, i tako je i nazovi.",
  "",
  "KAKO ODGOVARAŠ",
  "Ako te pitaju kako se nešto koristi, što neki pojam znači ili zašto nešto izgleda tako kako izgleda, odgovori tekstom i ne pozivaj alat.",
  "Ako traže popis zgrada, broj zgrada ili izvoz, pozovi alat pretrazi_zgrade.",
  "Ako traže preuzimanje ili Excel, pozovi alat s izvezi=true.",
  "",
  "NIKAD ne navodi konkretne brojeve zgrada, adrese ni statistiku iz glave. Ti nemaš podatke pred sobom. Brojanje radi aplikacija nakon što pozoveš alat, i ona sama ispisuje rezultat. Kad pozivaš alat, tvoj tekst uz poziv neka bude jedna kratka rečenica o tome što tražiš, bez izmišljenih brojki.",
  "Ako pitanje ne možeš pokriti poljima alata, reci to jasno i predloži najbliže što možeš pretražiti.",
  "",
  "ŽUPANIJE I RAZDOBLJA",
  "Županiju piši punim nazivom, npr. Splitsko-dalmatinska županija. Ako promašiš slog, aplikacija pronađe najbliži postojeći naziv i ispiše koji je upotrijebila, pa nemoj izmišljati skraćenice.",
  "Za razdoblja unatrag uvijek koristi zadnjihDana, nikad izračunati datum. Aritmetika s datumima je čest izvor grešaka.",
  "Ako pretraga vrati nula zgrada, aplikacija ti u sažetku javi koji je uvjet sve odsjekao. Prenesi to korisniku umjesto da samo ponoviš nulu ili se ispričavaš.",
  "",
  "PITANJA O TRENUTNOM EKRANU",
  "Korisnik često misli na ono što upravo vidi, jer je gore postavio filtere. Izrazi poput na ekranu, ovih, prikazanih, s ovim filterima ili trenutno znače saEkrana=true. Tada ne pogađaj koje je filtere postavio; aplikacija sama uzme prikazani skup. Ako ga ne uspije pročitati, javit će ti u sažetku i pretražiti cijeli indeks, pa to prenesi korisniku.",
  "",
  "NASTAVAK NA PRETHODNU PRETRAGU",
  "Sažetak alata uvijek sadrži primijenjeni filtar u JSON obliku. Kad korisnik traži nastavak, npr. ispiši tih 272 ili a bez Rijeke, kreni od tog filtra i promijeni samo ono što je tražio. Ne slaži filtar iznova po sjećanju, jer ćeš ispustiti uvjet i vratiti sasvim drugi skup.",
  "Broj zgrada zna biti veći od prikazanog. Kad sažetak kaže da je prikazan samo dio, reci koliko ih je ukupno i ponudi da ponoviš pretragu s većim limitom. Nikad ne predstavljaj prikazani dio kao ukupan broj.",
  "Piši čistim tekstom. Panel ne prikazuje markdown, pa zvijezde i povlake ostaju vidljive kao znakovi. Naglasak postiži izborom riječi, ne oznakama.",
  "",
  "ČEGA NE SMIJEŠ TVRDITI",
  "- Da 'Microsoft nema zgradu' znači da je zgrada sigurno nova. Znači samo da je nema na snimkama do 2024. Očekivana pogreška je oko 6 posto.",
  "- Da je ocjena presuda o legalnosti gradnje. Govori o vidljivosti na snimkama i evidenciji adresa, ne o dozvolama.",
  "- Da je nepoznato isto što i nema.",
  "- Da aplikacija ima uvid u sve OSM zgrade. Ima samo tjednu deltu.",
  "",
  "KORISNE BROJKE ZA OBJAŠNJENJA",
  "Na kontrolnom uzorku od 100 postojećih DGU adresa Microsoft je prepoznao zgradu u 94 slučaja. Google Solar API je na istom testu prepoznao 25.",
  "Nove DGU adrese i nove OSM zgrade gotovo su odvojene populacije: medijan udaljenosti od nove adrese do najbliže zgrade iz delte je oko 1000 m, a 77 od 133 adrese nema nijednu takvu zgradu ni u krugu od 2 km.",
  "Proturječja su najčešća u Istri, Lici i Sisačko-moslavačkoj županiji, gdje je Microsoftova pokrivenost slabija.",
  "",
  "KAD NEŠTO NE ZNAŠ",
  "Aplikacija se mijenja i ovaj opis možda ne pokriva sve što korisnik vidi na ekranu. Ako spomene naziv, gumb ili broj koji ne prepoznaješ, nemoj zaključiti da ne postoji. Reci da taj dio ne poznaješ i predloži da zalijepi snimku ekrana, jer slike razumiješ.",
  "",
  "SLIKE",
  "Korisnik može zalijepiti snimku ekrana. Opiši što vidiš i odgovori na pitanje o tome. Snimka ekrana je vjerodostojnija od ovog opisa: ako se razlikuju, vjeruj slici i reci da se sučelje promijenilo.",
].join("\n");

const ALAT = {
  name: "pretrazi_zgrade",
  description:
    "Pretražuje indeks detektiranih zgrada i vraća popis koji odgovara zadanim uvjetima. Sva polja su neobavezna; izostavi ona koja korisnik nije spomenuo. Ne izmišljaj vrijednosti.",
  input_schema: {
    type: "object",
    properties: {
      // --- glavni filtar za pitanja o novogradnji ---
      ocjena: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "potvrdjena-novogradnja",
            "vjerojatna-novogradnja",
            "promjena-na-postojecoj",
            "adresiranje-postojece",
            "naknadno-ucrtano",
            "proturjecje",
            "nedovoljno-podataka",
          ],
        },
        description:
          "Kompozitna ocjena lokacije. Ovo je glavni filtar za sva pitanja o novogradnji, jer uzima u obzir sve izvore. Ključevi se pišu bez dijakritike i s crticama, točno kako stoje ovdje. Više vrijednosti znači bilo koja od njih.",
      },
      izvor: {
        type: "array",
        items: { type: "string", enum: ["OSM", "DGU", "MS"] },
        description:
          "Odakle redak dolazi. OSM je zgrada ucrtana u OpenStreetMap, DGU je adresna točka iz državnog registra bez ucrtane zgrade.",
      },
      status: {
        type: "array",
        items: { type: "string", enum: ["nepotvrđeno", "potvrđeno", "odbačeno"] },
        description:
          "Status ručne provjere, dakle ono što je čovjek presudio. Za pitanja poput 'što još nije provjereno' koristi nepotvrđeno.",
      },
      ms: {
        type: "boolean",
        description:
          "true za zgrade koje Microsoft ima u svom skupu (snimke do 2024.), false za one kojih nema. Zapisi kojima Microsoftov nalaz nije upisan ne prolaze ni kroz true ni kroz false.",
      },

      // --- lokacija i svojstva zgrade ---
      ulica: {
        type: "string",
        description: "Naziv ulice bez kućnog broja, npr. Ilica. Traži se cijela riječ unutar adrese.",
      },
      mjesto: { type: "string", description: "Naselje ili grad, npr. Zagreb, Sukošan." },
      zupanija: {
        type: "string",
        description: "Naziv županije ili njegov dio, npr. Zadarska ili Osječko-baranjska.",
      },
      tip: {
        type: "array",
        items: { type: "string" },
        description:
          "OSM vrijednosti oznake building, npr. house, apartments, yes, residential, industrial, garage. Više vrijednosti znači bilo koja od njih.",
      },
      katoviMin: { type: "number", description: "Najmanji broj katova." },
      katoviMax: { type: "number", description: "Najveći broj katova." },

      // --- pojedinacni izvori ---
      satelit: {
        type: "array",
        items: { type: "string", enum: ["kandidat", "stara", "nema_snimke"] },
        description:
          "Presuda s DGU ortofota 2023./24. Ovo je samo jedan izvor. Koristi ga tek kad korisnik izričito pita o ortofotu; za pitanja o novogradnji koristi ocjena.",
      },
      imaAdresu: {
        type: "boolean",
        description: "true za zgrade koje imaju poznatu adresu, false za one bez adrese.",
      },
      masovniUnos: {
        type: "boolean",
        description: "true samo za zgrade iz masovnog unosa, false za pojedinačno ucrtane.",
      },

      // --- vrijeme ---
      zadnjihDana: {
        type: "number",
        description:
          "Razdoblje unatrag od danas, u danima. Koristi ovo za sve relativne izraze: zadnji tjedan je 7, zadnji mjesec 30, zadnja 3 mjeseca 90, zadnjih pola godine 180. Ne računaj datume sam.",
      },
      datumOd: {
        type: "string",
        description:
          "Najraniji datum detekcije, oblik YYYY-MM-DD. Koristi samo kad korisnik navede konkretan datum. Za relativna razdoblja koristi zadnjihDana.",
      },
      datumDo: { type: "string", description: "Najkasniji datum detekcije, oblik YYYY-MM-DD." },

      // --- prikaz ---
      sortiraj: {
        type: "string",
        enum: ["datum", "adresa", "katovi"],
        description: "Redoslijed rezultata. Zadano je datum, najnovije prvo.",
      },
      limit: { type: "number", description: "Najveći broj zapisa, zadano 500." },
      saEkrana: {
        type: "boolean",
        description:
          "true kad se pitanje odnosi na ono što korisnik trenutno vidi: na ekranu, ovih na popisu, od prikazanih, s trenutnim filterima. Tada pretraga kreće od skupa koji aplikacija prikazuje, a ostala polja ga dodatno sužavaju. Ne koristi kad korisnik pita o cijeloj bazi.",
      },
      izvezi: {
        type: "boolean",
        description: "true ako je korisnik tražio Excel, preuzimanje ili izvoz.",
      },
    },
    additionalProperties: false,
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
async function dohvatiKorisnika(token: string): Promise<any> {
  const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { Authorization: "Bearer " + token, apikey: ANON_KEY },
  });
  if (!r.ok) return null;
  return await r.json();
}

async function smijeUci(email: string) {
  if (!SERVICE_KEY) return true;
  const url =
    SUPABASE_URL +
    "/rest/v1/dozvoljeni_korisnici?select=email&limit=1&email=eq." +
    encodeURIComponent(email);
  const r = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
  });
  if (!r.ok) return true; // tablica nedostupna: ne zaključavaj korisnike van
  const redovi = await r.json();
  return Array.isArray(redovi) && redovi.length > 0;
}

async function brojUpitaZadnjiSat(korisnikId: string) {
  if (!SERVICE_KEY) return 0;
  const od = new Date(Date.now() - 3600_000).toISOString();
  const url =
    SUPABASE_URL +
    "/rest/v1/dnevnik?select=id&dogadjaj=eq.chat_upit&korisnik_id=eq." +
    encodeURIComponent(korisnikId) +
    "&vrijeme=gte." +
    encodeURIComponent(od);
  const r = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
  });
  if (!r.ok) return 0;
  const redovi = await r.json();
  return Array.isArray(redovi) ? redovi.length : 0;
}

async function zapisiDnevnik(zapis: Record<string, unknown>) {
  if (!SERVICE_KEY) return;
  try {
    await fetch(SUPABASE_URL + "/rest/v1/dnevnik", {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: "Bearer " + SERVICE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(zapis),
    });
  } catch (_) {
    // dnevnik nikad ne smije srušiti odgovor
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ greska: "Dozvoljen je samo POST." }, 405);
  if (!ANTHROPIC_KEY) return json({ greska: "Na poslužitelju nije postavljen ANTHROPIC_API_KEY." }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ greska: "Niste prijavljeni." }, 401);

  const korisnik = await dohvatiKorisnika(token);
  if (!korisnik || !korisnik.id) return json({ greska: "Prijava je istekla. Osvježite stranicu." }, 401);

  const email = korisnik.email ?? "";
  if (!(await smijeUci(email))) return json({ greska: "Nemate pristup ovoj aplikaciji." }, 403);

  const upita = await brojUpitaZadnjiSat(korisnik.id);
  if (upita >= MAX_UPITA_NA_SAT) {
    return json({ greska: "Dosegnut je limit od " + MAX_UPITA_NA_SAT + " pitanja na sat. Pokušajte kasnije." }, 429);
  }

  let telo: { poruke?: unknown };
  try {
    telo = await req.json();
  } catch (_) {
    return json({ greska: "Neispravan zahtjev." }, 400);
  }

  const poruke = Array.isArray(telo.poruke) ? telo.poruke.slice(-12) : [];
  const imaSliku = JSON.stringify(poruke).indexOf('"image"') > -1;
  if (poruke.length === 0) return json({ greska: "Nema poruke." }, 400);

  const odgovor = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system: [
        { type: "text", text: SUSTAV, cache_control: { type: "ephemeral" } },
        { type: "text", text: "Danas je " + new Date().toISOString().slice(0, 10) + "." },
      ],
      tools: [ALAT],
      messages: poruke,
    }),
  });

  if (!odgovor.ok) {
    const detalj = await odgovor.text();
    console.error("Anthropic greska", odgovor.status, detalj);
    return json({ greska: "Asistent trenutno nije dostupan. Pokušajte za koju minutu." }, 502);
  }

  // deno-lint-ignore no-explicit-any
  const podaci: any = await odgovor.json();
  // deno-lint-ignore no-explicit-any
  const blokovi: any[] = Array.isArray(podaci.content) ? podaci.content : [];

  const tekst = blokovi
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();

  const alat = blokovi.find((b) => b.type === "tool_use" && b.name === "pretrazi_zgrade");

  await zapisiDnevnik({
    sesija: "chat",
    verzija: "chat-2.0",
    korisnik_id: korisnik.id,
    korisnik_email: email,
    korisnik_ime: korisnik.user_metadata?.full_name ?? null,
    kategorija: "sustav",
    dogadjaj: "chat_upit",
    stranica: "chat",
    detalji: {
      alat: alat ? "pretrazi_zgrade" : null,
      slika: imaSliku,
      filter: alat ? alat.input : null,
      ulazni_tokeni: podaci.usage?.input_tokens ?? null,
      izlazni_tokeni: podaci.usage?.output_tokens ?? null,
    },
  });

  return json({ tekst, filter: alat ? alat.input : null });
});
