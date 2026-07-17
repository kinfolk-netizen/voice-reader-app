// Local dev shim: serves public/ and mounts the Netlify functions.
// MOCK_TTS=1 intercepts Speechify calls with locally generated audio + speech marks
// so the full playback pipeline can be tested end-to-end without an API key.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ttsProxy = require('../api/tts-proxy.js');
const getVoices = require('../api/get-voices.js');
const costEstimate = require('../api/cost-estimate.js');

const MOCK = process.env.MOCK_TTS === '1';
const mockAudioB64 = MOCK ? fs.readFileSync(path.join(__dirname, 'mock.mp3')).toString('base64') : null;
const MOCK_AUDIO_MS = 2000;

function mockSpeechMarks(text) {
  // Fabricate evenly spaced word marks across the mock audio duration
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) words.push({ start: m.index, value: m[0] });
  const step = MOCK_AUDIO_MS / Math.max(words.length, 1);
  return {
    chunks: words.map((w, i) => ({
      type: 'word', value: w.value, start: w.start,
      end: w.start + w.value.length,
      start_time: Math.round(i * step), end_time: Math.round((i + 1) * step)
    }))
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      if (url.pathname.startsWith('/.netlify/functions/')) {
        const fn = url.pathname.split('/').pop();
        // Mock interception for speechify
        if (MOCK && fn === 'tts-proxy' && body) {
          const parsed = JSON.parse(body);
          if (parsed.providerId === 'speechify') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true, audio: mockAudioB64,
              speechMarks: mockSpeechMarks(parsed.text),
              format: 'mp3', provider: 'speechify', voice: parsed.voice,
              characters: parsed.text.length, estimatedCost: (parsed.text.length * 0.00001).toFixed(6)
            }));
            return;
          }
        }
        if (MOCK && fn === 'get-voices' && url.searchParams.get('providerId') === 'speechify') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true, providerId: 'speechify', providerName: 'Speechify',
            supportsBoundaries: true, tier: 'premium',
            voices: [
              { id: 'oliver', label: 'Oliver (en-GB, male)', gender: 'male', locale: 'en-GB' },
              { id: 'george', label: 'George (en-GB, male)', gender: 'male', locale: 'en-GB' }
            ]
          }));
          return;
        }
        const handlers = { 'tts-proxy': ttsProxy, 'get-voices': getVoices, 'cost-estimate': costEstimate };
        const handler = handlers[fn];
        if (!handler) { res.writeHead(404); res.end('no such function'); return; }
        const event = {
          httpMethod: req.method,
          queryStringParameters: Object.fromEntries(url.searchParams),
          body: body || null
        };
        const result = await handler.handler(event, {});
        res.writeHead(result.statusCode, result.headers || {});
        res.end(result.body || '');
        return;
      }
      // static
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.join(__dirname, '..', 'public', p);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(file));
      } else { res.writeHead(404); res.end('not found'); }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(8899, () => console.log('devtest server on http://localhost:8899 (mock=' + MOCK + ')'));
