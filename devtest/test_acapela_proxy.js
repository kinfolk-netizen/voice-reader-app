// JOB 2 — Acapela Cloud proxy adapter (offline).
// Mocks global fetch so the proxy logic (login -> token, Token auth header,
// cached token, re-login once on 401, base64 mp3, 3000-char chunking, missing
// creds -> 401) is exercised with no network call. Also checks the get-voices
// fallback list and scans public/ to prove no ACAPELA_ name ships.

// fake creds (never real secrets)
process.env.ACAPELA_EMAIL = 'test@example.invalid';
process.env.ACAPELA_PASSWORD = 'test_password_fake';

const MP3 = Buffer.from([0x49, 0x44, 0x33]);
let calls = [];
let tokenSeq = 0;
let validToken = null;      // the token the fake server currently accepts
let accountVoices = ['Harry22k_NT', 'Rosie22k_NT'];
let accountFails = false;

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const auth = (opts.headers && opts.headers['Authorization']) || '';
  calls.push({ path: u.pathname, method: opts.method || 'GET', auth, body: opts.body });
  const json = (status, obj) => ({
    ok: status >= 200 && status < 300, status, statusText: 'S' + status,
    headers: { get: () => 'application/json' },
    json: async () => obj, text: async () => JSON.stringify(obj)
  });
  if (u.pathname === '/api/login/') {
    const b = JSON.parse(opts.body);
    if (b.email !== 'test@example.invalid' || b.password !== 'test_password_fake') return json(400, { error: 'bad creds' });
    validToken = 'tok' + (++tokenSeq);
    return json(200, { token: validToken });
  }
  if (auth !== 'Token ' + validToken) return json(401, { detail: 'Invalid token.' });
  if (u.pathname === '/api/account/') {
    if (accountFails) return json(500, {});
    return json(200, { email: 'x', voices: accountVoices, credits: 10 });
  }
  if (u.pathname === '/api/command/') {
    return {
      ok: true, status: 200, statusText: 'OK',
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => MP3.buffer.slice(MP3.byteOffset, MP3.byteOffset + MP3.length)
    };
  }
  return json(404, {});
};

const proxy = require('../api/tts-proxy.js');
const call = (text, voice) => proxy.handler({ httpMethod: 'POST', body: JSON.stringify({ providerId: 'acapela', text, voice }) });

let fails = 0;
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};

