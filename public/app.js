const app = document.getElementById("app");
const searchInput = document.getElementById("search");
const lastUpdatedEl = document.getElementById("last-updated");
const topbarEl = document.querySelector(".topbar");

// Applique le theme choisi par le viewer (clair/sombre), pas de logique custom necessaire :
// on s'appuie uniquement sur prefers-color-scheme via le CSS.

// Cache l'entete (recherche incluse) des qu'on quitte le tout haut de la page, et ne la fait
// reapparaitre que quand on est revenu tout en haut — surtout utile sur mobile ou l'entete
// prend une bonne partie de l'ecran. Le comportement visuel (translateY) n'est actif qu'en
// dessous de 640px via le CSS, mais on laisse tourner la logique partout : inoffensif sur desktop.
(() => {
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      topbarEl.classList.toggle("header-hidden", window.scrollY > 24);
      ticking = false;
    });
  }, { passive: true });
})();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatDateTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function normalize(str) {
  return String(str ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Remplace le contenu de #app et relance l'animation d'apparition (une classe CSS appliquee
// deux fois de suite ne se re-declenche pas toute seule, d'ou le forcage de reflow).
function setAppHtml(html) {
  app.classList.remove("fade-in");
  void app.offsetWidth;
  app.innerHTML = html;
  app.classList.add("fade-in");
}

function updateActiveTab(name) {
  document.querySelectorAll("#main-tabs .tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === name);
  });
}

function isRecent(iso, days) {
  if (!iso) return false;
  const diffMs = Date.now() - new Date(iso).getTime();
  return diffMs >= 0 && diffMs < days * 24 * 60 * 60 * 1000;
}

let clubInfo = null;

async function loadClubInfo() {
  try {
    clubInfo = await fetchJson("/api/club");
    lastUpdatedEl.textContent = clubInfo.lastUpdated
      ? `Dernière actualisation : ${formatDateTime(clubInfo.lastUpdated)} · ${clubInfo.swimmerCount} nageur(s) suivis`
      : "Aucune donnée récupérée pour le moment";
    renderStatsStrip();
  } catch {
    lastUpdatedEl.textContent = "Actualisation indisponible";
  }
}

function renderStatsStrip() {
  const el = document.getElementById("stats-strip");
  if (!el || !clubInfo) return;
  const last = clubInfo.lastCompetition;
  el.innerHTML = `
    <div class="stat"><strong>${clubInfo.swimmerCount}</strong><span>nageurs</span></div>
    <div class="stat"><strong>${clubInfo.resultCount}</strong><span>résultats</span></div>
    ${last ? `<div class="stat stat-wide"><strong>${escapeHtml(last.name || "")}</strong><span>${formatDate(last.date)}</span></div>` : ""}
  `;
}

function swimmerCardHtml(s) {
  const chipClass = s.gender === "F" ? "chip-f" : "chip-m";
  const genderLabel = s.gender === "F" ? "Dame" : s.gender === "M" ? "Homme" : "";
  const isNew = isRecent(s.firstSeen, 7);
  return `
    <a class="swimmer-card" href="#/nageur/${encodeURIComponent(s.id)}">
      ${isNew ? `<span class="new-badge">Nouveau</span>` : ""}
      <span class="name">${escapeHtml(s.name)}</span>
      <span class="meta">
        ${s.birthYear ? `<span>${s.birthYear}</span>` : ""}
        ${genderLabel ? `<span class="chip ${chipClass}">${genderLabel}</span>` : ""}
      </span>
      <span class="meta">${s.resultCount} résultat${s.resultCount > 1 ? "s" : ""}${s.upcomingCount ? ` · ${s.upcomingCount} à venir` : ""}</span>
    </a>`;
}

let sortMode = "name"; // "name" | "age"

function sortSwimmers(swimmers, mode) {
  const sorted = [...swimmers];
  if (mode === "age") {
    // Plus ages (annee de naissance la plus petite) en premier ; sans annee connue, a la fin.
    sorted.sort((a, b) => (a.birthYear ?? 9999) - (b.birthYear ?? 9999) || a.name.localeCompare(b.name, "fr"));
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }
  return sorted;
}

async function renderHome(query) {
  updateActiveTab("nageurs");
  setAppHtml(`
    <div id="stats-strip" class="stats-strip"></div>
    <div class="home-header">
      <h1 class="section-title">Nageurs du club</h1>
      <label class="sort-control">
        Trier par
        <select id="sort-select">
          <option value="name">Nom</option>
          <option value="age">Âge (plus grands d'abord)</option>
        </select>
      </label>
    </div>
    <div id="grid" class="swimmer-grid"><div class="loading">Chargement des nageurs…</div></div>`);
  renderStatsStrip();
  const grid = document.getElementById("grid");
  const sortSelect = document.getElementById("sort-select");
  sortSelect.value = sortMode;
  sortSelect.addEventListener("change", () => {
    sortMode = sortSelect.value;
    renderHome(query);
  });

  try {
    const swimmers = await fetchJson(`/api/swimmers?q=${encodeURIComponent(query || "")}`);
    if (!swimmers.length) {
      grid.innerHTML = `<div class="empty-state">Aucun nageur ne correspond à « ${escapeHtml(query)} ».</div>`;
      return;
    }
    grid.innerHTML = sortSwimmers(swimmers, sortMode).map(swimmerCardHtml).join("");
  } catch (err) {
    grid.innerHTML = `<div class="error-state">Impossible de charger les nageurs (${escapeHtml(err.message)}).</div>`;
  }
}

function competitionCardHtml(c) {
  return `
    <a class="competition-card" href="#/competition/${encodeURIComponent(c.id)}">
      <div>
        <div class="comp-name">${escapeHtml(c.name || "Compétition")}</div>
        <div class="comp-meta">${formatDate(c.date)}${c.location ? ` · ${escapeHtml(c.location)}` : ""}</div>
      </div>
      <div class="comp-count">${c.swimmerCount} nageur${c.swimmerCount > 1 ? "s" : ""} · ${c.resultCount} résultat${c.resultCount > 1 ? "s" : ""}</div>
    </a>`;
}

let competitionQuery = "";

async function renderCompetitions() {
  updateActiveTab("competitions");
  setAppHtml(`
    <div class="home-header">
      <h1 class="section-title">Compétitions</h1>
      <div class="comp-search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
          <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <input id="comp-search" type="search" placeholder="Chercher une compétition (nom, lieu)…" autocomplete="off" />
      </div>
    </div>
    <div id="comp-list" class="competitions-list"><div class="loading">Chargement des compétitions…</div></div>`);

  const compSearchInput = document.getElementById("comp-search");
  compSearchInput.value = competitionQuery;
  compSearchInput.focus();
  compSearchInput.setSelectionRange(competitionQuery.length, competitionQuery.length);
  let debounce;
  compSearchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      competitionQuery = compSearchInput.value.trim();
      loadCompetitionsList(competitionQuery);
    }, 150);
  });

  await loadCompetitionsList(competitionQuery);
}

