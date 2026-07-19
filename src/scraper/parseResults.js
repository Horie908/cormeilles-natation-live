// Parse la page resultats.php?idact=nat&idcpt={id}&go=res&idclb=733
// Structure reelle observee (juillet 2026):
//   <thead> ... <span id="{idnat}"></span><span>NOM Prenom (anneeNaissance/age) <i class="fa fa-mars|fa-venus"></i> FRA</span> ... <span class="italic">[idnat]</span>
//   puis une serie de <tr class="border-b ..."> avec les colonnes :
//   [0] rang, [1] epreuve (+ lien idepr), [2] serie/categorie, [3] mention (ex DNS/DSQ court), [4] temps final ou "DNS dec"/"DSQ ...",
//   [5] temps de reaction, [6] points, [7] -, [8] badge record personnel ("Nouvelle performance etablie")
const { cheerio, timeToCentiemes } = require("./ffn");

const TIME_RE = /^\d{1,2}:\d{2}\.\d{2}$/;

function parseClubResultsHtml(html, competitionId) {
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
    const age = nameMatch ? parseInt(nameMatch[3], 10) : null;
    const isMale = $thead.find("i.fa-mars").length > 0;
    const isFemale = $thead.find("i.fa-venus").length > 0;
    const gender = isMale ? "M" : isFemale ? "F" : null;

    if (!swimmers.has(idnat)) {
      swimmers.set(idnat, { id: idnat, name, birthYear, age, gender, results: [] });
    }

    // cheerio (htmlparser2) regroupe automatiquement les <tr> qui suivent un <thead>
    // dans un <tbody> implicite : thead[nageur A] -> tbody(ses tr) -> thead[nageur B] -> tbody(ses tr) ...
    const $tbody = $thead.next("tbody");
    $tbody.children("tr").each((__, trEl) => {
      const $node = $(trEl);
      const tds = $node.find("td");
      if (tds.length < 7) return;

      const rank = $(tds[0]).text().trim();
      const eventLink = $(tds[1]).find("a").first();
      const event = eventLink.text().trim();
      const eventHref = eventLink.attr("href") || "";
      const eprMatch = eventHref.match(/idepr=(\d+)/);
      const eventId = eprMatch ? eprMatch[1] : null;
      const round = $(tds[2]).text().trim();
      const finalCellText = $(tds[4]).text().trim();

      let status = "OK";
      let time = null;
      if (TIME_RE.test(finalCellText)) {
        time = finalCellText;
      } else if (/DSQ/i.test(finalCellText)) {
        status = "DSQ";
      } else if (/DNS/i.test(finalCellText)) {
        status = "DNS";
      } else if (/DNF|ABD/i.test(finalCellText)) {
        status = "DNF";
      } else if (finalCellText) {
        status = "AUTRE";
      }

      const points = $(tds[6]).text().trim();
      const isPB = $node.find('[data-tippy-content*="Nouvelle performance"]').length > 0;

      if (event) {
        swimmers.get(idnat).results.push({
          competitionId: String(competitionId),
          event,
          eventId,
          round,
          rank: rank || null,
          time,
          timeCentiemes: timeToCentiemes(time),
          status,
          points: points || null,
          isPB,
        });
      }
    });
  });

  return Array.from(swimmers.values());
}

module.exports = { parseClubResultsHtml };
