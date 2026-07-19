// Parse la page resultats.php?idact=nat&idcpt={id}&go=res&idclb=733
// Structure reelle observee (juillet 2026):
//   <thead> ... <span id="{idnat}"></span><span>NOM Prenom (anneeNaissance/age) <i class="fa fa-mars|fa-venus"></i> FRA</span> ... <span class="italic">[idnat]</span>
//   puis une serie de <tr class="border-b ..."> avec les colonnes :
//   [0] rang, [1] epreuve (+ lien idepr), [2] serie/categorie, [3] mention (ex DNS/DSQ court), [4] temps final ou "DNS dec"/"DSQ ...",
//   [5] temps de reaction, [6] points, [7] -, [8] badge record personnel ("Nouvelle performance etablie")
const { cheerio, timeToCentiemes } = require("./ffn");

const TIME_RE = /^\d{1,2}:\d{2}\.\d{2}$/;

const MONTHS_FR = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
};

function frenchDateToIso(text) {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\s+(\p{L}+)\s+(\d{4})/u);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthKey = m[2].toLowerCase();
  const month = MONTHS_FR[monthKey];
  if (!month) return null;
  const year = parseInt(m[3], 10);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Extrait titre / lieu / date de la competition depuis l'entete de la page resultats.php
function parseCompetitionMeta(html, idcpt) {
  const $ = cheerio.load(html);
  const h3 = $("h3").first().text().trim();
  let name = h3 || null;
  let location = null;
  if (h3) {
    const idx = h3.lastIndexOf(" - ");
    if (idx > 0) {
      name = h3.slice(0, idx).trim();
      location = h3.slice(idx + 3).replace(/\s*\(FRA\)\s*$/, "").trim();
    }
  }
  const dateText = $("p.font-bold.text-blue-600").first().text().trim();
  const date = frenchDateToIso(dateText);
  return { idcpt: String(idcpt), name, location, date };
}

function parseClubResultsHtml(html, competitionMeta) {
  const $ = cheerio.load(html);
  const swimmers = new Map(); // idnat -> { id, name, birthYear, age, gender, results: [] }

  $("thead").each((_, theadEl) => {
    const $thead = $(theadEl);
    const idSpan = $thead.find("span[id]").first();
    const idnat = idSpan.attr("id");
    if (!idnat) return;

    const nameSpanText = $thead.find("td span").eq(1).text().trim();
    // ex: "BOUCHKI Jalil (2006/11 ans)  FRA"
    const nameMatch = nameSpanText.match(/^(.*?)\s*\((\d{4})\/(\d+)\s*ans?\)/);
    const name = nameMatch ? nameMatch[1].trim() : nameSpanText.trim();
    const birthYear = nameMatch ? parseInt(nameMatch[2], 10) : null;
    const isMale = $thead.find("i.fa-mars").length > 0;
    const isFemale = $thead.find("i.fa-venus").length > 0;
    const gender = isMale ? "M" : isFemale ? "F" : null;

    if (!swimmers.has(idnat)) {
      swimmers.set(idnat, { id: idnat, name, birthYear, gender, results: [] });
    }

    // cheerio (htmlparser2) regroupe automatiquement les <tr> qui suivent un <thead>
    // dans un <tbody> implicite : thead[nageur A] -> tbody(ses tr) -> thead[nageur B] -> tbody(ses tr) ...
    const $tbody = $thead.next("tbody");
    $tbody.children("tr").each((__, trEl) => {
      const $node = $(trEl);
      const tds = $node.find("td");
      if (tds.length < 7) return;

      const rankRaw = $(tds[0]).text().trim();
      const eventLink = $(tds[1]).find("a").first();
      const event = (eventLink.text() || $(tds[1]).text()).trim();
      const eprMatch = (eventLink.attr("href") || "").match(/idepr=(\d+)/);
      const eventId = eprMatch ? eprMatch[1] : null;
      const round = $(tds[2]).text().trim();
      const finalCellText = $(tds[4]).text().trim();

      let status = "OK";
      let time = null;
      if (TIME_RE.test(finalCellText)) {
        time = finalCellText;
      } else if (/^DSQ/i.test(finalCellText)) {
        status = "DSQ";
      } else if (/^DNS/i.test(finalCellText) || /^(NP|Abs|AB)\b/i.test(finalCellText) || !finalCellText) {
        status = "DNS";
      } else if (/DNF|ABD/i.test(finalCellText)) {
        status = "DNF";
      } else {
        status = "AUTRE";
      }

      const rankMatch = rankRaw.match(/^\d+/);
      const rank = rankMatch ? parseInt(rankMatch[0], 10) : null;
      const isPB = $node.find('[data-tippy-content*="Nouvelle performance"]').length > 0;

      if (event) {
        swimmers.get(idnat).results.push({
          competitionId: competitionMeta.idcpt,
          competitionName: competitionMeta.name,
          date: competitionMeta.date,
          location: competitionMeta.location,
          event,
          eventId,
          session: round,
          time,
          timeCentiemes: timeToCentiemes(time),
          rank,
          status,
          isPB,
        });
      }
    });
  });

  return Array.from(swimmers.values());
}

