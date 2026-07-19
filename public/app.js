const app = document.getElementById("app");
const searchInput = document.getElementById("search");
const lastUpdatedEl = document.getElementById("last-updated");

// Applique le theme choisi par le viewer (clair/sombre), pas de logique custom necessaire :
// on s'appuie uniquement sur prefers-color-scheme via le CSS.

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

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadClubInfo() {
  try {
    const club = await fetchJson("/api/club");
    lastUpdatedEl.textContent = club.lastUpdated
      ? `Dernière actualisation : ${formatDateTime(club.lastUpdated)} · ${club.swimmerCount} nageur(s) suivis`
      : "Aucune donnée récupérée pour le moment";
  } catch {
    lastUpdatedEl.textContent = "Actualisation indisponible";
  }
}

function swimmerCardHtml(s) {
  const chipClass = s.gender === "F" ? "chip-f" : "chip-m";
  const genderLabel = s.gender === "F" ? "Dame" : s.gender === "M" ? "Homme" : "";
  return `
    <a class="swimmer-card" href="#/nageur/${encodeURIComponent(s.id)}">
      <span class="name">${escapeHtml(s.name)}</span>
      <span class="meta">
        ${s.birthYear ? `<span>${s.birthYear}</span>` : ""}
        ${genderLabel ? `<span class="chip ${chipClass}">${genderLabel}</span>` : ""}
      </span>
      <span class="meta">${s.resultCount} résultat${s.resultCount > 1 ? "s" : ""}${s.upcomingCount ? ` · ${s.upcomingCount} à venir` : ""}</span>
    </a>`;
}

async function renderHome(query) {
  app.innerHTML = `<h1 class="section-title">Nageurs du club</h1><div id="grid" class="swimmer-grid"><div class="loading">Chargement des nageurs…</div></div>`;
  const grid = document.getElementById("grid");
  try {
    const swimmers = await fetchJson(`/api/swimmers?q=${encodeURIComponent(query || "")}`);
    if (!swimmers.length) {
      grid.innerHTML = `<div class="empty-state">Aucun nageur ne correspond à « ${escapeHtml(query)} ».</div>`;
      return;
    }
    grid.innerHTML = swimmers.map(swimmerCardHtml).join("");
  } catch (err) {
    grid.innerHTML = `<div class="error-state">Impossible de charger les nageurs (${escapeHtml(err.message)}).</div>`;
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
      <td class="date">${formatDate(r.date)}<br><small style="color:var(--text-muted)">${escapeHtml(r.competitionName || "")}${r.location ? ` · ${escapeHtml(r.location)}` : ""}</small></td>
      <td class="event">${escapeHtml(r.event)}${roundOrSession ? `<br><small style="color:var(--text-muted)">${escapeHtml(roundOrSession)}</small>` : ""}</td>
      <td class="rank">${escapeHtml(formatRank(r.rank))}</td>
      <td class="time">${r.time ? escapeHtml(r.time) : "—"} ${r.isPB ? `<span class="pb-badge">PB</span>` : ""}</td>
      <td>${statusHtml}</td>
    </tr>${opponentsDetailHtml(r, swimmerName)}`;
}

function upcomingRowHtml(u) {
  const opponents = (u.opponents || [])
    .map((o) => `<span>${escapeHtml(o.name)} <span class="opp-club">(${escapeHtml(o.club || "")}${o.lane ? `, couloir ${o.lane}` : ""})</span></span>`)
    .join("");
  return `
    <tr>
      <td>${formatDate(u.date)}</td>
      <td class="event">${escapeHtml(u.competitionName || "")}${u.location ? `<br><small style="color:var(--text-muted)">${escapeHtml(u.location)}</small>` : ""}</td>
      <td class="event">${escapeHtml(u.event || "")}${u.session ? `<br><small style="color:var(--text-muted)">${escapeHtml(u.session)}</small>` : ""}</td>
      <td class="rank">${u.scheduledTime ? escapeHtml(u.scheduledTime) : "—"}${u.heat ? `<br><small>Série ${escapeHtml(String(u.heat))}${u.lane ? `, couloir ${escapeHtml(String(u.lane))}` : ""}</small>` : ""}</td>
      <td><div class="opponent-list">${opponents || "<span class=\"opp-club\">Liste de départ pas encore publiée</span>"}</div></td>
    </tr>`;
}

async function renderSwimmer(id) {
  app.innerHTML = `<div class="loading">Chargement de la fiche nageur…</div>`;
  try {
    const s = await fetchJson(`/api/swimmers/${encodeURIComponent(id)}`);
    const genderLabel = s.gender === "F" ? "Dame" : s.gender === "M" ? "Homme" : "";
    const results = [...(s.results || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const upcoming = [...(s.upcoming || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    app.innerHTML = `
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
    `;
  } catch (err) {
    app.innerHTML = `<a class="back-link" href="#/">&larr; Retour aux nageurs</a><div class="error-state">Nageur introuvable (${escapeHtml(err.message)}).</div>`;
  }
}

function currentQueryFromSearch() {
  return searchInput.value.trim();
}

function router() {
  const hash = location.hash || "#/";
  const swimmerMatch = hash.match(/^#\/nageur\/(.+)$/);
  if (swimmerMatch) {
    renderSwimmer(decodeURIComponent(swimmerMatch[1]));
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
