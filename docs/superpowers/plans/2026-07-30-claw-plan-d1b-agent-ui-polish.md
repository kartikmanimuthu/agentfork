# Agent UI Polish — Preview & Seed Templates

> Corrective pass on D1 Task 9. Written after the fact because the first UI attempt
> was made without a plan — recorded here so the changes are reviewable.

**Goal:** Make the workspace-file preview read like a document (matching OpenClaw's preview and expanded modal), and give the seed files enough markdown structure that there is something worth previewing.

**Reference — read from source, not screenshots** (`gh api repos/openclaw/openclaw`):

| What | Where |
|---|---|
| Panel geometry, reader typography | `ui/src/styles/components.css` — `.md-preview-dialog__*`, lines ~3885–4290 |
| Expand/collapse state handling | `ui/src/pages/agents/agent-file-preview-state.ts` |
| Markdown parser options | `ui/src/components/markdown-parser.ts` — `breaks: true`, `linkify: true` |

**Corrections to my first (screenshot-guessed) diagnosis:**

- The light bands are **not** per-element backgrounds. `h2` carries `border-top` +
  `padding-top: 1.3rem`, producing a rule above each section. My
  `[&>*]:border-b [&>*]:bg-muted/20` was wrong and is removed.
- The document is a **centred sheet** — `.md-preview-dialog__reader` is
  `width: min(100%, 82ch)`, `margin: 0 auto`, with its own border, background and
  shadow, floating on a darker body. That framing is most of the "looks clean".
- The panel uses **`min-height: min(76vh, 820px)`** — a *minimum*. My `max-h-[70vh]`
  did the opposite and collapsed around short files.
- Headings are **serif** (`Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia`).
- `breaks: true` is why plain one-fact-per-line files render correctly there and
  collapsed into a run-on paragraph here. Needs `remark-breaks`.
- **There is no blur on file content.** The only `blur` in the whole component
  stylesheet is `backdrop-filter: blur(14px)` on the modal backdrop. The blurred
  textareas in the reference screenshots are the screenshotter's own redaction.

## Diagnosis

| Symptom | Root cause |
|---|---|
| Preview text is small, cramped, unstyled | `components/ui/markdown-content.tsx` is a **chat-bubble** renderer. Its element map hardcodes `text-[13px]` on `p`, `text-lg` on `h1`, `mb-1.5` spacing. Those explicit classes win over any `className` passed in, so it cannot be rescaled from outside. Retuning it would regress `/chat`. |
| Modal is narrow with a large empty white area | `max-w-3xl` is too narrow (OpenClaw's is ~55vw), and the content area uses a **fixed** `h-[60vh]` instead of a max, so short files render a tall empty box. |
| Expand barely changes anything | `max-w-[95vw]` widened it but height stayed `h-[80vh]`; OpenClaw's expanded state is near-full-viewport. |
| Even correct rendering looks bland | Seed templates are plain prose plus an HTML comment — **no headings, no lists**. OpenClaw's seeds are structured markdown documents. |
| Inner tab row is cluttered (`USER UNSET TOOLS UNSET HEARTBEAT UNSET`) | The `unset` badge is too prominent and repeats on every unseeded file. |

## Changes

### 1. New document-scale markdown renderer

Create `components/agent/markdown-document.tsx`. Separate from the chat renderer by
design — different medium, different scale. Its own element map:

| Element | Chat renderer | Document renderer |
|---|---|---|
| `h1` | `text-lg font-bold` | `text-3xl font-bold` |
| `h2` | `text-base font-bold` | `text-xl font-semibold` |
| `h3` | `text-sm font-semibold` | `text-base font-semibold` |
| `p` | `text-[13px] mb-1.5` | `text-[15px] leading-7` |
| `ul`/`ol` | `text-[13px] space-y-0.5` | `text-[15px] space-y-2` |

Plus OpenClaw's **banded blocks**: each top-level child sits on a faint background
with a hairline separator beneath, via `[&>*]:border-b [&>*]:px-6 [&>*]:py-3` on the
wrapper. That banding is what makes their preview read as a rendered document rather
than a wall of text.

### 2. Resize the preview dialog

`components/agent/file-preview-dialog.tsx`:

- Default: `sm:max-w-4xl`, content `max-h-[70vh]` (a **max**, so short files no longer
  render an empty box).
- Expanded: `sm:max-w-[96vw]`, content `h-[86vh]` — near-full-viewport, matching the
  reference.
- Keep `Expand`/`Collapse` · `Editor` · `Close`, which already match.

### 3. Structured seed templates

Rewrite `libs/claw-studio/src/workspace/templates.ts` as real markdown documents,
following OpenClaw's shape — an `# <FILE>.md — <question>` title, then `##` sections,
lists, and an HTML-comment prompt telling the user what to fill in. Keep each within
its `SLUG_CHAR_CAPS` budget (the existing test asserts this).

### 4. Re-seed unedited files

New templates only reach existing tenants if something updates them. Add
`WorkspaceFileService.reseedUnedited()`:

- Updates only files at **`version === 1`**. Every `write`/`restore` increments
  `version`, so `version === 1` means *never edited by a human or by Claw*. Precise
  condition, zero risk of clobbering real content.
- Does **not** bump `version` and does **not** write a revision — a seed refresh is not
  an edit.
- Called alongside `seed()` in `resolveClawRuntime` and the files API route.

### 5. Soften the `unset` badge

Render it as a small muted dot-and-label rather than repeated uppercase text, so the
tab row stays readable when several files are unseeded.

## Verification

- `cd libs/claw-studio && bunx vitest run` — the existing template-cap test must still
  pass; add coverage for `reseedUnedited` (updates v1, leaves v2+ alone, writes no
  revision).
- `cd apps/mission-control && bunx tsc --noEmit`.
- Visual: open a seeded `SOUL`, click `Preview` — headings/lists render at document
  scale with banded blocks; `Expand` fills the viewport; a short file (`IDENTITY`) shows
  no large empty area.
- `/chat` markdown is unchanged — the chat renderer was not touched.

## Non-regression

`components/ui/markdown-content.tsx` must not be modified. Confirm with
`git status --porcelain -- apps/mission-control/components/ui`.
