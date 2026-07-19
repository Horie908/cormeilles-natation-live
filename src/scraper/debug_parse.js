const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const html = fs.readFileSync(path.join(__dirname, "..", "..", "data", "sample_multi.html"), "utf8");
const $ = cheerio.load(html);
const table = $("table").get(0);
console.log("table children tags:", table.children.map(c => c.type === "tag" ? c.tagName + (c.tagName==="thead" ? "["+$(c).find("span[id]").attr("id")+"]" : "") : c.type));
