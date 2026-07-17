// End-to-end test for live voice-memo transcription (note / memo / export flow).
// Runs against devtest/server.js on a mobile viewport with a synthetic mic.
//
// SpeechRecognition is not implemented in headless Chromium, so scenario A injects
// a controllable mock SpeechRecognition to drive the append/save/export logic
// deterministically. Scenario B removes it to verify the graceful fallback.
//
// Usage: node devtest/server.js  (in one shell)
//        node devtest/memo-transcription.js
const { chromium } = require('playwright');

const BASE = 'http://localhost:8899/';
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' };

// A mock SpeechRecognition that emits two final segments shortly after start().
const MOCK_SR = `
window.__SR_STARTS = 0;
class MockSpeechRecognition {
  constructor(){ this.continuous=false; this.interimResults=false; this.lang=''; this._timers=[]; }
  start(){
    window.__SR_STARTS++;
    const emit = (segs, idx, isFinal) => {
      if (!this.onresult) return;
      const results = segs.map(t => { const r=[{transcript:t}]; r.isFinal=isFinal; return r; });
      this.onresult({ resultIndex: idx, results });
    };
    // interim, then two finals — mirrors a real recognizer streaming while I speak.
    this._timers.push(setTimeout(() => emit(['the mountain'], 0, false), 80));
    this._timers.push(setTimeout(() => emit(['The mountain rose before them.'], 0, true), 200));
    this._timers.push(setTimeout(() => emit(['The mountain rose before them.','Junia scanned the canopy.'], 1, true), 360));
  }
  stop(){ this._timers.forEach(clearTimeout); if (this.onend) this.onend(); }
  abort(){ this._timers.forEach(clearTimeout); if (this.onend) this.onend(); }
}
window.SpeechRecognition = MockSpeechRecognition;
window.webkitSpeechRecognition = MockSpeechRecognition;
`;

const REMOVE_SR = `
delete window.SpeechRecognition;
delete window.webkitSpeechRecognition;
Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true});
Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});
`;

const SAMPLE_TEXT = [
  'The mountain rose before them like a declaration.',
  'Kael walked with his eyes down, reading the ground like scripture.',
  'Junia walked with her eyes up, scanning the canopy for shapes.'
].join(' ');

function assert(cond, name, detail) {
  results.checks.push({ name, pass: !!cond, detail: detail || '' });
  if (!cond) results.ok = false;
}
const results = { ok: true, checks: [], pageErrors: [] };

async function loadTextAndOpenNote(page) {
  await page.fill('#text', SAMPLE_TEXT);
  await page.click('#use-text-btn');
  await page.waitForTimeout(300);
  await page.click('#note-btn');
  await page.waitForSelector('#note-editor:not(.hidden)', { timeout: 3000 });
}

async function readNotesFromStorage(page) {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.endsWith('-notes')) {
        try { const arr = JSON.parse(localStorage.getItem(k)); if (arr && arr.length) return arr; } catch (e) {}
      }
    }
    return [];
  });
}

(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
           '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
  });

  // ---------- Scenario A: transcription supported ----------
  {
    const context = await browser.newContext({ ...MOBILE, permissions: ['microphone'] });
    const page = await context.newPage();
    page.on('pageerror', e => results.pageErrors.push('A: ' + e.message));
    await page.addInitScript(MOCK_SR);
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(400);

    await loadTextAndOpenNote(page);

    // Start recording -> mock recognizer streams transcript into the textarea.
    await page.click('#memo-btn');
    await page.waitForTimeout(700);
    const liveText = await page.$eval('#note-input', el => el.value);
    assert(/mountain rose before them/i.test(liveText), 'A1 live transcript appears in textarea', liveText);
    assert(/Junia scanned the canopy/i.test(liveText), 'A2 second final segment appended', liveText);

    // Stop recording.
    await page.click('#memo-btn');
    await page.waitForTimeout(400);
    const status = await page.$eval('#memo-status', el => el.textContent);
    assert(/transcript captured/i.test(status), 'A3 memo-status confirms transcript + audio', status);
    const srStarts = await page.evaluate(() => window.__SR_STARTS);
    assert(srStarts >= 1, 'A4 recognizer was actually started', String(srStarts));

    // Save note.
    await page.click('#note-save');
    await page.waitForTimeout(300);
    const notes = await readNotesFromStorage(page);
    assert(notes.length === 1, 'A5 exactly one note persisted', JSON.stringify(notes.map(n=>n.pct)));
    const n = notes[0] || {};
    assert(!!n.transcript && /mountain rose/i.test(n.transcript), 'A6 note.transcript stored', n.transcript);
    assert(!!n.note && /mountain rose/i.test(n.note), 'A7 note.note contains transcribed text', n.note);
    assert(!!n.memoId, 'A8 audio memo also saved (memoId present)', String(n.memoId));

    // Export -> markdown contains transcript text AND the voice-memo marker.
    const [ download ] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-notes-btn')
    ]);
    const stream = await download.createReadStream();
    let md = '';
    for await (const chunk of stream) md += chunk.toString();
    assert(/mountain rose before them/i.test(md), 'A9 export includes transcript as note text', md.slice(0,200));
    assert(/voice memo/i.test(md), 'A10 export still marks a voice memo exists', '');

    // Persistence: reload, reload same text -> saved note (with transcript) re-renders; memo playback no-error.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.fill('#text', SAMPLE_TEXT);
    await page.click('#use-text-btn');
    await page.waitForTimeout(400);
    const listText = await page.$eval('#notes-list', el => el.textContent);
    assert(/mountain rose/i.test(listText), 'A11 note persists across reload', listText.slice(0,120));
    const playBtns = await page.$$('#notes-list .memo-play');
    assert(playBtns.length === 1, 'A12 persisted memo has a play button', String(playBtns.length));
    if (playBtns.length) { await playBtns[0].click(); await page.waitForTimeout(200); }

    await context.close();
  }

  // ---------- Scenario B: SpeechRecognition unavailable (graceful fallback) ----------
  {
    const context = await browser.newContext({ ...MOBILE, permissions: ['microphone'] });
    const page = await context.newPage();
    page.on('pageerror', e => results.pageErrors.push('B: ' + e.message));
    await page.addInitScript(REMOVE_SR);
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(400);

    await loadTextAndOpenNote(page);

    await page.click('#memo-btn');       // start (audio only, no recognizer)
    await page.waitForTimeout(500);
    await page.click('#memo-btn');        // stop
    await page.waitForTimeout(400);
    const status = await page.$eval('#memo-status', el => el.textContent);
    assert(/transcription not supported/i.test(status), 'B1 fallback status shown', status);
    assert(/recorded/i.test(status), 'B2 audio still recorded in fallback', status);

    await page.click('#note-save');
    await page.waitForTimeout(300);
    const notes = await readNotesFromStorage(page);
    assert(notes.length === 1, 'B3 note saved without transcription', String(notes.length));
    const n = notes[0] || {};
    assert(!!n.memoId, 'B4 audio memo saved in fallback', String(n.memoId));
    assert(!n.transcript, 'B5 no transcript stored when unsupported', String(n.transcript));

    await context.close();
  }

  assert(results.pageErrors.length === 0, 'Z no page errors across both scenarios', results.pageErrors.join(' | '));

  await browser.close();

  console.log(JSON.stringify(results, null, 2));
  const failed = results.checks.filter(c => !c.pass);
  console.log('\n' + (results.ok ? 'ALL PASS (' + results.checks.length + ' checks)' : 'FAILURES: ' + failed.map(c=>c.name).join(', ')));
  process.exit(results.ok ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
