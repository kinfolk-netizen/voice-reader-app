import fs from 'fs';
import path from 'path';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL: ' + m); } else console.log('ok: ' + m); };
const js = fs.readFileSync('public/music-player.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const map = JSON.parse(fs.readFileSync('public/music-map.json', 'utf8'));

try { new Function(js); ok(true, 'music-player.js parses'); } catch (e) { ok(false, 'parses: ' + e.message); }
ok(/createGain/.test(js) && /createMediaElementSource/.test(js), 'music routed through GainNode');
ok(!/\.volume\s*=/.test(js), 'no .volume writes (ignored on iOS)');
ok(/music-player\.js/.test(html), 'index.html loads music-player.js');
ok(!/AWS_|SECRET|API_KEY|ACCESS_KEY/.test(js), 'no key names in music-player.js');

// every chapter ch00..ch11 + interlude maps to a defined bucket
const keys = [...Array(12).keys()].map(i => 'ch' + String(i).padStart(2, '0')).concat('interlude');
keys.forEach(k => ok(map.chapters[k] && map.buckets[map.chapters[k]], 'map covers ' + k));

// chapter detection
const g = {}; global.window = g; global.document = { readyState: 'loading', addEventListener() {} };
global.localStorage = {}; new Function('window', 'document', js)(g, global.document);
const d = g.__wrMusic.detectChapter;
ok(d('Chapter 3: The Gate') === 'ch03', 'detect Chapter 3');
ok(d('CH07\nText') === 'ch07', 'detect CH07');
ok(d('Prologue') === 'ch00', 'detect Prologue');
ok(d('Epilogue') === 'ch11', 'detect Epilogue');
ok(d('Interlude II') === 'interlude', 'detect Interlude');
ok(d('plain text') === null, 'unknown -> null');
ok(g.__wrMusic.bucketOf('03-Artist_Album_01_Title.mp3') === '03', 'bucket prefix');

// no audio shipped in public/
const bad = [];
(function walk(p) { for (const f of fs.readdirSync(p)) { const q = path.join(p, f); fs.statSync(q).isDirectory() ? walk(q) : /\.(mp3|flac|wav|m4a|ogg|aac)$/i.test(f) && bad.push(q); } })('public');
ok(bad.length === 0, 'no audio files in public/ ' + bad.join(','));
process.exit(fail ? 1 : 0);
