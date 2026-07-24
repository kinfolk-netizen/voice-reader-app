/**
 * TTS Proxy - Netlify Serverless Function
 * Securely handles TTS generation requests for multiple providers
 * 
 * Timestamp: 2:45PM, 12.10.24
 * Document ID: VR-API-TTS-Proxy-241210-1445
 */

// Phase A (2026-07-23): pronunciation lexicon. LEXICON is the single source of
// truth (public/score/saga-lexicon.json). ElevenLabs uses a pronunciation
// dictionary (spoken text is NEVER mutated, so word-sync offsets stay aligned);
// Speechify uses caption-safe substitution + offset remap (helpers at bottom).
// Both degrade gracefully to today's behavior when unconfigured.
const LEXICON = require('../public/score/saga-lexicon.json');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const { providerId, text, voice, options = {} } = JSON.parse(event.body);

    // Phase A: set only on the Speechify lexicon path; drives the mark remap
    // that keeps captions aligned to the ORIGINAL (displayed) text.
    let lexiconEdits = null;
    let speechifyInput = null; // the exact text sent to Speechify (post-lexicon/SSML)
    let elDictAttached = false; // true when an EL pronunciation dictionary rode the request
    let emotionWrap = null; // Phase B: {prefixLen, contentLen} when emotion SSML wraps the input

    // Validate required fields
    if (!providerId || !text) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing required fields: providerId and text are required'
        })
      };
    }

    // Get API key from environment
    let apiKey;
    let apiEndpoint;
    
    switch (providerId) {
      case 'openai':
        apiKey = process.env.OPENAI_API_KEY;
        apiEndpoint = 'https://api.openai.com/v1/audio/speech';
        break;
      case 'azure':
        apiKey = process.env.AZURE_SPEECH_KEY;
        apiEndpoint = process.env.AZURE_SPEECH_REGION
          ? `https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`
          : null;
        break;
      case 'elevenlabs':
        apiKey = process.env.ELEVENLABS_API_KEY;
        // v2.20: request character-level timestamps so the reader gets real
        // word-sync marks from ElevenLabs (falls back to plain audio below).
        apiEndpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voice || 'default'}/with-timestamps`;
        break;
      case 'speechify':
        apiKey = process.env.SPEECHIFY_API_KEY;
        apiEndpoint = 'https://api.speechify.ai/v1/audio/speech';
        break;
      case 'local':
        // Local provider doesn't need API key
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            success: false,
            error: 'Local provider should be used client-side, not via proxy'
          })
        };
      default:
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            success: false,
            error: `Unknown provider: ${providerId}`
          })
        };
    }

    // Check if API key exists
    if (!apiKey) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: `API key not configured for provider: ${providerId}`
        })
      };
    }

    // Make request to TTS provider
    let response;
    
    if (providerId === 'openai') {
      response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: options.model || 'tts-1',
          input: text,
          voice: voice || 'alloy',
          response_format: options.format || 'mp3'
        })
      });
    } else if (providerId === 'elevenlabs') {
      const elHeaders = {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      };
      // Phase A: attach the pronunciation dictionary (alias respellings) when
      // provisioned. The `text` itself is unchanged, so the /with-timestamps
      // alignment still indexes the source characters -> captions stay exact.
      const elBodyObj = {
        text: text,
        model_id: options.model || 'eleven_multilingual_v2',
        voice_settings: options.voiceSettings || {
          stability: 0.5,
          similarity_boost: 0.5
        }
      };
      const pdLocators = elPronLocators(options);
      if (pdLocators) { elBodyObj.pronunciation_dictionary_locators = pdLocators; elDictAttached = true; }
      const elBody = JSON.stringify(elBodyObj);
      response = await fetch(apiEndpoint, { method: 'POST', headers: elHeaders, body: elBody });
      if (!response.ok) {
        // with-timestamps unavailable for this voice/model — fall back to the
        // plain endpoint (audio only; the reader degrades to estimated sync).
        const plainEndpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voice || 'default'}`;
        response = await fetch(plainEndpoint, { method: 'POST', headers: elHeaders, body: elBody });
      }
    } else if (providerId === 'azure') {
      if (!apiEndpoint) {
        return {
          statusCode: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ success: false, error: 'AZURE_SPEECH_REGION not configured' })
        };
      }
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
      const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'>${esc(text)}</voice></speak>`;
      response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'WitnessReader'
        },
        body: ssml
      });
    } else if (providerId === 'speechify') {
      // Phase A: Speechify has no pronunciation dictionary, so we substitute
      // lexicon names in the SPOKEN text and remap the returned marks back to
      // source offsets (below). Behind SPEECHIFY_LEXICON=on so the narrator's
      // word-sync can't regress before the live caption check.
      speechifyInput = text;
      if (process.env.SPEECHIFY_LEXICON === 'on') {
        const applied = applyLexicon(text);
        speechifyInput = applied.spoken;
        lexiconEdits = applied.edits;
      }
      let speechifyModel = options.model || 'simba-3.2';
      // Phase B: wrap in emotion SSML when a cue is present and enabled. Emotion
      // needs simba-english. Skipped if lexicon substitution is active (avoids a
      // double remap) or the cue is unknown / the line has &/< (see helper). The
      // cue was already stripped from the spoken text by the parser.
      if (process.env.SPEECHIFY_EMOTION === 'on' && options.emotion && (!lexiconEdits || !lexiconEdits.length)) {
        const wrap = speechifyEmotionSSML(speechifyInput, options.emotion);
        if (wrap) {
          speechifyInput = wrap.ssml;
          speechifyModel = 'simba-english';
          emotionWrap = { prefixLen: wrap.prefixLen, contentLen: wrap.contentLen };
        }
      }
      // Speechify hard limit: 2000 chars per request (frontend chunks well below this)
      if (speechifyInput.length > 2000) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            success: false,
            error: 'Speechify requests are limited to 2000 characters. Send smaller chunks.'
          })
        };
      }
      response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: speechifyInput,
          voice_id: voice || 'oliver',
          model: speechifyModel,
          audio_format: options.format || 'mp3'
        })
      });
    }

    // Speechify: most English voices support simba-english, not simba-3.2.
    // If the model was rejected for this voice, retry once with simba-english.
    if (providerId === 'speechify' && response.status === 400) {
      const errText = await response.clone().text();
      if (errText.includes('not available for') || errText.includes('simba')) {
        response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            input: speechifyInput != null ? speechifyInput : text,
            voice_id: voice || 'oliver',
            model: 'simba-english',
            audio_format: options.format || 'mp3'
          })
        });
      }
    }

    // Check response
    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: `Provider error: ${response.statusText}`,
          details: errorText
        })
      };
    }

    // Get audio data.
    // Speechify returns JSON ({ audio_data: <base64>, speech_marks: {...} });
    // OpenAI / ElevenLabs return raw audio bytes.
    let audioBase64;
    let speechMarks = null;
    const contentType = response.headers.get('content-type') || '';
    if (providerId === 'speechify' || contentType.includes('application/json')) {
      const json = await response.json();
      audioBase64 = json.audio_data || json.audioData || json.audio || json.audio_base64;
      speechMarks = json.speech_marks || json.speechMarks || null;
      // Phase A: names were substituted in the spoken text, so the marks index
      // the substituted string. Remap every offset back to the source text so
      // the reader highlights the right displayed word.
      if (lexiconEdits && lexiconEdits.length && speechMarks) {
        speechMarks = remapMarksToSource(speechMarks, lexiconEdits);
      }
      // Phase B: undo the SSML prefix shift if Speechify indexed marks into the
      // SSML string (auto-detected). No-op if marks are already plain-text-indexed.
      if (emotionWrap && speechMarks) {
        speechMarks = remapEmotionMarks(speechMarks, emotionWrap);
      }
      // ElevenLabs with-timestamps: convert character alignment -> word marks
      // in the same shape the reader already consumes ({start, start_time}).
      if (!speechMarks && (json.alignment || json.normalized_alignment)) {
        const al = json.alignment || json.normalized_alignment;
        // Phase A safety net: if a pronunciation dictionary is attached and the
        // returned alignment no longer indexes the source text 1:1 (an alias
        // could shift it), drop the marks so the reader falls back to weighted
        // estimation rather than highlighting the wrong word. No dictionary
        // attached -> unchanged behavior (never regresses today's captions).
        if (elDictAttached && Array.isArray(al.characters) && al.characters.length !== text.length) {
          speechMarks = null;
        } else {
          speechMarks = elAlignmentToMarks(al);
        }
      }
      if (!audioBase64) {
        return {
          statusCode: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            success: false,
            error: 'Provider returned JSON without audio data',
            details: JSON.stringify(Object.keys(json))
          })
        };
      }
    } else {
      const audioBuffer = await response.arrayBuffer();
      audioBase64 = Buffer.from(audioBuffer).toString('base64');
    }

    // Calculate cost (speechify: ~$10 per 1M chars at Starter overage rates)
    const costPerChar =
      providerId === 'openai' ? 0.000015 :
      providerId === 'speechify' ? 0.00001 :
      providerId === 'azure' ? 0.000016 :
      0.00003;
    const estimatedCost = text.length * costPerChar;

    // Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        audio: audioBase64,
        speechMarks: speechMarks,
        format: options.format || 'mp3',
        provider: providerId,
        voice: voice,
        characters: text.length,
        estimatedCost: estimatedCost.toFixed(6)
      })
    };

  } catch (error) {
    console.error('TTS Proxy Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

// v2.20: ElevenLabs character alignment -> word-level speech marks.
// Groups characters into words at whitespace; each word yields
// { start: charOffsetInSentText, start_time: ms } — the exact shape
// flattenSpeechMarks() in the reader already consumes.
function elAlignmentToMarks(alignment) {
  if (!alignment || !Array.isArray(alignment.characters) ||
      !Array.isArray(alignment.character_start_times_seconds)) return null;
  const chars = alignment.characters;
  const times = alignment.character_start_times_seconds;
  const marks = [];
  let inWord = false;
  for (let i = 0; i < chars.length; i++) {
    const isSpace = /\s/.test(chars[i] || ' ');
    if (!isSpace && !inWord) {
      marks.push({ start: i, start_time: Math.round((times[i] || 0) * 1000) });
      inWord = true;
    } else if (isSpace) {
      inWord = false;
    }
  }
  return marks.length ? marks : null;
}
exports._elAlignmentToMarks = elAlignmentToMarks;

// ============================================================================
// Phase A — pronunciation lexicon (caption-safe)
// ============================================================================

// ElevenLabs pronunciation-dictionary locators. Options override env; env is the
// provisioned default (set once after uploading saga-lexicon.pls). null -> today.
function elPronLocators(options) {
  if (options && Array.isArray(options.pronunciationDictionaryLocators)) {
    return options.pronunciationDictionaryLocators;
  }
  const id = process.env.ELEVENLABS_PRON_DICT_ID;
  if (!id) return null;
  const ver = process.env.ELEVENLABS_PRON_DICT_VERSION;
  return [ ver
    ? { pronunciation_dictionary_id: id, version_id: ver }
    : { pronunciation_dictionary_id: id } ];
}

// Cached matcher built from the lexicon. Longest match wins; apostrophes are
// straight/curly-tolerant; boundaries are letter-only so possessives ("Ka'el's")
// and embedded substrings ("Kaelin") are handled correctly.
let _matcher = null;
function _key(s) { return s.toLowerCase().replace(/[’]/g, "'"); }
function getMatcher() {
  if (_matcher) return _matcher;
  const entries = [];
  for (const c of LEXICON.characters) for (const m of c.match) entries.push({ m, say: c.say });
  entries.sort((a, b) => b.m.length - a.m.length);
  const alts = [];
  const map = new Map();
  for (const e of entries) {
    alts.push(e.m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]"));
    map.set(_key(e.m), e.say);
  }
  const re = new RegExp('(?<![A-Za-z])(' + alts.join('|') + ')(?![A-Za-z])', 'gi');
  _matcher = { re, map };
  return _matcher;
}

// text -> { spoken, edits:[{srcStart,srcEnd,dstStart,dstEnd}] }.
// Whole-word, case-insensitive, curated allow-list (Risk A2). No match -> spoken
// === text and edits === [] (pure no-op).
function applyLexicon(text) {
  const { re, map } = getMatcher();
  const edits = [];
  let out = '', last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    const matched = m[1];
    const say = map.get(_key(matched));
    if (say === undefined) continue;
    const srcStart = m.index, srcEnd = srcStart + matched.length;
    out += text.slice(last, srcStart);
    const dstStart = out.length;
    out += say;
    edits.push({ srcStart, srcEnd, dstStart, dstEnd: out.length });
    last = srcEnd;
  }
  out += text.slice(last);
  return { spoken: out, edits };
}

// Map a spoken-text offset back to the source-text offset. Offsets inside a
// substituted token collapse to that name's start (whole-word highlight).
function remapOffset(dst, edits) {
  let delta = 0;
  for (const e of edits) {
    if (dst < e.dstStart) break;
    if (dst < e.dstEnd) return e.srcStart;
    delta += (e.dstEnd - e.dstStart) - (e.srcEnd - e.srcStart);
  }
  return dst - delta;
}

// Deep-clone speech marks, remapping every numeric start/end to source space.
function remapMarksToSource(sm, edits) {
  if (!sm || !edits || !edits.length) return sm;
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const copy = {};
      for (const k of Object.keys(node)) {
        if (k === 'start' && typeof node.start === 'number') copy.start = remapOffset(node.start, edits);
        else if (k === 'end' && typeof node.end === 'number') copy.end = remapOffset(node.end, edits);
        else copy[k] = walk(node[k]);
      }
      return copy;
    }
    return node;
  };
  return walk(sm);
}

