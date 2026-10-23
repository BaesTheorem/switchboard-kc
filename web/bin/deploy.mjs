#!/usr/bin/env node
// Deploys the web app and its Worker with Wrangler, then makes sure the
// owner token is set and the server has a city key.
//   node bin/deploy.mjs            deploy
//   node bin/deploy.mjs --dry-run  bundle and check only
//
// Reads web/.env (gitignored): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
// ADMIN_TOKEN, and optionally TURNSTILE_SECRET. Missing values fall back to ../push/.env (CF_ACCOUNT_ID,
// CF_API_TOKEN), and a missing ADMIN_TOKEN is made and saved to web/.env.
// The first key comes from ../ios/Config/civic-config.json when it exists;
// otherwise the app reads one from the city's Android app on first use.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry-run");

function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const [k, ...v] = l.split("="); return [k.trim().replace(/^export /, ""), v.join("=").trim().replace(/^['"]|['"]$/g, "")]; }));
}

const envFile = join(web, ".env");
const mine = readEnv(envFile);
const push = readEnv(join(web, "../push/.env"));
const env = {
  ...process.env,
  CLOUDFLARE_ACCOUNT_ID: mine.CLOUDFLARE_ACCOUNT_ID || push.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: mine.CLOUDFLARE_API_TOKEN || push.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
};
if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in web/.env");
  process.exit(1);
}
let admin = mine.ADMIN_TOKEN;
if (!admin) {
  admin = randomBytes(24).toString("base64url");
  writeFileSync(envFile, `${existsSync(envFile) ? readFileSync(envFile, "utf8").trimEnd() + "\n" : ""}ADMIN_TOKEN=${admin}\n`, { mode: 0o600 });
  console.log("Made a new owner token and saved it to web/.env (ADMIN_TOKEN).");
}

// A new service-worker version makes installed apps fetch the new files.
const swPath = join(web, "public/sw.js");
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
writeFileSync(swPath, readFileSync(swPath, "utf8").replace(/const VERSION = "[^"]*";/, `const VERSION = "${dry ? "dev" : stamp}";`));

const wrangler = join(web, "node_modules/.bin/wrangler");
const run = (args, input) => execFileSync(wrangler, args, { cwd: web, env, input, stdio: input ? ["pipe", "inherit", "inherit"] : "inherit" });

if (dry) {
  run(["deploy", "--dry-run", "--outdir", "/tmp/switchboard-kc-dry"]);
  process.exit(0);
}
run(["deploy"]);
run(["secret", "put", "ADMIN_TOKEN"], admin);
// The robot check on filing, when web/.env has its secret (the site key is in wrangler.jsonc).
if (mine.TURNSTILE_SECRET) run(["secret", "put", "TURNSTILE_SECRET"], mine.TURNSTILE_SECRET);

const name = /"name":\s*"([^"]+)"/.exec(readFileSync(join(web, "wrangler.jsonc"), "utf8"))[1];
const sub = (await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`, {
  headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
})).json()).result?.subdomain;
const base = mine.URL || `https://${name}.${sub}.workers.dev`;
console.log(`Deployed: ${base}`);

// Seed the city key once, through the owner endpoint (it tests the key first).
const cfgPath = join(web, "../ios/Config/civic-config.json");
if (existsSync(cfgPath)) {
  const status = await fetch(`${base}/api/health`).then((r) => r.json()).catch(() => null);
  if (!status?.key) {
    const c = JSON.parse(readFileSync(cfgPath, "utf8"));
    const r = await fetch(`${base}/api/admin/key`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": admin },
      body: JSON.stringify({ key: c.key, city_id: c.city_id, app_version: c.app_version, source: "deploy" }),
    });
    console.log("City key:", r.status, await r.text());
  }
}
