// Scraper pour ffn.extranat.fr (le backend derriere "FFN Live" / liveffn.com)
// Ne genere JAMAIS de donnees inventees : si une info n'est pas trouvee, on la laisse vide.

const cheerio = require("cheerio");

const BASE = "https://ffn.extranat.fr/webffn";
const CLUB_ID = 733; // ACS CORMEILLES

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; CormeillesNatationLive/1.0; usage club interne)",
  "Accept-Language": "fr-FR,fr;q=0.9",
};

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return await res.text();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Parse un temps "01:23.45" ou "23.45" en centiemes pour tri/comparaison
function timeToCentiemes(t) {
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d+)[.,](\d{1,2})$/);
  if (!m) return null;
  const min = m[1] ? parseInt(m[1], 10) : 0;
  const sec = parseInt(m[2], 10);
  const cent = parseInt(m[3].padEnd(2, "0"), 10);
  return min * 6000 + sec * 100 + cent;
}

module.exports = { BASE, CLUB_ID, HEADERS, fetchHtml, sleep, timeToCentiemes, cheerio };
