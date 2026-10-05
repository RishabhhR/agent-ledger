#!/usr/bin/env node
// A tiny read-only server that lets a dashboard page show this repo's ledger.
//
//   node ledger-server.mjs [--repo PATH] [--port 4780] [--allow-origin https://your-dashboard.example]
//
// It serves .ledger/LEDGER.md (parsed) on 127.0.0.1 only. Nothing leaves your
// machine unless a page you allowed asks for it, and then only with the
// pairing code printed in this terminal. It never writes and never runs
// commands. No dependencies.
//
// Why so strict: any website you visit can send requests to localhost. So
// every request must pass, in order: the Host check (blocks DNS rebinding),
// the Origin check (only pages you allowed), and the pairing code.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseLedger } from "./parse-ledger.mjs";

const VERSION = "0.1.0";
const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));
const MAX_LEDGER_BYTES = 5_000_000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 60_000;

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/sample-state.js": ["sample-state.js", "text/javascript; charset=utf-8"],
};

// Applies to the pages this server serves itself. A hosted copy of the page
// must send an equivalent policy (see ../web/vercel.json).
const PAGE_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U

// 16 symbols x 5 bits = 80 bits. 256 is a multiple of 32, so `& 31` is unbiased.
export function generateCode() {
  const bytes = randomBytes(16);
  const symbols = Array.from(bytes, (b) => CODE_ALPHABET[b & 31]);
  return [0, 4, 8, 12].map((i) => symbols.slice(i, i + 4).join("")).join("-");
}

// Forgiving about how people type it: case, dashes, spaces and the Crockford
// look-alikes (O -> 0, I/L -> 1).
export function normaliseCode(value) {
  return String(value ?? "").toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

function codesMatch(given, expected) {
  const a = createHash("sha256").update(normaliseCode(given)).digest();
  const b = createHash("sha256").update(normaliseCode(expected)).digest();
  return timingSafeEqual(a, b);
}

export function parseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`"${value}" is not a valid origin. Use something like https://your-dashboard.example (no path).`);
  }
  if (!/^https?:$/.test(url.protocol) || url.origin === "null" || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error(`"${value}" is not a valid origin. Use scheme + host (+ port) only, for example https://your-dashboard.example`);
  }
  return url.origin;
}

function gitHead(repo) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf-8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