exports._elPronLocators = elPronLocators;
exports._applyLexicon = applyLexicon;
exports._remapOffset = remapOffset;
exports._remapMarksToSource = remapMarksToSource;
exports._LEXICON = LEXICON;

// ============================================================================
// Phase B — Speechify emotion (caption-safe)
// ============================================================================

// Neutral cue -> Speechify <speechify:style emotion> (+ optional prosody).
// The 13-cue vocabulary maps onto Speechify's emotion set; a few common
// synonyms are folded in. Anything not here -> plain delivery (graceful).
const SPEECHIFY_EMO = {
  whisper: { style: 'calm',      volume: 'x-soft' },
  soft:    { style: 'calm',      volume: 'soft'   },
  warm:    { style: 'warm'                        },
  tender:  { style: 'warm',      volume: 'soft'   },
  calm:    { style: 'calm'                        },
  sad:     { style: 'sad'                         },
  afraid:  { style: 'fearful'                     },
  angry:   { style: 'angry'                       },
  firm:    { style: 'assertive'                   },
  bright:  { style: 'bright'                       },
  urgent:  { style: 'energetic', rate: 'fast'     },
  flat:    { style: 'direct'                       },
  weary:   { style: 'relaxed',   rate: 'slow'     }
};
const SPEECHIFY_EMO_SYN = {
  quiet: 'soft', hushed: 'soft', scared: 'afraid', terrified: 'afraid',
  gentle: 'tender', tired: 'weary', hard: 'firm', excited: 'bright', flatly: 'flat'
};
function resolveCue(cue) {
  if (!cue) return null;
  const c = String(cue).toLowerCase();
  if (SPEECHIFY_EMO[c]) return c;
  if (SPEECHIFY_EMO_SYN[c]) return SPEECHIFY_EMO_SYN[c];
  return null;
}

