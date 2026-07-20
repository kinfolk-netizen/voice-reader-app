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
      },
      speechify: {
        providerId: 'speechify',
        providerName: 'Speechify',
        supportsBoundaries: true, // real word timings via speech marks
        tier: 'premium',
        voices: [] // Fetched dynamically with API key
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
            const EL_ACCENTS = { american: 'American', british: 'British', australian: 'Australian', irish: 'Irish', 'south african': 'South African', indian: 'Indian', transatlantic: 'Transatlantic' };
            const EL_LOCALES = { american: 'en-US', british: 'en-GB', australian: 'en-AU', irish: 'en-IE', 'south african': 'en-ZA', indian: 'en-IN' };
            const elAge = a => {
              const s = (a || '').toLowerCase();
              if (s.includes('old') || s.includes('senior')) return 'senior';
              if (s.includes('middle')) return 'adult';
              if (s.includes('young') || s.includes('teen')) return 'young';
              return 'adult';
            };
            provider.voices = (data.voices || []).map(v => {
              const labels = v.labels || {};
              const name = v.name || v.voice_id;
              const gender = (labels.gender || '').toLowerCase();
              const age = elAge(labels.age);
              const accentKey = (labels.accent || '').toLowerCase();
              const locale = EL_LOCALES[accentKey] || '';
              const flavor = labels.description || labels.use_case || v.category || '';
              const bits = [age + ' ' + (gender || 'voice')];
              if (EL_ACCENTS[accentKey]) bits.push(EL_ACCENTS[accentKey]);
              if (flavor) bits.push(flavor);
              return {
                id: v.voice_id,
                label: name + ' — ' + bits.join(' · '),
                name: name,
                gender: gender,
                age: age,
                locale: locale,
                flavor: flavor,
                category: v.category || '',
                description: v.description || ''
              };
            });
          }
        } catch (error) {
          console.log('Could not fetch ElevenLabs voices:', error.message);
          // Use default empty array
        }
      }

      // For Azure, fetch the live neural voice list (region-scoped)
      if (providerId === 'azure' && process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) {
        try {
          const region = process.env.AZURE_SPEECH_REGION;
          const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
            headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY }
          });
          if (response.ok) {
            const list = await response.json();
            const AZ_ACCENTS = { 'en-US': 'American', 'en-GB': 'British', 'en-AU': 'Australian', 'en-IE': 'Irish', 'en-ZA': 'South African', 'en-IN': 'Indian', 'en-CA': 'Canadian', 'en-NG': 'Nigerian' };
            const AZ_CHILD = new Set(['en-US-AnaNeural']);
            const mapped = (Array.isArray(list) ? list : [])
              .filter(v => (v.Locale || '').toLowerCase().startsWith('en'))
              .map(v => {
                const locale = v.Locale;
                const gender = (v.Gender || '').toLowerCase();
                const age = AZ_CHILD.has(v.ShortName) ? 'teen' : 'adult';
                const name = v.DisplayName || v.LocalName || v.ShortName;
                const accent = AZ_ACCENTS[locale] || locale;
                return {
                  id: v.ShortName,
                  label: name + ' — ' + [age + ' ' + (gender || 'voice'), accent].join(' · '),
                  name: name,
                  gender: gender,
                  age: age,
                  locale: locale,
                  models: []
                };
              });
            if (mapped.length) provider.voices = mapped;
          }
        } catch (error) {
          console.log('Could not fetch Azure voices:', error.message);
        }
      }

      // For Speechify, fetch real voices dynamically (never hardcode voice names)
      if (providerId === 'speechify' && process.env.SPEECHIFY_API_KEY) {
        try {
          const response = await fetch('https://api.speechify.ai/v1/voices', {
            headers: {
              'Authorization': `Bearer ${process.env.SPEECHIFY_API_KEY}`
            }
          });

          if (response.ok) {
            const data = await response.json();
            const list = Array.isArray(data) ? data : (data.voices || []);
            const ACCENTS = { 'en-GB': 'British', 'en-US': 'American', 'en-AU': 'Australian', 'en-IN': 'Indian', 'en-NG': 'Nigerian' };
            const mapped = list.map(v => {
              const tags = Array.isArray(v.tags) ? v.tags : [];
              const tag = p => (tags.find(t => t.startsWith(p)) || '').slice(p.length);
              const locale = v.locale || (Array.isArray(v.models) && v.models[0] && Array.isArray(v.models[0].languages) && v.models[0].languages[0] ? v.models[0].languages[0].locale : '') || '';
              const ageTag = tag('age:');
              const age = ageTag === 'teen' ? 'teen' : ageTag === 'young-adult' ? 'young' : ageTag === 'senior' ? 'senior' : 'adult';
              const flavor = [tag('timbre:'), tag('style:')].filter(Boolean).slice(0, 2).join(', ');
              const name = v.display_name || v.name || v.id || v.voice_id;
              const bits = [age + ' ' + (v.gender || 'voice'), ACCENTS[locale] || locale];
              if (flavor) bits.push(flavor);
              return {
                id: v.id || v.voice_id,
                label: name + ' — ' + bits.join(' · '),
                name: name,
                gender: v.gender || '',
                age: age,
                flavor: flavor,
                models: Array.isArray(v.models) ? v.models.map(m => m.name) : [],
                locale: locale
              };
            }).filter(v => v.id && (v.locale || '').toLowerCase().startsWith('en'));
            // English first; en-GB male (saga narrator preference) sorted to top
            const score = v => {
              // Jonathan's narrator ruling 07.17.26: John Rhys-Davies primary, Benjamin backup
              if (v.id === 'john-rhys-davies') return -2;
              if (v.id === 'benjamin') return -1;
              const loc = (v.locale || '').toLowerCase();
              const g = (v.gender || '').toLowerCase();
              if (loc.startsWith('en-gb') && g === 'male') return 0;
              if (loc.startsWith('en-gb')) return 1;
              if (loc.startsWith('en') && g === 'male') return 2;
              if (loc.startsWith('en')) return 3;
              return 4;
            };
            provider.voices = mapped.sort((a, b) => score(a) - score(b));
          }
        } catch (error) {
          console.log('Could not fetch Speechify voices:', error.message);
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
