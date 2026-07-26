// v2.34 Live Cast Seating — offline harness.
// Extracts the real methods out of public/index.html by line range and runs
// them against a stubbed app, so the seating logic is exercised without a
// browser. Fake fetch stands in for /.netlify/functions/tts-proxy.
import fs from 'fs';

const src = fs.readFileSync('public/index.html', 'utf-8').split('\n');
const slice = (a, b) => src.slice(a - 1, b).join('\n');   // 1-indexed inclusive

const liveBlock = slice(2286, 2397);          // state + probe + liveness + understudy
const seatBlock = slice(2610, 2706);          // autoCastSpeakers + castSeatingReport
const failStart = src.findIndex(l => l.includes('failoverChunk(provider, chunk, status, data) {')) + 1;
let failEnd = failStart;
while (!/^            \},$/.test(src[failEnd - 1])) failEnd++;
const failBlock = slice(failStart, failEnd);

const body = `({
${liveBlock}
${seatBlock}
${failBlock}
  // ---- stubs ----
  providerModels: { elevenlabs: 'eleven_turbo_v2_5', speechify: 'simba-english' },
  castMap: {},
  allVoices: [],
  registry: null,
  saved: 0,
  statusLines: [],
  castKey(n) { return String(n || '').replace(/\\u2019/g, "'").trim().toUpperCase(); },
  normName(s) { return this.castKey(s); },
  saveCastMap() { this.saved++; },
  updateStatus(s) { this.statusLines.push(s); },
  async loadRegistry() { return this.registry; },
  async loadAllVoices() { return this.allVoices; },
  registryLookup(name) {
    const k = this.castKey(name);
    for (const c of (this.registry || { characters: [] }).characters) {
      const names = [c.name, ...(c.aliases || [])].map(x => this.castKey(x));
      if (names.includes(k)) return c;
    }
    return null;
  },
  scoreMatch(attrs, pool, used) {
    for (const v of pool) if (!used.has(v.provider + '||' + v.voiceId)) return v;
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
const EL = [
  ['pFZP5JQG7iQjIQuC4Bku', 'Lily'], ['IKne3meq5aSn9XLyUdCD', 'Charlie'],
  ['SAz9YHcvj6GT2YYXdXww', 'River'], ['CwhRBWXzGAHq8TQ4Fs17', 'Roger'],
  ['N2lVS1w4EtoT3dr4eOWO', 'Callum'], ['pqHfZKP75CvOlQylNhV4', 'Bill'],
  ['nPczCjzI2devNBz1zQrb', 'Brian'], ['5M1W9IgOqnGaZnqjhACC', 'Jon Mark'],
  ['cgSgspJ2msm6clMCkdW9', 'Jessica'], ['JBFqnCBsd6RMkjVDRZzb', 'George'],
];
// the bench understudies, plus every Speechify voice the saga registry names,
// so the pool reflects what the real account actually returns
const registryJson = JSON.parse(fs.readFileSync('public/cast-registry.json', 'utf-8'));
const SPX = [...new Set([
  'douglas', 'lorne', 'mason', 'alec', 'oliver', 'collin', 'hugh_32', 'george', 'kara',
  ...registryJson.characters.filter(c => c.voice.provider === 'speechify').map(c => c.voice.voiceId),
])];
const fullPool = [
  ...EL.map(([id, name]) => ({ value: 'elevenlabs||' + id, label: name, name, gender: 'male', age: 'adult', locale: 'en-US', provider: 'elevenlabs', voiceId: id })),
  ...SPX.map(id => ({ value: 'speechify||' + id, label: id, name: id, gender: 'male', age: 'adult', locale: 'en-US', provider: 'speechify', voiceId: id })),
];

const PANEL = ['THE KEEPER', 'THE CONDUCTOR', 'DJ SCORES', 'GIDEON', 'COLE', 'AMOS',
               'THE WITNESS TONE', "THE AUTHOR'S SEAT", 'MAREN'];

let fetchPlan = {};   // provider -> 'ok' | 'quota' | 'key'
globalThis.fetch = async (url, opts) => {
  const b = JSON.parse(opts.body);
  const mode = fetchPlan[b.providerId] || 'ok';
  if (mode === 'ok') return { ok: true, status: 200, json: async () => ({ success: true, audio: 'AAA' }) };
  if (mode === 'quota') return { ok: false, status: 401, json: async () => ({ success: false, error: 'quota_exceeded: insufficient credit' }) };
  return { ok: false, status: 401, json: async () => ({ success: false, error: 'API key not configured for provider: ' + b.providerId }) };
};

const reset = (plan) => {
  fetchPlan = plan;
  for (const k of Object.keys(store)) delete store[k];
  app.providerLive = null;
  app.castReseated = [];
  app.castMap = {};
  app.allVoices = fullPool;
  app.registry = JSON.parse(fs.readFileSync('public/cast-registry.json', 'utf-8'));
  app.statusLines = [];
};

let fails = 0;
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};

// ---- 1. both providers live -------------------------------------------
console.log('\n1. both providers live — panel should seat all ElevenLabs');
reset({});
let rep = await app.autoCastSpeakers(PANEL);
check('9 chairs seated', Object.keys(app.castMap).length === 9);
check('all on elevenlabs', PANEL.every(s => app.castMap[s].provider === 'elevenlabs'), rep.seats);
check('Keeper on canon Lily', app.castMap['THE KEEPER'].voiceId === 'pFZP5JQG7iQjIQuC4Bku');
check('no dark providers', rep.dark.length === 0);
check('9 distinct voices', new Set(PANEL.map(s => app.castMap[s].voiceId)).size === 9);

// ---- 2. ElevenLabs out of credit --------------------------------------
console.log('\n2. ElevenLabs out of credit — should fall to the Speechify bench');
reset({ elevenlabs: 'quota' });
rep = await app.autoCastSpeakers(PANEL);
check('all on speechify', PANEL.every(s => app.castMap[s].provider === 'speechify'), rep.seats);
check('reports 11L out of credit', rep.dark.join().includes('out of credit'), rep.dark.join());
check('9 distinct understudies', new Set(PANEL.map(s => app.castMap[s].voiceId)).size === 9);
check('Keeper -> douglas', app.castMap['THE KEEPER'].voiceId === 'douglas');

// ---- 3. reconcile: a chair stuck on a dead voice -----------------------
console.log('\n3. chair already seated on a dead ElevenLabs voice');
reset({ elevenlabs: 'quota' });
app.castMap = { 'THE KEEPER': { provider: 'elevenlabs', voiceId: 'pFZP5JQG7iQjIQuC4Bku' } };
rep = await app.autoCastSpeakers(PANEL);
check('Keeper re-seated off the dark provider', app.castMap['THE KEEPER'].provider === 'speechify');
check('re-seat counted in the report', rep.reseated === 1, 'reseated=' + rep.reseated);

// ---- 4. reconcile: voice deleted from the account ----------------------
console.log('\n4. chair seated on a voice no longer on the account');
reset({});
app.castMap = { COLE: { provider: 'elevenlabs', voiceId: 'DELETED_VOICE_ID' } };
rep = await app.autoCastSpeakers(PANEL);
check('Cole moved off the missing voice', app.castMap.COLE.voiceId !== 'DELETED_VOICE_ID');
check('Cole back on his canon Callum', app.castMap.COLE.voiceId === 'N2lVS1w4EtoT3dr4eOWO');

// ---- 5. an already-good seat is left alone -----------------------------
console.log('\n5. an already-correct seat is not churned');
reset({});
app.castMap = { AMOS: { provider: 'elevenlabs', voiceId: 'pqHfZKP75CvOlQylNhV4' } };
rep = await app.autoCastSpeakers(PANEL);
check('Amos untouched', app.castMap.AMOS.voiceId === 'pqHfZKP75CvOlQylNhV4');
check('nothing re-seated', rep.reseated === 0);

// ---- 6. saga characters still get their registry voices ---------------
console.log('\n6. a saga script — registry voices, no bench interference');
reset({});
const saga = ['NARRATOR', 'JUNIA', "KA'EL", 'MAREN'];
rep = await app.autoCastSpeakers(saga);
check('Narrator -> john-rhys-davies', app.castMap.NARRATOR.voiceId === 'john-rhys-davies');
check("Ka'el -> rory (apostrophe key survives)", app.castMap["KA'EL"].voiceId === 'rory');
check('Maren still gets her panel bench voice', app.castMap.MAREN.voiceId === 'cgSgspJ2msm6clMCkdW9');

// ---- 7. unknown speaker gets score-matched, never left blank ----------
console.log('\n7. an unknown speaker');
reset({});
rep = await app.autoCastSpeakers(['THE KEEPER', 'SOMEBODY NEW']);
check('unknown speaker seated anyway', !!(app.castMap['SOMEBODY NEW'] || {}).voiceId);
check("does not steal the Keeper's voice",
  app.castMap['SOMEBODY NEW'].voiceId !== app.castMap['THE KEEPER'].voiceId);

// ---- 8. mid-session failover ------------------------------------------
console.log('\n8. provider dies mid-session — failoverChunk');
reset({});
await app.autoCastSpeakers(PANEL);
const alt = app.failoverChunk('elevenlabs',
  { text: 'Lamps up.', speaker: 'THE KEEPER', provider: 'elevenlabs', voice: 'pFZP5JQG7iQjIQuC4Bku' },
  401, { error: 'quota_exceeded' });
check('failover returned a substitute', !!alt);
check('substitute is on speechify', alt && alt.provider === 'speechify', alt && alt.chunk.voice);
check('castMap re-seated for later chunks', app.castMap['THE KEEPER'].provider === 'speechify');
check('provider marked dark', app.providerLive.elevenlabs.ok === false, app.providerLive.elevenlabs.reason);
const alt2 = app.failoverChunk('speechify', alt.chunk, 401, { error: 'quota_exceeded' });
check('only one hop — no infinite failover', alt2 === null);

// ---- 9. probe is cached, not repeated --------------------------------
console.log('\n9. the probe costs 9 characters once per provider per tab');
reset({});
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { calls++; return realFetch(u, o); };
await app.autoCastSpeakers(PANEL);
const first = calls;
app.providerLive = null;                    // new page-load, same tab
await app.autoCastSpeakers(PANEL);
check('probes on first load', first > 0, first + ' request(s)');
check('sessionStorage suppresses the second round', calls === first, calls + ' total');
globalThis.fetch = realFetch;

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
process.exit(fails ? 1 : 0);
