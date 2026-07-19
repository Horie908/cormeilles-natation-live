const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "club_data.json");

let state = {
  club: { id: 733, name: "ACS Cormeilles Natation", lastUpdated: null },
  swimmers: [],
};

function load() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (err) {
      console.error("Impossible de lire club_data.json :", err.message);
    }
  }
  return state;
}

function save(next) {
  state = next;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

function get() {
  return state;
}

module.exports = { load, save, get, DATA_FILE };
