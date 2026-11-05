// Checks public/music-cues.json against the real chapter listening copies.
// Usage: node devtest/verify_music_cues.mjs "<folder that contains the Ch00..Ch11 folders>"
import fs from 'fs';
import path from 'path';
const root = process.argv[2];
const cues = JSON.parse(fs.readFileSync('public/music-cues.json', 'utf8')).cues;
const valid = new Set(['01', '02', '03', '04', '05', '06']);
const norm = s => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s/g, ' ').toLowerCase();
function find(dir, n) {
  const re = new RegExp('_CH' + n + '_Listening_v[\\d.]+\\.txt$');
  const out = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) { if (!/_ARCHIVE/i.test(f)) walk(p); } else if (re.test(f) && !/^Copy of/.test(f)) out.push(p); } })(dir);
  return out.sort().pop();
}
let bad = 0;
for (const key of Object.keys(cues)) {
  const n = key.slice(2);
  const file = root && find(root, n);
  if (!file) { console.log(key + ': chapter file not found'); bad++; continue; }
  const t = norm(fs.readFileSync(file, 'utf8').trim());
  let from = 0, line = [];
  for (const c of cues[key]) {
    if (!valid.has(c.mood)) { console.log(key + ': bad mood ' + c.mood); bad++; }
    if (c.at === '^') { line.push('0%:' + c.mood); continue; }
    const a = norm(c.at);
    const p = t.indexOf(a, from);
    if (p < 0) { console.log(key + ': NOT FOUND (or out of order): ' + c.at); bad++; continue; }
    const dup = t.indexOf(a, p + 1) >= 0;
    if (dup) console.log(key + ': note - phrase appears more than once: ' + c.at);
    line.push(Math.round(100 * p / t.length) + '%:' + c.mood); from = p;
  }
  console.log(key + ' ' + line.join('  '));
}
console.log(bad ? 'PROBLEMS: ' + bad : 'all cue anchors found, in order');
process.exit(bad ? 1 : 0);
