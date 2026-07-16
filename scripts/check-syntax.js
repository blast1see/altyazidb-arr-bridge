"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const roots = [
  "altyazidb-arr-bridge-chrome-0.1.1/src",
  "altyazidb-arr-bridge-firefox-0.1.1/src",
  "tampermonkey",
  "scripts",
  "test"
];

function collectJavaScript(relativePath) {
  const absolutePath = path.join(root, relativePath);

  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const stat = fs.statSync(absolutePath);

  if (stat.isFile()) {
    return absolutePath.endsWith(".js") ? [absolutePath] : [];
  }

  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(absolutePath, entry.name);

    if (entry.isDirectory()) {
      return collectJavaScript(path.relative(root, child));
    }

    return entry.isFile() && entry.name.endsWith(".js") ? [child] : [];
  });
}

const files = roots.flatMap(collectJavaScript).sort();
let failed = false;

for (const file of files) {
  try {
    new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
  } catch (error) {
    failed = true;
    console.error(error.stack || error.message);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`JavaScript syntax OK (${files.length} files).`);
