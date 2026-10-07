// JOB 1 — Polly twins recast (v1.10, by ear),child-safety, reservation, stale-seat clearing.
// Like test_cast_seating_v234.mjs this pulls the REAL methods out of
// public/index.html, but it does NOT stub scoreMatch — the live reservation and
// child-safety guards are exercised against the real matcher. Fake fetch stands
// in for /.netlify/functions/tts-proxy.
import fs from 'fs';

// split on \r?\n so a CRLF (Windows) checkout of index.html doesn't leave a
// trailing \r that would break the closing-brace anchors below.
const src = fs.readFileSync('public/index.html', 'utf-8').split(/\r?\n/);
const slice = (a, b) => src.slice(a - 1, b).join('\n');   // 1-indexed inclusive

// Same ranges as test_cast_seating_v234.mjs (keep both in sync if index moves).
const liveBlock = slice(2295, 2406);          // state + probe + liveness + understudy
const seatBlock = slice(2628, 2818);       // autoCastSpeakers + castSeatingReport

// scoreMatch and failoverChunk extracted by signature, so they survive edits above.
const methodBlock = (sig) => {
  const start = src.findIndex(l => l.includes(sig));
  if (start < 0) throw new Error('method not found: ' + sig);
  let end = start;
  while (!/^            \},$/.test(src[end])) end++;
  return src.slice(start, end + 1).join('\n');
};
const scoreBlock = methodBlock('scoreMatch(attrs, pool, used, reserved) {');
const failBlock = methodBlock('failoverChunk(provider, chunk, status, data) {');

const body = `({
${liveBlock}
${scoreBlock}
${seatBlock}
${failBlock}
  // ---- stubs (scoreMatch is REAL, pulled from index.html above) ----
  providerModels: { elevenlabs: 'eleven_turbo_v2_5', speechify: 'simba-english', polly: 'neural' },
  registryAgeScale: ['child', 'teen', 'young', 'adult', 'senior'],
  castMap: {},
  allVoices: [],
  registry: null,
  NARRATOR: 'Narrator',
  saved: 0,
  statusLines: [],
  castKey(n) { return String(n || '').replace(/\\u2019/g, "'").replace(/\`/g, "'").trim().toUpperCase(); },
  normName(s) { return this.castKey(s); },
  saveCastMap() { this.saved++; },
  updateStatus(s) { this.statusLines.push(s); },
  async loadRegistry() { return this.registry; },
  async loadAllVoices() { return this.allVoices; },
  registryLookup(name) {
    const k = this.castKey(name);
    for (const c of (this.registry || { characters: [] }).characters) {
      const names = [c.name, ...(c.aliases || [])].map(x => this.castKey(x));
      if (names.includes(k)) return c;   // raw char carries .voice, .locked, .age ...
    }
    return null;
  },
  chunkCacheKey() { return 'k' + Math.random(); },
  async audioCacheGet() { return null; },
  audioCachePut() {},
  async ttsAcquire() { return () => {}; },
  async fetchCloudChunk() { return { success: true, audio: 'AAA' }; }
})`;

const app = eval(body);

// ---- environment stubs -------------------------------------------------
const store = {};
globalThis.sessionStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
};

const sp = (id, gender, age, locale) => ({ value: 'speechify||' + id, label: id, name: id, gender, age, locale, provider: 'speechify', voiceId: id });
const po = (id, gender, age, locale) => ({ value: 'polly||' + id, label: id, name: id, gender, age, locale, provider: 'polly', voiceId: id });
const POOL = [
  sp('john-rhys-davies', 'male', 'senior', 'en-GB'),
  sp('linda', 'female', 'child', 'en-US'),     // Lira (locked, reserved)
  sp('alfonso', 'male', 'senior', 'en-GB'),    // the Ch1 elder "Watcher"
  sp('benjamin', 'male', 'adult', 'en-GB'),
  sp('helen', 'female', 'adult', 'en-GB'),
  sp('michael', 'male', 'adult', 'en-GB'),
  sp('archie', 'male', 'adult', 'en-GB'),
  po('Ivy', 'female', 'child', 'en-US'),       // Pip (locked, reserved)
  po('Justin', 'male', 'child', 'en-US'),      // Junia (locked, reserved)
  po('Kevin', 'male', 'child', 'en-US'),       // Ka'el (locked, reserved)
  po('Joanna', 'female', 'adult', 'en-US'),
  po('Matthew', 'male', 'adult', 'en-US'),
  po('Brian', 'male', 'adult', 'en-GB'),
];

