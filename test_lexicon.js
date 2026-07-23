/**
 * test_lexicon.js — Phase A pronunciation lexicon.
 *
 * Proves the caption-safety invariant: names may be re-spelled for the ear, but
 * the marks the reader consumes always resolve back to the ORIGINAL displayed
 * text, so word-sync (the v2.20 precision work) never regresses.
 *
 * Run: node test_lexicon.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const proxy = require('./api/tts-proxy.js');
const { buildPls } = require('./devtest/gen-lexicon-artifacts.js');
const LEXICON = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'score', 'saga-lexicon.json'), 'utf8'));

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, 'FAIL: ' + name);
  passed++;
  console.log('  ✓ ' + name);
}

console.log('Test 1 — lexicon schema');
ok('has version', typeof LEXICON.version === 'string');
ok('characters is a non-empty array', Array.isArray(LEXICON.characters) && LEXICON.characters.length > 0);
ok('every entry has name/match/alias/say', LEXICON.characters.every(c =>
  c.name && Array.isArray(c.match) && c.match.length > 0 && typeof c.alias === 'string' && typeof c.say === 'string'));
ok('say respellings are single-token (1:1 word-sync)', LEXICON.characters.every(c => !/\s/.test(c.say)));
ok('proxy embeds the same lexicon (no drift)',
  JSON.stringify(proxy._LEXICON) === JSON.stringify(LEXICON));

console.log('Test 2 — committed .pls matches the lexicon (anti-drift)');
const committedPls = fs.readFileSync(path.join(__dirname, 'public', 'score', 'saga-lexicon.pls'), 'utf8');
ok('saga-lexicon.pls === buildPls(lexicon)', committedPls === buildPls(LEXICON));
ok('.pls has a lexeme per match spelling',
  (committedPls.match(/<lexeme>/g) || []).length === LEXICON.characters.reduce((n, c) => n + c.match.length, 0));

console.log('Test 3 — ElevenLabs pronunciation-dictionary locators');
delete process.env.ELEVENLABS_PRON_DICT_ID;
delete process.env.ELEVENLABS_PRON_DICT_VERSION;
ok('no env -> null (today\'s behavior)', proxy._elPronLocators({}) === null);
process.env.ELEVENLABS_PRON_DICT_ID = 'dict_abc';
let loc = proxy._elPronLocators({});
ok('env id -> single locator', Array.isArray(loc) && loc.length === 1 && loc[0].pronunciation_dictionary_id === 'dict_abc');
ok('no version key when unset', loc[0].version_id === undefined);
process.env.ELEVENLABS_PRON_DICT_VERSION = 'v9';
loc = proxy._elPronLocators({});
ok('env version -> included', loc[0].version_id === 'v9');
ok('options override env', proxy._elPronLocators({ pronunciationDictionaryLocators: [{ pronunciation_dictionary_id: 'z' }] })[0].pronunciation_dictionary_id === 'z');
delete process.env.ELEVENLABS_PRON_DICT_ID;
delete process.env.ELEVENLABS_PRON_DICT_VERSION;

console.log('Test 4 — substitution matching');
ok('no-match text is untouched (pure no-op)', (() => {
  const r = proxy._applyLexicon('The harvester carried water to the wall.');
  return r.spoken === 'The harvester carried water to the wall.' && r.edits.length === 0;
})());
ok('case-insensitive + curly apostrophe', proxy._applyLexicon('KA’EL and ka\'el').spoken === 'Kahell and Kahell');
ok('possessive kept, name re-spelled', proxy._applyLexicon("Ka'el's cloak").spoken === "Kahell's cloak");
ok('substring is NOT matched (Marathon != Mara)', proxy._applyLexicon('The Marathon route').spoken === 'The Marathon route');
ok('substring is NOT matched (Kaelin != Kael)', proxy._applyLexicon('Kaelin waited').spoken === 'Kaelin waited');
ok('multiple distinct names', proxy._applyLexicon('Alyrion, Malakai, Tessara').spoken === 'Uhleerion, Mallakye, Tessahra');

console.log('Test 5 — CAPTION SAFETY: every non-substituted spoken char remaps to the identical source char');
function captionSafe(source) {
  const { spoken, edits } = proxy._applyLexicon(source);
  const inSub = (o) => edits.some(e => o >= e.dstStart && o < e.dstEnd);
  for (let o = 0; o < spoken.length; o++) {
    if (inSub(o)) continue; // inside a re-spelled name -> collapses to name start (checked below)
    const src = proxy._remapOffset(o, edits);
    assert.ok(src >= 0 && src <= source.length, 'offset out of range at ' + o);
    assert.strictEqual(source[src], spoken[o],
      `remap mismatch @spoken ${o} '${spoken[o]}' -> src ${src} '${source[src]}' in: ${source}`);
  }
  // A mark landing inside a re-spelled name must point at that name's first char.
  for (const e of edits) {
    for (let o = e.dstStart; o < e.dstEnd; o++) {
      assert.strictEqual(proxy._remapOffset(o, edits), e.srcStart, 'in-name offset must collapse to name start');
    }
  }
  return true;
}
ok('single name mid-sentence', captionSafe("She turned to Ka'el and waited."));
ok('name at string start', captionSafe("Ka'el ran."));
ok('name at string end', captionSafe("They followed Junia"));
ok('several names + possessive', captionSafe("Ka'el's oath, Junia's fear, and Eirenos itself."));
ok('adjacent names', captionSafe("Alyrion Malakai Corvath"));
ok('real cellar-style line', captionSafe("“Me too,” said Junia, and Ka'el felt the tower breathe."));

console.log('Test 6 — remapMarksToSource on Speechify-shaped marks');
(() => {
  const source = "Ka'el heard Junia.";
  const { spoken, edits } = proxy._applyLexicon(source); // "Kahell heard Joonia."
  // Build word marks in SPOKEN space (as Speechify would return them).
  const words = [];
  const re = /\S+/g; let m;
  while ((m = re.exec(spoken)) !== null) words.push({ type: 'word', value: m[0], start: m.index, end: m.index + m[0].length, start_time: words.length * 100 });
  const sm = { type: 'speech', start: 0, chunks: words };
  const remapped = proxy._remapMarksToSource(sm, edits);
  // Each remapped start must index the correct displayed word in `source`.
  const srcWords = [];
  const re2 = /\S+/g; while ((m = re2.exec(source)) !== null) srcWords.push({ start: m.index });
  ok('structure preserved (chunk count + type)', remapped.chunks.length === words.length && remapped.type === 'speech');
  ok('value fields untouched', remapped.chunks.every((c, i) => c.value === words[i].value));
  ok('word starts map to source word starts', remapped.chunks.every((c, i) => c.start === srcWords[i].start));
  ok('start_time preserved', remapped.chunks.every((c, i) => c.start_time === words[i].start_time));
})();

console.log('Test 7 — flag-off passthrough (no edits => marks unchanged)');
ok('remap with empty edits is identity', proxy._remapMarksToSource({ chunks: [{ start: 5 }] }, []) .chunks[0].start === 5);

console.log(`\nALL ${passed} ASSERTIONS PASSED ✅`);
