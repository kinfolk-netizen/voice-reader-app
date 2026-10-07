// JOB 1/2 — Polly twins (v1.10) + Pip/Merra on Azure, Auren on Speechify (v1.12, by ear):
// child-safety, reservation, stale-seat clearing, dark-provider fallbacks.
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
const seatBlock = slice(2628, 2823);       // autoCastSpeakers + castSeatingReport

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
const az = (id, gender, age, locale) => ({ value: 'azure||' + id, label: id, name: id, gender, age, locale, provider: 'azure', voiceId: id });
const POOL = [
  sp('john-rhys-davies', 'male', 'senior', 'en-GB'),
  sp('linda', 'female', 'child', 'en-US'),     // Lira (locked, reserved)
  sp('alfonso', 'male', 'senior', 'en-GB'),    // the Ch1 elder "Watcher"
  sp('benjamin', 'male', 'adult', 'en-GB'),
  sp('helen', 'female', 'adult', 'en-GB'),
  sp('michael', 'male', 'adult', 'en-GB'),
  sp('archie', 'male', 'adult', 'en-GB'),
  sp('joe', 'male', 'young', 'en-US'),         // Auren (locked, reserved)
  po('Ivy', 'female', 'child', 'en-US'),       // back in the pool since 1.12
  po('Justin', 'male', 'child', 'en-US'),      // Junia (locked, reserved)
  po('Kevin', 'male', 'child', 'en-US'),       // Ka'el (locked, reserved)
  po('Joanna', 'female', 'adult', 'en-US'),
  po('Matthew', 'male', 'adult', 'en-US'),
  po('Brian', 'male', 'adult', 'en-GB'),
  az('en-US-AnaNeural', 'female', 'child', 'en-US'),     // Pip (locked, reserved)
  az('en-GB-MaisieNeural', 'female', 'child', 'en-GB'),  // Merra (locked, reserved)
];
// a live young voice off Speechify, for Auren when Speechify is dark
const EL_WILL = { value: 'elevenlabs||will', label: 'Will', name: 'Will', gender: 'male', age: 'young', locale: 'en-US', provider: 'elevenlabs', voiceId: 'will' };

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

// 1.12 reserved set = the locked rows' voices. Ivy is back in the pool.
const RESERVED = new Set(['Justin', 'Kevin', 'linda', 'en-US-AnaNeural', 'en-GB-MaisieNeural', 'joe']);
const is = (k, prov, id) => seat(k).provider === prov && seat(k).voiceId === id;
// Auren off his locked joe: a live non-reserved teen/young voice, never child/adult.
const aurenFallbackOK = (s) => {
  const v = [...POOL, EL_WILL].find(p => p.provider === s.provider && p.voiceId === s.voiceId);
  return !!v && !RESERVED.has(v.voiceId) && ['teen', 'young'].includes(v.age);
};

// ---- 1. 1.12 canon: twins on Polly, Pip on Azure, Auren on Speechify ---
console.log('\n1. KA\'EL / JUNIA -> polly Kevin / Justin; PIP -> azure Ana; AUREN -> speechify joe');
reset({});
await app.autoCastSpeakers(['NARRATOR', "KA'EL", 'JUNIA', 'PIP', 'AUREN']);
check("Ka'el -> polly/Kevin", is("KA'EL", 'polly', 'Kevin'), JSON.stringify(seat("KA'EL")));
check('Junia -> polly/Justin', is('JUNIA', 'polly', 'Justin'), JSON.stringify(seat('JUNIA')));
check('Pip -> azure/en-US-AnaNeural (locked seat wins over gender)', is('PIP', 'azure', 'en-US-AnaNeural'), JSON.stringify(seat('PIP')));
check('Auren -> speechify/joe (locked)', is('AUREN', 'speechify', 'joe'), JSON.stringify(seat('AUREN')));

