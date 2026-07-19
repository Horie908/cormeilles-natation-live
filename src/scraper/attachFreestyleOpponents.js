// Ajoute, pour chaque resultat "50 Nage Libre" d'un nageur du club, la liste REELLE des
// autres nageurs (tous clubs confondus) qui ont couru la meme epreuve a la meme competition,
// avec leur temps. Aucune donnee inventee : si le classement complet n'est pas trouve pour une
// epreuve, "opponents" reste absent pour ce resultat plutot que d'etre devine.
const { EXTRANAT_BASE, fetchHtml } = require("./ffn");
const { parseEventLeaderboard } = require("./parseResults");
const store = require("../store");

async function getLeaderboard(idcpt, idepr, eventName, roundHint, cache) {
  const key = `${idcpt}_${idepr}`;
  let html = cache.get(key);
  if (!html) {
    const url = `${EXTRANAT_BASE}/resultats.php?idact=nat&idcpt=${idcpt}&go=epr&idepr=${idepr}`;
    html = await fetchHtml(url);
    cache.set(key, html);
  }
  // roundHint distingue Series/Finale : deux nageurs du meme club sur la meme epreuve/competition
  // mais des tours differents (l'un en finale, l'autre elimine en series) doivent voir chacun
  // leurs VRAIS adversaires de leur propre course, pas ceux de l'autre tour.
  return parseEventLeaderboard(html, eventName, roundHint);
}

// Enrichit `data` (forme club_data.json) en place. Reutilisable depuis run.js pour que chaque
// actualisation automatique garde cette fonctionnalite, pas seulement le scraping manuel.
// `onlyCompetitionIds` (Set optionnel) limite le travail a certaines competitions seulement —
// utilise par l'actualisation "live" pour ne re-scraper que la competition du jour, sans
// re-parcourir tout l'historique de la saison a chaque fois.
async function attachFreestyleOpponents(data, { onlyCompetitionIds } = {}) {
  const cache = new Map();
  let attached = 0;
  let skipped = 0;

  for (const swimmer of data.swimmers) {
    for (const result of swimmer.results) {
      if (!result.event || !result.event.startsWith("50 Nage Libre") || !result.eventId) continue;
      if (onlyCompetitionIds && !onlyCompetitionIds.has(result.competitionId)) continue;

      const lb = await getLeaderboard(result.competitionId, result.eventId, result.event, result.session, cache);
      if (!lb.title || !lb.entries.length) {
        console.log(`Pas de classement complet trouve pour ${swimmer.name} - ${result.event} (idcpt=${result.competitionId}, idepr=${result.eventId})`);
        skipped++;
        continue;
      }

      result.opponents = lb.entries
        .filter((e) => e.id !== swimmer.id)
        .map((e) => ({ name: e.name, club: e.club, time: e.time, rank: e.rank }));
      const mine = lb.entries.find((e) => e.id === swimmer.id);
      if (mine) result.rank = mine.rank; // recale sur le classement reel de l'epreuve complete
      attached++;
    }
  }

  console.log(`Adversaires 50 Nage Libre : ${attached} resultat(s) enrichis, ${skipped} sans classement complet disponible.`);
  return data;
}

async function main() {
  store.load();
  const data = await attachFreestyleOpponents(store.get());
  store.save(data);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { attachFreestyleOpponents };