(async () => {
  // ---- 1. login -> token -> synth -> base64 ----------------------------
  console.log('\n1. Acapela logs in and synthesizes via the proxy');
  calls = [];
  let res = await call('Lamps up.', 'Harry22k_NT');
  let body = JSON.parse(res.body);
  check('200 OK', res.statusCode === 200, 'status=' + res.statusCode + ' ' + (body.error || ''));
  check('success, provider acapela', body.success === true && body.provider === 'acapela');
  check('audio returned as base64 mp3', body.audio === MP3.toString('base64'), body.audio);
  check('first call is POST /api/login/', calls[0].path === '/api/login/' && calls[0].method === 'POST');
  const cmd = calls.find(c => c.path === '/api/command/');
  check("synth sends 'Authorization: Token <token>'", cmd && cmd.auth === 'Token tok1', cmd && cmd.auth);
  const params = new URLSearchParams(cmd.body);
  check('synth params voice/text/type=mp3/output=file',
    params.get('voice') === 'Harry22k_NT' && params.get('text') === 'Lamps up.' && params.get('type') === 'mp3' && params.get('output') === 'file',
    cmd.body);

  // ---- 2. token cached in module scope ---------------------------------
  console.log('\n2. token is cached between calls');
  calls = [];
  await call('Again.', 'Harry22k_NT');
  check('no second login', !calls.some(c => c.path === '/api/login/'), calls.map(c => c.path).join(','));

  // ---- 3. 401 -> re-login once -> retry --------------------------------
  console.log('\n3. a revoked token re-logs in once');
  validToken = 'revoked-server-side';
  calls = [];
  res = await call('Once more.', 'Harry22k_NT');
  check('200 after re-login', res.statusCode === 200, 'status=' + res.statusCode);
  check('exactly one re-login', calls.filter(c => c.path === '/api/login/').length === 1, calls.map(c => c.path).join(','));
  check('retry used the new token', calls[calls.length - 1].auth === 'Token ' + validToken);

  // ---- 4. bare-name voice resolved via /api/account/ -------------------
  console.log('\n4. a fallback bare name ("Rosie") resolves to the account id');
  calls = [];
  await call('Hello.', 'Rosie');
  const cmd4 = calls.find(c => c.path === '/api/command/');
  check('account voice list consulted', calls.some(c => c.path === '/api/account/'));
  check('Rosie -> Rosie22k_NT', new URLSearchParams(cmd4.body).get('voice') === 'Rosie22k_NT', cmd4.body);

  // ---- 5. 3000-char limit: chunked, mp3 concatenated -------------------
  console.log('\n5. text over 3000 chars is chunked at sentence boundaries');
  const long = ('This is one sentence of the scene. ').repeat(200);   // ~7000 chars
  calls = [];
  res = await call(long, 'Harry22k_NT');
  body = JSON.parse(res.body);
  const synths = calls.filter(c => c.path === '/api/command/');
  check('split into 3 requests', synths.length === 3, synths.length + ' request(s)');
  check('every piece <= 3000 chars', synths.every(c => new URLSearchParams(c.body).get('text').length <= 3000));
  check('pieces end on a sentence', synths.slice(0, -1).every(c => new URLSearchParams(c.body).get('text').endsWith('.')));
  check('audio is the concatenated mp3', body.audio === Buffer.concat([MP3, MP3, MP3]).toString('base64'));

  // ---- 6. missing creds -> 401, no network -----------------------------
  console.log('\n6. missing credentials');
  delete process.env.ACAPELA_EMAIL;
  calls = [];
  res = await call('x', 'Harry22k_NT');
  check('missing ACAPELA_EMAIL -> 401 not configured', res.statusCode === 401 && /not configured/.test(JSON.parse(res.body).error), res.body);
  process.env.ACAPELA_EMAIL = 'test@example.invalid';
  delete process.env.ACAPELA_PASSWORD;
  res = await call('x', 'Harry22k_NT');
  check('missing ACAPELA_PASSWORD -> 401 not configured', res.statusCode === 401 && /not configured/.test(JSON.parse(res.body).error), res.body);
  check('no network call without creds', calls.length === 0, calls.length + ' call(s)');

  // ---- 7. wrong password -> 401 (reader marks Acapela dark) ------------
  console.log('\n7. rejected login');
  process.env.ACAPELA_PASSWORD = 'wrong_fake';
  proxy._acapelaResetToken();
  res = await call('x', 'Harry22k_NT');
  check('rejected login -> 401', res.statusCode === 401, 'status=' + res.statusCode);
  process.env.ACAPELA_PASSWORD = 'test_password_fake';

  // ---- 8. get-voices: account list, then static fallback ---------------
  console.log('\n8. get-voices acapela');
  const voicesApi = require('../api/get-voices.js');
  const list = async () => JSON.parse((await voicesApi.handler({ httpMethod: 'GET', queryStringParameters: { providerId: 'acapela' } })).body);
  let vb = await list();
  check('live account list used', vb.voices.length === 2 && vb.voices[0].id === 'Harry22k_NT', vb.voices.map(v => v.id).join(','));
  check('Harry tagged child male en-GB', vb.voices[0].age === 'child' && vb.voices[0].gender === 'male' && vb.voices[0].locale === 'en-GB');
  accountVoices = ['Harry22k_NT', 'Graham22k_NT'];
  vb = await list();
  check('unknown account voice treated as adult (never seats a child)', vb.voices.find(v => v.name === 'Graham').age === 'adult');
  accountFails = true;
  vb = await list();
  const names = vb.voices.map(v => v.name);
  const EXPECT = ['Harry', 'Arthur', 'Caleb', 'Archie', 'Liam', 'Rosie', 'Amelia', 'Chloe', 'Amy', 'Emilio', 'Ella'];
  check('account failure -> static fallback of 11 kids', EXPECT.every(n => names.includes(n)) && names.length === 11, names.join(','));
  check('fallback all age child', vb.voices.every(v => v.age === 'child'));
  delete process.env.ACAPELA_EMAIL;
  vb = await list();
  check('no creds -> static fallback', vb.voices.length === 11);
  process.env.ACAPELA_EMAIL = 'test@example.invalid';
  const archie = vb.voices.find(v => v.name === 'Archie');
  check("Archie's label names the provider (vs Speechify's archie)", /Acapela/.test(archie.label) && /Scottish/.test(archie.label), archie.label);
  check('Amy is Northern, Liam Australian, Emilio/Ella US',
    /Northern/.test(vb.voices.find(v => v.name === 'Amy').label) && vb.voices.find(v => v.name === 'Liam').locale === 'en-AU'
    && vb.voices.find(v => v.name === 'Emilio').locale === 'en-US' && vb.voices.find(v => v.name === 'Ella').gender === 'female');

  // ---- 9. no ACAPELA_ names (or the fake creds) under public/ ----------
  console.log('\n9. no Acapela credential name appears in any file under public/');
  const fs = require('fs'); const p = require('path');
  const NEEDLES = ['ACAPELA_', 'test_password_fake', 'test@example.invalid', 'acapela-cloud.com/api/login'];
  const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.json', '.css', '.svg', '.txt', '.md']);
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = p.join(dir, e.name);
      if (e.isDirectory()) { walk(fp); continue; }
      if (!TEXT_EXT.has(p.extname(e.name).toLowerCase())) continue;
      const t = fs.readFileSync(fp, 'utf-8');
      for (const n of NEEDLES) if (t.includes(n)) hits.push(e.name + ' :: ' + n);
    }
  };
  walk(p.join(__dirname, '..', 'public'));
  check('no ACAPELA_ names under public/', hits.length === 0, hits.join(', '));

  console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
  process.exit(fails ? 1 : 0);
})();
