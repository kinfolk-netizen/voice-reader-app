// End-to-end test of the Speechify chunked playback path (mock backend).
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));

  await page.goto('http://localhost:8899/', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  const results = {};

  // 1. Provider dropdown contains Speechify
  results.providerOption = await page.$eval('#provider', el =>
    [...el.options].map(o => o.value).includes('speechify'));

  // 2. Select Speechify -> voices load from (mock) API
  await page.selectOption('#provider', 'speechify');
  await page.waitForTimeout(800);
  results.settingsVisible = await page.$eval('#speechify-settings', el => !el.classList.contains('hidden'));
  results.voices = await page.$eval('#speechify-voice', el => [...el.options].map(o => o.textContent));
  results.selectedVoice = await page.$eval('#speechify-voice', el => el.value);

  // 3. Load a multi-paragraph text long enough to force multiple chunks (>3800 chars)
  const para = 'The mountain rose before them like a declaration. Ka’el walked with his eyes down, reading the ground like scripture he did not want to misinterpret. Junia walked with her eyes up, scanning the canopy for shapes that should not be there. ';
  const text = Array.from({ length: 8 }, (_, i) => para.repeat(3).trim()).join('\n\n');
  await page.fill('#text', text);
  await page.click('#use-text-btn');
  await page.waitForTimeout(400);
  results.textLen = text.length;
  results.sentenceSpans = await page.$$eval('.reader-sentence', els => els.length);

  // 4. Play
  await page.click('#play-btn');
  await page.waitForTimeout(1500);
  results.statusDuringPlay = await page.$eval('#status', el => el.textContent);
  results.highlightActive = await page.$$eval('.reader-sentence.highlight', els => els.length);

  // 5. Wait for chunk 1 (2s mock audio) to finish -> chunk 2 should auto-play
  await page.waitForTimeout(2600);
  results.statusChunk2 = await page.$eval('#status', el => el.textContent);

  // 6. Pause / resume
  await page.click('#play-btn');
  await page.waitForTimeout(300);
  results.statusPaused = await page.$eval('#status', el => el.textContent);
  await page.click('#play-btn');
  await page.waitForTimeout(500);
  results.statusResumed = await page.$eval('#status', el => el.textContent);

  // 7. Highlight advanced (word-sync marks drive highlightSentenceAt)
  results.highlightAfterResume = await page.$$eval('.reader-sentence.highlight', els => els.length);

  console.log(JSON.stringify(results, null, 2));
  const errors = logs.filter(l => l.startsWith('PAGEERROR') || l.toLowerCase().includes('uncaught'));
  console.log('PAGE ERRORS:', errors.length ? errors : 'none');
  console.log('CHUNK LOGS:', logs.filter(l => l.includes('[CLOUD TTS]')));
  await browser.close();
})();
