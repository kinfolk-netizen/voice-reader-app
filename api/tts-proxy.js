/**
 * TTS Proxy - Netlify Serverless Function
 * Securely handles TTS generation requests for multiple providers
 * 
 * Timestamp: 2:45PM, 12.10.24
 * Document ID: VR-API-TTS-Proxy-241210-1445
 */

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
      const elBody = JSON.stringify({
        text: text,
        model_id: options.model || 'eleven_multilingual_v2',
        voice_settings: options.voiceSettings || {
          stability: 0.5,
          similarity_boost: 0.5
        }
      });
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
      // Speechify hard limit: 2000 chars per request (frontend chunks well below this)
      if (text.length > 2000) {
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
          input: text,
          voice_id: voice || 'oliver',
          model: options.model || 'simba-3.2',
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
            input: text,
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
      // ElevenLabs with-timestamps: convert character alignment -> word marks
      // in the same shape the reader already consumes ({start, start_time}).
      if (!speechMarks && (json.alignment || json.normalized_alignment)) {
        speechMarks = elAlignmentToMarks(json.alignment || json.normalized_alignment);
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
