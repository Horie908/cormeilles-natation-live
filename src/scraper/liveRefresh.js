// Actualisation "live" legere, pensee pour tourner frequemment (toutes les ~15 min) pendant
// qu'une competition a lieu, SANS refaire le scraping complet de toute la saison a chaque fois
// (ca, c'est le travail de run.js, qui tourne seulement 2x/jour). Cout normal : 2 requetes
// (recherche des competitions du mois en cours) + 0 a quelques requetes si une competition du
// club a lieu aujourd'hui. Un cache persistant evite de re-tester indefiniment les memes
// competitions d'autres clubs.
const fs = require("fs");
const path = require("path");
const { CLUB_ID } = require("./ffn");
const { parseClubResultsHtml } = require("./parseResults");
const { findCompetitionIds, testClubParticipation } = require("./discover");
const { attachFreestyleOpponents } = require("./attachFreestyleOpponents");
const store = require("../store");

const CACHE_FILE = path.join(__dirname, "..", "..", "data", "tested_competitions.json");

function loadTestedIds() {
  if (!fs.existsSync(CACHE_FILE)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(CACHE_FILE, "utf8").replace(/^﻿/, "")));
  } catch {
    return new Set();
  }
}

function saveTestedIds(set) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(Array.from(set)), "utf8");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  store.load();
  const data = store.get();
  const today = todayIso();
  const testedIds = loadTestedIds();

  // 1) Competitions du club deja connues (dans club_data.json) et datees d'aujourd'hui : on les
  //    re-scrape pour capter les resultats ajoutes au fil de la journee.
  const todayCompetitionIds = new Set();
  for (const sw of data.swimmers) {
    for (const r of sw.results) {
      if (r.date === today) todayCompetitionIds.add(r.competitionId);
    }
  }

  // 2) Verifie si une NOUVELLE competition du club vient d'apparaitre aujourd'hui (scan leger,
  //    mois en cours uniquement — pas toute la saison).
  const candidateIds = await findCompetitionIds({ monthsBack: 0, monthsForward: 0 });
  for (const idcpt of candidateIds) {
    if (testedIds.has(idcpt) || todayCompetitionIds.has(idcpt)) continue;
    const found = await testClubParticipation(idcpt);
    testedIds.add(idcpt);
    if (found && found.meta.date === today) {
      todayCompetitionIds.add(idcpt);
    }
  }
  saveTestedIds(testedIds);

  if (!todayCompetitionIds.size) {
    console.log("Actualisation live : pas de competition du club aujourd'hui, rien a faire.");
    return;
  }

  console.log(`Actualisation live : ${todayCompetitionIds.size} competition(s) du jour a rafraichir (${Array.from(todayCompetitionIds).join(", ")}).`);

  for (const idcpt of todayCompetitionIds) {
    const found = await testClubParticipation(idcpt);
    if (!found) continue;
    const freshSwimmers = parseClubResultsHtml(found.html, found.meta);

    // Remplace uniquement les resultats de CETTE competition (nouveaux temps, corrections),
    // sans toucher au reste de la saison deja scrapee.
    for (const sw of data.swimmers) {
      sw.results = sw.results.filter((r) => r.competitionId !== String(idcpt));
    }
    for (const fresh of freshSwimmers) {
      let existing = data.swimmers.find((s) => s.id === fresh.id);
      if (!existing) {
        existing = { id: fresh.id, name: fresh.name, birthYear: fresh.birthYear, gender: fresh.gender, results: [], upcoming: [] };
        data.swimmers.push(existing);
      }
      existing.results.push(...fresh.results);
    }
  }

  data.swimmers.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  data.club = { id: CLUB_ID, name: "ACS Cormeilles Natation", lastUpdated: new Date().toISOString() };

  await attachFreestyleOpponents(data, { onlyCompetitionIds: todayCompetitionIds });

  store.save(data);
  console.log("Actualisation live terminee.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
