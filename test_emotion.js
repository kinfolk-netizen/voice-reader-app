/**
 * test_emotion.js — Phase B Speechify emotion path (proxy side).
 *
 * Proves: cue vocabulary + synonyms resolve correctly; the SSML envelope is
 * well-formed with the prefix landing exactly at the spoken text; and the
 * caption remap returns marks to ORIGINAL-text offsets whether Speechify indexes
 * them into the SSML string or the plain text — so word-sync never regresses.
 *
 * Run: node test_emotion.js
 */
'use strict';
const assert = require('assert');
const proxy = require('./api/tts-proxy.js');

let passed = 0;
function ok(name, cond) { assert.ok(cond, 'FAIL: ' + name); passed++; console.log('  ✓ ' + name); }

console.log('Test 1 — cue resolution');
ok('canonical cue passes through', proxy._resolveCue('afraid') === 'afraid');
ok('synonym folds in (quiet->soft)', proxy._resolveCue('quiet') === 'soft');
ok('synonym (scared->afraid)', proxy._resolveCue('scared') === 'afraid');
ok('case-insensitive', proxy._resolveCue('WHISPER') === 'whisper');
ok('unknown cue -> null (plain delivery)', proxy._resolveCue('sarcastic') === null);
ok('empty -> null', proxy._resolveCue(null) === null);

console.log('Test 2 — SSML envelope');
const w = proxy._speechifyEmotionSSML('Do you hear it?', 'afraid');
ok('afraid -> fearful style', /emotion="fearful"/.test(w.ssml));
ok('wrapped in <speak>', w.ssml.startsWith('<speak>') && w.ssml.endsWith('</speak>'));
ok('prefix lands exactly at the text', w.ssml.slice(w.prefixLen, w.prefixLen + 15) === 'Do you hear it?');
ok('contentLen is the raw text length', w.contentLen === 'Do you hear it?'.length);
ok('whisper adds x-soft prosody', /volume="x-soft"/.test(proxy._speechifyEmotionSSML('hush', 'whisper').ssml));
ok('urgent adds fast rate', /rate="fast"/.test(proxy._speechifyEmotionSSML('run', 'urgent').ssml));
ok('weary adds slow rate + relaxed', (() => { const s = proxy._speechifyEmotionSSML('so tired', 'weary').ssml; return /rate="slow"/.test(s) && /emotion="relaxed"/.test(s); })());
ok('unknown cue -> null', proxy._speechifyEmotionSSML('hello', 'zany') === null);
ok('text with & is skipped (no escaping-offset risk)', proxy._speechifyEmotionSSML('you & me', 'sad') === null);
ok('text with < is skipped', proxy._speechifyEmotionSSML('a < b', 'sad') === null);
ok("quotes/apostrophes are allowed unescaped", (() => { const s = proxy._speechifyEmotionSSML("don't stop", 'firm'); return s && s.ssml.includes("don't stop"); })());

console.log('Test 3 — CAPTION SAFETY: SSML-indexed marks remap to original-text offsets');
(() => {
  const text = 'Do you hear it?';
  const wrap = proxy._speechifyEmotionSSML(text, 'afraid');
  const meta = { prefixLen: wrap.prefixLen, contentLen: wrap.contentLen };
  // Speechify indexed into the SSML string: each word offset = prefixLen + column
  const cols = [0, 3, 7, 12]; // Do / you / hear / it?
  const ssmlMarks = { type: 'speech', chunks: cols.map((c, i) => ({
    type: 'word', value: text.slice(c).split(' ')[0], start: wrap.prefixLen + c, end: wrap.prefixLen + c + 2, start_time: i * 100
  })) };
  const out = proxy._remapEmotionMarks(ssmlMarks, meta);
  ok('every mark maps back to its original-text column', out.chunks.every((m, i) => m.start === cols[i]));
  ok('first word lands at offset 0 (start of line)', out.chunks[0].start === 0);
  ok('remapped offsets index the correct source chars',
     out.chunks.every((m, i) => text[m.start] === text[cols[i]]));
  ok('structure + value + timing preserved',
     out.chunks.length === 4 && out.chunks[3].value === 'it?' && out.chunks[2].start_time === 200);
})();

console.log('Test 4 — plain-indexed marks are left untouched (no double-shift)');
(() => {
  const meta = { prefixLen: 42, contentLen: 15 };
  const plain = { chunks: [{ start: 0, start_time: 0 }, { start: 3, start_time: 100 }] };
  const out = proxy._remapEmotionMarks(plain, meta);
  ok('min offset below prefix => detected plain => unchanged', out.chunks[0].start === 0 && out.chunks[1].start === 3);
})();

console.log('Test 5 — empty / missing marks are safe');
ok('null marks pass through', proxy._remapEmotionMarks(null, { prefixLen: 42, contentLen: 15 }) === null);

console.log('Test 6 — ElevenLabs v3 emotion tags');
ok('afraid -> [nervous]', proxy._elEmotionTag('afraid') === '[nervous]');
ok('whisper -> [whispers]', proxy._elEmotionTag('whisper') === '[whispers]');
ok('sad -> [sorrowful]', proxy._elEmotionTag('sad') === '[sorrowful]');
ok('synonym quiet -> [softly]', proxy._elEmotionTag('quiet') === '[softly]');
ok('tag is bracketed and lowercase', /^\[[a-z]+\]$/.test(proxy._elEmotionTag('urgent')));
ok('unknown cue -> null (plain delivery)', proxy._elEmotionTag('smug') === null);
ok('empty -> null', proxy._elEmotionTag(null) === null);

console.log('Test 7 — EL v3 emotion caption remap (exact source-indexed marks)');
(() => {
  // Alignment string is `[nervous] Be careful with it.` (tag = 9 chars, +1 space).
  const tag = proxy._elEmotionTag('afraid'); // [nervous]
  const prefixLen = tag.length + 1;           // 10
  const text = 'Be careful with it.';
  const contentLen = text.length;
  // Marks as elAlignmentToMarks would emit over the full string: tag word at 0,
  // then each spoken word offset by prefixLen.
  const cols = [0, 3, 11, 16]; // Be / careful / with / it. within `text`
  const marks = [{ start: 0, start_time: 0 }].concat(
    cols.map((c, i) => ({ start: prefixLen + c, end: prefixLen + c + 2, start_time: (i + 1) * 100 }))
  );
  const out = proxy._remapElEmotionMarks(marks, prefixLen, contentLen);
  ok('tag mark is dropped (only spoken words remain)', out.length === cols.length);
  ok('spoken words map back to source columns', out.every((m, i) => m.start === cols[i]));
  ok('first spoken word lands at offset 0', out[0].start === 0);
  ok('remapped offsets index the correct source chars',
     out.every((m, i) => text[m.start] === text[cols[i]]));
  ok('timing preserved (tag dropped, not the times)', out[1].start_time === 200);
})();

console.log('Test 8 — EL remap edge cases');
ok('null marks -> null', proxy._remapElEmotionMarks(null, 10, 20) === null);
ok('empty marks -> null', proxy._remapElEmotionMarks([], 10, 20) === null);
ok('all-tag marks -> null (nothing survives)',
   proxy._remapElEmotionMarks([{ start: 0, start_time: 0 }], 10, 20) === null);
ok('offset never exceeds contentLen-1 (clamped)', (() => {
  const out = proxy._remapElEmotionMarks([{ start: 999, start_time: 0 }], 10, 5);
  return out[0].start === 4;
})());

console.log(`\nALL ${passed} ASSERTIONS PASSED ✅`);
