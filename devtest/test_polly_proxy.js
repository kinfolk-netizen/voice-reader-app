// JOB 1 — Amazon Polly proxy adapter (offline).
// Mocks @aws-sdk/client-polly so the proxy logic (SSML wrapping, neural engine,
// base64 mp3, missing-secret guard) is exercised with no AWS call and no
// dependency install. Also scans public/ to prove no AWS key name ships.
const Module = require('module');

// ---- mock the AWS SDK v3 Polly client ----------------------------------
let lastCommandInput = null;
let lastClientConfig = null;
class SynthesizeSpeechCommand {
  constructor(input) { this.input = input; lastCommandInput = input; }
}
class PollyClient {
  constructor(cfg) { this.cfg = cfg; lastClientConfig = cfg; }
  async send(/* cmd */) {
    // a tiny fake "mp3" byte stream, SDK v3 style
    return { AudioStream: { transformToByteArray: async () => new Uint8Array([0x49, 0x44, 0x33]) } };
  }
}
const fakeSdk = { PollyClient, SynthesizeSpeechCommand };
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@aws-sdk/client-polly') return fakeSdk;
  return origLoad.apply(this, arguments);
};

// fake creds (never real secrets)
process.env.AWS_POLLY_ACCESS_KEY_ID = 'AKIA_TEST_FAKE';
process.env.AWS_POLLY_SECRET_ACCESS_KEY = 'test_secret_fake';
process.env.AWS_POLLY_REGION = 'us-east-1';

const proxy = require('../api/tts-proxy.js');

let fails = 0;
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};

(async () => {
  // ---- 1. plain text synthesizes to base64 mp3 via the SDK -------------
  console.log('\n1. Polly synthesizes plain text via the proxy');
  const res = await proxy.handler({ httpMethod: 'POST', body: JSON.stringify({ providerId: 'polly', text: 'Lamps up.', voice: 'Justin' }) });
  const body = JSON.parse(res.body);
  const expectAudio = Buffer.from([0x49, 0x44, 0x33]).toString('base64');
  check('200 OK', res.statusCode === 200, 'status=' + res.statusCode);
  check('success true', body.success === true, body.error);
  check('provider is polly', body.provider === 'polly');
  check('audio returned as base64 mp3', body.audio === expectAudio, body.audio);
  check('region from env', lastClientConfig.region === 'us-east-1');
  check('engine neural', lastCommandInput.Engine === 'neural');
  check('TextType ssml', lastCommandInput.TextType === 'ssml');
  check('voice passed through', lastCommandInput.VoiceId === 'Justin');
  check('plain text wrapped in <speak>', lastCommandInput.Text === '<speak>Lamps up.</speak>', lastCommandInput.Text);

  // ---- 2. SSML passthrough + XML escaping ------------------------------
  console.log('\n2. SSML handling');
  check('existing SSML passes through untouched', proxy._toPollySSML('<speak>hi <break time="200ms"/>there</speak>') === '<speak>hi <break time="200ms"/>there</speak>');
  check('plain text is XML-escaped', proxy._toPollySSML('Tom & "Jim" <x>') === '<speak>Tom &amp; &quot;Jim&quot; &lt;x&gt;</speak>', proxy._toPollySSML('Tom & "Jim" <x>'));

  // ---- 3. missing secret -> 401, never a silent half-call --------------
  console.log('\n3. missing credentials');
  delete process.env.AWS_POLLY_SECRET_ACCESS_KEY;
  const res2 = await proxy.handler({ httpMethod: 'POST', body: JSON.stringify({ providerId: 'polly', text: 'x', voice: 'Justin' }) });
  check('missing secret -> 401', res2.statusCode === 401, 'status=' + res2.statusCode);
  process.env.AWS_POLLY_SECRET_ACCESS_KEY = 'test_secret_fake';
  delete process.env.AWS_POLLY_ACCESS_KEY_ID;
  const res3 = await proxy.handler({ httpMethod: 'POST', body: JSON.stringify({ providerId: 'polly', text: 'x', voice: 'Justin' }) });
  check('missing access key -> 401', res3.statusCode === 401, 'status=' + res3.statusCode);
  process.env.AWS_POLLY_ACCESS_KEY_ID = 'AKIA_TEST_FAKE';

  // ---- 4. no AWS key name ships in any file under public/ --------------
  console.log('\n4. no key name appears in any file under public/');
  const fs = require('fs'); const p = require('path');
  const NEEDLES = ['AWS_POLLY_ACCESS_KEY_ID', 'AWS_POLLY_SECRET_ACCESS_KEY', 'secretAccessKey', 'accessKeyId', 'AKIA_TEST_FAKE', 'test_secret_fake'];
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
  check('no AWS key names under public/', hits.length === 0, hits.join(', '));

  // ---- 5. the Polly voice list exposes the child voices ----------------
  console.log('\n5. get-voices exposes Polly, incl. the child voices');
  const voicesApi = require('../api/get-voices.js');
  const vr = await voicesApi.handler({ httpMethod: 'GET', queryStringParameters: { providerId: 'polly' } });
  const vb = JSON.parse(vr.body);
  const byId = Object.fromEntries((vb.voices || []).map(v => [v.id, v]));
  check('polly provider returned', vb.providerId === 'polly' && Array.isArray(vb.voices) && vb.voices.length > 0);
  check('Justin is a child voice', byId.Justin && byId.Justin.age === 'child');
  check('Ivy is a child voice', byId.Ivy && byId.Ivy.age === 'child');
  check('Kevin is a child voice', byId.Kevin && byId.Kevin.age === 'child');
  check('en-GB voices present (Brian)', !!byId.Brian && byId.Brian.locale === 'en-GB');

  Module._load = origLoad;
  console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
  process.exit(fails ? 1 : 0);
})();
