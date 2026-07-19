// Orchestre le scraping complet du club et sauvegarde data/club_data.json
// Usage: node src/scraper/run.js
const fs = require("fs");
const path = require("path");
const { BASE, CLUB_ID, fetchHtml, sleep } = require("./ffn");
const { parseClubResultsHtml } = require("./parseResults");
const store = require("../store");

const COMPETITIONS_FILE = path.join(__dirname, "..", "..", "data", "competitions.json");

function loadKnownCompetitionIds() {
  if (fs.existsSync(COMPETITIONS_FILE)) {
    return JSON.parse(fs.readFileSync(COMPETITIONS_FILE, "utf8"));
  }
  // Liste de depart connue (a completer via la decouverte automatique des competitions du club)
  return [{ id: "44045", name: null }];
}

async function scrapeCompetition(idcpt) {
  const url = `${BASE}/resultats.php?idact=nat&idcpt=${idcpt}&go=res&idclb=${CLUB_ID}`;
  const html = await fetchHtml(url);
  return parseClubResultsHtml(html, idcpt);
}

async function main() {
  const competitions = loadKnownCompetitionIds();
  const swimmersById = new Map();

  for (const comp of competitions) {
    try {
      const swimmers = await scrapeCompetition(comp.id);
      for (const sw of swimmers) {
        if (!swimmersById.has(sw.id)) {
          swimmersById.set(sw.id, { ...sw, results: [] });
        }
        swimmersById.get(sw.id).results.push(...sw.results);
      }
      console.log(`Competition ${comp.id} : ${swimmers.length} nageur(s) du club trouve(s)`);
    } catch (err) {
      console.error(`Erreur sur la competition ${comp.id} :`, err.message);
    }
    await sleep(500); // on reste courtois avec le serveur de la FFN
  }

  const data = {
    club: { id: CLUB_ID, name: "ACS Cormeilles Natation", lastUpdated: new Date().toISOString() },
    swimmers: Array.from(swimmersById.values()).sort((a, b) => a.name.localeCompare(b.name, "fr")),
  };

  store.save(data);
  console.log(`Sauvegarde : ${data.swimmers.length} nageur(s), ${data.swimmers.reduce((n, s) => n + s.results.length, 0)} resultat(s) au total.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, scrapeCompetition };
