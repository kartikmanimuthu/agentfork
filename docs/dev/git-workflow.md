# Git Workflow — Committing & Pushing (GitHub + Bitbucket)

This repo lives in **two remotes** that must stay in sync. `origin` is configured to **push to both** at once, so a single `git push` lands on GitHub *and* Bitbucket.

> Audience: humans and AI agents. Follow the steps verbatim. Do not push, force-push, or rewrite history unless the user explicitly asks.

## Remote layout

| Remote | Fetch | Push | Use for |
| --- | --- | --- | --- |
| `origin` | GitHub | **GitHub + Bitbucket** | Default. A bare `git push` fans out to both. |
| `github` | GitHub | GitHub only | Push to GitHub alone. |
| `bitbucket` | Bitbucket | Bitbucket only | Push to / fetch from Bitbucket alone. |

GitHub: `https://github.com/kartikmanimuthu/chatbot.git`Bitbucket: `git@bitbucket.org:acme/chatflow.git`

Verify with `git remote -v`. `origin` must list **two** push lines (GitHub then Bitbucket). If it doesn't, re-create the fan-out:

```bash
git remote set-url --add --push origin https://github.com/kartikmanimuthu/chatbot.git
git remote set-url --add --push origin git@bitbucket.org:acme/chatflow.git
```

## Standard commit + push

```bash
git status                       # confirm what you're committing
git add -A                       # or stage specific paths
git commit -m "type(scope): summary"   # see commit message rules below
git push                         # → fans out to BOTH GitHub and Bitbucket
```

That's it. Commits are local until pushed; the single `git push` mirrors them to both repos.

### Single-target push (only when asked)

```bash
git push github   <branch>       # GitHub only
git push bitbucket <branch>      # Bitbucket only
```

## Before you push — checklist

1. **Verify the work.** Run `bun run typecheck` and `bun run test` (or `bun run verify`). Never claim success without seeing the commands pass.
2. **No secrets.** Never commit real credentials. `.env.example` holds *placeholders only*. GitHub push protection will block real keys (e.g. `AWS_BEARER_TOKEN_BEDROCK`, `AKIA…`). If blocked, **stop and tell the user** — do not use the allow-secret bypass URL on your own.
3. **Branch, don't push to** `main` **directly.** Work on a feature branch and open a PR into `main`(`gh pr create --base main`). Only the user merges.

## Commit message rules

- Conventional Commits: `feat(...)`, `fix(...)`, `docs(...)`, `test(...)`, `build(...)`, etc.
- Imperative, one-line summary; body only if it adds context.
- AI agents append the configured `Co-Authored-By` trailer.

## Keeping the two remotes in sync (important)

The fan-out push only covers changes that flow **through this machine**. Two gotchas:

1. **Fetch is GitHub-only.** If someone pushes *directly* to Bitbucket, you won't get it from `git pull`. Pull it in manually:

   ```bash
   git fetch bitbucket
   git merge bitbucket/main        # ff-only when histories share a base
   ```

2. **Both push legs must each fast-forward.** `git push` sends to GitHub first, then Bitbucket. If one side rejects (non-fast-forward), that half fails while the other may have already succeeded → the repos drift. On rejection: `git fetch` the rejecting remote, merge, push again.

When in doubt about divergence, check:

```bash
git fetch github && git fetch bitbucket
git rev-list --left-right --count github/main...bitbucket/main   # 0 0 = in sync
```