# CLAUDE.md — Witness Reader (voice-reader-app)

Jonathan's private listening tool for hearing *The Resonance Field* read in character voices.
It is NOT an audiobook pipeline; nothing it makes is published. Optimise for fast iteration.
Live site: https://witnessreader.netlify.app · Netlify project: witnessreader (team KIN) · production branch: `Kin-GitHub`.

## The workflow (cost rules — read first)
Netlify charges **15 credits per production deploy** and charges Agent Runners for AI time.
The plan has 1,000 credits/month. So:

1. **All coding happens here, in Claude Code on Jonathan's machine. Never use Netlify Agent Runners.**
2. **Never commit to `Kin-GitHub` directly.** Every job gets its own branch: `feature/<short-topic>`.
3. Before pushing, run the tests (see below). Don't push red.
4. Push the branch: `git push -u origin feature/<topic>`. Then give Jonathan the pull-request link
   (`https://github.com/kinfolk-netizen/voice-reader-app/compare/Kin-GitHub...feature/<topic>?expand=1`).
   Opening the PR builds a **Deploy Preview** (free) at `deploy-preview-<PR#>--witnessreader.netlify.app`.
   Jonathan listens there.
5. **Merge only when Jonathan says yes.** Each merge = one production deploy = 15 credits.
   Batch related changes into one PR rather than many small merges.
6. Docs-only commits (this file, `docs/`, `*.md`) are skipped by the `ignore` rule in `netlify.toml`,
   so they cost nothing.

## Hard rules
- **Keys never reach the browser.** Every provider goes through a serverless proxy in `api/`
  with credentials from Netlify env vars. Never commit a key; never ask Jonathan to paste one into chat.
  Jonathan sets env vars himself in Netlify → witnessreader → Site configuration → Environment variables.
- **Mirror existing patterns** (`api/tts-proxy.js`, the v2.34 liveness probe, three-pass auto-seat,
  one-hop failover). Don't invent new architecture.
- **Child safety:** a registry row with `age: "child"` is never seated on an adult or senior voice by
  score-match. If no child/teen/young voice is free, it reads in the Narrator voice.
- **No voice cloning or voice design of children, ever.** Only stock catalogue child voices the provider
  owns (Polly, Acapela, Azure), or consented recorded lines per the spec in Jonathan HQ.
- The devtest harness slices `public/index.html` by line ranges. If you move code in `index.html`,
  update the ranges in `devtest/test_cast_seating_v234.mjs` in the same commit.

## Tests
- `node devtest/test_cast_seating_v234.mjs` — offline seating/failover harness (stubbed network).
- `python devtest/check_cast_v234.py` — registry integrity + voice-collision check.
- Add new tests to `devtest/` for anything you build.

## Cast (canon — never drift ages)
| Character | Age | Voice | Status |
|---|---|---|---|
| Ka'el | 12 | polly / Kevin | LOCKED (recast by ear 2026-10-07) |
| Junia | 12 | polly / Justin | LOCKED (recast by ear 2026-10-07) |
| Auren | 15 | speechify / joe | LOCKED (by ear 2026-10-07); aliases AUREN, THE WATCHER (→ Auren, not the elder Watcher). Speechify dark → a live non-reserved teen/young voice, else Narrator |
| Lira | 10 | speechify / linda | LOCKED |
| Pip | 6 | azure / en-US-AnaNeural (Ana) | LOCKED (by ear 2026-10-07; locked seat wins over gender, intended). Azure dark → Narrator |
| Merra | 8 | azure / en-GB-MaisieNeural (Maisie) | LOCKED (by ear 2026-10-07). Azure dark → Narrator |
| Malakai | young | speechify / cleon | registry seat (PR #8), not locked |
Registry `1.12-kids-locked`. Speechify's evie/rory are gone for good (rights withdrawn). Remove them everywhere.
Reserved (derived from the locked rows): Justin, Kevin, linda, Ana, Maisie, joe — never score-match them to anyone else.
polly/Ivy is no longer anyone's voice; it is back in the pool. Acapela stays wired as a provider but seats no one.

## Work queue
See `docs/QUEUE.md`. Do the top unfinished job, then report: files changed, test results,
the PR link, and anything Jonathan must do (env vars, listening).