async function loadCompetitionsList(query) {
  const list = document.getElementById("comp-list");
  if (!list) return;
  try {
    const competitions = await fetchJson(`/api/competitions?q=${encodeURIComponent(query || "")}`);
    if (!competitions.length) {
      list.innerHTML = `<div class="empty-state">Aucune compétition ne correspond à « ${escapeHtml(query)} ».</div>`;
      return;
    }
    list.innerHTML = competitions.map(competitionCardHtml).join("");
  } catch (err) {
    list.innerHTML = `<div class="error-state">Impossible de charger les compétitions (${escapeHtml(err.message)}).</div>`;
  }
}

function competitionResultRowHtml(r) {
  const statusHtml =
    r.status === "OK"
      ? `<span class="status-pill status-ok">OK</span>`
      : `<span class="status-pill status-bad">${escapeHtml(r.status)}</span>`;
  return `
    <tr>
      <td data-label="Nageur"><a href="#/nageur/${encodeURIComponent(r.swimmerId)}" class="swimmer-link">${escapeHtml(r.swimmerName)}</a></td>
      <td class="event" data-label="Épreuve">${escapeHtml(r.event)}${r.session ? `<br><small style="color:var(--text-muted)">${escapeHtml(r.session)}</small>` : ""}</td>
      <td class="rank" data-label="Rang">${escapeHtml(formatRank(r.rank))}</td>
      <td class="time" data-label="Temps">${r.time ? escapeHtml(r.time) : "—"} ${r.isPB ? `<span class="pb-badge">PB</span>` : ""}</td>
      <td data-label="Statut">${statusHtml}</td>
    </tr>`;
}

