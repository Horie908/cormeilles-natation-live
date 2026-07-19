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
  res.json({ ...club, swimmerCount: swimmers.length });
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
    }));
  res.json(list);
});

app.get("/api/swimmers/:id", (req, res) => {
  const { swimmers } = store.get();
  const swimmer = swimmers.find((s) => s.id === req.params.id);
  if (!swimmer) return res.status(404).json({ error: "Nageur introuvable" });
  res.json(swimmer);
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
