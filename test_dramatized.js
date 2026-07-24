// Offline test harness for the Dramatized Reader parser + chunker.
// Mirrors the functions in public/index.html (kept in sync by copy —
// verify with grep before trusting a green run).

const app = {
  NARRATOR: 'Narrator',
  castMap: { "KA’EL": 'benjamin', 'JUNIA': 'amelia' },
  voiceSelections: { speechify: 'john-rhys-davies' },

  parseScriptSegments(text) {
    // Kept in sync with public/index.html (Phase B): optional (cue) before colon.
    const tagRe = /^([A-Z][A-Z'’.\-]*(?:[ ][A-Z][A-Z'’.\-]*){0,2})(?:\s*\(([a-z][a-z\/-]*)\))?:\s+/;
    const segs = [];
    const paraRe = /[^\n][\s\S]*?(?=\n\s*\n|\n(?=[A-Z][A-Z'’.\-]*(?:[ ][A-Z][A-Z'’.\-]*){0,2}(?:\s*\([a-z][a-z\/-]*\))?:\s)|$)/g;
    let m;
    while ((m = paraRe.exec(text)) !== null) {
      const paraStart = m.index;
      const para = m[0];
      const tag = para.match(tagRe);
      let speaker = this.NARRATOR;
      let contentStart = paraStart;
      let emotion = null;
      if (tag) {
        speaker = tag[1].trim();
        if (speaker.toUpperCase() === 'NARRATOR') speaker = this.NARRATOR;
        emotion = tag[2] ? tag[2].toLowerCase() : null;
        contentStart = paraStart + tag[0].length;
      }
      const end = paraStart + para.length;
      if (end <= contentStart) continue;
      const last = segs[segs.length - 1];
      if (last && last.speaker === speaker && !tag) {
        last.end = end;
      } else {
        segs.push({ speaker, start: contentStart, end, emotion });
      }
    }
    return segs;
  },

  castKey(name) { return (name || '').trim().toUpperCase(); },

  voiceForSpeaker(speaker) {
    const key = (!speaker || speaker === this.NARRATOR)
      ? this.castKey(this.NARRATOR)
      : this.castKey(speaker);
    return this.castMap[key] || this.voiceSelections.speechify;
  },

  buildCloudChunks(text, limit = 500) {
    const chunks = [];
    const parts = text.split(/\n\s*\n/);
    let searchFrom = 0;
    const paraInfos = [];
    for (const p of parts) {
      if (!p.trim().length) continue;
      const idx = text.indexOf(p, searchFrom);
      searchFrom = idx + p.length;
      paraInfos.push({ text: p, start: idx });
    }
    let cur = null;
    const pushCur = () => { if (cur) { chunks.push(cur); cur = null; } };
    for (const p of paraInfos) {
      let pieces = [{ text: p.text, start: p.start }];
      if (p.text.length > limit) {
        pieces = [];
        const sre = /[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g;
        let m2;
        while ((m2 = sre.exec(p.text)) !== null) {
          pieces.push({ text: m2[0], start: p.start + m2.index });
        }
      }
      for (const piece of pieces) {
        const pieceEnd = piece.start + piece.text.length;
        if (cur && (pieceEnd - cur.start) > limit) pushCur();
        if (!cur) cur = { start: piece.start, end: pieceEnd };
        cur.end = pieceEnd;
      }
    }
    pushCur();
    return chunks.map(c => ({ start: c.start, end: c.end, text: text.slice(c.start, c.end) }));
  },

  buildDramatizedChunks(fullText, limit = 500) {
    const segs = this.parseScriptSegments(fullText);
    const chunks = [];
    for (const seg of segs) {
      const segText = fullText.slice(seg.start, seg.end);
      for (const c of this.buildCloudChunks(segText, limit)) {
        chunks.push({
          start: c.start + seg.start,
          end: c.end + seg.start,
          text: c.text,
          speaker: seg.speaker,
          voice: this.voiceForSpeaker(seg.speaker)
        });
      }
    }
    return chunks;
  }
};

