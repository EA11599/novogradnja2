/* AlexiGEO - plutajući chat asistent
   Uključi se s jednim retkom prije </body>:
     <script src="assets/chat.js" defer></script>
   Radi na svakoj stranici koja ima prijavljenog Supabase korisnika. */

(function () {
  "use strict";

  var POSTAVKE = {
    funkcija: "https://stbknyvbduzrgnbmhpxl.supabase.co/functions/v1/chat",
    indeks: "data/teren-indeks.json",
    sheetjs: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    naglasak: "#E0752D",
    maxPrikaz: 8,
  };

  var POZDRAV =
    "Pitajte me kako se aplikacija koristi ili tražite zgrade po ulici, mjestu, tipu i statusu.\n\n" +
    "Na primjer: zgrade u Ilici u Zagrebu koje su kandidati za novogradnju.";

  var poruke = [];
  var indeks = null;
  var ucitavanje = null;
  var zadnjiRezultat = [];
  var radi = false;

  /* ---------- stil ---------- */

  var css = [
    ".ag-chat-btn{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:none;",
    "background:" + POSTAVKE.naglasak + ";color:#fff;font-size:24px;cursor:pointer;z-index:9998;",
    "box-shadow:0 4px 14px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center}",
    ".ag-chat-btn:hover{filter:brightness(1.08)}",
    ".ag-chat-btn:focus-visible{outline:3px solid #1a1a1a;outline-offset:2px}",
    ".ag-chat{position:fixed;right:20px;bottom:88px;width:380px;max-width:calc(100vw - 32px);",
    "height:520px;max-height:calc(100vh - 120px);background:#fff;border:1px solid #ddd8cf;border-radius:14px;",
    "box-shadow:0 10px 34px rgba(0,0,0,.20);z-index:9999;display:none;flex-direction:column;overflow:hidden;",
    "font-family:inherit;color:#2f2f2d}",
    ".ag-chat.otvoren{display:flex}",
    ".ag-chat-head{padding:12px 14px;background:" + POSTAVKE.naglasak + ";color:#fff;display:flex;",
    "align-items:center;justify-content:space-between;font-size:15px;font-weight:500}",
    ".ag-chat-head button{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:0 4px}",
    ".ag-chat-tijelo{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:1.5}",
    ".ag-m{max-width:88%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word}",
    ".ag-m.ja{align-self:flex-end;background:" + POSTAVKE.naglasak + ";color:#fff;border-bottom-right-radius:4px}",
    ".ag-m.bot{align-self:flex-start;background:#f4f1ea;border-bottom-left-radius:4px}",
    ".ag-m.greska{align-self:flex-start;background:#fceaea;color:#7c2020}",
    ".ag-rez{align-self:flex-start;width:100%;background:#f4f1ea;border-radius:12px;padding:10px 12px}",
    ".ag-rez b{font-weight:500}",
    ".ag-rez ul{margin:8px 0 0;padding-left:18px}",
    ".ag-rez li{margin:2px 0}",
    ".ag-rez .ag-akcije{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}",
    ".ag-rez button{border:1px solid #d8d2c8;background:#fff;border-radius:8px;padding:6px 10px;",
    "font-size:13px;cursor:pointer;font-family:inherit;color:#2f2f2d}",
    ".ag-rez button:hover{background:#efeae1}",
    ".ag-chat-noga{border-top:1px solid #e8e3da;padding:10px;display:flex;gap:8px}",
    ".ag-chat-noga textarea{flex:1;resize:none;border:1px solid #d8d2c8;border-radius:8px;padding:8px 10px;",
    "font-family:inherit;font-size:14px;height:40px;max-height:110px;color:#2f2f2d}",
    ".ag-chat-noga button{border:none;background:" + POSTAVKE.naglasak + ";color:#fff;border-radius:8px;",
    "width:40px;font-size:17px;cursor:pointer}",
    ".ag-chat-noga button:disabled{opacity:.5;cursor:default}",
    ".ag-tipka{align-self:flex-start;color:#8a857c;font-size:13px;padding:4px 2px}",
    "@media(max-width:520px){.ag-chat{right:8px;left:8px;width:auto;bottom:80px;height:calc(100vh - 110px)}",
    ".ag-chat-btn{right:14px;bottom:14px}}",
  ].join("");

  var stil = document.createElement("style");
  stil.textContent = css;
  document.head.appendChild(stil);

  /* ---------- sučelje ---------- */

  var gumb = document.createElement("button");
  gumb.className = "ag-chat-btn";
  gumb.setAttribute("aria-label", "Otvori asistenta");
  gumb.textContent = "\u2709";

  var panel = document.createElement("div");
  panel.className = "ag-chat";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Asistent");
  panel.innerHTML =
    '<div class="ag-chat-head"><span>Asistent</span>' +
    '<button type="button" aria-label="Zatvori">&times;</button></div>' +
    '<div class="ag-chat-tijelo"></div>' +
    '<div class="ag-chat-noga">' +
    '<textarea rows="1" placeholder="Pitajte nešto..." aria-label="Poruka"></textarea>' +
    '<button type="button" aria-label="Pošalji">&#9654;</button></div>';

  document.body.appendChild(gumb);
  document.body.appendChild(panel);

  var tijelo = panel.querySelector(".ag-chat-tijelo");
  var polje = panel.querySelector("textarea");
  var posalji = panel.querySelector(".ag-chat-noga button");
  var zatvori = panel.querySelector(".ag-chat-head button");

  gumb.addEventListener("click", function () {
    panel.classList.toggle("otvoren");
    if (panel.classList.contains("otvoren")) {
      if (!tijelo.childNodes.length) dodajPoruku("bot", POZDRAV);
      polje.focus();
    }
  });
  zatvori.addEventListener("click", function () {
    panel.classList.remove("otvoren");
    gumb.focus();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("otvoren")) {
      panel.classList.remove("otvoren");
      gumb.focus();
    }
  });
  polje.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      posaljiPoruku();
    }
  });
  polje.addEventListener("input", function () {
    polje.style.height = "40px";
    polje.style.height = Math.min(polje.scrollHeight, 110) + "px";
  });
  posalji.addEventListener("click", posaljiPoruku);

  function dodajPoruku(vrsta, tekst) {
    var d = document.createElement("div");
    d.className = "ag-m " + vrsta;
    d.textContent = tekst;
    tijelo.appendChild(d);
    tijelo.scrollTop = tijelo.scrollHeight;
    return d;
  }

  /* ---------- prijava ---------- */

  function dohvatiToken() {
    var klijenti = [window.supabase, window.supabaseClient, window.sb, window.db];
    for (var i = 0; i < klijenti.length; i++) {
      var k = klijenti[i];
      if (k && k.auth && typeof k.auth.getSession === "function") {
        return k.auth.getSession().then(function (r) {
          return r && r.data && r.data.session ? r.data.session.access_token : izLokalne();
        });
      }
    }
    return Promise.resolve(izLokalne());
  }

  function izLokalne() {
    for (var i = 0; i < localStorage.length; i++) {
      var kljuc = localStorage.key(i);
      if (kljuc && kljuc.indexOf("sb-") === 0 && kljuc.indexOf("-auth-token") > -1) {
        try {
          var v = JSON.parse(localStorage.getItem(kljuc));
          if (v && v.access_token) return v.access_token;
          if (v && v.currentSession && v.currentSession.access_token) return v.currentSession.access_token;
        } catch (e) {
          /* preskoči */
        }
      }
    }
    return null;
  }

  /* ---------- razgovor ---------- */

  function posaljiPoruku() {
    var tekst = polje.value.trim();
    if (!tekst || radi) return;
    polje.value = "";
    polje.style.height = "40px";
    dodajPoruku("ja", tekst);
    poruke.push({ role: "user", content: tekst });

    radi = true;
    posalji.disabled = true;
    var cekaj = document.createElement("div");
    cekaj.className = "ag-tipka";
    cekaj.textContent = "razmišljam...";
    tijelo.appendChild(cekaj);
    tijelo.scrollTop = tijelo.scrollHeight;

    dohvatiToken()
      .then(function (token) {
        if (!token) throw new Error("Niste prijavljeni. Osvježite stranicu i prijavite se ponovno.");
        return fetch(POSTAVKE.funkcija, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ poruke: poruke }),
        });
      })
      .then(function (r) {
        return r.json().then(function (t) {
          if (!r.ok) throw new Error(t.greska || "Greška " + r.status);
          return t;
        });
      })
      .then(function (odg) {
        cekaj.remove();
        var zapamti = odg.tekst || "";
        if (odg.tekst) dodajPoruku("bot", odg.tekst);
        if (odg.filter) {
          return primijeniFilter(odg.filter).then(function (sazetak) {
            poruke.push({ role: "assistant", content: (zapamti + "\n" + sazetak).trim() });
          });
        }
        poruke.push({ role: "assistant", content: zapamti || "(bez odgovora)" });
      })
      .catch(function (e) {
        cekaj.remove();
        dodajPoruku("greska", e.message || "Nešto je pošlo po zlu.");
        poruke.pop();
      })
      .then(function () {
        radi = false;
        posalji.disabled = false;
        polje.focus();
      });
  }

  /* ---------- indeks ---------- */

  function ucitajIndeks() {
    if (indeks) return Promise.resolve(indeks);
    if (ucitavanje) return ucitavanje;
    ucitavanje = fetch(POSTAVKE.indeks)
      .then(function (r) {
        if (!r.ok) throw new Error("Ne mogu učitati indeks zgrada (" + r.status + ").");
        return r.json();
      })
      .then(function (d) {
        indeks = Array.isArray(d.zgrade) ? d.zgrade : [];
        return indeks;
      });
    return ucitavanje;
  }

  /* ---------- filtriranje ---------- */

  var DOZVOLJENA = [
    "ulica", "mjesto", "zupanija", "tip", "katoviMin", "katoviMax",
    "satelit", "imaAdresu", "masovniUnos", "datumOd", "datumDo",
    "sortiraj", "limit", "izvezi",
  ];
  var SATELIT = ["kandidat", "stara", "nema_snimke"];

  function ocisti(sirovi) {
    var f = {};
    if (!sirovi || typeof sirovi !== "object") return f;
    DOZVOLJENA.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(sirovi, k)) f[k] = sirovi[k];
    });
    if (f.satelit) {
      f.satelit = [].concat(f.satelit).filter(function (s) {
        return SATELIT.indexOf(s) > -1;
      });
      if (!f.satelit.length) delete f.satelit;
    }
    if (f.tip) {
      f.tip = [].concat(f.tip).filter(function (t) {
        return typeof t === "string" && t.length < 40;
      });
      if (!f.tip.length) delete f.tip;
    }
    ["katoviMin", "katoviMax", "limit"].forEach(function (k) {
      if (k in f) {
        var n = Number(f[k]);
        if (isFinite(n)) f[k] = n;
        else delete f[k];
      }
    });
    ["datumOd", "datumDo"].forEach(function (k) {
      if (k in f && !/^\d{4}-\d{2}-\d{2}$/.test(String(f[k]))) delete f[k];
    });
    return f;
  }

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[čć]/g, "c")
      .replace(/đ/g, "d")
      .replace(/š/g, "s")
      .replace(/ž/g, "z")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function bezBroja(adresa) {
    return String(adresa || "").replace(/\s+\d+\s*[a-zA-ZčćžšđČĆŽŠĐ]?$/, "").trim();
  }

  function imaRijec(sijeno, igla) {
    var h = norm(sijeno);
    var n = norm(igla).trim();
    if (!n) return true;
    var esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + esc + "([^a-z0-9]|$)").test(h);
  }

  function odgovara(z, f) {
    if (f.ulica) {
      if (!z.a) return false;
      if (!imaRijec(bezBroja(z.a), f.ulica)) return false;
    }
    if (f.mjesto && !imaRijec(z.m, f.mjesto)) return false;
    if (f.zupanija && norm(z.z).indexOf(norm(f.zupanija)) === -1) return false;
    if (f.tip && f.tip.indexOf(z.t) === -1) return false;
    if (f.satelit && f.satelit.indexOf(z.s) === -1) return false;
    if (typeof f.imaAdresu === "boolean" && !!z.a !== f.imaAdresu) return false;
    if (typeof f.masovniUnos === "boolean" && (z.u === 1) !== f.masovniUnos) return false;
    if (f.katoviMin != null || f.katoviMax != null) {
      var k = parseInt(z.k, 10);
      if (!isFinite(k)) return false;
      if (f.katoviMin != null && k < f.katoviMin) return false;
      if (f.katoviMax != null && k > f.katoviMax) return false;
    }
    if (f.datumOd && (!z.d || z.d < f.datumOd)) return false;
    if (f.datumDo && (!z.d || z.d > f.datumDo)) return false;
    return true;
  }

  function primijeniFilter(sirovi) {
    var f = ocisti(sirovi);
    return ucitajIndeks().then(function (svi) {
      var rez = svi.filter(function (z) {
        return odgovara(z, f);
      });
      if (f.sortiraj === "adresa") {
        rez.sort(function (a, b) {
          return String(a.a || "").localeCompare(String(b.a || ""), "hr");
        });
      } else if (f.sortiraj === "katovi") {
        rez.sort(function (a, b) {
          return (parseInt(b.k, 10) || 0) - (parseInt(a.k, 10) || 0);
        });
      } else {
        rez.sort(function (a, b) {
          return String(b.d || "").localeCompare(String(a.d || ""));
        });
      }
      var granica = f.limit && f.limit > 0 ? Math.min(f.limit, 5000) : 500;
      rez = rez.slice(0, granica);
      zadnjiRezultat = rez;
      window.__agChatRezultat = rez;
      prikaziRezultat(rez, f);
      if (f.izvezi && rez.length) uExcel(rez);
      return "Pretraga je vratila " + rez.length + " zgrada.";
    });
  }

  /* ---------- prikaz rezultata ---------- */

  function opisFiltera(f) {
    var d = [];
    if (f.ulica) d.push("ulica " + f.ulica);
    if (f.mjesto) d.push(f.mjesto);
    if (f.zupanija) d.push(f.zupanija);
    if (f.tip) d.push("tip " + f.tip.join(", "));
    if (f.satelit) d.push(f.satelit.join(" ili "));
    if (f.imaAdresu === true) d.push("s adresom");
    if (f.imaAdresu === false) d.push("bez adrese");
    if (f.masovniUnos === true) d.push("masovni unos");
    if (f.masovniUnos === false) d.push("bez masovnog unosa");
    if (f.katoviMin != null) d.push("min " + f.katoviMin + " kat.");
    if (f.katoviMax != null) d.push("max " + f.katoviMax + " kat.");
    if (f.datumOd) d.push("od " + f.datumOd);
    if (f.datumDo) d.push("do " + f.datumDo);
    return d.length ? d.join(" \u00b7 ") : "bez filtera";
  }

  function prikaziRezultat(rez, f) {
    var box = document.createElement("div");
    box.className = "ag-rez";

    var naslov = document.createElement("div");
    naslov.innerHTML = "<b>" + rez.length + (rez.length === 1 ? " zgrada" : " zgrada") + "</b>";
    box.appendChild(naslov);

    var pod = document.createElement("div");
    pod.style.cssText = "font-size:12px;color:#8a857c;margin-top:2px";
    pod.textContent = opisFiltera(f);
    box.appendChild(pod);

    if (rez.length) {
      var ul = document.createElement("ul");
      rez.slice(0, POSTAVKE.maxPrikaz).forEach(function (z) {
        var li = document.createElement("li");
        li.textContent = (z.a || "bez adrese") + (z.m ? ", " + z.m : "") + (z.d ? " (" + z.d + ")" : "");
        ul.appendChild(li);
      });
      box.appendChild(ul);
      if (rez.length > POSTAVKE.maxPrikaz) {
        var jos = document.createElement("div");
        jos.style.cssText = "font-size:12px;color:#8a857c;margin-top:4px";
        jos.textContent = "i još " + (rez.length - POSTAVKE.maxPrikaz) + " u Excelu.";
        box.appendChild(jos);
      }

      var akcije = document.createElement("div");
      akcije.className = "ag-akcije";

      var bExcel = document.createElement("button");
      bExcel.type = "button";
      bExcel.textContent = "Preuzmi Excel";
      bExcel.addEventListener("click", function () {
        uExcel(rez);
      });
      akcije.appendChild(bExcel);

      if (typeof window.agPrikaziNaKarti === "function") {
        var bKarta = document.createElement("button");
        bKarta.type = "button";
        bKarta.textContent = "Prikaži na karti";
        bKarta.addEventListener("click", function () {
          window.agPrikaziNaKarti(rez);
          panel.classList.remove("otvoren");
        });
        akcije.appendChild(bKarta);
      }
      box.appendChild(akcije);
    }

    tijelo.appendChild(box);
    tijelo.scrollTop = tijelo.scrollHeight;
  }

  /* ---------- Excel ---------- */

  function ucitajSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (ok, ne) {
      var s = document.createElement("script");
      s.src = POSTAVKE.sheetjs;
      s.onload = function () {
        ok();
      };
      s.onerror = function () {
        ne(new Error("Ne mogu učitati komponentu za Excel."));
      };
      document.head.appendChild(s);
    });
  }

  function uExcel(rez) {
    ucitajSheetJS()
      .then(function () {
        var zaglavlje = [
          "Adresa", "Mjesto", "Županija", "Tip", "Katovi",
          "Satelitska presuda", "Masovni unos", "Datum detekcije", "OSM ID", "Karta",
        ];
        var redovi = rez.map(function (z) {
          return [
            z.a || "", z.m || "", z.z || "", z.t || "", z.k || "",
            z.s || "", z.u === 1 ? "da" : "ne", z.d || "", z.i || "",
            "https://www.google.com/maps?q=" + z.y + "," + z.x,
          ];
        });
        var ws = window.XLSX.utils.aoa_to_sheet([zaglavlje].concat(redovi));
        for (var i = 0; i < redovi.length; i++) {
          var adr = window.XLSX.utils.encode_cell({ r: i + 1, c: 9 });
          if (ws[adr]) {
            ws[adr].l = { Target: redovi[i][9], Tooltip: "Otvori u Google Maps" };
            ws[adr].v = "karta";
          }
        }
        ws["!cols"] = [
          { wch: 34 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 8 },
          { wch: 18 }, { wch: 13 }, { wch: 16 }, { wch: 18 }, { wch: 10 },
        ];
        var wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Zgrade");
        var d = new Date().toISOString().slice(0, 10);
        window.XLSX.writeFile(wb, "alexigeo-pretraga-" + d + ".xlsx");
      })
      .catch(function (e) {
        dodajPoruku("greska", e.message);
      });
  }

  window.agChat = {
    otvori: function () {
      panel.classList.add("otvoren");
      if (!tijelo.childNodes.length) dodajPoruku("bot", POZDRAV);
      polje.focus();
    },
    rezultat: function () {
      return zadnjiRezultat;
    },
  };
})();
