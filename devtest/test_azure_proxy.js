// Azure Speech proxy adapter (offline).
// Mocks global fetch so the proxy logic (SSML body, headers, base64 mp3,
// SSML pass-through, missing key/region -> 401) is exercised with no network
// call. Also checks the get-voices live list + static fallback and scans
// public/ to prove no AZURE_ name ships.

// fake creds (never real secrets)
process.env.AZURE_SPEECH_KEY = 'test_azure_key_fake';
process.env.AZURE_SPEECH_REGION = 'testregion';

const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04]);
let calls = [];
let listFails = false;

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  calls.push({ host: u.host, path: u.pathname, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
  if ((opts.headers || {})['Ocp-Apim-Subscription-Key'] !== 'test_azure_key_fake') {
    return { ok: false, status: 401, statusText: 'Unauthorized', headers: { get: () => 'text/plain' }, text: async () => 'bad key' };
  }
  if (u.pathname === '/cognitiveservices/v1') {
    return {
      ok: true, status: 200, statusText: 'OK',
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => MP3.buffer.slice(MP3.byteOffset, MP3.byteOffset + MP3.length)
    };
  }
  if (u.pathname === '/cognitiveservices/voices/list') {
    if (listFails) return { ok: false, status: 500, statusText: 'S500', json: async () => ({}) };
    return {
      ok: true, status: 200,
      json: async () => [
        { ShortName: 'en-GB-MaisieNeural', DisplayName: 'Maisie', Gender: 'Female', Locale: 'en-GB' },
        { ShortName: 'en-US-AnaNeural', DisplayName: 'Ana', Gender: 'Female', Locale: 'en-US' },
        { ShortName: 'en-US-JennyNeural', DisplayName: 'Jenny', Gender: 'Female', Locale: 'en-US' },
        { ShortName: 'en-AU-NatashaNeural', DisplayName: 'Natasha', Gender: 'Female', Locale: 'en-AU' },
        { ShortName: 'fr-FR-DeniseNeural', DisplayName: 'Denise', Gender: 'Female', Locale: 'fr-FR' }
      ]
    };
  }
  return { ok: false, status: 404, statusText: 'S404', text: async () => '' };
};

const proxy = require('../api/tts-proxy.js');
const call = (text, voice) => proxy.handler({ httpMethod: 'POST', body: JSON.stringify({ providerId: 'azure', text, voice }) });

let fails = 0;
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};