function competitionResultsTableHtml(results, idPrefix) {
  return `
    <div class="results-table-wrap">
      <table class="results">
        <thead><tr><th>Nageur</th><th>Épreuve</th><th>Rang</th><th>Temps</th><th>Statut</th></tr></thead>
        <tbody id="${idPrefix}-body">${results.map(competitionResultRowHtml).join("")}</tbody>
      </table>
    </div>`;
}

function scheduleSessionHtml(session, i) {
  return `
    <details class="schedule-session"${i === 0 ? " open" : ""}>
      <summary>
        <span>${escapeHtml(session.title || "Réunion")}${session.date ? ` — ${formatDate(session.date)}` : ""}</span>
        ${session.doorsOpen ? `<span class="schedule-doors">Ouverture des portes : ${escapeHtml(session.doorsOpen)}</span>` : ""}
      </summary>
      <ul class="schedule-list">
        ${session.events
          .map(
            (e) => `
          <li>
            <span class="schedule-time">${escapeHtml(e.time)}</span>
            <span class="schedule-event">${escapeHtml(e.name)}</span>
          </li>`
          )
          .join("")}
      </ul>
    </details>`;
}

function planningCardHtml(c) {
  const hasSchedule = Array.isArray(c.schedule) && c.schedule.length > 0;
  return `
    <div class="planning-block">
      <div class="competition-card planning-card">
        <div>
          <div class="comp-name">${escapeHtml(c.name || "Compétition")}</div>
          <div class="comp-meta">${c.location ? escapeHtml(c.location) : ""}</div>
        </div>
        <div class="comp-count">${formatDate(c.date)}</div>
      </div>
      ${
        hasSchedule
          ? `<div class="schedule-block">${c.schedule.map(scheduleSessionHtml).join("")}</div>`
          : `<div class="schedule-pending">Horaires pas encore publiés pour cette compétition.</div>`
      }
    </div>`;
}

