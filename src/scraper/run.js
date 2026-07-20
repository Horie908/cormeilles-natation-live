// Orchestre le scraping complet du club et sauvegarde data/club_data.json
// Usage: node src/scraper/run.js
const { CLUB_ID } = require("./ffn");
const { parseClubResultsHtml, parseProgramme } = require("./parseResults");
const { findClubCompetitions, getProgrammeHtml } = require("./discover");
const { attachFreestyleOpponents } = require("./attachFreestyleOpponents");
const store = require("../store");

const MAX_PAST_COMPETITIONS = 20; // toute la saison en cours (depuis mars), pas l'historique des annees precedentes
const MONTHS_BACK = 5; // couvre mars -> aujourd'hui
const MONTHS_FORWARD = 1;

async function main() {
  // On garde la trace de la premiere apparition de chaque nageur (pour le badge "Nouveau" sur
  // le site) meme si ce scraping complet reconstruit tout le reste depuis zero a chaque fois.
  store.load();
  const previousFirstSeen = new Map(store.get().swimmers.map((s) => [s.id, s.firstSeen]).filter(([, v]) => v));

  console.log("Recherche des competitions recentes du club (departement + region)...");
  const { past, future } = await findClubCompetitions({ monthsBack: MONTHS_BACK, monthsForward: MONTHS_FORWARD });
  console.log(`Competitions passees avec le club : ${past.length} · a venir identifiees : ${future.length}`);

  const selectedPast = past.slice(0, MAX_PAST_COMPETITIONS);
  const swimmersById = new Map();
  const now = new Date().toISOString();

  for (const { meta, html } of selectedPast) {
    const swimmers = parseClubResultsHtml(html, meta);
    for (const sw of swimmers) {
      if (!swimmersById.has(sw.id)) {
        swimmersById.set(sw.id, { ...sw, results: [], upcoming: [], firstSeen: previousFirstSeen.get(sw.id) || now });
      }
      swimmersById.get(sw.id).results.push(...sw.results);
    }
    console.log(`Competition ${meta.idcpt} (${meta.name}, ${meta.date}) : ${swimmers.length} nageur(s) du club`);
  }

  // Compétitions à venir : le planning horaire (programme.php) est en general publie bien avant
  // la liste de depart, donc on l'attache des qu'il est disponible (jamais de couloir/adversaire
  // invente pour autant - la liste de depart, elle, reste a implementer separement).
  const upcomingCompetitions = [];
  for (const { meta } of future) {
    const entry = { id: meta.idcpt, name: meta.name, date: meta.date, location: meta.location, schedule: null };
    const programmeHtml = await getProgrammeHtml(meta.idcpt);
    if (programmeHtml) {
      const sessions = parseProgramme(programmeHtml);
      if (sessions.length) {
        entry.schedule = sessions;
        console.log(`A venir ${meta.idcpt} (${meta.name}, ${meta.date}) : planning recupere (${sessions.length} reunion(s)).`);
      }
    }
    if (!entry.schedule) {
      console.log(`A venir ${meta.idcpt} (${meta.name}, ${meta.date}) : planning pas encore publie.`);
    }
    upcomingCompetitions.push(entry);
  }

  let data = {
    club: { id: CLUB_ID, name: "ACS Cormeilles Natation", lastUpdated: new Date().toISOString() },
    swimmers: Array.from(swimmersById.values()).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    // Planning des competitions a venir identifiees au calendrier (avec horaires quand le
    // programme est deja publie) : permet d'afficher le planning meme quand la liste de depart
    // (couloirs/adversaires) n'est pas encore connue.
    upcomingCompetitions: upcomingCompetitions.sort((a, b) => (a.date || "").localeCompare(b.date || "")),
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
