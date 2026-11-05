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
  function status() {
    var s = $('wr-music-status'); if (!s) return;
    var lab = st.map && st.map.buckets && st.bucket ? (st.map.buckets[st.bucket] || st.bucket) : 'all tracks';
    s.textContent = st.tracks.length
      ? st.tracks.length + ' tracks loaded - chapter: ' + (st.chap || 'unknown') + ' - mood: ' + lab + (st.list[st.idx] ? ' - now: ' + st.list[st.idx].name : '')
      : 'No music loaded yet. Tap Add music folder and pick your MUSIC folder.';
  }
  function addFiles(files, persist) {
    var seen = {}; st.tracks.forEach(function (t) { seen[t.name] = 1; });
    Array.prototype.forEach.call(files, function (f) { if (!/\.(mp3|m4a|aac|wav|flac|ogg)$/i.test(f.name) || /^XX-/.test(f.name)) return; if (!seen[f.name]) st.tracks.push(f); });
    if (persist) idbSave(Array.prototype.slice.call(files));
    buildList(); status();
  }
  function ui() {
    var ref = $('player-card'); if (!ref || $('music-card')) return;
    var c = document.createElement('div'); c.className = 'card'; c.id = 'music-card';
    c.innerHTML =
      '<h2 style="margin:0 0 8px">Background music</h2>' +
      '<p style="margin:0 0 8px;font-size:.85em"><b>Step 1 (one time):</b> add your music library - choose the MUSIC folder. <b>After that,</b> music follows your chapter automatically.</p>' +
      '<p id="wr-music-status" style="margin:0 0 8px;font-size:.9em"></p>' +
      '<input type="file" id="wr-music-files" accept="audio/*" multiple style="display:none">' +
      '<input type="file" id="wr-music-dir" webkitdirectory multiple style="display:none">' +
      '<button type="button" id="wr-music-pickdir">Add music folder</button> ' +
      '<button type="button" id="wr-music-pick">Add files</button> ' +
      '<button type="button" id="wr-music-toggle">Music: on</button> ' +
      '<button type="button" id="wr-music-next">Next</button> ' +
      '<button type="button" id="wr-music-clear">Clear music</button>' +
      '<div style="margin-top:10px"><div style="font-size:.9em;margin-bottom:6px">Music volume: <b id="wr-music-pct"></b></div>' +
      '<div style="display:flex;align-items:center;gap:10px"><button type="button" id="wr-vol-down" aria-label="Music volume down 5 percent" style="min-width:56px;min-height:48px;font-size:1.4em">-</button>' +
      '<input type="range" id="wr-music-vol" min="0" max="1" step="0.01" style="flex:1">' +
      '<button type="button" id="wr-vol-up" aria-label="Music volume up 5 percent" style="min-width:56px;min-height:48px;font-size:1.4em">+</button></div></div>' +
      '<div style="margin-top:10px"><label>Mood <select id="wr-music-mood"><option value="">Auto (match chapter)</option></select></label></div>' +
      '<p style="font-size:.8em;opacity:.7;margin:8px 0 0">Music stays on your device. Files named 01- to 06- match chapter moods.</p>';
    ref.parentNode.insertBefore(c, ref.nextSibling);
    var sel = $('wr-music-mood');
    if (st.map && st.map.buckets) Object.keys(st.map.buckets).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = k + ' ' + st.map.buckets[k]; sel.appendChild(o);
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
    $('wr-music-pickdir').onclick = function () { ensureAudio(); $('wr-music-dir').click(); };
    $('wr-music-dir').onchange = function (e) { addFiles(e.target.files, true); };
    $('wr-music-toggle').onclick = function () {
      st.on = !st.on; this.textContent = 'Music: ' + (st.on ? 'on' : 'off');
      if (st.on) { if (st.wantPlay) playCurrent(true); } else { setVol(st.vol); pauseMusic(); }
    };
    $('wr-music-next').onclick = function () { if (st.list.length) { st.idx = (st.idx + 1) % st.list.length; st.wantPlay = true; playCurrent(true); } };
    $('wr-music-clear').onclick = function () { pauseMusic(); st.tracks = []; st.list = []; st.idx = 0; idbClear(); status(); };
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
        else { st.wantPlay = false; pauseMusic(); }
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
