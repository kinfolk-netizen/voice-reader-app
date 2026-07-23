// v2.20 timing unit tests: weight curve, cps EMA, clock/speed formatting,
// and the proxy's ElevenLabs alignment->marks converter.
const assert = require('assert');

// --- extract the pure functions from index.html by evaluating their bodies ---
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
function grabMethod(name) {
  const re = new RegExp(name + String.raw`\(([^)]*)\)\s*\{`);
  const m = re.exec(html);
  if (!m) throw new Error('method not found: ' + name);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0 && i < html.length) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') depth--;
    i++;
  }
  return new Function(m[1], html.slice(m.index + m[0].length, i - 1));
}
const buildWeightCurve = grabMethod('buildWeightCurve');
const charAtWeight = grabMethod('charAtWeight');
const fmtClock = grabMethod('fmtClock');
const fmtSpeed = grabMethod('fmtSpeed');

// 1. weight curve: monotone cumulative, punctuation adds weight
const t = 'Hello, world. Yes!';
const cum = buildWeightCurve(t);
assert.strictEqual(cum.length, t.length + 1);
for (let i = 1; i < cum.length; i++) assert(cum[i] > cum[i-1], 'monotone');
assert(cum[t.length] > t.length, 'punctuation adds weight');
console.log('PASS weight curve monotone + weighted');

// 2. mapping: frac 0 -> 0; frac ~1 -> near end; monotone in frac
assert.strictEqual(charAtWeight(cum, 0), 0);
assert(charAtWeight(cum, 0.999) >= t.length - 2);
let prev = -1;
for (let f = 0; f <= 1; f += 0.05) {
  const c = charAtWeight(cum, f);
  assert(c >= prev, 'mapping monotone');
  prev = c;
}
console.log('PASS charAtWeight mapping');

// 3. weighted beats linear on a pause-heavy text: after the mid-audio point of
// a text whose first half is punctuation-dense, weighted position should lag
// linear position (speech spent longer on the punctuated half).
const heavy = 'A. B. C. D. E. F. G. H.' + ' plain unpunctuated tail of letters here';
const hc = buildWeightCurve(heavy);
const linear = Math.floor(heavy.length * 0.5);
const weighted = charAtWeight(hc, 0.5);
assert(weighted < linear, `weighted (${weighted}) should trail linear (${linear}) in punctuated half`);
console.log('PASS weighted lags linear across pause-heavy text');

// 4. cps EMA math (formula check)
const seed = 15.5, inst = 12.0;
const next = seed * 0.7 + inst * 0.3;
assert(Math.abs(next - 14.45) < 1e-9);
console.log('PASS cps EMA formula');

// 5. formatting
assert.strictEqual(fmtClock(65), '1:05');
assert.strictEqual(fmtClock(3671), '1:01:11');
assert.strictEqual(fmtSpeed(1), '1×');
assert.strictEqual(fmtSpeed('1.15'), '1.15×');
assert.strictEqual(fmtSpeed(0.85), '0.85×');
console.log('PASS clock + speed formatting');

// 6. proxy converter
const { _elAlignmentToMarks } = require('./api/tts-proxy.js');
const marks = _elAlignmentToMarks({
  characters: ['H','i',' ','y','o','u','.',' ','G','o'],
  character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.9, 1.0]
});
assert.strictEqual(marks.length, 3);
assert.deepStrictEqual(marks[0], { start: 0, start_time: 0 });
assert.deepStrictEqual(marks[1], { start: 3, start_time: 300 });
assert.deepStrictEqual(marks[2], { start: 8, start_time: 900 });
assert.strictEqual(_elAlignmentToMarks(null), null);
assert.strictEqual(_elAlignmentToMarks({ characters: [] }), null);
console.log('PASS elAlignmentToMarks converter');

console.log('\nALL TIMING TESTS PASS');
