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

console.log("OK  production build targets ES2020, Safari 14 and iOS 14");
console.log("OK  inlined production CSS contains no unsupported @layer rules");