async function renderLive() {
  updateActiveTab("live");
  setAppHtml(`<div class="loading">Chargement du live…</div>`);
  try {
    const data = await fetchJson("/api/live");
    const sortedUpcoming = [...(data.upcoming || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    const liveSection = data.live
      ? `<div class="live-banner">
           <span class="live-dot" aria-hidden="true"></span>
           <div>
             <strong>En direct — ${escapeHtml(data.live.name || "Compétition")}</strong>
             <div class="comp-meta">${formatDate(data.live.date)}${data.live.location ? ` · ${escapeHtml(data.live.location)}` : ""}</div>
           </div>
         </div>
         ${competitionResultsTableHtml(data.live.results, "live-current")}`
      : "";

    setAppHtml(`
      <h1 class="section-title">Live</h1>

      ${liveSection}

      <h2 class="block-title">Planning des prochaines compétitions</h2>
      ${
        sortedUpcoming.length
          ? `<div class="competitions-list">${sortedUpcoming.map(planningCardHtml).join("")}</div>`
          : `<div class="empty-state">Aucune compétition à venir programmée pour le moment.</div>`
      }

      ${
        data.last
          ? `<h2 class="block-title">Dernière compétition (${escapeHtml(data.last.name || "")}, ${formatDate(data.last.date)})</h2>
             ${competitionResultsTableHtml(data.last.results, "live-last")}`
          : ""
      }
    `);
  } catch (err) {
    setAppHtml(`<div class="error-state">Impossible de charger le live (${escapeHtml(err.message)}).</div>`);
  }
}

async function renderCompetition(id) {
  setAppHtml(`<div class="loading">Chargement de la compétition…</div>`);
  try {
    const c = await fetchJson(`/api/competitions/${encodeURIComponent(id)}`);
    const results = [...c.results].sort(
      (a, b) => a.swimmerName.localeCompare(b.swimmerName, "fr") || (a.event || "").localeCompare(b.event || "", "fr")
    );
    setAppHtml(`
      <a class="back-link" href="#/competitions">&larr; Retour aux compétitions</a>
      <div class="swimmer-header">
        <h1>${escapeHtml(c.name || "Compétition")}</h1>
        <span class="sub">${formatDate(c.date)}${c.location ? ` · ${escapeHtml(c.location)}` : ""}</span>
      </div>
      <div class="comp-search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
          <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <input id="comp-swimmer-search" type="search" placeholder="Chercher un nageur dans cette compétition…" autocomplete="off" />
      </div>
      <div class="results-table-wrap">
        <table class="results">
          <thead><tr><th>Nageur</th><th>Épreuve</th><th>Rang</th><th>Temps</th><th>Statut</th></tr></thead>
          <tbody id="comp-results-body">${results.map(competitionResultRowHtml).join("")}</tbody>
        </table>
      </div>
      <div id="comp-empty" class="empty-state" style="display:none">Aucun nageur ne correspond à cette recherche.</div>`);

    const searchEl = document.getElementById("comp-swimmer-search");
    const bodyEl = document.getElementById("comp-results-body");
    const emptyEl = document.getElementById("comp-empty");
    searchEl.addEventListener("input", () => {
      const q = normalize(searchEl.value.trim());
      const filtered = q ? results.filter((r) => normalize(r.swimmerName).includes(q)) : results;
      bodyEl.innerHTML = filtered.map(competitionResultRowHtml).join("");
      emptyEl.style.display = filtered.length ? "none" : "block";
    });
  } catch (err) {
    setAppHtml(`<a class="back-link" href="#/competitions">&larr; Retour aux compétitions</a><div class="error-state">Compétition introuvable (${escapeHtml(err.message)}).</div>`);
  }
}

function formatRank(rank) {
  if (rank === null || rank === undefined || rank === "") return "—";
  if (typeof rank === "number") return rank === 1 ? "1er" : `${rank}e`;
  return String(rank);
}

function opponentsDetailHtml(r, swimmerName) {
  if (!r.opponents || !r.opponents.length) return "";
  const self = { name: swimmerName, club: "ACS CORMEILLES", time: r.time, rank: r.rank, isSelf: true };
  const field = [...r.opponents, self].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

  // Podium + tous les coequipiers du club present dans cette course + une fenetre de contexte
  // autour du nageur (course a champ large : on n'affiche pas tout le monde, mais le podium,
  // les copains de club, et le vrai voisinage de classement, avec de vraies personnes/temps).
  const selfIdx = field.findIndex((e) => e.isSelf);
  const windowStart = Math.max(0, selfIdx - 2);
  const windowEnd = Math.min(field.length, selfIdx + 3);
  const shown = new Map();
  field.slice(0, 3).forEach((e, i) => shown.set(i, e));
  field.forEach((e, i) => {
    if (e.club === "ACS CORMEILLES") shown.set(i, e);
  });
  for (let i = windowStart; i < windowEnd; i++) shown.set(i, field[i]);
  const orderedIdx = Array.from(shown.keys()).sort((a, b) => a - b);

  let rowsHtml = "";
  let prevIdx = null;
  for (const idx of orderedIdx) {
    if (prevIdx !== null && idx > prevIdx + 1) {
      rowsHtml += `<tr class="opp-gap"><td colspan="4">···</td></tr>`;
    }
    const e = shown.get(idx);
    const rowClass = e.isSelf ? "opp-self" : e.club === "ACS CORMEILLES" ? "opp-teammate" : "";
    rowsHtml += `
      <tr class="${rowClass}">
        <td class="rank">${escapeHtml(formatRank(e.rank))}</td>
        <td>${escapeHtml(e.name)}</td>
        <td class="opp-club">${escapeHtml(e.club || "")}</td>
        <td class="time">${e.time ? escapeHtml(e.time) : "—"}</td>
      </tr>`;
    prevIdx = idx;
  }

  return `
    <tr class="opp-details-row">
      <td colspan="5">
        <details>
          <summary>Voir les adversaires de cette course (${field.length} nageurs au départ)</summary>
          <table class="opp-table">
            <thead><tr><th>Rang</th><th>Nageur</th><th>Club</th><th>Temps</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </details>
      </td>
    </tr>`;
}

function resultRowHtml(r, swimmerName) {
  const statusHtml =
    r.status === "OK"
      ? `<span class="status-pill status-ok">OK</span>`
      : `<span class="status-pill status-bad">${escapeHtml(r.status)}</span>`;
  const roundOrSession = r.round || r.session;
  return `
    <tr>
      <td class="date" data-label="Date">${formatDate(r.date)}<br><small style="color:var(--text-muted)">${escapeHtml(r.competitionName || "")}${r.location ? ` · ${escapeHtml(r.location)}` : ""}</small></td>
      <td class="event" data-label="Épreuve">${escapeHtml(r.event)}${roundOrSession ? `<br><small style="color:var(--text-muted)">${escapeHtml(roundOrSession)}</small>` : ""}</td>
      <td class="rank" data-label="Rang">${escapeHtml(formatRank(r.rank))}</td>
      <td class="time" data-label="Temps">${r.time ? escapeHtml(r.time) : "—"} ${r.isPB ? `<span class="pb-badge">PB</span>` : ""}</td>
      <td data-label="Statut">${statusHtml}</td>
    </tr>${opponentsDetailHtml(r, swimmerName)}`;
}

function upcomingRowHtml(u) {
  const opponents = (u.opponents || [])
    .map((o) => `<span>${escapeHtml(o.name)} <span class="opp-club">(${escapeHtml(o.club || "")}${o.lane ? `, couloir ${o.lane}` : ""})</span></span>`)
    .join("");
  return `
    <tr>
      <td data-label="Date">${formatDate(u.date)}</td>
      <td class="event" data-label="Compétition">${escapeHtml(u.competitionName || "")}${u.location ? `<br><small style="color:var(--text-muted)">${escapeHtml(u.location)}</small>` : ""}</td>
      <td class="event" data-label="Épreuve">${escapeHtml(u.event || "")}${u.session ? `<br><small style="color:var(--text-muted)">${escapeHtml(u.session)}</small>` : ""}</td>
      <td class="rank" data-label="Horaire">${u.scheduledTime ? escapeHtml(u.scheduledTime) : "—"}${u.heat ? `<br><small>Série ${escapeHtml(String(u.heat))}${u.lane ? `, couloir ${escapeHtml(String(u.lane))}` : ""}</small>` : ""}</td>
      <td data-label="Adversaires"><div class="opponent-list">${opponents || "<span class=\"opp-club\">Liste de départ pas encore publiée</span>"}</div></td>
    </tr>`;
}

async function renderSwimmer(id) {
  updateActiveTab("nageurs");
  setAppHtml(`<div class="loading">Chargement de la fiche nageur…</div>`);
  try {
    const s = await fetchJson(`/api/swimmers/${encodeURIComponent(id)}`);
    const genderLabel = s.gender === "F" ? "Dame" : s.gender === "M" ? "Homme" : "";
    const results = [...(s.results || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const upcoming = [...(s.upcoming || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    setAppHtml(`
      <a class="back-link" href="#/">&larr; Retour aux nageurs</a>
      <div class="swimmer-header">
        <h1>${escapeHtml(s.name)}</h1>
        <span class="sub">${s.birthYear ? `${s.birthYear}` : ""}${genderLabel ? ` · ${genderLabel}` : ""}</span>
      </div>

      ${
        upcoming.length
          ? `<h2 class="block-title">Prochaines compétitions</h2>
             <div class="upcoming-table-wrap">
               <table class="results">
                 <thead><tr><th>Date</th><th>Compétition</th><th>Épreuve</th><th>Horaire</th><th>Adversaires</th></tr></thead>
                 <tbody>${upcoming.map(upcomingRowHtml).join("")}</tbody>
               </table>
             </div>`
          : ""
      }

      <h2 class="block-title">Historique des résultats</h2>
      ${
        results.length
          ? `<div class="results-table-wrap">
               <table class="results">
                 <thead><tr><th>Date</th><th>Épreuve</th><th>Rang</th><th>Temps</th><th>Statut</th></tr></thead>
                 <tbody>${results.map((r) => resultRowHtml(r, s.name)).join("")}</tbody>
               </table>
             </div>`
          : `<div class="empty-state">Aucun résultat enregistré pour l'instant.</div>`
      }
    `);
  } catch (err) {
    setAppHtml(`<a class="back-link" href="#/">&larr; Retour aux nageurs</a><div class="error-state">Nageur introuvable (${escapeHtml(err.message)}).</div>`);
  }
}

function currentQueryFromSearch() {
  return searchInput.value.trim();
}

function router() {
  const hash = location.hash || "#/";
  const swimmerMatch = hash.match(/^#\/nageur\/(.+)$/);
  const competitionMatch = hash.match(/^#\/competition\/(.+)$/);
  if (swimmerMatch) {
    renderSwimmer(decodeURIComponent(swimmerMatch[1]));
  } else if (competitionMatch) {
    renderCompetition(decodeURIComponent(competitionMatch[1]));
  } else if (hash === "#/competitions") {
    renderCompetitions();
  } else if (hash === "#/live") {
    renderLive();
  } else {
    renderHome(currentQueryFromSearch());
  }
}

let searchDebounce;
searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    if ((location.hash || "#/") !== "#/") location.hash = "#/";
    else renderHome(currentQueryFromSearch());
  }, 150);
});

window.addEventListener("hashchange", router);
loadClubInfo();
router();
