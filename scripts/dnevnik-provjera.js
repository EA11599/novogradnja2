// Dnevna provjera dnevnika: pita Supabase ima li novih gresaka u zadnja 24
// sata i, ako ih ima, otvara GitHub Issue sa sazetkom. Ako ih nema, ne radi
// nista - bez obavijesti znaci da je sve u redu.
//
// Pokrece se iz .github/workflows/dnevnik-provjera.yml (svaki dan + rucno).
//
// Trazi dvije varijable okruzenja:
//   SUPABASE_SERVICE_KEY - servisni kljuc (GitHub Secret), zaobilazi RLS
//   GITHUB_TOKEN         - automatski dostupan u Actions, za otvaranje Issuea

const SUPABASE_URL = "https://stbknyvbduzrgnbmhpxl.supabase.co";

// Dogadjaji koji NISU problemi nego normalan rad aplikacije. Bez ovog popisa
// bi svaka obavijest bila zatrpana telemetrijom i prestao bi je citati.
const RUTINSKI = new Set([
  "kontekst_preglednika",
  "prozor_ucitan",
  "mreza_prekinuta",
  "mreza_vracena",
  "rucni_test",
]);

// Koliko sati unatrag gledamo. 25 umjesto 24 da se zbog kasnjenja rasporeda
// ne dogodi rupa izmedju dva pokretanja.
const SATI_UNATRAG = 25;

function opisGreske(z) {
  const d = z.detalji || {};
  return (
    d.poruka ||
    (d.greska && d.greska.poruka) ||
    d.adresa ||
    d.tekst ||
    d.razlog ||
    "(bez opisa)"
  );
}

async function dohvatiZapise() {
  const kljuc = process.env.SUPABASE_SERVICE_KEY;
  if (!kljuc) throw new Error("Nedostaje SUPABASE_SERVICE_KEY (GitHub Secret).");

  const od = new Date(Date.now() - SATI_UNATRAG * 3600 * 1000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/dnevnik` +
    `?select=vrijeme,sesija,verzija,korisnik_email,korisnik_ime,kategorija,dogadjaj,stranica,detalji` +
    `&kategorija=in.(greska,sustav)` +
    `&vrijeme=gte.${encodeURIComponent(od)}` +
    `&order=vrijeme.desc` +
    `&limit=2000`;

  const res = await fetch(url, {
    headers: {
      apikey: kljuc,
      Authorization: `Bearer ${kljuc}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const tekst = await res.text();
    throw new Error(`Supabase ${res.status}: ${tekst.slice(0, 300)}`);
  }
  return res.json();
}

function grupiraj(zapisi) {
  const grupe = new Map();
  zapisi.forEach((z) => {
    if (RUTINSKI.has(z.dogadjaj)) return;
    const opis = opisGreske(z);
    const kljuc = `${z.dogadjaj}||${opis}`;
    if (!grupe.has(kljuc)) {
      grupe.set(kljuc, {
        dogadjaj: z.dogadjaj,
        opis,
        puta: 0,
        korisnici: new Set(),
        sesije: new Set(),
        stranice: new Set(),
        verzije: new Set(),
        poKorisniku: new Map(),
        zadnji: z.vrijeme,
      });
    }
    const g = grupe.get(kljuc);
    g.puta++;
    if (z.korisnik_email) g.korisnici.add(z.korisnik_email);
    if (z.sesija) g.sesije.add(z.sesija);
    if (z.stranica) g.stranice.add(z.stranica);
    if (z.verzija) g.verzije.add(z.verzija);
    if (z.vrijeme > g.zadnji) g.zadnji = z.vrijeme;

    // Razlaganje PO KORISNIKU - da se vidi kome se tocno sto dogodilo, kada
    // i u kojoj sesiji. Bez ovoga kod greske koju su imala dva covjeka vidis
    // oba emaila i obje sesije, ali ne znas tko je koji.
    const tko = z.korisnik_ime || z.korisnik_email || "(neprijavljen)";
    if (!g.poKorisniku.has(tko)) {
      g.poKorisniku.set(tko, { puta: 0, sesije: new Set(), zadnji: z.vrijeme, email: z.korisnik_email || null });
    }
    const k = g.poKorisniku.get(tko);
    k.puta++;
    if (z.sesija) k.sesije.add(z.sesija);
    if (z.vrijeme > k.zadnji) k.zadnji = z.vrijeme;
  });
  return [...grupe.values()].sort((a, b) => b.puta - a.puta);
}

