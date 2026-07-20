// Decouverte des competitions du club (passees et a venir) sur ffn.extranat.fr / liveffn.com.
// Port du script scrape_ffn.ps1 (session de decouverte du 2026-07-19) en JavaScript, pour
// pouvoir tourner sur un serveur Node classique (Render, etc. n'ont pas PowerShell).
const { EXTRANAT_BASE, LIVEFFN_BASE, CLUB_ID, DEPT_ID, REGION_ID, fetchHtml, sleep, ffnSeason } = require("./ffn");
const { parseCompetitionMeta } = require("./parseResults");

// Parcourt competitions.php sur une fenetre de mois (departement + region) et renvoie
// l'ensemble unique des idcpt trouves.
async function findCompetitionIds({ monthsBack = 2, monthsForward = 1 } = {}) {
  const today = new Date();
  const ids = new Set();

  for (let offset = -monthsBack; offset <= monthsForward; offset++) {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const mth = d.getMonth() + 1;
    const sai = ffnSeason(d);
    for (const [key, val] of [
      ["iddep", DEPT_ID],
      ["idreg", REGION_ID],
    ]) {
      const url = `${EXTRANAT_BASE}/competitions.php?idact=nat&idsai=${sai}&${key}=${val}&idmth=${mth}`;
      try {
        const html = await fetchHtml(url);
        for (const m of html.matchAll(/idcpt=(\d+)/g)) ids.add(m[1]);
      } catch (err) {
        console.error(`Echec recuperation ${url} :`, err.message);
      }
    }
  }
  return Array.from(ids);
}

// Renvoie { meta, html } si le club apparait dans les resultats de cette competition, sinon null.
async function testClubParticipation(idcpt) {
  const url = `${EXTRANAT_BASE}/resultats.php?idact=nat&idcpt=${idcpt}&go=res&idclb=${CLUB_ID}`;
  try {
    const html = await fetchHtml(url);
    if (!html.includes("ACS CORMEILLES")) return null;
    const meta = parseCompetitionMeta(html, idcpt);
    return { meta, html };
  } catch (err) {
    console.error(`Echec test participation idcpt=${idcpt} :`, err.message);
    return null;
  }
}

// Classe les competitions candidates en "passees" (avec resultats du club) et "a venir"
// (identifiees au calendrier, sans resultats a scraper).
async function findClubCompetitions({ monthsBack = 2, monthsForward = 1 } = {}) {
  const candidateIds = await findCompetitionIds({ monthsBack, monthsForward });
  const today = new Date();
  const past = [];
  const future = [];

  for (const idcpt of candidateIds) {
    const found = await testClubParticipation(idcpt);
    if (!found || !found.meta.date) continue;
    const compDate = new Date(found.meta.date + "T00:00:00");
    if (compDate <= today) past.push(found);
    else future.push(found);
  }

  past.sort((a, b) => (b.meta.date || "").localeCompare(a.meta.date || ""));
  future.sort((a, b) => (a.meta.date || "").localeCompare(b.meta.date || ""));
  return { past, future };
}

// Tente de recuperer une liste de depart (adversaires/couloirs/horaires) pour une competition
// a venir. Renvoie null si non publiee (cas normal avant la reunion technique, generalement
// la veille ou le matin meme) - on n'invente jamais de couloir/horaire.
async function getStartlistHtml(idcpt) {
  const url = `${LIVEFFN_BASE}/startlist.php?competition=${idcpt}&langue=fra`;
  try {
    const html = await fetchHtml(url, { retryOn429: false });
    if (html.includes("n'est pas disponible actuellement") || html.includes("sera publiée")) {
      return null;
    }
    return html;
  } catch {
    return null;
  }
}

// Tente de recuperer le planning horaire (programme des reunions/epreuves) d'une competition
// a venir, publie sur liveffn.com generalement des la creation de la competition (bien avant la
// liste de depart). Renvoie null si non disponible - on n'invente jamais d'horaire.
async function getProgrammeHtml(idcpt) {
  const url = `${LIVEFFN_BASE}/programme.php?competition=${idcpt}&langue=fra`;
  try {
    const html = await fetchHtml(url, { retryOn429: false });
    if (html.includes("n'est pas disponible actuellement") || html.includes("sera publiée")) {
      return null;
    }
    return html;
  } catch {
    return null;
  }
}

module.exports = { findCompetitionIds, testClubParticipation, findClubCompetitions, getStartlistHtml, getProgrammeHtml, sleep };
