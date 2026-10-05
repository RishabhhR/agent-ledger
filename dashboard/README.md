# Dashboard (optional, read-only)

A web page that shows what your agents are doing, what they finished, and what needs you, read straight from `.ledger/LEDGER.md`. It is **optional**: the ledger works without it.

```
 browser page  ──►  http://127.0.0.1:4780  ──►  .ledger/LEDGER.md
 (static files)     small local server           (in your repo)
                    read-only, this machine only
```

There is **no backend and no account**. The page only ever talks to a server running on *your* computer, so your ledger (which can describe private code) is never sent to anyone. The page can be hosted as plain static files, or served by the local server itself.

## Run it locally (recommended)

You need Node.js and a repo that has the ledger (`install.sh`). It uses only Node's built-in modules and was tested on Node 20; CI runs on Ubuntu with Node 18, 20 and 22.

```bash
node dashboard/server/ledger-server.mjs --repo /path/to/your/repo
```

It prints a **pairing code** and a local address. Open the address, paste the code, done. The code changes every time you start the server and only works on your machine.

```
 repo:           my-project
 open here:      http://127.0.0.1:4780
 pairing code:   ABCD-EFGH-JKMN-PQRS
```

Options: `--port N` (default 4780) and `--allow-origin <origin>` (below).

### Experimental: hosted copy of the page

Deploy the folder `dashboard/web` as a static site (on Vercel, set the project's root directory to `dashboard/web` with no build step; `vercel.json` there sets the security headers). Then tell your server which page may read it:

```bash
node dashboard/server/ledger-server.mjs --repo . --allow-origin https://your-site.example
```

A production static copy of the page is available at [agent-ledger-dashboard-ecru.vercel.app](https://agent-ledger-dashboard-ecru.vercel.app/). The page itself has no ledger access. A hosted page may be blocked or prompt for permission when it tries to reach localhost, depending on the browser; this path has not been verified in real Chrome, Safari, or Firefox. If it cannot connect, use the locally served page above.

The hosted page shows the command with its own address filled in. It still fetches from `http://127.0.0.1:<port>` in your browser, subject to the browser's localhost policy.

**Trade-off:** with a hosted page, whoever controls that hosting controls the JavaScript that reads your ledger, and the browser may refuse the localhost connection. If that matters to you, use the page the server serves itself, or host your own.

## What the page shows

- **What to do next**: plain-language prompts computed from the ledger (decisions waiting, defects, finished work nobody reviewed, which agent has open tasks).
- **Decisions waiting**, **Open work** grouped by agent, **Finished** with a "reviewed / not reviewed / defect" badge, and each agent's **checkpoint** compared with the repo's latest commit.
- It updates by itself every few seconds, keeps showing the last data if the connection drops, and asks for a new code if the server was restarted.

## Why it is safe to run

Any website you visit can send requests to `localhost`, so the server defends itself. Every request must pass, in order:

| Gate | What it stops |
|---|---|
| **Loopback only.** The server listens on `127.0.0.1`, never your network. | Other devices on your network. |
| **Host check.** Only `127.0.0.1:<port>` and `localhost:<port>` are accepted. | DNS-rebinding tricks, where a hostile site points its own name at your machine. |
| **Origin check.** A page is served only if you started the server with its exact origin (or it is the server's own page). Never `*`. | A hostile page in another tab reading your ledger. |
| **Pairing code.** 80 random bits, compared in constant time, printed only in your terminal. 10 wrong tries per minute locks it for a minute; requests from pages you didn't allow can't trigger that lockout. | Guessing, and a hostile page locking you out. |
| **Read-only.** Only `GET`, `HEAD` and `OPTIONS` work; everything else is `405`. There is no endpoint that writes a file or runs a command. | Turning the dashboard into a way to change your repo or run code. |

In the page itself, ledger text is untrusted (agents write it), so it is only ever inserted as plain text, never as HTML. A strict Content-Security-Policy also forbids inline scripts and any connection except to your own machine.

## What has and hasn't been verified

Verified (`node --test dashboard/tests/*.test.mjs`, 27 tests, plus a real browser):

- Each gate above has a test, and each was **mutation-checked**: removing it makes a test fail (host check, origin check, pairing check, read-only, loopback binding, exact-origin CORS, lockout, path traversal).
- In a Chromium browser: pairing, live updates, a connection drop and recovery, a server restart (asks for the new code), a mobile-width layout, and a ledger full of hostile entries (`<script>`, `<img onerror>`, `<svg onload>`), none of which ran or created elements. A page on a non-allowed origin got nothing, even with the correct code. The production CSP blocked an inline script and requests to other sites.

**Not verified:**

- **Safari and Firefox.** Browsers differ on whether a page can call `localhost`. If the hosted page can't connect, open the page the server serves itself; the page tells you this when it fails.
- **A real public HTTPS page calling localhost.** This was tried on 2026-10-05 against the live hosted page in one embedded Chromium browser, and the browser blocked it (`net::ERR_BLOCKED_BY_CLIENT`): a logging listener on `127.0.0.1` received no request at all, while the server answered correctly when called directly. That says nothing about regular Chrome, Safari or Firefox, which may prompt for permission or allow it; see [issue #7](https://github.com/RishabhhR/agent-ledger/issues/7). Use the locally served page if the hosted one cannot connect.
- **Windows.**

## API (what the page uses)

- `GET /health` → `{ ok, app, version, pairing }`. No code needed; reveals nothing about your repo.
- `GET /state` with `Authorization: Bearer <code>` → the parsed ledger: `decisions`, `tasks`, `done`, `checkpoints`, `attention`, `warnings`, `counts`, plus `repo` (folder name only, never a path) and `head`. Supports `ETag` / `If-None-Match`.

## Limits and what comes next

One repo per server. It polls every few seconds rather than pushing. The pairing code lives in `sessionStorage`, so it is forgotten when the tab closes.

**Input from the page** (answering a decision, adding a task) is not built. If it is, it will only be able to write ledger entries, which agents then pick up through the protocol like any other. It must never become an endpoint that runs commands.
