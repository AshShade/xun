#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const release = process.argv.includes("--release");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = release ? pkg.version : `${pkg.version}-b${String(Math.random() * 10000 | 0).padStart(4, "0")}`;

// 1. Copy public/ → dist/ (static assets + manifest)
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dst, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}
fs.rmSync("dist", { recursive: true, force: true });
copyDir("public", "dist");

// 2. Update manifest version
const manifestPath = path.join("dist", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = pkg.version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// 3. Bundle each entry point as a self-contained IIFE
esbuild.buildSync({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    options: "src/options.ts",
    editor: "src/editor.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: release,
  legalComments: "none",
  dropLabels: release ? ["DEV"] : [],
  define: { __VERSION__: JSON.stringify(version) },
});

// 4. Write .build-info for TUI switcher
const branch = (() => {
  try {
    const head = fs.readFileSync(".git", "utf8").trim();
    if (head.startsWith("gitdir:")) {
      const gitdir = head.split(": ", 2)[1];
      const h = fs.readFileSync(path.join(gitdir, "HEAD"), "utf8").trim();
      return h.startsWith("ref:") ? h.split("/").pop() : h.slice(0, 8);
    }
  } catch {}
  try {
    const h = fs.readFileSync(path.join(".git", "HEAD"), "utf8").trim();
    return h.startsWith("ref:") ? h.split("/").pop() : h.slice(0, 8);
  } catch { return "unknown"; }
})();
fs.writeFileSync(path.join("dist", ".build-info"), `branch=${branch}\nversion=${version}\n`);

console.log(`Built ${version} [${branch}]${release ? " (release)" : ""}`);

// 5. Release: create browser-specific dist directories
if (release) {
  function copyDirSync(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name), d = path.join(dst, entry.name);
      entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
    }
  }

  fs.rmSync("dist-firefox", { recursive: true, force: true });
  fs.rmSync("dist-chrome", { recursive: true, force: true });

  // Firefox: keep as-is (supports both scripts and service_worker keys)
  copyDirSync("dist", "dist-firefox");
  const ffManifest = JSON.parse(fs.readFileSync("dist-firefox/manifest.json", "utf8"));
  delete ffManifest.background.service_worker;
  fs.writeFileSync("dist-firefox/manifest.json", JSON.stringify(ffManifest, null, 2) + "\n");

  // Chrome: strip Firefox-specific fields
  copyDirSync("dist", "dist-chrome");
  const crManifest = JSON.parse(fs.readFileSync("dist-chrome/manifest.json", "utf8"));
  delete crManifest.browser_specific_settings;
  delete crManifest.background.scripts;
  fs.writeFileSync("dist-chrome/manifest.json", JSON.stringify(crManifest, null, 2) + "\n");

  console.log(`  → dist-firefox/ (MV3 + scripts)`);
  console.log(`  → dist-chrome/  (MV3 + service_worker)`);
}
