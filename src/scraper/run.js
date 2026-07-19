// Orchestre le scraping complet du club et sauvegarde data/club_data.json
// Usage: node src/scraper/run.js
const { CLUB_ID } = require("./ffn");
const { parseClubResultsHtml } = require("./parseResults");
const { findClubCompetitions, getStartlistHtml } = require("./discover");
const { attachFreestyleOpponents } = require("./attachFreestyleOpponents");
const store = require("../store");

const MAX_PAST_COMPETITIONS = 3; // on ne remonte pas l'historique complet, juste la saison en cours
const MONTHS_BACK = 2;
const MONTHS_FORWARD = 1;

async function main() {
  console.log("Recherche des competitions recentes du club (departement + region)...");
  const { past, future } = await findClubCompetitions({ monthsBack: MONTHS_BACK, monthsForward: MONTHS_FORWARD });
  console.log(`Competitions passees avec le club : ${past.length} · a venir identifiees : ${future.length}`);

  const selectedPast = past.slice(0, MAX_PAST_COMPETITIONS);
  const swimmersById = new Map();

  for (const { meta, html } of selectedPast) {
    const swimmers = parseClubResultsHtml(html, meta);
    for (const sw of swimmers) {
      if (!swimmersById.has(sw.id)) {
        swimmersById.set(sw.id, { ...sw, results: [], upcoming: [] });
      }
      swimmersById.get(sw.id).results.push(...sw.results);
    }
    console.log(`Competition ${meta.idcpt} (${meta.name}, ${meta.date}) : ${swimmers.length} nageur(s) du club`);
  }

  // Compétitions à venir : on ne remplit "upcoming" que si une vraie liste de départ est publiée
  // (jamais de couloir/horaire/adversaire invente).
  for (const { meta } of future) {
    const startlistHtml = await getStartlistHtml(meta.idcpt);
    if (!startlistHtml) {
      console.log(`A venir ${meta.idcpt} (${meta.name}, ${meta.date}) : liste de depart pas encore publiee.`);
      continue;
    }
    console.log(`A venir ${meta.idcpt} (${meta.name}, ${meta.date}) : liste de depart PUBLIEE mais parsing pas encore implemente pour ce format — a completer.`);
  }

  let data = {
    club: { id: CLUB_ID, name: "ACS Cormeilles Natation", lastUpdated: new Date().toISOString() },
    swimmers: Array.from(swimmersById.values()).sort((a, b) => a.name.localeCompare(b.name, "fr")),
  };

  console.log("Recherche des adversaires reels sur les 50 Nage Libre...");
  data = await attachFreestyleOpponents(data);

  store.save(data);
  const totalResults = data.swimmers.reduce((n, s) => n + s.results.length, 0);
  console.log(`Sauvegarde : ${data.swimmers.length} nageur(s), ${totalResults} resultat(s) au total.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
