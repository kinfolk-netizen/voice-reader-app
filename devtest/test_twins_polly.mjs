// JOB 1 — Polly twins recast, child-safety, reservation, stale-seat clearing.
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
const liveBlock = slice(2289, 2400);          // state + probe + liveness + understudy
const seatBlock = slice(2622, 2760);          // autoCastSpeakers + castSeatingReport

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
  sp('archie', 'male', 'adult', 'en-GB'),      // returns to the pool; a stale Auren seat
  po('Ivy', 'female', 'child', 'en-US'),
  po('Justin', 'male', 'child', 'en-US'),
  po('Kevin', 'male', 'child', 'en-US'),
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

// ---- 1. twins + Auren seat on their locked Polly voices ---------------
console.log('\n1. KA\'EL / JUNIA / AUREN -> polly Justin / Ivy / Kevin');
reset({});
await app.autoCastSpeakers(['NARRATOR', "KA'EL", 'JUNIA', 'AUREN']);
check("Ka'el -> polly/Justin", seat("KA'EL").provider === 'polly' && seat("KA'EL").voiceId === 'Justin', JSON.stringify(seat("KA'EL")));
check('Junia -> polly/Ivy', seat('JUNIA').provider === 'polly' && seat('JUNIA').voiceId === 'Ivy', JSON.stringify(seat('JUNIA')));
check('Auren -> polly/Kevin', seat('AUREN').provider === 'polly' && seat('AUREN').voiceId === 'Kevin', JSON.stringify(seat('AUREN')));

// ---- 2. THE WATCHER resolves to Auren, not the Ch1 elder --------------
console.log('\n2. THE WATCHER -> Auren (polly/Kevin); the elder WATCHER stays on alfonso');
reset({});
await app.autoCastSpeakers(['NARRATOR', 'THE WATCHER', 'WATCHER']);
check('THE WATCHER -> polly/Kevin (Auren)', seat('THE WATCHER').provider === 'polly' && seat('THE WATCHER').voiceId === 'Kevin', JSON.stringify(seat('THE WATCHER')));
check('elder WATCHER -> speechify/alfonso', seat('WATCHER').provider === 'speechify' && seat('WATCHER').voiceId === 'alfonso', JSON.stringify(seat('WATCHER')));

// ---- 3. Pip & Merra read as Narrator, never an adult voice ------------
console.log('\n3. PIP & MERRA (voiceless children) read as Narrator');
reset({});
await app.autoCastSpeakers(['NARRATOR', 'PIP', 'MERRA']);
check('Pip -> Narrator voice', seat('PIP').provider === 'speechify' && seat('PIP').voiceId === NAR, JSON.stringify(seat('PIP')));
check('Merra -> Narrator voice', seat('MERRA').provider === 'speechify' && seat('MERRA').voiceId === NAR, JSON.stringify(seat('MERRA')));
const notAdultChild = (s) => { const v = POOL.find(p => p.provider === s.provider && p.voiceId === s.voiceId); return !v || (v.age !== 'adult'); };
check('Pip never on an adult voice', notAdultChild(seat('PIP')));
check('Merra never on an adult voice', notAdultChild(seat('MERRA')));

// ---- 4. reserved voices are never score-matched to a stranger ---------
console.log('\n4. a stranger is score-matched, but never onto Justin / Ivy / Kevin / linda');
reset({});
await app.autoCastSpeakers(['NARRATOR', 'A CHILD STRANGER', 'AN ADULT STRANGER']);
const reservedIds = new Set(['Justin', 'Ivy', 'Kevin', 'linda']);
check('adult stranger seated somewhere', !!seat('AN ADULT STRANGER').voiceId);
check('adult stranger not on a reserved voice', !reservedIds.has(seat('AN ADULT STRANGER').voiceId), JSON.stringify(seat('AN ADULT STRANGER')));

// ---- 5. stale saved seats (evie/rory/archie) are cleared on load ------
console.log('\n5. stale seats on the twins (rory) and Auren (archie) are re-seated to canon');
reset({});
app.castMap = {
  "KA'EL": { provider: 'speechify', voiceId: 'rory' },   // gone for good — not in the pool
  AUREN: { provider: 'speechify', voiceId: 'archie' },   // archie is live again, but not Auren's
};
const rep5 = await app.autoCastSpeakers(['NARRATOR', "KA'EL", 'AUREN']);
check("Ka'el cleared off rory -> polly/Justin", seat("KA'EL").voiceId === 'Justin', JSON.stringify(seat("KA'EL")));
check('Auren cleared off archie -> polly/Kevin', seat('AUREN').voiceId === 'Kevin', JSON.stringify(seat('AUREN')));
check('both re-seats counted in the report', rep5.reseated === 2, 'reseated=' + rep5.reseated);

// ---- 6. dark Polly: the twins fall to Narrator, Auren to a backup -----
console.log('\n6. Polly out of credit at load — one hop off the dead provider');
reset({ polly: 'quota' });
const rep6 = await app.autoCastSpeakers(['NARRATOR', 'JUNIA', "KA'EL", 'AUREN']);
check('Junia (child) -> Narrator voice', seat('JUNIA').voiceId === NAR, JSON.stringify(seat('JUNIA')));
check("Ka'el (child) -> Narrator voice", seat("KA'EL").voiceId === NAR, JSON.stringify(seat("KA'EL")));
check('Auren (teen) off dead Polly onto a live voice', seat('AUREN').provider !== 'polly' && !!seat('AUREN').voiceId, JSON.stringify(seat('AUREN')));
check('report marks Polly out of credit', rep6.dark.join().includes('POLLY') && rep6.dark.join().includes('out of credit'), rep6.dark.join());

// ---- 7. status line counts Polly seats --------------------------------
console.log('\n7. the seating report counts Polly seats for the status line');
reset({});
const rep7 = await app.autoCastSpeakers(['NARRATOR', "KA'EL", 'JUNIA', 'AUREN']);
check('report shows ×POLLY', /\d×POLLY/.test(rep7.seats), rep7.seats);

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
process.exit(fails ? 1 : 0);
