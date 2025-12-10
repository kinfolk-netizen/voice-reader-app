/**
 * Get Voices API - Netlify Serverless Function
 * Returns available voices for specified TTS provider(s)
 * 
 * Timestamp: 2:47PM, 12.10.24
 * Document ID: VR-API-Get-Voices-241210-1447
 */

exports.handler = async (event, context) => {
  // Handle CORS
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const providerId = params.providerId;

    // Voice data for all providers
    const VOICES = {
      local: {
        providerId: 'local',
        providerName: 'Local Browser TTS',
        supportsBoundaries: true,
        tier: 'free',
        voices: [
          { id: 'default', label: 'Default', gender: 'neutral' }
        ]
      },
      openai: {
        providerId: 'openai',
        providerName: 'OpenAI TTS',
        supportsBoundaries: false,
        tier: 'premium',
        voices: [
          { id: 'alloy', label: 'Alloy', gender: 'neutral', style: 'clear' },
          { id: 'echo', label: 'Echo', gender: 'male', style: 'warm' },
          { id: 'fable', label: 'Fable', gender: 'neutral', style: 'expressive' },
          { id: 'onyx', label: 'Onyx', gender: 'male', style: 'deep' },
          { id: 'nova', label: 'Nova', gender: 'female', style: 'bright' },
          { id: 'shimmer', label: 'Shimmer', gender: 'female', style: 'soft' }
        ]
      },
      azure: {
        providerId: 'azure',
        providerName: 'Azure Speech',
        supportsBoundaries: true,
        tier: 'premium',
        voices: [
          { id: 'en-US-JennyNeural', label: 'Jenny (US)', gender: 'female', accent: 'US' },
          { id: 'en-US-GuyNeural', label: 'Guy (US)', gender: 'male', accent: 'US' },
          { id: 'en-GB-SoniaNeural', label: 'Sonia (UK)', gender: 'female', accent: 'UK' },
          { id: 'en-AU-NatashaNeural', label: 'Natasha (AU)', gender: 'female', accent: 'AU' }
        ]
      },
      elevenlabs: {
        providerId: 'elevenlabs',
        providerName: 'ElevenLabs',
        supportsBoundaries: false,
        tier: 'premium',
        voices: [] // Would fetch dynamically with API key
      }
    };

    // If specific provider requested
    if (providerId) {
      const provider = VOICES[providerId];
      if (!provider) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            success: false,
            error: `Provider not found: ${providerId}`
          })
        };
      }

      // For ElevenLabs, try to fetch real voices if API key available
      if (providerId === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
        try {
          const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: {
              'xi-api-key': process.env.ELEVENLABS_API_KEY
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            provider.voices = data.voices.map(v => ({
              id: v.voice_id,
              label: v.name,
              category: v.category,
              description: v.description
            }));
          }
        } catch (error) {
          console.log('Could not fetch ElevenLabs voices:', error.message);
          // Use default empty array
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          ...provider
        })
      };
    }

    // Return all providers
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        providers: Object.values(VOICES)
      })
    };

  } catch (error) {
    console.error('Get Voices Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
