const fs = require("fs");
const path = require("path");
const { parseClubResultsHtml } = require("./parseResults");

for (const file of ["sample_44045.html", "sample_multi.html"]) {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "data", file), "utf8");
  const swimmers = parseClubResultsHtml(html, 44045);
  console.log("===", file, "===");
  console.log(JSON.stringify(swimmers, null, 2));
}
