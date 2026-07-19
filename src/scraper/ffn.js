// Client HTTP pour ffn.extranat.fr (le backend derriere "FFN Live" / liveffn.com)
// Ne genere JAMAIS de donnees inventees : si une info n'est pas trouvee, on la laisse vide.

const cheerio = require("cheerio");

const EXTRANAT_BASE = "https://ffn.extranat.fr/webffn";
const LIVEFFN_BASE = "https://www.liveffn.com/cgi-bin";
const CLUB_ID = 733; // ACS CORMEILLES
const DEPT_ID = 1633; // VAL-D'OISE
const REGION_ID = 1592; // ILE-DE-FRANCE

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; CormeillesNatationLive/1.0; usage club interne)",
  "Accept-Language": "fr-FR,fr;q=0.9",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Respect du site : throttling systematique + une seule retentative apres pause longue
// en cas de blocage temporaire (HTTP 403/429), constate lors du developpement en cas de
// requetes trop rapprochees.
async function fetchHtml(url, { retryOn429 = true } = {}) {
  async function doFetch() {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} sur ${url}`);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }

  try {
    const html = await doFetch();
    await sleep(700);
    return html;
  } catch (err) {
    if (retryOn429 && (err.status === 403 || err.status === 429)) {
      await sleep(60000);
      const html = await doFetch();
      await sleep(700);
      return html;
    }
    throw err;
  }
}

// Saison FFN = "idsai". Septembre -> Aout de l'annee suivante porte le nom de l'annee de fin.
function ffnSeason(date) {
  return date.getMonth() + 1 >= 9 ? date.getFullYear() + 1 : date.getFullYear();
}

// Parse un temps "01:23.45" en centiemes pour tri/comparaison
function timeToCentiemes(t) {
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d+)[.,](\d{1,2})$/);
  if (!m) return null;
  const min = m[1] ? parseInt(m[1], 10) : 0;
  const sec = parseInt(m[2], 10);
  const cent = parseInt(m[3].padEnd(2, "0"), 10);
  return min * 6000 + sec * 100 + cent;
}

module.exports = {
  EXTRANAT_BASE,
  LIVEFFN_BASE,
  CLUB_ID,
  DEPT_ID,
  REGION_ID,
  HEADERS,
  fetchHtml,
  sleep,
  ffnSeason,
  timeToCentiemes,
  cheerio,
};
