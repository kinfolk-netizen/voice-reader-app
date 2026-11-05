// Job 4 step 1 (2026-11-05): static checks for public/music-test.html, the iPhone
// test page that answers "does the reading voice stop the music?" before the
// music player is built into index.html.
import { readFileSync } from 'node:fs';
const s = readFileSync(new URL('../public/music-test.html', import.meta.url), 'utf8');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

const js = s.match(/<script>([\s\S]*)<\/script>/);
ok(!!js, 'page has one inline script');
try { new Function(js[1]); ok(true, 'script parses'); } catch (e) { ok(false, 'script parses: ' + e.message); }
ok(/createMediaElementSource/.test(s) && /createGain/.test(s), 'music routes through a GainNode (iOS ignores audio.volume)');
ok(!/\.volume\s*=/.test(s), 'no audio.volume writes');
ok(/navigator\.audioSession/.test(s), 'sets navigator.audioSession.type');
ok(/mediaSession/.test(s), 'sets Media Session metadata');
ok(/\/\.netlify\/functions\/tts-proxy/.test(s), 'cloud voice goes through the existing proxy');
ok(/accept="audio\/\*"/.test(s), 'file picker accepts audio');
ok(!/youtube|spotify/i.test(s), 'no YouTube/Spotify embeds');
// Keys never reach the browser: no credential or env-var names on this page.
ok(!/AWS_|SECRET|API_KEY|ACCESS_KEY/.test(s), 'no key or env-var names on the page');
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
