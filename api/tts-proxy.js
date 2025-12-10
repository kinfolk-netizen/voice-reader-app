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
        // Azure endpoint would be configured here
        break;
      case 'elevenlabs':
        apiKey = process.env.ELEVENLABS_API_KEY;
        apiEndpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voice || 'default'}`;
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
      response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: options.model || 'eleven_monolingual_v1',
          voice_settings: options.voiceSettings || {
            stability: 0.5,
            similarity_boost: 0.5
          }
        })
      });
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

    // Get audio data
    const audioBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    // Calculate cost
    const costPerChar = providerId === 'openai' ? 0.000015 : 0.00003;
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
