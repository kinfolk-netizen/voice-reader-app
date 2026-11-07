// Scene themes (Pitch Room Run 21): every scene in scene-themes.js has a scoped
// CSS block in scene-themes.css, defines the full token set, loads nothing
// external, and gates its animation behind prefers-reduced-motion.
import fs from 'fs';
const js = fs.readFileSync('public/scene-themes.js', 'utf-8');
const css = fs.readFileSync('public/scene-themes.css', 'utf-8');
const m = js.match(/var SCENES = (\{[\s\S]*?\n\});/);
const scenes = JSON.parse(m[1]);
const TOKENS = ['--paper', '--surface', '--surface-2', '--ink', '--ink-2', '--ink-3', '--hairline', '--hairline-soft', '--accent', '--accent-deep', '--accent-wash', '--accent-wash-strong', '--ok', '--err', '--shadow-1', '--shadow-play'];
let fails = 0; const ok = (c, msg) => { console.log((c ? '  PASS ' : '  FAIL ') + msg); if (!c) fails++; };
ok(Object.keys(scenes).length >= 6, Object.keys(scenes).length + ' scenes registered');
for (const [id, s] of Object.entries(scenes)) {
  const start = css.indexOf(`(${id}) =====`); const next = css.indexOf('/* =====', start + 10);
  const block = css.slice(start, next < 0 ? css.length : next);
  ok(start > 0, `${id}: CSS block present (${s.name})`);
  ok(TOKENS.every(t => new RegExp(t.replace(/-/g, '\\-') + '\\s*:').test(block)), `${id}: full token set`);
  ok(!/url\((?!#|"?data:|'?data:)/.test(block) && !/<script/i.test(s.markup) && !/https?:\/\//.test(s.markup.replace('http://www.w3.org/2000/svg', '')), `${id}: nothing external`);
  ok(!/animation\s*:/.test(block) || /prefers-reduced-motion:\s*no-preference/.test(block), `${id}: motion gated by prefers-reduced-motion`);
  ok(block.length + s.markup.length < 15000, `${id}: size ${block.length + s.markup.length} bytes`);
  ok(/\.theme-dot\[data-theme="/.test(block), `${id}: picker swatch`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall checks passed'); process.exit(fails ? 1 : 0);