function vrijemeHr(iso) {
  return new Date(iso).toLocaleString("hr-HR", {
    timeZone: "Europe/Zagreb",
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function sastaviTekst(grupe, ukupnoZapisa) {
  const redovi = [
    `Automatska provjera dnevnika za zadnja ${SATI_UNATRAG} sata.`,
    "",
    `**${grupe.length}** različitih problema, ukupno **${grupe.reduce((s, g) => s + g.puta, 0)}** pojavljivanja.`,
    "",
    "| Događaj | Opis | Puta | Korisnika | Zadnji put |",
    "| --- | --- | ---: | ---: | --- |",
  ];

  grupe.forEach((g) => {
    const opis = g.opis.replace(/\|/g, "\\|").slice(0, 140);
    redovi.push(
      `| \`${g.dogadjaj}\` | ${opis} | ${g.puta} | ${g.korisnici.size} | ${vrijemeHr(g.zadnji)} |`
    );
  });

  // Pregled po korisniku - odgovara na pitanje "kome danas nesto ne radi",
  // sto je cesto prvo sto zelis znati kad otvoris obavijest.
  const korisnici = new Map();
  grupe.forEach((g) => {
    g.poKorisniku.forEach((k, tko) => {
      if (!korisnici.has(tko)) korisnici.set(tko, { puta: 0, vrste: new Set(), zadnji: k.zadnji });
      const u = korisnici.get(tko);
      u.puta += k.puta;
      u.vrste.add(g.dogadjaj);
      if (k.zadnji > u.zadnji) u.zadnji = k.zadnji;
    });
  });

  redovi.push("");
  redovi.push("### Po korisniku");
  redovi.push("");
  redovi.push("| Korisnik | Problema | Različitih vrsta | Zadnji put |");
  redovi.push("| --- | ---: | ---: | --- |");
  [...korisnici.entries()]
    .sort((a, b) => b[1].puta - a[1].puta)
    .forEach(([tko, u]) => {
      redovi.push(`| ${tko} | ${u.puta} | ${u.vrste.size} | ${vrijemeHr(u.zadnji)} |`);
    });

  redovi.push("", "---", "", "### Detalji po problemu");

  grupe.forEach((g) => {
    redovi.push("");
    redovi.push(`#### \`${g.dogadjaj}\``);
    redovi.push("");
    redovi.push(g.opis.slice(0, 400));
    redovi.push("");
    if (g.stranice.size) redovi.push(`Stranica: ${[...g.stranice].join(", ")}`);
    if (g.verzije.size) redovi.push(`Verzija stranice: ${[...g.verzije].join(", ")}`);
    redovi.push("");
    redovi.push("| Korisnik | Puta | Zadnji put | Sesije |");
    redovi.push("| --- | ---: | --- | --- |");
    [...g.poKorisniku.entries()]
      .sort((a, b) => b[1].puta - a[1].puta)
      .forEach(([tko, k]) => {
        const sesije = [...k.sesije].slice(0, 3).map((s) => `\`${s}\``).join(", ");
        const visak = k.sesije.size > 3 ? ` +${k.sesije.size - 3}` : "";
        redovi.push(`| ${tko} | ${k.puta} | ${vrijemeHr(k.zadnji)} | ${sesije}${visak} |`);
      });
  });

  redovi.push("");
  redovi.push("---");
  redovi.push("");
  redovi.push("Za cijeli trag jedne sesije, u Supabase SQL Editoru:");
  redovi.push("");
  redovi.push("```sql");
  redovi.push("select to_char(vrijeme at time zone 'Europe/Zagreb', 'HH24:MI:SS') as kada,");
  redovi.push("       kategorija, dogadjaj, stranica, detalji");
  redovi.push("from public.dnevnik");
  redovi.push("where sesija = 'OZNAKA-SESIJE-ODOZGO'");
  redovi.push("order by vrijeme;");
  redovi.push("```");
  redovi.push("");
  redovi.push(`_Pregledano ${ukupnoZapisa} zapisa kategorija greska/sustav._`);

  return redovi.join("\n");
}

async function otvoriIssue(naslov, tijelo) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error("Nedostaje GITHUB_TOKEN ili GITHUB_REPOSITORY.");

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: naslov, body: tijelo, labels: ["dnevnik"] }),
  });
  if (!res.ok) {
    const tekst = await res.text();
    throw new Error(`GitHub ${res.status}: ${tekst.slice(0, 300)}`);
  }
  const issue = await res.json();
  return issue.html_url;
}

async function main() {
  const zapisi = await dohvatiZapise();
  console.log(`Dohvaceno ${zapisi.length} zapisa kategorija greska/sustav.`);

  const grupe = grupiraj(zapisi);
  if (grupe.length === 0) {
    console.log("Nema problema u promatranom razdoblju - Issue se ne otvara.");
    return;
  }

  console.log(`Problema: ${grupe.length}`);
  grupe.forEach((g) => console.log(`  ${g.puta}x ${g.dogadjaj}: ${g.opis.slice(0, 100)}`));

  const datum = new Date().toLocaleDateString("hr-HR", { timeZone: "Europe/Zagreb" });
  const naslov = `Dnevnik: ${grupe.length} problema (${datum})`;
  const url = await otvoriIssue(naslov, sastaviTekst(grupe, zapisi.length));
  console.log(`Issue otvoren: ${url}`);
}

main().catch((err) => {
  console.error("Provjera dnevnika pukla:", err.message);
  process.exit(1);
});
