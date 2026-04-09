#!/usr/bin/env node
// Build script: injects version from package.json, strips #IF_DEV blocks for release
const fs = require("fs");
const path = require("path");

const release = process.argv.includes("--release");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = release ? pkg.version : `${pkg.version}-b${String(Math.random() * 10000 | 0).padStart(4, "0")}`;

// 1. Update manifest.json version
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
manifest.version = pkg.version; // manifest doesn't support -dev suffix
fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// 2. Post-process compiled JS in dist/
const dist = "dist";
for (const f of fs.readdirSync(dist).filter(f => f.endsWith(".js"))) {
  const fp = path.join(dist, f);
  let code = fs.readFileSync(fp, "utf8");
  // Strip `export` keywords (Firefox content scripts don't use modules)
  code = code.replace(/^export /gm, "");
  // Inject version
  code = code.replace(/__VERSION__/g, version);
  // Strip #IF_DEV blocks in release mode
  if (release) {
    code = code.replace(/\/\/ #IF_DEV[\s\S]*?\/\/ #END_IF_DEV\n?/g, "");
  }
  fs.writeFileSync(fp, code);
}

console.log(`Built ${version}${release ? " (release)" : " (dev)"}`);
