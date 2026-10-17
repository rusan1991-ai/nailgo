/**
 * Run the real production build and verify its inlined CSS is safe for Safari/iOS 14+.
 *
 * Run from any directory with the repository dependencies installed:
 *   npm --prefix tools/devcheck run webkit-build
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const config = fs.readFileSync(path.join(root, "vite.config.ts"), "utf8");
const expectedTargets = ["es2020", "edge88", "firefox78", "chrome87", "safari14", "ios14"];
const targetConfig = config.match(/target:\s*\[([^\]]+)\]/);
assert.ok(targetConfig, "Vite production build must declare explicit browser targets");
assert.deepEqual(
  [...targetConfig[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1]),
  expectedTargets,
  "Vite production targets must cover ES2020 and the requested Safari/iOS browser versions",
);
assert.match(config, /cssTarget:\s*["']safari14["']/);
assert.match(config, /postcssCascadeLayers\(\)/, "cascade layers must be flattened for legacy WebKit");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(npm, ["run", "build"], { cwd: root, encoding: "utf8" });
if (build.stdout) process.stdout.write(build.stdout);
if (build.stderr) process.stderr.write(build.stderr);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const htmlPath = path.join(root, "dist", "index.html");
assert.ok(fs.existsSync(htmlPath), "Vite build must emit dist/index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
assert.ok(inlineStyles.length > 0, "vite-plugin-singlefile must inline production CSS");
assert.ok(
  inlineStyles.every((css) => !/@layer\b/i.test(css)),
  "Safari 14 / iOS 14-15.3 must not receive unsupported @layer rules in inline styles",
);
const inlineCss = inlineStyles.join("\n");
assert.ok(inlineCss.includes(".n2g-min-h-viewport") && inlineCss.includes(".n2g-h-viewport"), "viewport fallbacks must survive CSS processing");
assert.ok(inlineCss.includes("min-height:100vh") && inlineCss.includes("height:100vh"), "legacy WebKit must retain 100vh fallbacks");
assert.ok(inlineCss.includes("calc(var(--vh,1vh)*100)"), "the JS-measured viewport height must be used when available");
assert.ok(inlineCss.includes("--color-pink-500:#ec4899!important"), "legacy WebKit must receive a HEX pink accent token");
assert.ok(inlineCss.includes("--color-pink-50:#fdf2f8!important"), "legacy WebKit must receive a HEX pastel token");
assert.ok(inlineCss.includes("box-sizing:border-box"), "legacy WebKit must keep padded full-width panels within the viewport");
assert.ok(
  inlineCss.includes("@media(max-width:639px)") && inlineCss.includes("font-size:16px!important"),
  "mobile form controls must stay at least 16px to prevent iOS Safari focus zoom",
);
const oklchTokens = new Set([...inlineCss.matchAll(/--color-([a-z0-9-]+):oklch\(/gi)].map((match) => match[1]));
const hexFallbackTokens = new Set([...inlineCss.matchAll(/--color-([a-z0-9-]+):#[a-f0-9]{6}!important/gi)].map((match) => match[1]));
assert.deepEqual(
  [...oklchTokens].filter((name) => !hexFallbackTokens.has(name)),
  [],
  "every Tailwind OKLCH palette token used by the app needs a legacy HEX fallback",
);
assert.ok(!/\b\d+(?:\.\d+)?(?:dvh|svh|lvh)\b/i.test(inlineCss), "inline CSS must not contain unsupported dynamic viewport units");
assert.ok(!/aspect-ratio\s*:/i.test(inlineCss), "production CSS must not depend on aspect-ratio for fixed round assets");

console.log("OK  production build targets ES2020, Safari 14 and iOS 14");
console.log("OK  inlined CSS retains viewport/HEX fallbacks and avoids @layer, dynamic viewport units and aspect-ratio");
