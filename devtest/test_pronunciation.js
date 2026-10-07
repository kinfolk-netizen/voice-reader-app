// JOB 3 — pronunciation at the transmit layer (offline).
// Exercises the PRONUNCIATION table in api/tts-proxy.js: Polly/Azure get SSML
// <phoneme> for Ka'el / Auren / Junia / Silas; Speechify gets the same-length
// respelling for Silas only; ElevenLabs (and anything else) is untouched; text
// already carrying a phoneme is never double-wrapped. Also drives the Speechify
// branch of the handler with a mocked fetch to prove the respelling is what is
// SENT, while the caller's text (cache key / highlighting) is left as it was.

process.env.SPEECHIFY_API_KEY = 'test_speechify_key_fake';
delete process.env.SPEECHIFY_LEXICON;
delete process.env.SPEECHIFY_EMOTION;

let sent = [];
globalThis.fetch = async (url, opts = {}) => {
  sent.push({ url: String(url), body: opts.body });
  return {
    ok: true, status: 200, statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ audio_data: Buffer.from('ID3').toString('base64'), audio_format: 'mp3', speech_marks: { chunks: [] } }),
    text: async () => ''
  };
};

const proxy = require('../api/tts-proxy.js');
const { _pronounce: pronounce, _toPollySSML: polly, _toAzureSSML: azure } = proxy;

let fails = 0;
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};
const count = (s, sub) => s.split(sub).length - 1;