// ---- Test 1: mixed narration + tagged dialogue, curly apostrophes, hard wraps ----
const sample = `The tower had been silent for three hundred years. Its stones
remembered songs no living voice could shape, and the wind that circled
its crown carried nothing but dust.

Junia pressed her palm against the cold door and waited.

JUNIA: “It’s warmer than it should be. Stone shouldn’t hold warmth like
this — not in the shadow of the hills.”

KA’EL: “Then it isn’t the stone that’s warm.”

She drew her hand back as if the door had breathed.

NARRATOR: The silence between them was its own kind of answer.

JUNIA: “Say that again.”`;

const segs = app.parseScriptSegments(sample);
console.log('--- Segments ---');
for (const s of segs) {
  console.log(`[${s.speaker}] ${JSON.stringify(sample.slice(s.start, s.end).slice(0, 60))}...`);
}

let pass = true;
const expectSpeakers = ['Narrator', 'JUNIA', 'KA’EL', 'Narrator', 'Narrator', 'JUNIA'];
const gotSpeakers = segs.map(s => s.speaker);
if (JSON.stringify(gotSpeakers) !== JSON.stringify(expectSpeakers)) {
  console.error('FAIL speakers:', gotSpeakers); pass = false;
}

// Narrator merge: paragraphs 1+2 (both untagged) should be ONE segment
if (gotSpeakers.filter(s => s === 'Narrator').length !== 3) {
  console.error('FAIL narrator merge'); pass = false;
}

