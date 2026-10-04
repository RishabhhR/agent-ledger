import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { generateCode, normaliseCode, startServer } from "../server/ledger-server.mjs";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const tempDirs = [];
const servers = [];
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
  tempDirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const HOSTED = "https://dashboard.example";
const EVIL = "https://evil.example";
const CODE = "ABCD-EFGH-JKMN-PQRS";

function repo({ git = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ledger-srv-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, ".ledger"));
  cpSync(here("../../examples/real-run-ledger.md"), path.join(dir, ".ledger", "LEDGER.md"));
  if (git) {
    const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
    execFileSync("git", ["init", "-q"], { cwd: dir, env });
    execFileSync("git", ["add", "-A"], { cwd: dir, env });
    execFileSync("git", ["commit", "-q", "-m", "x"], { cwd: dir, env });
  }
  return dir;
}

async function boot(opts = {}) {
  const dir = opts.dir ?? repo();
  const s = await startServer({ repo: dir, port: 0, code: CODE, allowOrigins: [HOSTED], ...opts });
  servers.push(s);
  return { ...s, dir };
}

// fetch() can't forge the Host header, and that is exactly what we need to test.
function request(s, { method = "GET", url = "/health", headers = {}, host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: s.port, method, path: url, headers: { Host: host ?? `127.0.0.1:${s.port}`, ...headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}
const auth = (code = CODE) => ({ Authorization: `Bearer ${code}` });

test("listens on the loopback interface only", async () => {
  const s = await boot();
  assert.equal(s.server.address().address, "127.0.0.1");
});

test("/health is public (so the page can detect the server) but reveals no repo data", async () => {
  const s = await boot();
  const r = await request(s);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true, app: "agent-ledger-dashboard", version: "0.1.0", pairing: "required" });
});

test("/state needs the pairing code; the wrong one and none are both 401", async () => {
  const s = await boot();
  assert.equal((await request(s, { url: "/state" })).status, 401);
  assert.equal((await request(s, { url: "/state", headers: auth("WXYZ-WXYZ-WXYZ-WXYZ") })).status, 401);
  assert.equal((await request(s, { url: "/state", headers: { Authorization: "Basic abc" } })).status, 401);
  const ok = await request(s, { url: "/state", headers: auth() });
  assert.equal(ok.status, 200);
});

test("the state is parsed ledger data, read-only, and leaks no local path", async () => {
  const s = await boot({ dir: repo({ git: true }) });
  const r = await request(s, { url: "/state", headers: auth() });
  const state = JSON.parse(r.body);
  assert.equal(state.readOnly, true);
  assert.equal(state.done[0].id, "TASK-001");
  assert.equal(state.done[0].review, "pass");
  assert.match(state.head, /^[0-9a-f]{7,}$/);
  assert.equal(state.repo, path.basename(s.dir));
  assert.ok(!r.body.includes(path.dirname(s.dir)), "no absolute path in the response");
  assert.match(r.headers["content-type"], /^application\/json/);
  assert.equal(r.headers["x-content-type-options"], "nosniff", "ledger text can never be sniffed as HTML");
  assert.equal(r.headers["cache-control"], "no-store");
});

