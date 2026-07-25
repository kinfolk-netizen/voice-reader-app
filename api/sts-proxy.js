/**
 * Speech-to-Speech Proxy - Netlify Serverless Function
 * Securely re-voices a recorded clip into a target (cast) voice via ElevenLabs
 * speech-to-speech. Mirrors tts-proxy.js: the API key lives server-side and is
 * never exposed to the browser.
 *
 * Reference (the curl this endpoint replaces):
 *   curl -X POST "https://api.elevenlabs.io/v1/speech-to-speech/$VOICE_ID" \
 *     -H "xi-api-key: $XI_API_KEY" \
 *     -F model_id=eleven_multilingual_sts_v2 \
 *     -F audio=@"clip.m4a" --output out.mp3
 *
 * Request (POST, application/json):
 *   {
 *     voiceId:   "<elevenlabs voice id>",   // required (target voice, e.g. Junia's)
 *     audio:     "<base64 audio bytes>",    // required (the source recording)
 *     mimeType:  "audio/m4a",               // optional (default audio/mpeg)
 *     filename:  "recording.m4a",           // optional (default audio.mp3)
 *     modelId:   "eleven_multilingual_sts_v2", // optional
 *     // The knobs below are accepted nested under `options` OR at the top level,
 *     // in camelCase OR snake_case (output_format, remove_background_noise, ...):
 *     options: {
 *       outputFormat: "mp3_44100_128",      // optional (ElevenLabs output_format)
 *       removeBackgroundNoise: false,       // optional
 *       voiceSettings: { stability, similarity_boost } // optional
 *     }
 *   }
 *
 * Response (200, application/json):
 *   { success, audio: "<base64 mp3>", format, provider: "elevenlabs", voice }
 *
 * Note: Netlify caps request bodies at ~6MB and base64 inflates ~33%, so keep
 * source clips short (a few MB of raw audio). Chunk longer material client-side.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const JSON_HEADERS = Object.assign({ 'Content-Type': 'application/json' }, CORS);

function fail(statusCode, error, extra) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(Object.assign({ success: false, error }, extra || {}))
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return fail(405, 'Method not allowed');
  }

  try {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return fail(400, 'Invalid JSON body');
    }

    const { voiceId, audio, mimeType, filename, modelId, options = {} } = payload;

    // Tunable knobs are accepted either nested under `options` or at the top
    // level, and in camelCase or snake_case — so callers can send the natural
    // ElevenLabs field names (e.g. remove_background_noise) without contortion.
    const opt = options || {};
    const pick = (...keys) => {
      for (const k of keys) {
        if (opt[k] != null) return opt[k];
        if (payload[k] != null) return payload[k];
      }
      return undefined;
    };
    const outputFormat = pick('outputFormat', 'output_format');
    const removeBackgroundNoise = pick('removeBackgroundNoise', 'remove_background_noise');
    const voiceSettings = pick('voiceSettings', 'voice_settings');

    // Validate required fields
    if (!voiceId) return fail(400, 'Missing required field: voiceId');
    if (!audio) return fail(400, 'Missing required field: audio (base64)');

    // Decode the source recording
    let audioBuffer;
    try {
      audioBuffer = Buffer.from(audio, 'base64');
    } catch (e) {
      return fail(400, 'audio is not valid base64');
    }
    if (!audioBuffer.length) return fail(400, 'audio decoded to zero bytes');

    // API key stays server-side (same env var tts-proxy uses)
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return fail(401, 'API key not configured for provider: elevenlabs');

    // Build the multipart form for ElevenLabs speech-to-speech. Node 18 (Netlify's
    // runtime) ships global fetch/FormData/Blob via undici, so no dependency needed.
    const form = new FormData();
    form.append('model_id', modelId || 'eleven_multilingual_sts_v2');
    if (outputFormat) form.append('output_format', outputFormat);
    if (removeBackgroundNoise != null) {
      form.append('remove_background_noise', String(!!removeBackgroundNoise));
    }
    if (voiceSettings) {
      form.append('voice_settings', JSON.stringify(voiceSettings));
    }
    const blob = new Blob([audioBuffer], { type: mimeType || 'audio/mpeg' });
    form.append('audio', blob, filename || 'audio.mp3');

    const endpoint = `https://api.elevenlabs.io/v1/speech-to-speech/${encodeURIComponent(voiceId)}`;
    // Only the API key header — let fetch set the multipart Content-Type + boundary.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form
    });

    if (!response.ok) {
      const details = await response.text();
      return {
        statusCode: response.status,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          success: false,
          error: `Provider error: ${response.statusText}`,
          details
        })
      };
    }

    const outBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(outBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        success: true,
        audio: audioBase64,
        format: (outputFormat || 'mp3_44100_128').startsWith('mp3') ? 'mp3' : 'raw',
        provider: 'elevenlabs',
        voice: voiceId,
        sourceBytes: audioBuffer.length
      })
    };
  } catch (error) {
    console.error('STS Proxy Error:', error);
    return fail(500, 'Internal server error', { message: error.message });
  }
};