let fetchPlan = {};
globalThis.fetch = async (url, opts) => {
  const b = JSON.parse(opts.body);
  const mode = fetchPlan[b.providerId] || 'ok';
  if (mode === 'ok') return { ok: true, status: 200, json: async () => ({ success: true, audio: 'AAA' }) };
  if (mode === 'quota') return { ok: false, status: 401, json: async () => ({ success: false, error: 'quota_exceeded: insufficient credit' }) };
  return { ok: false, status: 401, json: async () => ({ success: false, error: 'API key not configured for provider: ' + b.providerId }) };
};

const reset = (plan) => {
  fetchPlan = plan || {};
  for (const k of Object.keys(store)) delete store[k];
  app.providerLive = null;
  app.castReseated = [];
  app.castMap = {};
  app.allVoices = POOL;
  app.registry = JSON.parse(fs.readFileSync('public/cast-registry.json', 'utf-8'));
  app.statusLines = [];
};

let fails = 0;
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};
const NAR = 'john-rhys-davies';
const seat = (k) => app.castMap[app.castKey(k)] || {};

// Auren (teen, unlocked, voiceless) is score-matched: never a reserved or child voice.
const RESERVED = new Set(['Justin', 'Ivy', 'Kevin', 'linda']);
const aurenOK = (s) => {
  const v = POOL.find(p => p.provider === s.provider && p.voiceId === s.voiceId);
  return !!v && !RESERVED.has(v.voiceId) && v.age !== 'child';
};

// ---- 1. v1.10 recast: twins + Pip seat on their locked Polly voices ---
console.log('\n1. KA\'EL / JUNIA / PIP -> polly Kevin / Justin / Ivy; AUREN score-matched');
reset({});
await app.autoCastSpeakers(['NARRATOR', "KA'EL", 'JUNIA', 'PIP', 'AUREN']);
check("Ka'el -> polly/Kevin", seat("KA'EL").provider === 'polly' && seat("KA'EL").voiceId === 'Kevin', JSON.stringify(seat("KA'EL")));
check('Junia -> polly/Justin', seat('JUNIA').provider === 'polly' && seat('JUNIA').voiceId === 'Justin', JSON.stringify(seat('JUNIA')));
check('Pip -> polly/Ivy (locked seat wins over gender)', seat('PIP').provider === 'polly' && seat('PIP').voiceId === 'Ivy', JSON.stringify(seat('PIP')));
check('Auren score-matched onto a live non-reserved, non-child voice', aurenOK(seat('AUREN')), JSON.stringify(seat('AUREN')));

// ---- 2. THE WATCHER resolves to Auren, not the Ch1 elder --------------
console.log('\n2. THE WATCHER -> Auren\'s row; the elder WATCHER stays on alfonso');
reset({});
await app.autoCastSpeakers(['NARRATOR', 'THE WATCHER', 'WATCHER']);
check('THE WATCHER looks up the Auren row', (app.registryLookup('THE WATCHER') || {}).name === 'Auren');
check('THE WATCHER on a live non-reserved, non-child voice', aurenOK(seat('THE WATCHER')), JSON.stringify(seat('THE WATCHER')));
check("THE WATCHER not on the elder's alfonso", seat('THE WATCHER').voiceId !== 'alfonso', JSON.stringify(seat('THE WATCHER')));
check('elder WATCHER -> speechify/alfonso', seat('WATCHER').provider === 'speechify' && seat('WATCHER').voiceId === 'alfonso', JSON.stringify(seat('WATCHER')));

// ---- 3. Merra reads as Narrator, never an adult voice -----------------
console.log('\n3. MERRA (voiceless child) reads as Narrator');
reset({});
await app.autoCastSpeakers(['NARRATOR', 'MERRA']);
check('Merra -> Narrator voice', seat('MERRA').provider === 'speechify' && seat('MERRA').voiceId === NAR, JSON.stringify(seat('MERRA')));
const notAdultChild = (s) => { const v = POOL.find(p => p.provider === s.provider && p.voiceId === s.voiceId); return !v || (v.age !== 'adult'); };
check('Merra never on an adult voice', notAdultChild(seat('MERRA')));

