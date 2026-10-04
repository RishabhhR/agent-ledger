# agent-ledger

## Stop being the copy-paste relay between coding agents

When Claude Code, Codex, or another coding agent works on the same repository, you should not have to carry task status, evidence, and handoffs between windows yourself.

**agent-ledger gives those sessions one inspectable place to claim work, record evidence, and be independently verified.** It is a small file-based protocol, not an orchestration service.

### Start in three commands

```bash
git clone https://github.com/RishabhhR/agent-ledger
cd agent-ledger
./install.sh /path/to/your/repo
```

It works across tools (Claude Code, Codex, Antigravity, Gemini CLI, Cursor, …) and inside one tool (an `architect`, a `builder` and a `reviewer`, all running as separate sessions of the same agent). There is no runtime or background service: it is a protocol, a shared markdown file, a few pointer files, and a small optional installer/validator. An optional read-only [dashboard](dashboard/) lets you watch it from a browser; it is a separate, opt-in piece, and the core stays free of any running service.

```
        Claude Code          Codex           Antigravity / Gemini / Cursor / …
        reads CLAUDE.md      reads AGENTS.md      reads its own instruction file
             └───────────────────┬───────────────────────┘
                                 ▼   every pointer says the same thing:
                      "read .ledger/PROTOCOL.md and follow it"
                                 │
               ┌─────────────────┴─────────────────┐
         .ledger/PROTOCOL.md                  .ledger/LEDGER.md
         the rules (one copy)        the state: decisions, tasks, done, checkpoints
                                 │
                               git   (history, review surface, sync between agents)
```

## Why

When you use more than one AI tool, each one is blind to the others. You paste outputs between windows, you can't tell which agent already did what, and "done" usually just means the agent said so. This kit gives them one shared place to coordinate, and three rules that make it trustworthy:

1. **Claim before you code.** An agent writes down what it will build and which files it touches, and commits that first, so the others don't duplicate it.
2. **Close with evidence.** "Done" requires the exact check that was run and what it printed, plus what was *not* verified.
3. **The author is not the verifier.** Another agent (or role) re-runs the check and records `PASS:` or files a `DEFECT` task. Nobody quietly rewrites someone else's code.

## Finish the setup in five minutes

The script copies `.ledger/` into your repo and adds a short pointer to `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` (creating them, or appending without touching what is there). It never overwrites existing project files and repairs malformed pointer markers if an earlier install was interrupted. Then:

1. Commit the new files.
2. Add a first task to `.ledger/LEDGER.md` (the format is at the top of the file).
3. Open your agent(s) in the repo and say something plain, such as *"pick up any work waiting for you."* They read the pointer, then the protocol, then the ledger.

Before or after an agent run, validate the coordination files:

```bash
./.ledger/validate.sh /path/to/your/repo
```

For an existing installation, `./agent-ledger/install.sh --check /path/to/your/repo` validates without changing anything. `--diff` shows template drift; `--update` is an explicitly named, safe re-run of the install/repair action for scripts and automation, without overwriting existing project files.

A tool that has no instruction file should need only one line at the start of the session (untested): *"Read `.ledger/PROTOCOL.md` and follow it. Your agent name is X."*

**Several roles in one tool:** start separate sessions and hand each a role card, for example `claude --model opus "Read .ledger/roles/architect.md and start."` See [docs/one-tool-many-roles.md](docs/one-tool-many-roles.md).

## What is in the box

| Path | What it is |
|---|---|
| [`template/.ledger/PROTOCOL.md`](template/.ledger/PROTOCOL.md) | The rules every agent follows. **Read this first**; it is the whole protocol. |
| [`template/.ledger/LEDGER.md`](template/.ledger/LEDGER.md) | The empty ledger and its entry format. |
| [`template/.ledger/roles/`](template/.ledger/roles) | Role cards: architect, builder, reviewer. |
| [`template/pointers/`](template/pointers) | The short snippets added to each tool's instruction file. |
| [`install.sh`](install.sh) | Copies the above into your repo, idempotently. |
| [`template/.ledger/validate.sh`](template/.ledger/validate.sh) | Checks ledger structure, duplicate IDs, pointer markers and conflict markers. |
| [`tests/test.sh`](tests/test.sh) | Regression tests for install, update, repair and validation behavior. |
| [`dashboard/`](dashboard/README.md) | Optional read-only web dashboard: a static page plus a small local server on your machine. No backend, no accounts. |
| [`docs/architecture.md`](docs/architecture.md) | Why it is designed this way, and where it breaks. |
| [`docs/tools.md`](docs/tools.md) | Which file each tool reads, and what has and hasn't been verified. |
| [`docs/one-tool-many-roles.md`](docs/one-tool-many-roles.md) | Running several agents inside a single tool. |
| [`docs/automation.md`](docs/automation.md) | Going from manual relay to an unattended loop. |
| [`examples/real-run-ledger.md`](examples/real-run-ledger.md) | A real ledger from a Codex → Claude run, unedited. |