// Parse la page resultats.php?idact=nat&idcpt={id}&go=epr&idepr={id} : le classement complet
// (tous clubs confondus) d'une competition. Cette page regroupe en fait TOUTES les epreuves
// d'une categorie/session (ex: toutes les epreuves "Dames") en plusieurs blocs <thead>/<tbody>,
// un bloc par epreuve — meme structure alternee que parseClubResultsHtml, mais ici chaque
// <thead> represente une EPREUVE (ex: "50 Nage Libre Dames - Séries") et non un nageur.
// On isole le bloc dont le titre commence par `eventName` (ex: "50 Nage Libre Dames").
// roundHint (ex: "Séries", "Finale A") permet de cibler le bon tableau quand une epreuve a
// plusieurs tours publies sur la meme page (series ET finale) : sans lui, on prendrait le
// premier tableau trouve, qui n'est pas forcement celui ou notre nageur a couru.
function parseLeaderboardRows($, $thead) {
  const rows = [];
  const $tbody = $thead.next("tbody");
  $tbody.children("tr").each((__, trEl) => {
    const $node = $(trEl);
    const tds = $node.find("td");
    if (tds.length < 4) return;

    const rankRaw = $(tds[0]).text().trim();
    const rankMatch = rankRaw.match(/^\d+/);
    const rank = rankMatch ? parseInt(rankMatch[0], 10) : null;

    const swimmerLink = $(tds[1]).find("a").first();
    const swimmerHref = swimmerLink.attr("href") || "";
    const swimmerNameRaw = swimmerLink.text().trim();
    const nameMatch = swimmerNameRaw.match(/^(.*?)\s*\(/);
    const name = nameMatch ? nameMatch[1].trim() : swimmerNameRaw;
    const swimmerClubIdMatch = swimmerHref.match(/idclb=(\d+)/);
    const idnatMatch = swimmerHref.match(/#(\d+)/);

    const clubLink = $(tds[2]).find("a").first();
    const clubName = clubLink.text().trim();

    const time = tds.length > 3 ? $(tds[3]).text().trim() : null;

    if (name) {
      rows.push({
        rank,
        id: idnatMatch ? idnatMatch[1] : null,
        name,
        clubId: swimmerClubIdMatch ? swimmerClubIdMatch[1] : null,
        club: clubName || null,
        time: TIME_RE.test(time) ? time : null,
        timeCentiemes: TIME_RE.test(time) ? timeToCentiemes(time) : null,
      });
    }
  });
  return rows;
}

function parseEventLeaderboard(html, eventName, roundHint) {
  const $ = cheerio.load(html);
  let exactMatch = null; // { title, $thead } — tableau dont le titre correspond a eventName + roundHint
  let firstMatch = null; // meilleur repli si aucune correspondance exacte de tour n'est trouvee

  $("thead").each((_, theadEl) => {
    const $thead = $(theadEl);
    const t = $thead.find("td > div > div").eq(0).text().trim();
    if (!t || !t.toLowerCase().startsWith(eventName.toLowerCase())) return;
    if (!firstMatch) firstMatch = { title: t, $thead };
    if (roundHint && t.toLowerCase() === `${eventName} - ${roundHint}`.toLowerCase() && !exactMatch) {
      exactMatch = { title: t, $thead };
    }
  });

  const chosen = exactMatch || firstMatch;
  if (!chosen) return { title: null, entries: [] };
  return { title: chosen.title, entries: parseLeaderboardRows($, chosen.$thead) };
}

module.exports = { parseClubResultsHtml, parseCompetitionMeta, parseEventLeaderboard, frenchDateToIso };