export function startServer({ repo, port = 4780, allowOrigins = [], code = generateCode(), log = () => {} }) {
  const repoRoot = path.resolve(repo);
  const ledgerPath = path.join(repoRoot, ".ledger", "LEDGER.md");
  if (!existsSync(ledgerPath)) {
    throw new Error(`No ledger at ${ledgerPath}. Run install.sh on this repo first, or pass --repo <path>.`);
  }
  const extraOrigins = allowOrigins.map(parseOrigin);
  const failures = [];
  let headCache = { at: 0, value: null };

  const head = () => {
    if (Date.now() - headCache.at > 2000) headCache = { at: Date.now(), value: gitHead(repoRoot) };
    return headCache.value;
  };

  let boundPort = port;
  const hostAllowed = (host) => !!host && [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`].includes(host.toLowerCase());
  const originAllowed = (origin) => [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`, ...extraOrigins].includes(origin);

  const lockedOut = () => {
    const cutoff = Date.now() - FAILURE_WINDOW_MS;
    while (failures.length && failures[0] < cutoff) failures.shift();
    return failures.length >= MAX_FAILURES;
  };

  const server = createServer((req, res) => {
    const baseHeaders = {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    };
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { ...baseHeaders, ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    const json = (status, value, headers = {}) =>
      send(status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", ...headers });

    // 1. Host: a rebinding attack reaches us under the attacker's hostname.
    if (!hostAllowed(req.headers.host)) return json(403, { error: "bad_host" });

    // 2. Origin: browsers always send it on cross-origin requests.
    const origin = req.headers.origin;
    const cors = {};
    if (origin !== undefined) {
      if (!originAllowed(origin)) return json(403, { error: "origin_not_allowed" });
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Vary"] = "Origin";
      cors["Access-Control-Allow-Headers"] = "Authorization, If-None-Match";
      cors["Access-Control-Expose-Headers"] = "ETag"; // so the page can read it for conditional polling
      cors["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
      cors["Access-Control-Max-Age"] = "600";
      // Chrome's Private Network Access preflight for public pages calling localhost.
      if (req.headers["access-control-request-private-network"] === "true") cors["Access-Control-Allow-Private-Network"] = "true";
    }

    if (req.method === "OPTIONS") return send(204, undefined, cors);
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(405, { error: "read_only" }, { ...cors, Allow: "GET, HEAD, OPTIONS" });
    }

    const pathname = new URL(req.url ?? "/", "http://x").pathname;

    // The page itself is public code: no pairing needed to load it.
    if (STATIC[pathname]) {
      const [file, type] = STATIC[pathname];
      try {
        return send(200, readFileSync(path.join(WEB_DIR, file)), { "Content-Type": type, "Content-Security-Policy": PAGE_CSP, ...cors });
      } catch {
        return json(404, { error: "ui_not_found" }, cors);
      }
    }

    if (pathname === "/health") {
      return json(200, { ok: true, app: "agent-ledger-dashboard", version: VERSION, pairing: "required" }, cors);
    }

    if (pathname === "/state") {
      // 3. Pairing code.
      if (lockedOut()) return json(429, { error: "too_many_attempts" }, { ...cors, "Retry-After": "60" });
      const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
      if (!match || !codesMatch(match[1], code)) {
        failures.push(Date.now());
        return json(401, { error: "pairing_code_required" }, cors);
      }

      let stat;
      try {
        stat = statSync(ledgerPath);
      } catch {
        return json(404, { error: "ledger_not_found", hint: "Is .ledger/LEDGER.md still in this repo?" }, cors);
      }
      if (stat.size > MAX_LEDGER_BYTES) return json(413, { error: "ledger_too_large" }, cors);

      const currentHead = head();
      const etag = `W/"${stat.mtimeMs}-${stat.size}-${currentHead ?? "nohead"}"`;
      if (req.headers["if-none-match"] === etag) return send(304, undefined, { ETag: etag, ...cors });

      const parsed = parseLedger(readFileSync(ledgerPath, "utf-8"), { head: currentHead });
      return json(200, {
        repo: path.basename(repoRoot),
        head: currentHead,
        ledgerUpdatedAt: stat.mtime.toISOString(),
        generatedAt: new Date().toISOString(),
        readOnly: true,
        ...parsed,
      }, { ETag: etag, ...cors });
    }

    return json(404, { error: "not_found" }, cors);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // 127.0.0.1 only: never reachable from the network.
    server.listen(port, "127.0.0.1", () => {
      boundPort = server.address().port;
      server.off("error", reject);
      log(`listening on 127.0.0.1:${boundPort}`);
      resolve({
        port: boundPort,
        code,
        repoName: path.basename(repoRoot),
        origins: [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`, ...extraOrigins],
        server,
        close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }),
      });
    });
  });
}

function parseArgs(argv) {
  const opts = { repo: process.cwd(), port: 4780, allowOrigins: [] };
  if (process.env.LEDGER_ALLOW_ORIGIN) opts.allowOrigins.push(...process.env.LEDGER_ALLOW_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean));
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value.`);
      return argv[++i];
    };
    if (arg === "--repo") opts.repo = next();
    else if (arg === "--port") {
      opts.port = Number(next());
      if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error("--port must be a number from 0 to 65535.");
    } else if (arg === "--allow-origin") opts.allowOrigins.push(...next().split(",").map((s) => s.trim()).filter(Boolean));
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`Unknown option ${arg}. Try --help.`);
  }
  return opts;
}

const HELP = `agent-ledger dashboard server (read-only)

  node ledger-server.mjs [--repo PATH] [--port 4780] [--allow-origin ORIGIN]

  --repo PATH           repo whose .ledger/LEDGER.md to show (default: current directory)
  --port N              port on 127.0.0.1 (default 4780)
  --allow-origin ORIGIN a hosted dashboard page that may read this ledger, e.g.
                        https://your-dashboard.example (repeatable, or comma-separated;
                        also LEDGER_ALLOW_ORIGIN). The page this server serves itself is always allowed.
`;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      process.stdout.write(HELP);
    } else {
      const s = await startServer(opts);
      const line = "-".repeat(60);
      console.log(`\n${line}\n agent-ledger dashboard server  (read-only, this machine only)\n${line}`);
      console.log(` repo:           ${s.repoName}`);
      console.log(` open here:      http://127.0.0.1:${s.port}`);
      console.log(` pairing code:   ${s.code}`);
      console.log(`                 (paste it into the dashboard; it changes every time you start this)`);
      console.log(` pages allowed:  ${s.origins.join(", ")}`);
      console.log(`${line}\n Ctrl-C to stop.\n`);
      const stop = () => s.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    }
  } catch (err) {
    console.error(err.code === "EADDRINUSE" ? "That port is already in use. Pick another with --port, or stop the other server." : `Error: ${err.message}`);
    process.exit(1);
  }
}