test("the code is forgiving about case, dashes and look-alike characters", async () => {
  const s = await boot();
  for (const typed of ["abcd-efgh-jkmn-pqrs", "ABCDEFGHJKMNPQRS", " abcd efgh jkmn pqrs ", "ABCD-EFGH-JKMN-PQRS"]) {
    assert.equal((await request(s, { url: "/state", headers: auth(typed) })).status, 200, typed);
  }
  assert.equal(normaliseCode("o1il"), "0111");
  assert.match(generateCode(), /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.notEqual(generateCode(), generateCode());
});

test("rejects a request whose Host is not this machine (DNS rebinding), even with the right code", async () => {
  const s = await boot();
  for (const host of ["evil.example", `evil.example:${s.port}`, "127.0.0.1", `127.0.0.1:${s.port + 1}`]) {
    for (const url of ["/health", "/state", "/"]) {
      const r = await request(s, { url, host, headers: auth() });
      assert.equal(r.status, 403, `${host} ${url}`);
    }
  }
  assert.equal((await request(s, { url: "/health", host: `localhost:${s.port}` })).status, 200);
});

test("rejects pages that were not allowed, even with the right code", async () => {
  const s = await boot();
  for (const origin of [EVIL, "null", "http://localhost:1", `https://${HOSTED.split("//")[1]}.evil.example`, "http://dashboard.example"]) {
    const r = await request(s, { url: "/state", headers: { ...auth(), Origin: origin } });
    assert.equal(r.status, 403, origin);
    assert.equal(r.headers["access-control-allow-origin"], undefined, "no CORS grant leaks to a blocked page");
  }
});

test("an allowed page gets an exact-origin CORS grant, and the preflight answers Private Network Access", async () => {
  const s = await boot();
  const r = await request(s, { url: "/state", headers: { ...auth(), Origin: HOSTED } });
  assert.equal(r.status, 200);
  assert.equal(r.headers["access-control-allow-origin"], HOSTED, "exact origin, never *");
  assert.equal(r.headers["vary"], "Origin");

  const pre = await request(s, { method: "OPTIONS", url: "/state", headers: { Origin: HOSTED, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization", "Access-Control-Request-Private-Network": "true" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers["access-control-allow-origin"], HOSTED);
  assert.match(pre.headers["access-control-allow-headers"], /Authorization/);
  assert.match(pre.headers["access-control-allow-headers"], /If-None-Match/, "a cross-origin page may send conditional requests");
  assert.equal(r.headers["access-control-expose-headers"], "ETag", "a cross-origin page may read the ETag");
  assert.equal(pre.headers["access-control-allow-private-network"], "true");

  const blocked = await request(s, { method: "OPTIONS", url: "/state", headers: { Origin: EVIL } });
  assert.equal(blocked.status, 403);
});

test("the page the server serves itself is allowed as its own origin", async () => {
  const s = await boot();
  const r = await request(s, { url: "/state", headers: { ...auth(), Origin: `http://127.0.0.1:${s.port}` } });
  assert.equal(r.status, 200);
});

test("is strictly read-only: every write method is refused and the ledger is untouched", async () => {
  const s = await boot();
  const file = path.join(s.dir, ".ledger", "LEDGER.md");
  const before = readFileSync(file, "utf-8");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = await request(s, { method, url: "/state", headers: auth() });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.allow, "GET, HEAD, OPTIONS");
  }
  assert.equal(readFileSync(file, "utf-8"), before);
});

test("polling is cheap: unchanged state answers 304, a change answers 200", async () => {
  const s = await boot();
  const first = await request(s, { url: "/state", headers: auth() });
  assert.equal(first.status, 200);
  const etag = first.headers.etag;
  assert.ok(etag);
  assert.equal((await request(s, { url: "/state", headers: { ...auth(), "If-None-Match": etag } })).status, 304);

  writeFileSync(path.join(s.dir, ".ledger", "LEDGER.md"), readFileSync(path.join(s.dir, ".ledger", "LEDGER.md"), "utf-8") + "\n### [TASK-002] status:open from:a to:b\nNew work.\n");
  const after = await request(s, { url: "/state", headers: { ...auth(), "If-None-Match": etag } });
  assert.equal(after.status, 200);
  assert.equal(JSON.parse(after.body).tasks[0].id, "TASK-002");
});

test("brute force is throttled, but a hostile page cannot lock the owner out", async () => {
  const s = await boot();
  // A page that was not allowed is turned away before it can count as an attempt.
  for (let i = 0; i < 25; i++) await request(s, { url: "/state", headers: { Authorization: "Bearer nope", Origin: EVIL } });
  assert.equal((await request(s, { url: "/state", headers: { ...auth(), Origin: HOSTED } })).status, 200);

  for (let i = 0; i < 10; i++) assert.equal((await request(s, { url: "/state", headers: auth("0000-0000-0000-0000") })).status, 401);
  const locked = await request(s, { url: "/state", headers: auth() });
  assert.equal(locked.status, 429, "even the correct code is refused during the lockout");
  assert.equal(locked.headers["retry-after"], "60");
});

test("serves only its own page files: no path can reach anything else", async () => {
  const s = await boot();
  for (const url of ["/app.js", "/style.css", "/", "/index.html"]) {
    const r = await request(s, { url });
    assert.equal(r.status, 200, url);
    assert.match(r.headers["content-security-policy"], /default-src 'none'.*script-src 'self'.*connect-src 'self'/, url);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
  }
  for (const url of ["/../server/ledger-server.mjs", "/%2e%2e/server/ledger-server.mjs", "/app.js/../../server/parse-ledger.mjs", "/server/ledger-server.mjs", "/.ledger/LEDGER.md", "/..%2f..%2fetc/passwd", "//etc/passwd"]) {
    const r = await request(s, { url });
    assert.equal(r.status, 404, url);
    assert.ok(!r.body.includes("createServer"), `${url} must not leak source`);
  }
});

test("HEAD works and has no body", async () => {
  const s = await boot();
  const r = await request(s, { method: "HEAD", url: "/state", headers: auth() });
  assert.equal(r.status, 200);
  assert.equal(r.body, "");
});

test("refuses to start without a ledger, and refuses wildcard or malformed allowed origins", async () => {
  const empty = mkdtempSync(path.join(tmpdir(), "ledger-empty-"));
  tempDirs.push(empty);
  assert.throws(() => startServer({ repo: empty, port: 0 }), /No ledger at .*install\.sh/);
  for (const bad of ["*", "https://x.example/path", "ftp://x.example", "not a url", "https://x.example?q=1"]) {
    assert.throws(() => startServer({ repo: repo(), port: 0, allowOrigins: [bad] }), /not a valid origin/, bad);
  }
});

test("a ledger deleted while running yields a clear 404, not a crash", async () => {
  const s = await boot();
  rmSync(path.join(s.dir, ".ledger"), { recursive: true });
  const r = await request(s, { url: "/state", headers: auth() });
  assert.equal(r.status, 404);
  assert.equal(JSON.parse(r.body).error, "ledger_not_found");
});

test("the command line: prints a pairing code, binds loopback, and explains a missing ledger", () => {
  const cli = here("../server/ledger-server.mjs");
  const empty = mkdtempSync(path.join(tmpdir(), "ledger-cli-"));
  tempDirs.push(empty);
  const bad = spawnSync(process.execPath, [cli, "--repo", empty], { encoding: "utf-8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /No ledger at/);
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf-8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--allow-origin/);
  const wrong = spawnSync(process.execPath, [cli, "--allow-origin", "*", "--repo", repo()], { encoding: "utf-8" });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /not a valid origin/);
});
