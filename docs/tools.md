# Tools: where each one reads its instructions

The kit works by putting a short pointer in whichever file your tool loads at session start. **Instruction-file conventions change; confirm against your tool's current documentation.** The last column says what this kit's author has verified, not what the vendor documents.

| Tool | File it reads | Verified in this kit |
|---|---|---|
| Claude Code | `CLAUDE.md` | **Yes.** A session given only a role card followed the protocol and recorded its review. |
| Codex CLI | `AGENTS.md` | **Yes.** A headless `codex exec` run, told only to "pick up any work waiting for you", read `AGENTS.md`, then `.ledger/PROTOCOL.md`, and closed the task with evidence. |
| Antigravity | `AGENTS.md` | Reported working in the author's own setup; **not re-verified in this kit's run.** |
| Gemini CLI | `GEMINI.md` | **No.** The kit ships a `GEMINI.md` pointer based on the commonly documented convention. |
| Cursor, GitHub Copilot, Windsurf, Aider, others | Their own rules files, many also read `AGENTS.md` | **No.** Add the pointer wherever the tool loads project instructions. |
| Anything else | n/a | Paste one line at session start: *"Read `.ledger/PROTOCOL.md` and follow it. Your agent name is X."* Should work anywhere an agent can read files; not tested. |

## Notes per tool

**Claude Code.** `claude --model <model> "<opening message>"` starts an interactive session with a model and a first message, which is how you hand it a role (see [one-tool-many-roles.md](one-tool-many-roles.md)). Headless: `claude -p`; give it an explicit `--allowedTools` list because there is nobody to answer permission prompts.

**Codex.** Headless runs use `codex exec`. In its `workspace-write` sandbox it could edit files and run tests but **could not write `.git`**, so it couldn't commit. That is why the protocol has a "not committed: sandbox" path. A human, or a loop that commits on the agents' behalf, does the commit.

**Adding a tool.** Create or extend its instruction file with the pointer block from [`template/pointers/AGENTS.md`](../template/pointers/AGENTS.md) (the generic one: it asks the agent to use its own name). Then run it on one small task and read the ledger afterwards. If it didn't read the protocol, the pointer isn't loading, and you'll know within one session. Run `.ledger/validate.sh .` after adding or editing pointers so a partial or duplicated block is visible.

**Installation support.** `install.sh` requires Bash and is intended for macOS, Linux, WSL and Git Bash. It does not overwrite existing project files. Use `--check` for validation, `--diff` to inspect template drift, and `--update` to add missing kit files or repair pointer blocks; existing customized files are deliberately left for human review.