(async () => {
  // ---- 1. SSML body, headers, base64 out --------------------------------
  console.log('\n1. Azure synthesizes via the proxy');
  calls = [];
  let res = await call(`Merra's "lamp" & <the> sea.`, 'en-GB-MaisieNeural');
  let body = JSON.parse(res.body);
  check('200 OK', res.statusCode === 200, 'status=' + res.statusCode + ' ' + (body.error || ''));
  check('success, provider azure, same response shape', body.success === true && body.provider === 'azure'
    && body.voice === 'en-GB-MaisieNeural' && 'speechMarks' in body && body.format === 'mp3');
  check('audio returned as base64 mp3', body.audio === MP3.toString('base64'), body.audio);
  const c = calls[0];
  check('POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1',
    calls.length === 1 && c.method === 'POST' && c.host === 'testregion.tts.speech.microsoft.com' && c.path === '/cognitiveservices/v1',
    c && (c.host + c.path));
  check('Ocp-Apim-Subscription-Key header', c.headers['Ocp-Apim-Subscription-Key'] === 'test_azure_key_fake');
  check('Content-Type application/ssml+xml', c.headers['Content-Type'] === 'application/ssml+xml');
  check('X-Microsoft-OutputFormat audio-24khz-48kbitrate-mono-mp3', c.headers['X-Microsoft-OutputFormat'] === 'audio-24khz-48kbitrate-mono-mp3');
  check('User-Agent witness-reader', c.headers['User-Agent'] === 'witness-reader');
  check('SSML body: locale from voice, voice name, XML-escaped text',
    c.body === `<speak version='1.0' xml:lang='en-GB'><voice name='en-GB-MaisieNeural'>Merra&apos;s &quot;lamp&quot; &amp; &lt;the&gt; sea.</voice></speak>`,
    c.body);

  calls = [];
  await call('Hello.', 'en-US-AnaNeural');
  check('en-US voice -> xml:lang en-US', calls[0].body === `<speak version='1.0' xml:lang='en-US'><voice name='en-US-AnaNeural'>Hello.</voice></speak>`, calls[0].body);

  // ---- 2. SSML passes through -------------------------------------------
  console.log('\n2. text that is already SSML is passed through');
  const ssml = `<speak version='1.0' xml:lang='en-GB'><voice name='en-GB-MaisieNeural'>Hi<break time='300ms'/>there</voice></speak>`;
  calls = [];
  await call(ssml, 'en-GB-MaisieNeural');
  check('body is the caller SSML, untouched', calls[0].body === ssml, calls[0].body);

  // ---- 3. provider error is surfaced ------------------------------------
  console.log('\n3. a rejected key surfaces the provider status');
  process.env.AZURE_SPEECH_KEY = 'wrong_fake';
  res = await call('x', 'en-US-AnaNeural');
  check('rejected key -> 401', res.statusCode === 401, 'status=' + res.statusCode);
  process.env.AZURE_SPEECH_KEY = 'test_azure_key_fake';

  // ---- 4. missing key / region -> 401, no network -----------------------
  console.log('\n4. missing credentials');
  calls = [];
  delete process.env.AZURE_SPEECH_KEY;
  res = await call('x', 'en-US-AnaNeural');
  check('missing AZURE_SPEECH_KEY -> 401 not configured', res.statusCode === 401 && /not configured/.test(JSON.parse(res.body).error), res.body);
  process.env.AZURE_SPEECH_KEY = 'test_azure_key_fake';
  delete process.env.AZURE_SPEECH_REGION;
  res = await call('x', 'en-US-AnaNeural');
  check('missing AZURE_SPEECH_REGION -> 401 not configured', res.statusCode === 401 && /not configured/.test(JSON.parse(res.body).error), res.body);
  check('no network call without creds', calls.length === 0, calls.length + ' call(s)');
  process.env.AZURE_SPEECH_REGION = 'testregion';

  // ---- 5. get-voices: live list, then static fallback -------------------
  console.log('\n5. get-voices azure');
  const voicesApi = require('../api/get-voices.js');
  const list = async () => JSON.parse((await voicesApi.handler({ httpMethod: 'GET', queryStringParameters: { providerId: 'azure' } })).body);
  calls = [];
  let vb = await list();
  check('voices/list called with the key', calls.some(x => x.path === '/cognitiveservices/voices/list' && x.headers['Ocp-Apim-Subscription-Key'] === 'test_azure_key_fake'));
  check('only en-GB / en-US kept', vb.voices.map(v => v.id).join(',') === 'en-GB-MaisieNeural,en-US-AnaNeural,en-US-JennyNeural', vb.voices.map(v => v.id).join(','));
  const by = id => vb.voices.find(v => v.id === id);
  check('Maisie: child female en-GB, name from DisplayName', by('en-GB-MaisieNeural').age === 'child' && by('en-GB-MaisieNeural').gender === 'female'
    && by('en-GB-MaisieNeural').locale === 'en-GB' && by('en-GB-MaisieNeural').name === 'Maisie');
  check('Ana: child', by('en-US-AnaNeural').age === 'child');
  check('Jenny: adult (never seats a child)', by('en-US-JennyNeural').age === 'adult');
  check("labels include '(Azure)'", vb.voices.every(v => /\(Azure\)/.test(v.label)), vb.voices.map(v => v.label).join(' | '));
  listFails = true;
  vb = await list();
  check('list failure -> static fallback Maisie + Ana', vb.voices.map(v => v.id).join(',') === 'en-GB-MaisieNeural,en-US-AnaNeural', vb.voices.map(v => v.id).join(','));
  listFails = false;
  delete process.env.AZURE_SPEECH_KEY;
  calls = [];
  vb = await list();
  check('no key -> static fallback, no network', vb.voices.length === 2 && calls.length === 0);
  check('fallback all child female, labelled (Azure)', vb.voices.every(v => v.age === 'child' && v.gender === 'female' && /\(Azure\)/.test(v.label)));
  process.env.AZURE_SPEECH_KEY = 'test_azure_key_fake';

  // ---- 6. no AZURE_ names (or the fake creds) under public/ -------------
  console.log('\n6. no Azure credential name appears in any file under public/');
  const fs = require('fs'); const p = require('path');
  const NEEDLES = ['AZURE_', 'test_azure_key_fake', 'Ocp-Apim-Subscription-Key'];
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
  check('no AZURE_ names under public/', hits.length === 0, hits.join(', '));

  console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
  process.exit(fails ? 1 : 0);
})();
