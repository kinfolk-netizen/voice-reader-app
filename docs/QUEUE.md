# Witness Reader — Work Queue
Do jobs top to bottom. One job = one branch = one PR. Mark a job DONE here (with the PR link) when merged.

---

## JOB 1 — Polly provider + the twins recast  ·  branch `feature/polly-twins`  ·  STATUS: READY
**Branch off `feature/claude-code-workflow`** (not Kin-GitHub) so the workflow setup and this job
ship in ONE merge = one production deploy.
Background: an earlier Netlify Agent Runner built Polly (registry 1.7) but that work never reached
GitHub, so build it fresh here. Env vars are ALREADY set in Netlify:
`AWS_POLLY_ACCESS_KEY_ID`, `AWS_POLLY_SECRET_ACCESS_KEY`, `AWS_POLLY_REGION` (us-east-1).

1. **Polly adapter.** Server-side proxy (AWS SDK v3 `SynthesizeSpeech`, engine `neural`, mp3).
   Accept SSML (wrap plain text in `<speak>`, XML-escaped). Expose the en-US/en-GB neural voice list
   through the same voice-list path the other providers use, so the Casting Room can browse it.
   Errors use the existing path: retries, mark provider dark, fail over one hop to the understudy.
   Leave a clean slot for future adapters (Acapela next, Azure maybe).
2. **Liveness probe.** Add Polly to the v2.34 probe (one 9-character synthesis per tab, cached);
   show it in the status line (e.g. `· 3×POLLY`).
3. **Registry → `1.9-twins-polly`:**
   - Ka'el → polly/Justin, LOCKED. Junia → polly/Ivy, LOCKED. Remove speechify evie/rory everywhere
     and retire any twins-pair rule that sent the twins to the Narrator when Speechify was dark.
   - Auren → polly/Kevin, LOCKED (replaces speechify/archie; archie returns to the pool).
     Keep aliases AUREN and THE WATCHER; THE WATCHER must resolve to Auren, not the Ch1 elder
     "Watcher" row (make the elder row exact-match only if needed).
   - Pip (6) and Merra (8): add/keep rows with `age: "child"` and NO voice yet, so they read as Narrator.
   - Reserve Justin, Ivy, Kevin (never score-matched to anyone else).
   - A saved browser seat pointing at evie, rory or archie-for-Auren is cleared on next load.
4. **Child-safety fallback** (see CLAUDE.md): enforce in the seating passes and test it.
5. **Tests** in `devtest/` (stub the network): Polly synthesizes via the proxy and no key name appears
   in any file under `public/`; dark Polly fails over one hop; KA'EL/JUNIA/AUREN seat on Justin/Ivy/Kevin;
   PIP/MERRA seat on Narrator and never on an adult voice; THE WATCHER → Auren; collision check passes.
6. Push, give Jonathan the PR link. He listens on the Deploy Preview with
   `2026-10-03_Audition_Twins_on_Polly_Dramatized_v1.0.txt` (Jonathan HQ → 10_VOICE_READER). Merge on his yes.

**Recast 2026-10-07 by ear** (Jonathan, after listening on the PR #7 Deploy Preview) → registry `1.10-polly-recast`:
- Ka'el → polly/Kevin, LOCKED. Junia → polly/Justin, LOCKED (Justin sounds like Junia).
- Pip → polly/Ivy, LOCKED (Ivy sounds youngest; the locked seat wins over gender, which is intended).
- Auren → no voice, NOT locked; score-matched to a live non-reserved voice until Job 2 finds one.
  Aliases AUREN / THE WATCHER kept (THE WATCHER → Auren, not the elder Watcher).
- Merra stays voiceless (Narrator).
- Reserved stays Justin, Ivy, Kevin + linda. Pass 0.5 now also drops a saved seat on a reserved
  voice by anyone but its locked owner (e.g. Auren still saved on Kevin from 1.9).

---

## JOB 2 — Acapela provider (Merra) + a voice for Auren  ·  branch `feature/acapela-kids`  ·  STATUS: WAITING ON JONATHAN
**Merra:** Acapela UK girls (Rosie, Amelia, Chloe, Amy-Northern). **Auren (15, teen boy):** needs a
teen-boy voice; candidates still to be researched (Acapela, Azure or others). Pip is now LOCKED on polly/Ivy.
Blocked until Jonathan signs up at https://www.acapela-cloud.com/signup/ and adds Netlify env vars
`ACAPELA_EMAIL` and `ACAPELA_PASSWORD` (dedicated password).
- Adapter in the Polly pattern. Acapela auth is login-based: `POST /api/login/` (email + password) returns
  a token; send `Authorization: Token <token>`. Cache the token server-side; re-login on 401.
  Synthesis: `/api/command/` (mp3; ≤3000 chars per request in stream mode → chunk accordingly).
  Voice list: `GET /api/account/` returns the voices this account can use. Docs: https://www.acapela-cloud.com/docs_api/
- Add to the liveness probe and the Casting Room voice list.
- Candidates to expose: UK boys Harry, Arthur, Caleb (also Archie-Scottish, Liam-Australian);
  UK girls Rosie, Amelia, Chloe (also Amy-Northern); US fallbacks Emilio, Ella.
- Registry: Merra stays voiceless (Narrator) and Auren stays score-matched until Jonathan locks them by ear.
- Audition script: `2026-10-03_Audition_Pip_Merra_The_Casting_Call_Dramatized_v1.0.txt`
  (Jonathan HQ → 10_VOICE_READER). Its tags look like `PIP AS HARRY` / `MERRA AS ROSIE`; make sure the
  Casting Room lets each of those tags be seated on its named voice.
- Note: Speechify also has a voice called `archie`. Disambiguate by provider in the UI.

---

## PARKED
- `feature/sts-proxy` (Jonathan's local commit 74802fa, ElevenLabs speech-to-speech proxy, July 25):
  never pushed. Ask Jonathan before including it anywhere.
- Azure (Maisie/Ana): parked until the Microsoft login is sorted.
- Voice shaping (pitch/formant) from the Recorded Lines & Voice Shaping spec: only if Acapela fails.
