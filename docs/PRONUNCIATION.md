# Name pronunciation — per provider, at the transmit layer

Source of truth: the `PRONUNCIATION` table at the top of `api/tts-proxy.js`
(kill switch: `PRONUNCIATION_ENABLED`). Added in Job 3 (2026-10-07 roll call).

## What it touches
Only the text **sent to the provider**, server-side. The displayed text, manuscript,
dramatized copies, audio cache keys (hashed client-side on the original text) and
word highlighting never see it.

## The table
| Name | IPA | Polly | Azure | Speechify | ElevenLabs | Heard before the fix |
|---|---|---|---|---|---|---|
| Ka'el | `ˈkɔː.ɛl` | phoneme | phoneme | — (already right) | — | Kevin/Justin "kale", Maisie "Kay-el", Ana "Kyle" |
| Auren | `ˈɔː.rən` | phoneme | phoneme | — | — | Kevin "Aaron" |
| Junia | `ˈdʒuː.ni.ə` | phoneme | phoneme | — | — | Kevin "yoonia" (dropped the hard J) |
| Silas | `ˈsaɪ.ləs` | phoneme | phoneme | respelled `Sylus` | — | Narrator (john-rhys-davies) "Sealis" |

## How each provider gets it
- **Polly** (Kevin, Justin, Ivy): `<phoneme alphabet='ipa' ph='…'>Name</phoneme>` inside `<speak>`,
  applied after XML-escaping. Polly neural supports `<phoneme>`. Its en-US phoneme set has no
  length mark, so `ː` is dropped (`ˈkɔ.ɛl`).
- **Azure** (Ana, Maisie): same phoneme tag, inside `<voice>`. en-GB voices (Maisie) keep `ː`;
  other locales (Ana, en-US) drop it.
- **Speechify**: the proxy does send SSML on some lines (emotion / breath `<break>`), but Speechify
  has no `<phoneme>` support, so names are **respelled** instead. Respellings must be the same
  length as the name so Speechify's word marks still line up with the original text.
- **ElevenLabs**: never touched (it uses `public/score/saga-lexicon.pls`).

## Matching rules
Longest name first, whole word, any case; `'` or `’` apostrophes (and their escaped forms);
possessives keep the `'s` outside the phoneme (`Ka'el's` → phoneme on `Ka'el`). Text already inside
a `<phoneme>` or `<sub>` is left alone, so nothing is ever double-wrapped.

## Tuning by ear
Edit the entry's `ipa` or `providers`. If a provider still says a name wrong (e.g. Polly ignores the
phoneme), give that entry a `respell` plus `respellOn: ['polly']` — that provider then gets the
respelling instead of the phoneme. Candidates: Ka'el → `Kawel`, Junia → `Joonia`, Auren → `Oren`.
Only Speechify needs a same-length respelling (word marks); Polly/Azure don't. Note the change
in the table's comment.
Run `node devtest/test_pronunciation.js` after any edit.
