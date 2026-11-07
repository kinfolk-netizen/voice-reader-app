// Reader v3 — every spoken character must be on screen.
// Extracts splitReaderSentences() from public/index.html and checks that, for
// tricky manuscript text, every non-space character falls inside a sentence
// span and that spans never overlap. (The pre-v3 regex dropped sentences that
// ended in a closing quote, so Now Playing showed a stale line.)
import fs from 'fs';
const src = fs.readFileSync('public/index.html', 'utf-8');
const a = src.indexOf('splitReaderSentences(text) {');
const i = src.indexOf('{', a);
const b = src.lastIndexOf('}', src.indexOf('// A short first line', a));   // method's closing brace
const fn = new Function('text', src.slice(i + 1, b));
let fails = 0;
const check = (name, text, expectCount) => {
  const segs = fn(text);
  const covered = new Array(text.length).fill(false);
  let prevEnd = 0, ok = true;
  for (const s of segs) {
    if (s.start < prevEnd) { ok = false; console.log('  overlap at', s.start); }
    for (let k = s.start; k < s.end; k++) covered[k] = true;
    prevEnd = s.end;
  }
  const missed = [...text].map((c, k) => (!covered[k] && /\S/.test(c)) ? k : -1).filter(k => k >= 0);
  if (missed.length) { ok = false; console.log('  missed:', JSON.stringify(text.slice(missed[0], missed[0] + 30))); }
  if (expectCount != null && segs.length !== expectCount) { ok = false; console.log('  expected', expectCount, 'sentences, got', segs.length, segs.map(s => text.slice(s.start, s.end))); }
  console.log((ok ? '  PASS ' : '  FAIL ') + name + ' (' + segs.length + ' sentences)');
  if (!ok) fails++;
};
check('closing double quote', 'He was trying to remember while afraid." He went down. Then up.', 3);
check('curly quotes and question', '“Don’t?” Julia whispered. “Wait!”', 3);
check('ellipsis and em dash', 'The three came again… Faster. Wrong the same way — the sound.', 3);
check('heading with no period', 'Chapter Three\n\nThe knock came. Softer now.', 3);
check('single-newline paragraphs (Google Docs paste)', 'First line here.\nSecond paragraph starts. And ends', 3);
check('no end punctuation at all', 'just some words without any ending', 1);
check('speaker tag script', 'JUNIA: "Are you there?"\nNARRATOR: He was. He always was.', 3);
check('closing bracket and single quote', "He said 'go.' (Then left.) Done.", 3);
check('CRLF line endings', 'One.\r\nTwo three.\r\n\r\nFour!', 3);
check('decimal and initials do not drop text', 'It cost 3.50 today. J.R. came home.', null);
const long = fs.existsSync('devtest/fixtures/chapter_sample.txt') ? fs.readFileSync('devtest/fixtures/chapter_sample.txt', 'utf-8') : null;
if (long) check('full chapter fixture', long, null);
console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
