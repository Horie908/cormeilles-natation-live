const path = require("path");
const express = require("express");
const cron = require("node-cron");
const store = require("./store");
const { main: runScrape } = require("./scraper/run");
const { main: runLiveRefresh } = require("./scraper/liveRefresh");

const PORT = process.env.PORT || 3000;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN || null;
const REFRESH_CRON = process.env.REFRESH_CRON || "0 7,19 * * *"; // 2x/jour par defaut : saison complete
const LIVE_REFRESH_CRON = process.env.LIVE_REFRESH_CRON || "*/15 * * * *"; // toutes les 15 min : juste la compet du jour

store.load();

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

app.get("/api/club", (req, res) => {
  const { club, swimmers } = store.get();
  const allResults = swimmers.flatMap((s) => s.results || []);
  const lastResult = [...allResults].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  res.json({
    ...club,
    swimmerCount: swimmers.length,
    resultCount: allResults.length,
    lastCompetition: lastResult ? { name: lastResult.competitionName, date: lastResult.date } : null,
  });
});

app.get("/api/swimmers", (req, res) => {
  const q = normalize(req.query.q);
  const { swimmers } = store.get();
  const list = swimmers
    .filter((s) => !q || normalize(s.name).includes(q))
    .map((s) => ({
      id: s.id,
      name: s.name,
      birthYear: s.birthYear,
      gender: s.gender,
      resultCount: s.results.length,
      upcomingCount: (s.upcoming || []).length,
      firstSeen: s.firstSeen || null,
    }));
  res.json(list);
});

app.get("/api/swimmers/:id", (req, res) => {
  const { swimmers } = store.get();
  const swimmer = swimmers.find((s) => s.id === req.params.id);
  if (!swimmer) return res.status(404).json({ error: "Nageur introuvable" });
  res.json(swimmer);
});

function listCompetitions() {
  const { swimmers } = store.get();
  const byId = new Map();
  for (const s of swimmers) {
    for (const r of s.results || []) {
      if (!byId.has(r.competitionId)) {
        byId.set(r.competitionId, {
          id: r.competitionId,
          name: r.competitionName,
          date: r.date,
          location: r.location,
          swimmerIds: new Set(),
          resultCount: 0,
        });
      }
      const c = byId.get(r.competitionId);
      c.swimmerIds.add(s.id);
      c.resultCount++;
    }
  }
  return Array.from(byId.values())
    .map((c) => ({ id: c.id, name: c.name, date: c.date, location: c.location, swimmerCount: c.swimmerIds.size, resultCount: c.resultCount }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

function getCompetitionResults(id) {
  const { swimmers } = store.get();
  const results = [];
  let meta = null;
  for (const s of swimmers) {
    for (const r of s.results || []) {
      if (r.competitionId !== id) continue;
      if (!meta) meta = { id: r.competitionId, name: r.competitionName, date: r.date, location: r.location };
      results.push({ ...r, swimmerId: s.id, swimmerName: s.name });
    }
  }
  if (!meta) return null;
  results.sort((a, b) => a.swimmerName.localeCompare(b.swimmerName, "fr") || (a.event || "").localeCompare(b.event || "", "fr"));
  return { ...meta, results };
}

app.get("/api/competitions", (req, res) => {
  const q = normalize(req.query.q);
  const list = listCompetitions().filter((c) => !q || normalize(c.name).includes(q) || normalize(c.location).includes(q));
  res.json(list);
});

app.get("/api/competitions/:id", (req, res) => {
  const comp = getCompetitionResults(req.params.id);
  if (!comp) return res.status(404).json({ error: "Compétition introuvable" });
  res.json(comp);
});

// Vue "Live" : la competition du jour (si le club en a une) avec ses resultats, le planning
// des prochaines competitions identifiees au calendrier, et la derniere competition passee (pour
// verifier que l'affichage fonctionne meme quand aucune competition n'est en cours).
app.get("/api/live", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const competitions = listCompetitions();
  const liveMeta = competitions.find((c) => c.date === today);
  const lastMeta = competitions[0] || null;

  res.json({
    today,
    live: liveMeta ? getCompetitionResults(liveMeta.id) : null,
    upcoming: store.get().upcomingCompetitions || [],
    last: lastMeta ? getCompetitionResults(lastMeta.id) : null,
  });
});

app.post("/api/refresh", async (req, res) => {
  if (REFRESH_TOKEN && req.query.token !== REFRESH_TOKEN) {
    return res.status(401).json({ error: "Token invalide" });
  }
  try {
    await runScrape();
    res.json({ ok: true, ...store.get().club });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualisation legere : ne re-scrape que la competition du jour (si le club en a une), pour
// suivre les temps qui tombent en direct pendant une reunion sans re-scraper toute la saison.
app.post("/api/refresh-live", async (req, res) => {
  if (REFRESH_TOKEN && req.query.token !== REFRESH_TOKEN) {
    return res.status(401).json({ error: "Token invalide" });
  }
  try {
    await runLiveRefresh();
    res.json({ ok: true, ...store.get().club });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Cormeilles Natation Live sur http://localhost:${PORT}`);
});

if (REFRESH_CRON) {
  cron.schedule(REFRESH_CRON, () => {
    console.log("Actualisation complete programmee des donnees FFN...");
    runScrape().catch((err) => console.error("Echec actualisation complete :", err.message));
  });
}

if (LIVE_REFRESH_CRON) {
  cron.schedule(LIVE_REFRESH_CRON, () => {
    runLiveRefresh().catch((err) => console.error("Echec actualisation live :", err.message));
  });
}
