const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const isRender = String(process.env.RENDER || "").toLowerCase() === "true";
const persistRoot = process.env.PERSIST_ROOT || (isRender ? "/var/data/websitemanbot" : rootDir);
const dataDir = process.env.DATA_DIR || path.join(persistRoot, "data");

const files = [
  path.join(dataDir, "settings.json"),
  path.join(dataDir, "secrets.json")
];

for (const file of files) {
  JSON.parse(fs.readFileSync(file, "utf8"));
}

const jsFiles = [
  "public/shared.js",
  "public/chaos.js",
  "public/site.js",
  "public/about.js",
  "public/support.js",
  "public/product.js",
  "public/admin/admin.js"
];

for (const file of jsFiles) {
  const fullPath = path.join(rootDir, file);
  new Function(fs.readFileSync(fullPath, "utf8"));
}

console.log("Sanity checks passed.");
