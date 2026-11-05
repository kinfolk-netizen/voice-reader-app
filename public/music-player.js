/* Witness Reader - background music (loaded from the listener's own device only).
   No audio is bundled or hosted. Music volume is its own Web Audio GainNode. */
(function () {
  'use strict';
  var AC = window.AudioContext || window.webkitAudioContext;
  var DB = 'wr-music', STORE = 'tracks';
  var st = { tracks: [], map: null, bucket: null, list: [], idx: 0, on: true, vol: 0.35, ctx: null, gain: null, el: null, chap: null, wantPlay: false };

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
    st.el = new Audio();
    st.el.preload = 'auto';
    st.el.addEventListener('ended', function () { next(); });
    var src = st.ctx.createMediaElementSource(st.el);
    st.gain = st.ctx.createGain();
    st.gain.gain.value = 0;
    src.connect(st.gain); st.gain.connect(st.ctx.destination);
    if (st.ctx.state === 'suspended') st.ctx.resume();
  }
  function setVol(v, fade) {
    st.vol = v; lsSet('wr-music-vol', String(v));
    if (!st.gain) return;
    var t = st.ctx.currentTime;
    st.gain.gain.cancelScheduledValues(t);
    st.gain.gain.setTargetAtTime(st.on ? v : 0, t, fade || 0.05);
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
    if ((m = /\bch(?:apter)?\.?\s*0*(\d{1,2})\b/i.exec(h))) return 'ch' + ('0' + m[1]).slice(-2);
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
    buildList(); status();
    if (st.wantPlay && st.on) { playCurrent(true); }
  }

  function playCurrent(fade) {
    if (!st.list.length || !st.on) return;
    ensureAudio(); if (!st.ctx) return; setSession();
    var t = st.list[st.idx];
    if (st.el._name !== t.name) {
      if (st.el._url) URL.revokeObjectURL(st.el._url);
      st.el._url = URL.createObjectURL(t); st.el._name = t.name; st.el.src = st.el._url;
    }
    if (st.gain && fade) { st.gain.gain.cancelScheduledValues(st.ctx.currentTime); st.gain.gain.setValueAtTime(0, st.ctx.currentTime); }
    var p = st.el.play(); if (p && p.catch) p.catch(function () {});
    setVol(st.vol, fade ? 1.2 : 0.05); status();
  }
  function pauseMusic() { if (st.el) st.el.pause(); }
  function next() { if (!st.list.length) return; st.idx = (st.idx + 1) % st.list.length; if (st.wantPlay) playCurrent(true); else status(); }

  /* ---------- UI (injected; keeps index.html edits tiny) ---------- */
  function status() {
    var s = $('wr-music-status'); if (!s) return;
    var lab = st.map && st.map.buckets && st.bucket ? (st.map.buckets[st.bucket] || st.bucket) : 'all tracks';
    s.textContent = st.tracks.length
      ? st.tracks.length + ' tracks loaded - chapter: ' + (st.chap || 'unknown') + ' - mood: ' + lab + (st.list[st.idx] ? ' - now: ' + st.list[st.idx].name : '')
      : 'No music loaded. Choose MP3 files from your device.';
  }
  function addFiles(files, persist) {
    var seen = {}; st.tracks.forEach(function (t) { seen[t.name] = 1; });
    Array.prototype.forEach.call(files, function (f) { if (!seen[f.name]) st.tracks.push(f); });
    if (persist) idbSave(Array.prototype.slice.call(files));
    buildList(); status();
  }
  function ui() {
    var ref = $('player-card'); if (!ref || $('music-card')) return;
    var c = document.createElement('div'); c.className = 'card'; c.id = 'music-card';
    c.innerHTML =
      '<h2 style="margin:0 0 8px">Background music</h2>' +
      '<p id="wr-music-status" style="margin:0 0 8px;font-size:.9em"></p>' +
      '<input type="file" id="wr-music-files" accept="audio/*" multiple style="display:none">' +
      '<button type="button" id="wr-music-pick">Choose music</button> ' +
      '<button type="button" id="wr-music-toggle">Music: on</button> ' +
      '<button type="button" id="wr-music-next">Next</button> ' +
      '<button type="button" id="wr-music-clear">Clear music</button>' +
      '<div style="margin-top:10px"><label>Music volume <input type="range" id="wr-music-vol" min="0" max="1" step="0.01" style="width:60%"></label></div>' +
      '<div style="margin-top:10px"><label>Mood <select id="wr-music-mood"><option value="">Auto (match chapter)</option></select></label></div>' +
      '<p style="font-size:.8em;opacity:.7;margin:8px 0 0">Music stays on your device. Name files like 01-... to 06-... to match moods.</p>';
    ref.parentNode.insertBefore(c, ref.nextSibling);
    var sel = $('wr-music-mood');
    if (st.map && st.map.buckets) Object.keys(st.map.buckets).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = k + ' ' + st.map.buckets[k]; sel.appendChild(o);
    });
    sel.value = lsGet('wr-music-bucket-override', '');
    var v = $('wr-music-vol'); v.value = st.vol;
    v.addEventListener('input', function () { setVol(parseFloat(v.value), 0.03); });
    $('wr-music-pick').onclick = function () { ensureAudio(); $('wr-music-files').click(); };
    $('wr-music-files').onchange = function (e) { addFiles(e.target.files, true); };
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
    fetch('music-map.json').then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (m) {
      st.map = m; ui(); hook();
      idbLoad().then(function (blobs) { if (blobs.length) { addFiles(blobs, false); } });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__wrMusic = { detectChapter: detectChapter, bucketOf: bucketOf };
})();