(async () => {
  // ---- 1. Polly: Ka'el respelled 'Kaw-el' (by ear 2026-10-07); IPA phoneme for the rest
  console.log('\n1. Polly — Ka\'el -> Kaw-el; <phoneme alphabet=ipa> for Auren / Junia / Silas');
  let s = polly("Ka'el ran.");
  check("Ka'el (straight) -> Kaw-el, no phoneme", s === '<speak>Kaw-el ran.</speak>', s);
  s = polly('Ka’el ran.');
  check('Ka’el (curly) -> Kaw-el, no phoneme', s === '<speak>Kaw-el ran.</speak>', s);
  s = polly("Ka'el's lamp.");
  check("Ka'el's -> Kaw-el's", s === '<speak>Kaw-el&apos;s lamp.</speak>', s);
  s = polly('Ka’el’s lamp.');
  check('Ka’el’s (curly possessive) -> Kaw-el’s', s === '<speak>Kaw-el’s lamp.</speak>', s);
  s = polly('Ka’el, Junia and Ka\'el.');
  check("no phoneme tag for Ka'el on polly", !/Ka(?:'|’|&apos;)el/.test(s) && count(s, 'Kaw-el') === 2 &&!s.includes("ph='ˈkɔ") && count(s, '<phoneme') === 1, s);
  s = polly('Auren and Junia met Silas.');
  check('Auren wrapped', s.includes("ph='ˈɔ.rən'>Auren</phoneme>"), s);
  check('Junia wrapped (hard J)', s.includes("ph='ˈdʒu.ni.ə'>Junia</phoneme>"), s);
  check('Silas wrapped', s.includes("ph='ˈsaɪ.ləs'>Silas</phoneme>"), s);
  check('Polly en-US IPA carries no length mark', !s.includes('ː'), s);
  s = polly('KA’EL! JUNIA!');
  check('upper-case: KA’EL -> KAW-EL, JUNIA wrapped, case kept', s.includes('KAW-EL!') && s.includes('>JUNIA</phoneme>'), s);
  s = polly('Silasa and Aurenfield and Kael.');
  check('no partial-word or unlisted-spelling hits', !s.includes('<phoneme'), s);
  s = polly('Tom & <Junia>');
  check('XML still escaped around the phoneme', s === "<speak>Tom &amp; &lt;<phoneme alphabet='ipa' ph='ˈdʒu.ni.ə'>Junia</phoneme>&gt;</speak>", s);

  // ---- 2. no double-wrap ------------------------------------------------
  console.log('\n2. already-SSML input / second pass never double-wraps');
  const once = polly("Junia and Ka'el.");
  const twice = pronounce(once, 'polly');
  check('second pass is a no-op', twice === once, twice);
  check('exactly one phoneme (Junia) plus Kaw-el', count(twice, '<phoneme') === 1 && twice.includes('Kaw-el.'), twice);
  const own = "<speak><phoneme alphabet='ipa' ph='x'>Junia</phoneme> and Auren<break time='200ms'/></speak>";
  s = polly(own);
  check('a line with its own phoneme keeps it untouched', s.includes("ph='x'>Junia</phoneme>") && count(s, '<phoneme') === 2, s);
  check('SSML tags/break preserved', s.includes("<break time='200ms'/>") && s.startsWith('<speak>'), s);
  s = polly("<speak><sub alias='Joo'>Junia</sub> spoke.</speak>");
  check('text inside <sub> left alone', !s.includes('<phoneme'), s);

  // ---- 3. Azure: locale-aware IPA -----------------------------------------
  console.log('\n3. Azure — phoneme inside <voice>; en-GB keeps the length mark');
  s = azure("Ka'el and Junia.", 'en-GB-MaisieNeural');
  check('Maisie: Ka\'el wrapped with en-GB IPA', s.includes("ph='ˈkɔː.ɛl'>Ka&apos;el</phoneme>"), s);
  check('Maisie: Junia wrapped with en-GB IPA', s.includes("ph='ˈdʒuː.ni.ə'>Junia</phoneme>"), s);
  check('phonemes sit inside <voice>', /<voice name='en-GB-MaisieNeural'>.*<phoneme.*<\/voice><\/speak>$/.test(s), s);
  check('Maisie: no Kaw-el respelling on Azure', !s.includes('Kaw-el'), s);
  s = azure('Ka’el’s lamp.', 'en-US-AnaNeural');
  check("Ana: Ka'el still phoneme (en-US, no length mark)", s.includes("ph='ˈkɔ.ɛl'>Ka’el</phoneme>’s lamp") && !s.includes('Kaw-el'), s);
  s = azure('Auren, Silas.', 'en-US-AnaNeural');
  check('Ana: en-US IPA without length mark', s.includes("ph='ˈɔ.rən'>Auren</phoneme>") && s.includes("ph='ˈsaɪ.ləs'>Silas</phoneme>") && !s.includes('ː'), s);
  s = azure("<speak version='1.0' xml:lang='en-GB'><voice name='en-GB-MaisieNeural'>Auren</voice></speak>", 'en-GB-MaisieNeural');
  check('Azure pass-through SSML still gets the table', s.includes("ph='ˈɔː.rən'>Auren</phoneme>"), s);
  check('Azure pass-through no double-wrap', pronounce(s, 'azure', 'en-GB') === s);

  // ---- 4. Speechify: Silas only, same-length respelling -----------------
  console.log('\n4. Speechify — Silas respelled (no <phoneme> support); the rest untouched');
  s = pronounce("Ka'el, Auren, Junia and Silas. SILAS!", 'speechify');
  check('Silas -> Sylus, SILAS -> SYLUS', s === "Ka'el, Auren, Junia and Sylus. SYLUS!", s);
  check('respelling keeps the length (marks stay 1:1)', s.length === "Ka'el, Auren, Junia and Silas. SILAS!".length);
  s = pronounce("Ka'el's and Ka’el and KA'EL", 'speechify');
  check("Speechify: Ka'el untouched (no Kaw-el)", s === "Ka'el's and Ka’el and KA'EL", s);
  check('no <phoneme> ever sent to Speechify', !pronounce('<speak>Silas<break time="180ms"/>Junia</speak>', 'speechify').includes('<phoneme'));
  s = pronounce('<speak>Silas<break time="180ms"/> waits</speak>', 'speechify');
  check('Speechify SSML (breath line) respelled in text, tags kept', s === '<speak>Sylus<break time="180ms"/> waits</speak>', s);

  // ---- 5. ElevenLabs / others untouched ---------------------------------
  console.log('\n5. ElevenLabs and other providers untouched');
  const raw = "Ka'el's friend Junia met Auren and Silas.";
  for (const p of ['elevenlabs', 'openai', 'acapela', undefined]) {
    check(String(p) + ' unchanged', pronounce(raw, p) === raw);
  }

  // ---- 6. handler: Speechify body carries the respelling ----------------
  console.log('\n6. handler — what is SENT to Speechify, vs what the caller gave');
  sent = [];
  const text = 'Father Silas lit the lamp.';
  const res = await proxy.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ providerId: 'speechify', text, voice: 'john-rhys-davies', options: {} })
  }, {});
  const call = sent.find(c => c.url.includes('speechify'));
  const body = call ? JSON.parse(call.body) : {};
  check('Speechify called', !!call, res.statusCode + ' ' + String(res.body).slice(0, 120));
  check('Speechify input respelled', body.input === 'Father Sylus lit the lamp.', body.input);
  check("caller's text unchanged (cache key hashes the original)", text === 'Father Silas lit the lamp.');

  // ---- 7. the flag ------------------------------------------------------
  console.log('\n7. table shape');
  const names = proxy._PRONUNCIATION.map(e => e.name).sort();
  check('table has Auren, Junia, Ka\'el, Silas', JSON.stringify(names) === JSON.stringify(['Auren', 'Junia', "Ka'el", 'Silas']), names.join());
  check('Ka\'el / Auren / Junia not on speechify', proxy._PRONUNCIATION.filter(e => e.name !== 'Silas').every(e => !e.providers.includes('speechify')));
  check('nothing on elevenlabs', proxy._PRONUNCIATION.every(e => !e.providers.includes('elevenlabs')));

  const kael = proxy._PRONUNCIATION.find(e => e.name === "Ka'el");
  check("Ka'el: respell Kaw-el on polly only", kael.respell === 'Kaw-el' && JSON.stringify(kael.respellOn) === '["polly"]');

  // respellOn: per-name fallback if a provider ignores the phoneme
  const junia = proxy._PRONUNCIATION.find(e => e.name === 'Junia');
  junia.respell = 'Joonia'; junia.respellOn = ['polly'];
  s = polly('Junia and Auren.');
  check('respellOn polly: Junia -> Joonia (any length), Auren still phoneme',
    s === "<speak>Joonia and <phoneme alphabet='ipa' ph='ˈɔ.rən'>Auren</phoneme>.</speak>", s);
  check('respellOn polly leaves Azure on the phoneme', azure('Junia', 'en-US-AnaNeural').includes(">Junia</phoneme>"));
  delete junia.respell; delete junia.respellOn;

  console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
  process.exit(fails ? 1 : 0);
})();
