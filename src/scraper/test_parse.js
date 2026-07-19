const fs = require("fs");
const path = require("path");
const { parseClubResultsHtml } = require("./parseResults");

const meta = { idcpt: "44045", name: "Test", location: "Test", date: "2026-01-01" };
for (const file of ["sample_44045.html", "sample_multi.html"]) {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "data", file), "utf8");
  const swimmers = parseClubResultsHtml(html, meta);
  console.log("===", file, "===");
  console.log(JSON.stringify(swimmers, null, 2));
}