// ---- 2. THE WATCHER resolves to Auren, not the Ch1 elder --------------
console.log('\n2. THE WATCHER -> Auren\'s row (joe); the elder WATCHER stays on alfonso');
reset({});
await app.autoCastSpeakers(['NARRATOR', 'THE WATCHER', 'WATCHER']);
check('THE WATCHER looks up the Auren row', (app.registryLookup('THE WATCHER') || {}).name === 'Auren');
check('THE WATCHER -> speechify/joe', is('THE WATCHER', 'speechify', 'joe'), JSON.stringify(seat('THE WATCHER')));
check('elder WATCHER -> speechify/alfonso', is('WATCHER', 'speechify', 'alfonso'), JSON.stringify(seat('WATCHER')));

// ---- 3. Merra on her locked Azure voice, never an adult voice ----------
console.log('\n3. MERRA -> azure Maisie');
reset({});
await app.autoCastSpeakers(['NARRATOR', 'MERRA']);
check('Merra -> azure/en-GB-MaisieNeural', is('MERRA', 'azure', 'en-GB-MaisieNeural'), JSON.stringify(seat('MERRA')));
const notAdultChild = (s) => { const v = POOL.find(p => p.provider === s.provider && p.voiceId === s.voiceId); return !v || (v.age !== 'adult'); };
check('Merra never on an adult voice', notAdultChild(seat('MERRA')));

// ---- 4. reserved voices are never score-matched to a stranger ---------
console.log('\n4. a stranger is score-matched, but never onto a reserved canon voice');
reset({});
await app.autoCastSpeakers(['NARRATOR', 'A CHILD STRANGER', 'AN ADULT STRANGER']);
check('adult stranger seated somewhere', !!seat('AN ADULT STRANGER').voiceId);
check('adult stranger not on a reserved voice', !RESERVED.has(seat('AN ADULT STRANGER').voiceId), JSON.stringify(seat('AN ADULT STRANGER')));
check('adult stranger not on the child voice Ivy', seat('AN ADULT STRANGER').voiceId !== 'Ivy', JSON.stringify(seat('AN ADULT STRANGER')));

// ---- 5. stale seats are cleared on load -------------------------------
console.log('\n5. stale seats (1.9 twins, Pip on Ivy, Merra on Narrator, Auren on Kevin) re-seat to 1.12 canon');
reset({});
app.castMap = {
  "KA'EL": { provider: 'polly', voiceId: 'Justin' },    // 1.9 canon, now Junia's
  JUNIA: { provider: 'polly', voiceId: 'Ivy' },         // 1.9 canon
  AUREN: { provider: 'polly', voiceId: 'Kevin' },       // 1.9 canon, now Ka'el's
  PIP: { provider: 'polly', voiceId: 'Ivy' },           // 1.10 canon, now in the pool
  MERRA: { provider: 'speechify', voiceId: NAR },       // read as Narrator under 1.10
};
const rep5 = await app.autoCastSpeakers(['NARRATOR', "KA'EL", 'JUNIA', 'PIP', 'MERRA', 'AUREN']);
check("Ka'el cleared off Justin -> polly/Kevin", is("KA'EL", 'polly', 'Kevin'), JSON.stringify(seat("KA'EL")));
check('Junia cleared off Ivy -> polly/Justin', is('JUNIA', 'polly', 'Justin'), JSON.stringify(seat('JUNIA')));
check('Pip cleared off Ivy -> azure/Ana', is('PIP', 'azure', 'en-US-AnaNeural'), JSON.stringify(seat('PIP')));
check('Merra cleared off Narrator -> azure/Maisie', is('MERRA', 'azure', 'en-GB-MaisieNeural'), JSON.stringify(seat('MERRA')));
check('Auren cleared off Kevin -> speechify/joe', is('AUREN', 'speechify', 'joe'), JSON.stringify(seat('AUREN')));
check('all five re-seats counted in the report', rep5.reseated === 5, 'reseated=' + rep5.reseated);
const ids5 = ["KA'EL", 'JUNIA', 'PIP', 'MERRA', 'AUREN'].map(k => seat(k).provider + '||' + seat(k).voiceId);
check('no two of them share a voice', new Set(ids5).size === 5, ids5.join(', '));

