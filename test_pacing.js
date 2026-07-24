/**
 * test_pacing.js — v2.25 DJ Scores Layer A (reader-side weighted silence).
 *
 * Mirrors the pure pause logic shipped in public/index.html
 * (computePauseAfterOne / computePauseTrack) and proves: the boundary->silence
 * model, the Restraint Law (quiet cues only lengthen, never shorten), the
 * Scarcity Law (no two big pauses back-to-back; Layer-A ceiling), and that the
 * whole thing is a no-op when disabled. This logic inserts silence BETWEEN audio
 * segments, so it can never mutate text or captions — that safety is structural.
 *
 * Run: node test_pacing.js
 */
'use strict';
const assert = require('assert');
let passed = 0;
function ok(name, cond) { assert.ok(cond, 'FAIL: ' + name); passed++; console.log('  ✓ ' + name); }

// ---- MIRROR of public/index.html (keep in lockstep) ----
const QUIET = { soft: 1, whisper: 1, tender: 1, sad: 1, flat: 1, weary: 1, calm: 1 };
function computePauseAfterOne(chunk, next, fullText) {
    const t = (chunk.text || '').replace(/\s+$/, '');
    let base;
    if (/(?:…|\.\.\.)$/.test(t)) base = 320;
    else if (/[—–-]$/.test(t)) base = 150;
    else if (/[.!?][")'”’\]]?$/.test(t)) {
        const lastSent = (t.match(/[^.!?]*[.!?][")'”’\]]?$/) || [t])[0];
        const words = lastSent.replace(/[^A-Za-z0-9'’ ]/g, ' ').trim().split(/\s+/).filter(Boolean);
        base = (words.length <= 2) ? 260 : 180;
    } else base = 0;
    let structural = 0;
    if (next) {
        const gapText = fullText.slice(chunk.end, next.start);
        const paraBreak = /\n\s*\n/.test(gapText);
        if (next.speaker !== chunk.speaker) {
            const narration = (chunk.role === 'narrator' || next.role === 'narrator');
            if (narration) structural = 550;
            else structural = ((chunk.text || '').length < 90 && (next.text || '').length < 90) ? 240 : 320;
        } else if (paraBreak) {
            structural = 300;
        }
    }
    let pause = Math.max(base, structural);
    const cue = (chunk.emotion || '').toLowerCase();
    if (QUIET[cue]) pause += 150;
    return pause;
}
function computePauseTrack(chunks, fullText, opts) {
    opts = opts || {};
    const track = [];
    if (opts.enabled === false) { for (let i = 0; i < chunks.length; i++) track.push(0); return track; }
    const intensity = (typeof opts.intensity === 'number') ? opts.intensity : 1;
    for (let i = 0; i < chunks.length; i++) {
        track.push(Math.round(computePauseAfterOne(chunks[i], chunks[i + 1] || null, fullText) * intensity));
    }
    const CEIL = 900;
    for (let i = 0; i < track.length; i++) {
        if (track[i] > CEIL) track[i] = CEIL;
        if (i > 0 && track[i] > 600 && track[i - 1] > 600) track[i] = Math.min(track[i], 400);
    }
    return track;
}
const one = (chunk, next, ft) => computePauseAfterOne(chunk, next, ft || '');

console.log('Test 1 — boundary -> silence baseline (last chunk, no structural)');
ok('sentence end -> 180', one({ text: 'He waited by the door.' }, null) === 180);
ok('one/two-word fragment rings longer -> 260', one({ text: 'Frozen. Listening.' }, null) === 260);
ok('ellipsis -> 320 (searching)', one({ text: 'The square felt…' }, null) === 320);
ok('em-dash -> 150 (caught breath)', one({ text: 'How did you—' }, null) === 150);
ok('mid-clause -> 0 (left to TTS)', one({ text: 'and kept a steady pace,' }, null) === 0);
ok('question mark counts as sentence end', one({ text: 'Should we be worried?' }, null) === 180);

console.log('Test 2 — Restraint Law: quiet cues only LENGTHEN, never shorten');
ok('soft adds a held beat on a sentence (180 -> 330)', one({ text: 'Do you hear it?', emotion: 'soft' }, null) === 330);
ok('quiet cue lengthens even a mid-clause (0 -> 150)', one({ text: 'well,', emotion: 'whisper' }, null) === 150);
ok('a non-quiet cue adds nothing (firm -> 0 change)', one({ text: 'well,', emotion: 'firm' }, null) === 0);
ok('quiet is never shorter than plain', one({ text: 'A line.', emotion: 'weary' }, null) >= one({ text: 'A line.' }, null));

console.log('Test 3 — structural boundaries (speaker turn / paragraph)');
const ftA = 'He crossed to the door.\n\nMaster Viell.';
ok('narration<->dialogue camera move -> 550', one({ text: 'He crossed to the door.', end: 23, speaker: 'NARRATOR', role: 'narrator' }, { text: 'Master Viell.', start: 25, speaker: 'KAEL', role: 'dialogue' }, ftA) === 550);
const ftB = 'I know that too,\n\nDo you think we did the right thing?';
ok('tight dialogue volley compresses -> 240', one({ text: 'I know that too,', end: 16, speaker: 'KAEL', role: 'dialogue' }, { text: 'Do you think we did the right thing?', start: 18, speaker: 'JUNIA', role: 'dialogue' }, ftB) === 240);
const ftC = 'First paragraph here.\n\nSecond paragraph here.';
ok('same speaker, new paragraph -> 300', one({ text: 'First paragraph here.', end: 21, speaker: 'NARRATOR', role: 'narrator' }, { text: 'Second paragraph here.', start: 23, speaker: 'NARRATOR', role: 'narrator' }, ftC) === 300);
ok('structural wins over a small base via MAX (not sum)', one({ text: 'He crossed to the door.', end: 23, speaker: 'NARRATOR', role: 'narrator' }, { text: 'Master Viell.', start: 25, speaker: 'KAEL', role: 'dialogue' }, ftA) === 550);

console.log('Test 4 — Scarcity Law: no two big pauses back-to-back');
const ftS = 'He spoke.\n\nWait.\n\nSilence.';
const scChunks = [
    { text: 'He spoke.', end: 9, speaker: 'NARRATOR', role: 'narrator', emotion: 'soft' },
    { text: 'Wait.', start: 11, end: 16, speaker: 'KAEL', role: 'dialogue', emotion: 'soft' },
    { text: 'Silence.', start: 18, speaker: 'NARRATOR', role: 'narrator' }
];
const scTrack = computePauseTrack(scChunks, ftS, {});
ok('first big pause stands (700)', scTrack[0] === 700);
ok('second consecutive big pause is trimmed to 400', scTrack[1] === 400);

console.log('Test 5 — ceiling clamp (reserved HOLD never produced by Layer A)');
ok('intensity blowout is clamped to 900', computePauseTrack([{ text: 'A.', end: 2, speaker: 'N', role: 'narrator' }, { text: 'B.', start: 4, speaker: 'K', role: 'dialogue' }], 'A.\n\nB.', { intensity: 3 })[0] === 900);

console.log('Test 6 — global toggle + intensity scalar');
const tChunks = [{ text: 'One.', end: 4 }, { text: 'Two.', start: 6 }];
ok('disabled -> all zeros', computePauseTrack(tChunks, 'One.\n\nTwo.', { enabled: false }).every(v => v === 0));
ok('disabled track length matches chunks', computePauseTrack(tChunks, 'One.\n\nTwo.', { enabled: false }).length === tChunks.length);
ok('intensity 0.5 halves (180 -> 90)', computePauseTrack([{ text: 'A sentence here.' }], '', { intensity: 0.5 })[0] === 90);
ok('default intensity is 1', computePauseTrack([{ text: 'A sentence here.' }], '', {})[0] === 180);

console.log(`\nALL ${passed} ASSERTIONS PASSED ✅`);