// Wrap plain text in Speechify emotion SSML. Returns null (-> plain delivery) if
// the cue is unknown or the text contains &/< (kept out of SSML so escaping can
// never shift caption offsets). Quotes/apostrophes are legal in element text and
// left as-is. prefixLen is the byte offset where the spoken text begins.
function speechifyEmotionSSML(text, cue) {
  const key = resolveCue(cue);
  if (!key) return null;
  if (/[&<]/.test(text)) return null;
  const m = SPEECHIFY_EMO[key];
  let inner = text;
  const pros = [];
  if (m.rate) pros.push('rate="' + m.rate + '"');
  if (m.volume) pros.push('volume="' + m.volume + '"');
  if (pros.length) inner = '<prosody ' + pros.join(' ') + '>' + text + '</prosody>';
  const ssml = '<speak><speechify:style emotion="' + m.style + '">' + inner + '</speechify:style></speak>';
  return { ssml: ssml, prefixLen: ssml.indexOf(text), contentLen: text.length };
}

// Undo the SSML prefix if Speechify indexed its marks into the SSML string.
// Detection: the smallest mark offset is >= the prefix length, i.e. the first
// spoken word begins after the opening tags. If marks are already plain-text-
// indexed (Speechify stripped the markup for alignment), this is a no-op.
function remapEmotionMarks(sm, wrap) {
  const starts = [];
  (function collect(n) {
    if (!n) return;
    if (Array.isArray(n)) { n.forEach(collect); return; }
    if (typeof n.start === 'number') starts.push(n.start);
    if (n.chunks) collect(n.chunks);
  })(sm);
  if (!starts.length) return sm;
  if (Math.min.apply(null, starts) < wrap.prefixLen) return sm; // already plain-indexed
  const shift = (o) => Math.max(0, Math.min(wrap.contentLen - 1, o - wrap.prefixLen));
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const copy = {};
      for (const k of Object.keys(node)) {
        if (k === 'start' && typeof node.start === 'number') copy.start = shift(node.start);
        else if (k === 'end' && typeof node.end === 'number') copy.end = shift(node.end);
        else copy[k] = walk(node[k]);
      }
      return copy;
    }
    return node;
  };
  return walk(sm);
}

exports._speechifyEmotionSSML = speechifyEmotionSSML;
exports._remapEmotionMarks = remapEmotionMarks;
exports._resolveCue = resolveCue;