// ---- 6. dark Polly: the Polly children fall to Narrator ---------------
console.log('\n6. Polly out of credit at load — one hop off the dead provider');
reset({ polly: 'quota' });
const rep6 = await app.autoCastSpeakers(['NARRATOR', 'JUNIA', "KA'EL", 'PIP', 'AUREN']);
check('Junia (child) -> Narrator voice', seat('JUNIA').voiceId === NAR, JSON.stringify(seat('JUNIA')));
check("Ka'el (child) -> Narrator voice", seat("KA'EL").voiceId === NAR, JSON.stringify(seat("KA'EL")));
check('Pip (Azure) unaffected -> azure/Ana', is('PIP', 'azure', 'en-US-AnaNeural'), JSON.stringify(seat('PIP')));
check('Auren (Speechify) unaffected -> speechify/joe', is('AUREN', 'speechify', 'joe'), JSON.stringify(seat('AUREN')));
check('report marks Polly out of credit', rep6.dark.join().includes('POLLY') && rep6.dark.join().includes('out of credit'), rep6.dark.join());

// ---- 7. dark Azure: Pip and Merra fall to Narrator --------------------
console.log('\n7. Azure dark — Pip and Merra read as Narrator, never another voice');
reset({ azure: 'key' });
const rep7a = await app.autoCastSpeakers(['NARRATOR', 'PIP', 'MERRA', "KA'EL"]);
check('Pip (child) -> Narrator voice', seat('PIP').voiceId === NAR, JSON.stringify(seat('PIP')));
check('Merra (child) -> Narrator voice', seat('MERRA').voiceId === NAR, JSON.stringify(seat('MERRA')));
check("Ka'el (Polly) unaffected", is("KA'EL", 'polly', 'Kevin'), JSON.stringify(seat("KA'EL")));
check('report marks Azure dark', rep7a.dark.join().includes('AZ'), rep7a.dark.join());

// ---- 8. dark Speechify: Auren to a live young/teen voice or Narrator ---
console.log('\n8. Speechify dark — Auren (teen) to a live non-reserved teen/young voice, else Narrator');
reset({ speechify: 'key' });
app.allVoices = [...POOL, EL_WILL];
await app.autoCastSpeakers(['NARRATOR', 'AUREN', 'THE WATCHER']);
check('Auren -> live young elevenlabs Will', aurenFallbackOK(seat('AUREN')) && seat('AUREN').provider !== 'speechify', JSON.stringify(seat('AUREN')));
check('THE WATCHER never on an adult or child voice', aurenFallbackOK(seat('THE WATCHER')) || seat('THE WATCHER').voiceId === seat('NARRATOR').voiceId, JSON.stringify(seat('THE WATCHER')));
reset({ speechify: 'key' });
await app.autoCastSpeakers(['NARRATOR', 'AUREN']);
check('no live teen/young voice: Auren -> re-seated Narrator, not adult Matthew/Brian',
  seat('AUREN').voiceId === seat('NARRATOR').voiceId && seat('NARRATOR').provider !== 'speechify', JSON.stringify(seat('AUREN')) + ' nar=' + JSON.stringify(seat('NARRATOR')));
check('Auren never on Ivy (child) or a reserved voice', seat('AUREN').voiceId !== 'Ivy' && !RESERVED.has(seat('AUREN').voiceId), JSON.stringify(seat('AUREN')));

// ---- 9. status line counts Polly + Azure seats ------------------------
console.log('\n9. the seating report counts Polly and Azure seats for the status line');
reset({});
const rep9 = await app.autoCastSpeakers(['NARRATOR', "KA'EL", 'JUNIA', 'PIP', 'AUREN']);
check('report shows ×POLLY', /\d×POLLY/.test(rep9.seats), rep9.seats);
check('report shows ×AZ', /\d×AZ/.test(rep9.seats), rep9.seats);

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
process.exit(fails ? 1 : 0);
