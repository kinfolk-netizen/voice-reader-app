/* Witness Reader - background music (loaded from the listener's own device only).
   No audio is bundled or hosted. Music volume is its own Web Audio GainNode. */
(function () {
  'use strict';
  var AC = window.AudioContext || window.webkitAudioContext;
  var DB = 'wr-music', STORE = 'tracks';
  var st = { curCue: null, level: 1, silent: false, cues: null, cuePts: [], cueKey: null, lastSwitch: 0, bucketIdx: {}, tracks: [], map: null, bucket: null, list: [], idx: 0, on: true, vol: 0.35, ctx: null, gain: null, el: null, chap: null, wantPlay: false };

  function $(id) { return document.getElementById(id); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- IndexedDB (optional; page works without it) ---------- */
  function idb() {
    return new Promise(function (res, rej) {
      try {
        var r = indexedDB.open(DB, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'name' }); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      } catch (e) { rej(e); }
    });
  }
  function idbSave(files) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readwrite'), s = tx.objectStore(STORE);
        files.forEach(function (f) { s.put({ name: f.name, blob: f }); });
        tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); };
      });
    }).catch(function () {});
  }
  function idbLoad() {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var q = db.transaction(STORE).objectStore(STORE).getAll();
        q.onsuccess = function () { res((q.result || []).map(function (r) { var b = r.blob; if (!b.name) { try { b.name = r.name; } catch (e) {} } return b; })); };
        q.onerror = function () { res([]); };
      });
    }).catch(function () { return []; });
  }
  function idbClear() { return idb().then(function (db) { db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); }).catch(function () {}); }

  /* ---------- Audio graph ---------- */
  function ensureAudio() {
    if (st.ctx) { if (st.ctx.state === 'suspended') st.ctx.resume(); return; }
    if (!AC) return;
    st.ctx = new AC();
    function mkDeck() {
      var el = new Audio(); el.preload = 'auto';
      var src = st.ctx.createMediaElementSource(el);
      var g = st.ctx.createGain(); g.gain.value = 0;
      src.connect(g); g.connect(st.ctx.destination);
      var d = { el: el, gain: g };
      el.addEventListener('ended', function () { if (st.deck === d) next(); });
      return d;
    }
    st.decks = [mkDeck(), mkDeck()]; st.deck = st.decks[0]; st.el = st.deck.el; st.gain = st.deck.gain;
    if (st.ctx.state === 'suspended') st.ctx.resume();
  }
  function setVol(v, fade) {
    st.vol = v; lsSet('wr-music-vol', String(v));
    if (!st.gain) return;
    var t = st.ctx.currentTime;
    st.gain.gain.cancelScheduledValues(t);
    st.gain.gain.setTargetAtTime(st.on && !st.silent ? v * st.level : 0, t, fade || 0.05);
  }
  function setSession() { try { if (navigator.audioSession && st.tracks.length) navigator.audioSession.type = 'playback'; } catch (e) {} }

  /* ---------- Playlist / chapter matching ---------- */
  function bucketOf(name) { var m = /^(\d{2})[-_]/.exec(name); return m ? m[1] : null; }
  function buildList() {
    var l = st.tracks;
    if (st.bucket) { var f = l.filter(function (t) { return bucketOf(t.name) === st.bucket; }); if (f.length) l = f; }
    st.list = l.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    if (st.idx >= st.list.length) st.idx = 0;
  }
  function detectChapter(text) {
    var h = (text || '').slice(0, 700), m;
    var W = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
    if ((m = /\bch(?:apter)?\.?\s*(?:0*(\d{1,2})|(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\b/i.exec(h))) { var n = m[1] ? parseInt(m[1], 10) : W[m[2].toLowerCase()]; return 'ch' + ('0' + n).slice(-2); }
    if (/\bprologue\b/i.test(h)) return 'ch00';
    if (/\bepilogue\b/i.test(h)) return 'ch11';
    if (/\binterlude\b/i.test(h)) return 'interlude';
    return null;
  }
  function applyChapter(key) {
    st.chap = key;
    var b = key && st.map && st.map.chapters ? st.map.chapters[key] : null;
    var ov = lsGet('wr-music-bucket-override', '');
    st.bucket = ov || b || null;
    st.cuePts = ov ? [] : computeCues(key);
    if (st.cuePts.length && st.cuePts[0].pos === 0 && st.cuePts[0].mood) st.bucket = st.cuePts[0].mood;
    st.lastSwitch = 0; st.curCue = null; st.silent = false; st.level = 1;
    st.bucketIdx = {};
    buildList();
    if (st.cuePts.length && st.cuePts[0].track) { var j0 = trackIndex(st.cuePts[0].track); if (j0 >= 0) st.idx = j0; }
    status();
    if (st.wantPlay && st.on) { playCurrent(true); }
  }

  /* ---------- Mood cues inside a chapter (anchor phrase -> mood) ---------- */
  function norm(s) {
    return String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s/g, ' ').toLowerCase();
  }
  function computeCues(key) {
    var out = [], list = key && st.cues && st.cues[key];
    var app = window.app; var text = app && app.currentText;
    if (!list || !text) return out;
    var t = norm(text), from = 0;
    list.forEach(function (c) {
      var a = norm(c.at), p = a === '^' ? 0 : t.indexOf(a, from);
      if (p < 0) { try { console.warn('[MUSIC] cue anchor not found:', c.at); } catch (e) {} return; }
      out.push({ pos: p, mood: c.mood, track: c.track, level: c.level, silence: !!c.silence }); from = p;
    });
    return out;
  }
  function trackIndex(key) {
    var k = String(key).toLowerCase();
    for (var i = 0; i < st.list.length; i++) { if (st.list[i].name.toLowerCase().indexOf(k) >= 0) return i; }
    return -1;
  }
  function cueAt(pos) {
    var m = null;
    for (var i = 0; i < st.cuePts.length; i++) { if (st.cuePts[i].pos <= pos) m = st.cuePts[i]; else break; }
    return m;
  }
  function onPos(pos) {
    if (!st.cuePts.length || !st.on) return;
    var c = cueAt(pos);
    if (!c || c === st.curCue) return;
    var prev = st.curCue, now = Date.now();
    var urgent = c.silence || (prev && prev.silence);
    if (!urgent && st.lastSwitch && now - st.lastSwitch < 12000) return;
    st.curCue = c; st.lastSwitch = now;
    if (c.silence) {
      st.silent = true; setVol(st.vol, 1.8); status();
      setTimeout(function () { if (st.silent) pauseMusic(); }, 7500);
      return;
    }
    var wasSilent = st.silent; st.silent = false; st.level = c.level || 1;
    var moodChanged = !!c.mood && c.mood !== st.bucket;
    if (moodChanged) { st.bucketIdx[st.bucket] = st.idx; st.bucket = c.mood; buildList(); st.idx = (st.bucketIdx[c.mood] || 0) % Math.max(1, st.list.length); }
    var trackChanged = false;
    if (c.track) { var j = trackIndex(c.track); if (j >= 0 && j !== st.idx) { st.idx = j; trackChanged = true; } }
    status();
    if (moodChanged || trackChanged || wasSilent) {
      if (st.wantPlay && st.gain) {
        if (wasSilent && !moodChanged && !trackChanged && st.el && !st.el.paused) setVol(st.vol, 1.4);
        else playCurrent(true, true);
      }
    } else { setVol(st.vol, 1.5); }
  }

  function playCurrent(fade, cross) {
    if (!st.list.length || !st.on || st.silent) return;
    ensureAudio(); if (!st.ctx) return; setSession();
    var t = st.list[st.idx];
    if (cross && st.deck && !st.deck.el.paused) {
      /* true crossfade: old track keeps playing while it fades out slowly, new track fades in on the other deck */
      var old = st.deck, nd = st.decks[st.decks[0] === old ? 1 : 0];
      st.deck = nd; st.el = nd.el; st.gain = nd.gain;
      old.gain.gain.cancelScheduledValues(st.ctx.currentTime);
      old.gain.gain.setTargetAtTime(0, st.ctx.currentTime, 1.3);
      setTimeout(function () { if (st.deck !== old) old.el.pause(); }, 8000);
    }
    if (st.el._name !== t.name) {
      if (st.el._url) URL.revokeObjectURL(st.el._url);
      st.el._url = URL.createObjectURL(t); st.el._name = t.name; st.el.src = st.el._url;
    }
    if (st.gain && fade) { st.gain.gain.cancelScheduledValues(st.ctx.currentTime); st.gain.gain.setValueAtTime(0, st.ctx.currentTime); }
    var p = st.el.play(); if (p && p.catch) p.catch(function () {});
    setVol(st.vol, fade ? (cross ? 1.4 : 1.2) : 0.05); status();
  }
  function pauseMusic() { (st.decks || (st.el ? [{ el: st.el }] : [])).forEach(function (d) { d.el.pause(); }); }
  function next() { if (!st.list.length) return; st.idx = (st.idx + 1) % st.list.length; if (st.wantPlay) playCurrent(true); else status(); }

  /* ---------- UI (injected; keeps index.html edits tiny) ---------- */
  var ALBUMS = { Ori: 'Ori and the Blind Forest', OriWotW: 'Ori and the Will of the Wisps', PF2: 'Peaceful Fantasy 2', CHC2: 'Celtic Hymn Collection II' };
  var ARTISTS = { Coker: 'Gareth Coker', Fiechter: 'Derek Fiechter', Martia: "Martia's Muses" };
  function prettyTrack(name) {
    var base = String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/^\d\d-\d\d_/, '');
    var p = base.split('_');
    if (p.length >= 4 && /^\d+$/.test(p[2])) {
      var t = p.slice(3).join(' ').replace(/-s-/g, "'s ").replace(/-/g, ' ').replace(/^tis /i, "'Tis ").replace(/\s+/g, ' ').trim();
      return { title: t, sub: ALBUMS[p[1]] || ARTISTS[p[0]] || p[0] };
    }
    return { title: base.replace(/[_-]+/g, ' ').trim(), sub: '' };
  }
  function chapLabel(c) {
    if (!c) return 'No chapter yet';
    if (c === 'ch00') return 'Prologue';
    if (c === 'interlude') return 'Interlude';
    var m = /^ch(\d+)$/.exec(c); return m ? 'Chapter ' + parseInt(m[1], 10) : c;
  }
  function setText(id, t) { var e = $(id); if (e && e.textContent !== t) e.textContent = t; }
  function status() {
    var card = $('music-card'); if (!card) return;
    var has = st.tracks.length > 0;
    card.classList.toggle('wrm-empty', !has);
    card.classList.toggle('wrm-off', !st.on);
    var lab = st.map && st.map.buckets && st.bucket ? (st.map.buckets[st.bucket] || st.bucket) : 'All tracks';
    var cur = st.list[st.idx], pt = cur ? prettyTrack(cur.name) : null;
    var eyebrow = !st.on ? 'Music off' : st.silent ? 'Resting - silence by design' : (st.wantPlay ? 'Now playing' : 'Up next');
    setText('wrm-eyebrow', eyebrow);
    setText('wrm-title', pt ? pt.title : 'Waiting for a chapter');
    setText('wrm-sub', pt ? pt.sub : '');
    setText('wrm-chap', chapLabel(st.chap));
    setText('wrm-mood', lab);
    setText('wrm-count', st.tracks.length + (st.tracks.length === 1 ? ' track' : ' tracks') + ' on this device');
    var tg = $('wr-music-toggle'); if (tg) tg.setAttribute('aria-checked', st.on ? 'true' : 'false');
    setText('wr-music-status', has
      ? st.tracks.length + ' tracks loaded. ' + chapLabel(st.chap) + ', mood ' + lab + (pt ? '. ' + eyebrow + ': ' + pt.title : '')
      : 'No music loaded yet. Tap Add music folder and pick your MUSIC folder.');
  }
  function addFiles(files, persist) {
    var seen = {}; st.tracks.forEach(function (t) { seen[t.name] = 1; });
    Array.prototype.forEach.call(files, function (f) { if (!/\.(mp3|m4a|aac|wav|flac|ogg)$/i.test(f.name) || /^XX-/.test(f.name)) return; if (!seen[f.name]) st.tracks.push(f); });
    if (persist) idbSave(Array.prototype.slice.call(files));
    buildList(); status();
  }
  var WRM_CSS = [
    '#music-card .wrm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}',
    '#music-card .wrm-head .card-title{margin:0}',
    '#music-card button{margin:0}',
    '#music-card .wrm-switch{position:relative;width:51px;height:31px;padding:0;border-radius:999px;background:var(--hairline);transition:background .2s ease;flex:0 0 auto}',
    '#music-card .wrm-switch span{position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.25);transition:transform .2s ease}',
    '#music-card .wrm-switch[aria-checked="true"]{background:var(--accent)}',
    '#music-card .wrm-switch[aria-checked="true"] span{transform:translateX(20px)}',
    '#music-card .wrm-switch:hover{opacity:1}',
    '#music-card .wrm-setup{display:none;text-align:center;padding:8px 4px 4px}',
    '#music-card.wrm-empty .wrm-setup{display:block}',
    '#music-card.wrm-empty .wrm-main{display:none}',
    '#music-card .wrm-setup-t{font-family:var(--serif);font-size:1.15em;font-weight:600;margin-bottom:6px}',
    '#music-card .wrm-setup-s{font-size:.88em;color:var(--ink-2);line-height:1.5;margin:0 auto 16px;max-width:34ch}',
    '#music-card .wrm-primary{background:var(--accent);color:#fff;width:100%;min-height:48px;font-size:15px}',
    '#music-card .wrm-primary:hover{background:var(--accent-deep);opacity:1}',
    '#music-card .wrm-now{display:flex;align-items:center;gap:14px;background:var(--surface-2);border:1px solid var(--hairline-soft);border-radius:var(--radius-s);padding:12px}',
    '#music-card .wrm-art{flex:0 0 48px;height:48px;border-radius:10px;background:var(--accent-wash-strong);color:var(--accent);display:flex;align-items:center;justify-content:center}',
    '#music-card .wrm-meta{flex:1 1 auto;min-width:0}',
    '#music-card .wrm-eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:3px}',
    '#music-card .wrm-title{font-family:var(--serif);font-size:1.05em;font-weight:600;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#music-card .wrm-sub{font-size:.8em;color:var(--ink-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#music-card .wrm-icon{flex:0 0 44px;width:44px;height:44px;padding:0;border-radius:50%;background:transparent;border:1px solid var(--hairline);color:var(--ink-2);display:flex;align-items:center;justify-content:center}',
    '#music-card .wrm-icon:hover{border-color:var(--accent);color:var(--accent);opacity:1}',
    '#music-card .wrm-chips{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 18px}',
    '#music-card .wrm-chip{font-size:12px;font-weight:500;padding:5px 11px;border-radius:999px;background:var(--surface-2);color:var(--ink-2);border:1px solid var(--hairline-soft)}',
    '#music-card .wrm-chip-accent{background:var(--accent-wash);color:var(--accent);border-color:transparent}',
    '#music-card .wrm-row-label{display:flex;justify-content:space-between;align-items:baseline;font-size:.85em;color:var(--ink-2);font-weight:500;margin-bottom:8px}',
    '#music-card .wrm-pct{font-variant-numeric:tabular-nums;color:var(--ink);font-weight:600}',
    '#music-card .wrm-vol{display:flex;align-items:center;gap:12px;margin-bottom:18px}',
    '#music-card .wrm-vol input{flex:1 1 auto}',
    '#music-card select{margin-bottom:0}',
    '#music-card .wrm-lib{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:18px;padding-top:14px;border-top:1px solid var(--hairline-soft)}',
    '#music-card .wrm-count{font-size:.82em;color:var(--ink-3)}',
    '#music-card .wrm-links{display:flex;gap:4px;flex-wrap:wrap}',
    '#music-card .wrm-link{background:transparent;color:var(--ink-2);padding:8px 10px;font-size:13px;font-weight:500;border-radius:8px}',
    '#music-card .wrm-link:hover{background:var(--surface-2);opacity:1}',
    '#music-card .wrm-link.wrm-danger{color:var(--err)}',
    '#music-card .wrm-link.wrm-armed{background:var(--err);color:#fff}',
    '#music-card.wrm-off .wrm-now,#music-card.wrm-off .wrm-chips,#music-card.wrm-off .wrm-vol{opacity:.45}',
    '#music-card .wrm-foot{font-size:.76em;color:var(--ink-3);line-height:1.5;margin-top:10px}',
    '#music-card .wrm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
  ].join('\n');
  var ICON_NOTE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  var ICON_NEXT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 5 5.5z"/><rect x="17.5" y="5" width="2.2" height="14" rx="1.1"/></svg>';
  function ui() {
    var ref = $('player-card'); if (!ref || $('music-card')) return;
    if (!$('wrm-style')) { var css = document.createElement('style'); css.id = 'wrm-style'; css.textContent = WRM_CSS; document.head.appendChild(css); }
    var c = document.createElement('div'); c.className = 'card wrm-empty'; c.id = 'music-card';
    c.innerHTML =
      '<div class="wrm-head"><div class="card-title">Background music</div>' +
      '<button type="button" id="wr-music-toggle" class="wrm-switch" role="switch" aria-checked="true" aria-label="Background music"><span></span></button></div>' +
      '<div class="wrm-setup">' +
        '<div class="wrm-setup-t">Add your music library</div>' +
        '<p class="wrm-setup-s">Choose your MUSIC folder once. After that, the score follows every chapter on its own.</p>' +
        '<button type="button" class="wrm-primary" data-wrm="pickdir">Add music folder</button>' +
      '</div>' +
      '<div class="wrm-main">' +
        '<div class="wrm-now"><div class="wrm-art">' + ICON_NOTE + '</div>' +
          '<div class="wrm-meta"><div class="wrm-eyebrow" id="wrm-eyebrow"></div><div class="wrm-title" id="wrm-title"></div><div class="wrm-sub" id="wrm-sub"></div></div>' +
          '<button type="button" id="wr-music-next" class="wrm-icon" aria-label="Next track">' + ICON_NEXT + '</button></div>' +
        '<div class="wrm-chips"><span class="wrm-chip" id="wrm-chap"></span><span class="wrm-chip wrm-chip-accent" id="wrm-mood"></span></div>' +
        '<div class="wrm-row-label"><span>Music volume</span><span class="wrm-pct" id="wr-music-pct"></span></div>' +
        '<div class="wrm-vol"><button type="button" id="wr-vol-down" class="wrm-icon" aria-label="Music volume down 5 percent">&minus;</button>' +
          '<input type="range" id="wr-music-vol" min="0" max="1" step="0.01" aria-label="Music volume">' +
          '<button type="button" id="wr-vol-up" class="wrm-icon" aria-label="Music volume up 5 percent">+</button></div>' +
        '<div class="wrm-row-label"><label for="wr-music-mood" style="margin:0;font-size:inherit">Mood</label></div>' +
        '<select id="wr-music-mood"><option value="">Match the chapter (auto)</option></select>' +
        '<div class="wrm-lib"><span class="wrm-count" id="wrm-count"></span><span class="wrm-links">' +
          '<button type="button" class="wrm-link" data-wrm="pickdir">Update folder</button>' +
          '<button type="button" class="wrm-link" id="wr-music-pick">Add files</button>' +
          '<button type="button" class="wrm-link wrm-danger" id="wr-music-clear">Clear</button></span></div>' +
        '<p class="wrm-foot">Your music stays on this device. Files named 01- to 06- match the chapter moods.</p>' +
      '</div>' +
      '<p id="wr-music-status" class="wrm-sr" aria-live="polite"></p>' +
      '<input type="file" id="wr-music-files" accept="audio/*" multiple style="display:none">' +
      '<input type="file" id="wr-music-dir" webkitdirectory multiple style="display:none">';
    ref.parentNode.insertBefore(c, ref.nextSibling);
    var sel = $('wr-music-mood');
    if (st.map && st.map.buckets) Object.keys(st.map.buckets).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = st.map.buckets[k]; sel.appendChild(o);
    });
    sel.value = lsGet('wr-music-bucket-override', '');
    var v = $('wr-music-vol'); v.value = st.vol;
    var pct = $('wr-music-pct');
    function showVol() { pct.textContent = Math.round(st.vol * 100) + '%'; v.value = st.vol; }
    function nudge(d) { var n = Math.min(1, Math.max(0, Math.round((st.vol + d) * 100) / 100)); setVol(n, 0.03); showVol(); }
    v.addEventListener('input', function () { setVol(parseFloat(v.value), 0.03); showVol(); });
    $('wr-vol-down').onclick = function () { nudge(-0.05); };
    $('wr-vol-up').onclick = function () { nudge(0.05); };
    showVol();
    $('wr-music-pick').onclick = function () { ensureAudio(); $('wr-music-files').click(); };
    $('wr-music-files').onchange = function (e) { addFiles(e.target.files, true); };
    Array.prototype.forEach.call(c.querySelectorAll('[data-wrm="pickdir"]'), function (b) { b.onclick = function () { ensureAudio(); $('wr-music-dir').click(); }; });
    $('wr-music-dir').onchange = function (e) { addFiles(e.target.files, true); };
    $('wr-music-toggle').onclick = function () {
      st.on = !st.on;
      if (st.on) { if (st.wantPlay) playCurrent(true); } else { setVol(st.vol); pauseMusic(); }
      status();
    };
    $('wr-music-next').onclick = function () { if (st.list.length) { st.idx = (st.idx + 1) % st.list.length; st.wantPlay = true; playCurrent(true); } };
    var clr = $('wr-music-clear'), armT = 0;
    clr.onclick = function () {
      if (!clr.classList.contains('wrm-armed')) {
        clr.classList.add('wrm-armed'); clr.textContent = 'Tap again to clear';
        clearTimeout(armT); armT = setTimeout(function () { clr.classList.remove('wrm-armed'); clr.textContent = 'Clear'; }, 3500);
        return;
      }
      clearTimeout(armT); clr.classList.remove('wrm-armed'); clr.textContent = 'Clear';
      pauseMusic(); st.tracks = []; st.list = []; st.idx = 0; idbClear(); status();
    };
    sel.onchange = function () { lsSet('wr-music-bucket-override', sel.value); applyChapter(st.chap); };
    status();
  }

  /* ---------- Hook into the reader without changing its code ---------- */
  function hook() {
    var app = window.app; if (!app) return;
    var load = $('use-text-btn');
    if (load) load.addEventListener('click', function () { var t = $('text'); applyChapter(detectChapter(t && t.value)); });
    var hs = app.highlightSentenceAt;
    if (typeof hs === 'function') app.highlightSentenceAt = function (ci) { var r = hs.apply(this, arguments); try { onPos(ci); } catch (e) {} return r; };
    ['play', 'pause', 'stop'].forEach(function (n) {
      var orig = app[n]; if (typeof orig !== 'function') return;
      app[n] = function () {
        if (n === 'play') { st.wantPlay = true; playCurrent(false); }
        else { st.wantPlay = false; pauseMusic(); status(); }
        return orig.apply(this, arguments);
      };
    });
  }

  function init() {
    st.vol = parseFloat(lsGet('wr-music-vol', '0.35')) || 0.35;
    var cuesP = fetch('music-cues.json').then(function (r) { return r.json(); }).catch(function () { return null; });
    fetch('music-map.json').then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (m) {
      st.map = m; return cuesP;
    }).then(function (c) {
      st.cues = c && c.cues ? c.cues : null; ui(); hook();
      idbLoad().then(function (blobs) { if (blobs.length) { addFiles(blobs, false); } });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__wrMusic = { detectChapter: detectChapter, bucketOf: bucketOf, state: st, onPos: onPos, applyChapter: applyChapter, trackIndex: trackIndex };
})();
