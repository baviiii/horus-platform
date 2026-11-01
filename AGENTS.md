# AGENTS.md — horus-platform

Instructions for any AI coding agent (Claude Code, Codex, Cursor…) working in this
repo. Read this before changing anything.

Horus is the AI platform behind Faircopy and the interview coach: model calls
(`/api/infer`), the knowledge index (corpus + vector search) and the knowledge
graph, plus the AWS infrastructure in `infrastructure/tofu` (including the
interview coach's Lambda settings). Other products depend on its responses, so a
change here can break them without touching their code.

## Before every push — no exceptions

1. **Run the checks, all green:**
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm format:check
   pnpm build
   ```
   Changed `infrastructure/tofu`? `tofu plan` and read the whole plan before any
   `apply`; never apply without the owner's yes.
2. **Code review the diff** for correctness bugs (in Claude Code: `/code-review`).
3. **Security review the diff** (in Claude Code: `/security-review`): API key
   scopes and tenant isolation, IAM (least privilege), secrets in tfvars or
   state, what each route returns to whom.
4. **Check who depends on what you changed.** Anything in `/api/infer`, the
   model settings, `packages/core/src/inference` or the knowledge APIs reaches
   the interview coach and Faircopy's Edge Functions. Say in the review what
   they'll see differently.
5. **Show the owner the diff and wait for an explicit yes.** Plain-language
   explanation of each change, plus the check and review results. Approval is
   per push: an earlier "go ahead" doesn't cover the next one, and approving a
   summary isn't the same as seeing the code.

Never `--no-verify`, never force-push, never commit secrets — `terraform.tfvars`
and state hold real values; keep them out of commits and out of chat.

## Other agents may be working here

More than one agent session can share this folder. Before anything else:
`git status` and `git log --oneline -3` — if the branch or files aren't what you
expect, someone else is working. Don't switch their branch, don't revert or commit
changes you didn't make, and never `git add -A` blindly: add your own files by
name. To work on another branch without disturbing them, use a temporary
`git worktree` outside the repo.

## Things that have broken before

- **Changing a model tier changes every caller's output.** Moving the fast tier
  to Claude Haiku 4.5, together with forcing schema-less answers into an open
  JSON object (`packages/core/src/inference/ai-sdk-json.ts`), made Haiku return
  only the first section of the coach's answers — interviews started with no
  questions. Before changing a model or how output is forced, run the coach's
  tools against it (its `npm run score-check` and a start/answer/finish round).
- **The AWS path ignores `temperature`** from callers; the coach sets it low for
  consistent scoring.
- **`/api/infer`'s body is a contract.** The coach (through Faircopy's `infer`)
  sends `schema` for its interview calls, and Faircopy's `parse-resume` sends
  résumé pages as image parts. Changing what the route accepts breaks them.