// ---- 4. reserved voices are never score-matched to a stranger ---------
console.log('\n4. a stranger is score-matched, but never onto Justin / Ivy / Kevin / linda');
reset({});
await app.autoCastSpeakers(['NARRATOR', 'A CHILD STRANGER', 'AN ADULT STRANGER']);
check('adult stranger seated somewhere', !!seat('AN ADULT STRANGER').voiceId);
check('adult stranger not on a reserved voice', !RESERVED.has(seat('AN ADULT STRANGER').voiceId), JSON.stringify(seat('AN ADULT STRANGER')));

// ---- 5. stale 1.9 seats are cleared on load ---------------------------
console.log('\n5. stale 1.9 seats (twins on Justin/Ivy, Auren on Kevin, Pip on Narrator) re-seat to 1.10 canon');
reset({});
app.castMap = {
  "KA'EL": { provider: 'polly', voiceId: 'Justin' },    // 1.9 canon, now Junia's
  JUNIA: { provider: 'polly', voiceId: 'Ivy' },         // 1.9 canon, now Pip's
  AUREN: { provider: 'polly', voiceId: 'Kevin' },       // 1.9 canon, now Ka'el's (Auren is unlocked)
  PIP: { provider: 'speechify', voiceId: NAR },         // read as Narrator under 1.9
};
const rep5 = await app.autoCastSpeakers(['NARRATOR', "KA'EL", 'JUNIA', 'PIP', 'AUREN']);
check("Ka'el cleared off Justin -> polly/Kevin", seat("KA'EL").voiceId === 'Kevin', JSON.stringify(seat("KA'EL")));
check('Junia cleared off Ivy -> polly/Justin', seat('JUNIA').voiceId === 'Justin', JSON.stringify(seat('JUNIA')));
check('Pip cleared off Narrator -> polly/Ivy', seat('PIP').voiceId === 'Ivy', JSON.stringify(seat('PIP')));
check('Auren cleared off reserved Kevin -> live non-reserved voice', aurenOK(seat('AUREN')), JSON.stringify(seat('AUREN')));
check('all four re-seats counted in the report', rep5.reseated === 4, 'reseated=' + rep5.reseated);
const ids5 = ["KA'EL", 'JUNIA', 'PIP', 'AUREN'].map(k => seat(k).provider + '||' + seat(k).voiceId);
check('no two of them share a voice', new Set(ids5).size === 4, ids5.join(', '));

// ---- 6. dark Polly: the Polly children fall to Narrator ---------------
console.log('\n6. Polly out of credit at load — one hop off the dead provider');
reset({ polly: 'quota' });
const rep6 = await app.autoCastSpeakers(['NARRATOR', 'JUNIA', "KA'EL", 'PIP', 'AUREN']);
check('Junia (child) -> Narrator voice', seat('JUNIA').voiceId === NAR, JSON.stringify(seat('JUNIA')));
check("Ka'el (child) -> Narrator voice", seat("KA'EL").voiceId === NAR, JSON.stringify(seat("KA'EL")));
check('Pip (child) -> Narrator voice', seat('PIP').voiceId === NAR, JSON.stringify(seat('PIP')));
check('Auren (teen) on a live non-Polly voice', seat('AUREN').provider !== 'polly' && aurenOK(seat('AUREN')), JSON.stringify(seat('AUREN')));
check('report marks Polly out of credit', rep6.dark.join().includes('POLLY') && rep6.dark.join().includes('out of credit'), rep6.dark.join());

// ---- 7. status line counts Polly seats --------------------------------
console.log('\n7. the seating report counts Polly seats for the status line');
reset({});
const rep7 = await app.autoCastSpeakers(['NARRATOR', "KA'EL", 'JUNIA', 'PIP', 'AUREN']);
check('report shows ×POLLY', /\d×POLLY/.test(rep7.seats), rep7.seats);

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
process.exit(fails ? 1 : 0);