The hosted static dashboard is available at [agent-ledger-dashboard-ecru.vercel.app](https://agent-ledger-dashboard-ecru.vercel.app/). It is only the page; your ledger still stays on your machine and is read by the local server you start.

## Verified tool matrix

This table is intentionally conservative and matches [docs/tools.md](docs/tools.md):

| Tool | File it reads | Verified in this kit |
|---|---|---|
| Claude Code | `CLAUDE.md` | **Yes.** A session given only a role card followed the protocol and recorded its review. |
| Codex CLI | `AGENTS.md` | **Yes.** A headless `codex exec` run, told only to "pick up any work waiting for you", read `AGENTS.md`, then `.ledger/PROTOCOL.md`, and closed the task with evidence. |
| Antigravity | `AGENTS.md` | Reported working in the author's own setup; **not re-verified in this kit's run.** |
| Gemini CLI | `GEMINI.md` | **No.** The kit ships a `GEMINI.md` pointer based on the commonly documented convention. |
| Cursor, GitHub Copilot, Windsurf, Aider, others | Their own rules files, many also read `AGENTS.md` | **No.** Add the pointer wherever the tool loads project instructions. |
| Anything else | n/a | Paste one line at session start: *"Read `.ledger/PROTOCOL.md` and follow it. Your agent name is X."* Should work anywhere an agent can read files; not tested. |

## What has actually been run

One real cross-tool run, on a toy task, in a scratch repo: a human seeded a task for **Codex**, which read `AGENTS.md` and `.ledger/PROTOCOL.md` on its own, did the work and closed it with evidence; then **Claude**, given only a reviewer role card, re-ran the tests and recorded `PASS:` without touching the code. The resulting ledger is in [`examples/`](examples/real-run-ledger.md). The [short terminal demo](demo/agent-ledger-demo.cast) shows the same kind of claim → work → review handoff from a fresh run. The installer and validator are covered by shell regression tests on every GitHub push and pull request. The installer was tested on a fresh repo, on a repo with an existing `CLAUDE.md`, on a second run, with a project-owned ledger, and with an interrupted pointer block.

Not verified here: Antigravity, Gemini CLI, Cursor, Copilot or any other tool beyond Claude Code and Codex, large projects, or more than two agents at once. See [docs/tools.md](docs/tools.md).

## Limits you should know about

- **It is advice, not enforcement.** Agents follow the pointer because their tool loads the file, and they usually follow the protocol, but nothing forces them. The validator catches common structural mistakes; it cannot prove an agent followed the protocol or that its evidence is truthful.
- **One shared file can lose a write.** Two agents saving at the same instant can drop an entry. The protocol says one writer at a time and re-read after writing. See [docs/architecture.md](docs/architecture.md) for the scale-up option.
- **Validation is local and opt-in.** Run `.ledger/validate.sh` before review or automate it in your own repository's CI. This kit's own CI tests the installer, but it cannot monitor another repository.
- **The installer is Bash-based.** macOS, Linux, WSL and Git Bash are the supported paths. Windows users without a Unix shell should copy the template manually or use a compatible shell; a native PowerShell installer is not included yet.
- **Sandboxed tools may not be able to commit.** The Codex run above couldn't write `.git`. The protocol says to report that instead of working around it.
- **The ledger is trusted input.** Anyone who can write to it can steer your agents. Don't point this at a repo that takes untrusted contributions without reviewing ledger changes.

## License

MIT, see [LICENSE](LICENSE).