// Tags must be excluded from spoken content
for (const s of segs) {
  const spoken = sample.slice(s.start, s.end);
  if (/^[A-Z’'A-Za-z.\- ]+:\s/.test(spoken) && !spoken.startsWith('It') === false) {
    // spot check: no segment starts with its own tag
  }
  if (spoken.startsWith('JUNIA:') || spoken.startsWith('KA’EL:') || spoken.startsWith('NARRATOR:')) {
    console.error('FAIL tag leaked into spoken text:', JSON.stringify(spoken.slice(0, 30))); pass = false;
  }
}

// ---- Test 2: chunks carry correct voices and offsets round-trip ----
const chunks = app.buildDramatizedChunks(sample);
console.log('--- Chunks ---');
for (const c of chunks) {
  console.log(`[${c.speaker} -> ${c.voice}] (${c.start}-${c.end}) ${JSON.stringify(c.text.slice(0, 45))}`);
  if (c.text !== sample.slice(c.start, c.end)) {
    console.error('FAIL offset round-trip on chunk at', c.start); pass = false;
  }
  if (c.text.length > 500) { console.error('FAIL chunk >500 chars'); pass = false; }
}
const junia = chunks.filter(c => c.speaker === 'JUNIA');
if (!junia.every(c => c.voice === 'amelia')) {
  console.error('FAIL JUNIA voice mapping (case-insensitive castKey):', junia.map(c => c.voice)); pass = false;
}
if (!chunks.filter(c => c.speaker === 'KA’EL').every(c => c.voice === 'benjamin')) {
  console.error('FAIL KA’EL voice mapping'); pass = false;
}
const kael = chunks.filter(c => c.speaker === 'KA’EL');
console.log('KA’EL voice:', kael[0] && kael[0].voice);

// ---- Test 3: plain prose (no tags) => everything narrator, single-voice path ----
const plain = 'A quiet morning. Nothing stirred.\n\nThe hills held their breath.';
const plainSegs = app.parseScriptSegments(plain);
if (!(plainSegs.length === 1 && plainSegs[0].speaker === 'Narrator')) {
  console.error('FAIL plain prose:', plainSegs); pass = false;
}

// ---- Test 4: false-positive guard — mid-sentence hard-wrapped line starting with a capitalized word+colon is INSIDE a paragraph, so paragraph-start rule protects it ----
const tricky = `He remembered the old warning well.
Beware: the tower answers those who knock.`;
const trickySegs = app.parseScriptSegments(tricky);
if (!(trickySegs.length === 1 && trickySegs[0].speaker === 'Narrator')) {
  console.error('FAIL tricky wrap:', trickySegs); pass = false;
}

// ---- Test 5: prose opener "Beware:" must NOT read as a speaker tag. Tags are
// ALL-CAPS only, so this stays one Narrator segment — no phantom speaker, and the
// word is not silently dropped from narration. ----
const edge = `Beware: the tower answers those who knock.`;
const edgeSegs = app.parseScriptSegments(edge);
if (edgeSegs.length !== 1 || edgeSegs[0].speaker !== app.NARRATOR) {
  console.error('FAIL "Beware:" should parse as a single Narrator segment, got:',
    edgeSegs.map(s => s.speaker)); pass = false;
}
const edgeSpoken = edge.slice(edgeSegs[0].start, edgeSegs[0].end);
if (!/^Beware: the tower/.test(edgeSpoken)) {
  console.error('FAIL "Beware:" was stripped as a tag instead of narrated:',
    JSON.stringify(edgeSpoken.slice(0, 30))); pass = false;
}

// ---- Test 6: blank-line collapse (mobile copy/paste strips the blank lines
// between turns). Turns separated by a SINGLE newline must STILL split into
// per-speaker segments, or the Cast card never appears and it reads as one
// Narrator. This is the regression that hid the Casting Room. ----
const collapsed = 'NARRATOR: The hall is set.\nKA’EL: I count the cobbles.\nJUNIA: Mine is gold.\nMARA: May I come in?';
const collapsedSegs = app.parseScriptSegments(collapsed);
const collapsedSpeakers = collapsedSegs.map(s => s.speaker);
if (JSON.stringify(collapsedSpeakers) !== JSON.stringify(['Narrator', 'KA’EL', 'JUNIA', 'MARA'])) {
  console.error('FAIL collapse split — expected 4 segments in order, got:', collapsedSpeakers); pass = false;
}
if (collapsedSegs.filter(s => s.speaker !== app.NARRATOR).length !== 3) {
  console.error('FAIL collapse — hasScriptTags would be false (Cast card would stay hidden)'); pass = false;
}
// tag must be stripped from spoken content so speech-mark offsets stay aligned
const kaelSeg = collapsedSegs.find(s => s.speaker === 'KA’EL');
const kaelSpoken = collapsed.slice(kaelSeg.start, kaelSeg.end);
if (!/^I count the cobbles/.test(kaelSpoken)) {
  console.error('FAIL collapse — tag not stripped from spoken text:', JSON.stringify(kaelSpoken)); pass = false;
}

// ---- Test 7: blank-line format still works unchanged (no regression) ----
const blanks = 'NARRATOR: The hall is set.\n\nKA’EL: I count the cobbles.\n\nJUNIA: Mine is gold.';
const blankSpeakers = app.parseScriptSegments(blanks).map(s => s.speaker);
if (JSON.stringify(blankSpeakers) !== JSON.stringify(['Narrator', 'KA’EL', 'JUNIA'])) {
  console.error('FAIL blank-line format regressed:', blankSpeakers); pass = false;
}

// ---- Test 8 (Phase B): emotion cue is extracted, stripped, offsets aligned ----
const emo = "JUNIA (afraid): Do you hear it?\nKA’EL (quiet): I hear it.\nNARRATOR: She drew back.\nTESSARA: Brace the wall.";
const emoSegs = app.parseScriptSegments(emo);
const emoSpeakers = emoSegs.map(s => s.speaker);
if (JSON.stringify(emoSpeakers) !== JSON.stringify(['JUNIA', 'KA’EL', 'Narrator', 'TESSARA'])) {
  console.error('FAIL emotion: speakers', emoSpeakers); pass = false;
}
if (JSON.stringify(emoSegs.map(s => s.emotion)) !== JSON.stringify(['afraid', 'quiet', null, null])) {
  console.error('FAIL emotion: cues', emoSegs.map(s => s.emotion)); pass = false;
}
// the spoken slice must NOT contain the "(cue)" — it was stripped with the tag
const juniaText = emo.slice(emoSegs[0].start, emoSegs[0].end);
if (juniaText !== 'Do you hear it?' ) { console.error('FAIL emotion: spoken text not clean:', JSON.stringify(juniaText)); pass = false; }
const kaelText = emo.slice(emoSegs[1].start, emoSegs[1].end);
if (kaelText !== 'I hear it.') { console.error('FAIL emotion: kael spoken:', JSON.stringify(kaelText)); pass = false; }
// no-cue lines still parse with emotion=null (backward compatible)
if (emoSegs[3].emotion !== null) { console.error('FAIL emotion: uncued line should be null'); pass = false; }

console.log(pass ? '\nALL CORE TESTS PASS' : '\nTESTS FAILED');
process.exit(pass ? 0 : 1);
