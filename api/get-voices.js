/**
 * Get Voices API - Netlify Serverless Function
 * Returns available voices for specified TTS provider(s)
 * 
 * Timestamp: 2:47PM, 12.10.24
 * Document ID: VR-API-Get-Voices-241210-1447
 */

// JOB 2 — Acapela children's voices. Known kids' names are tagged age 'child'
// (Acapela sells them as children's voices); anything else the account returns
// is treated as adult so the child-safety guard never seats a child on it.
const ACAPELA_KIDS = {
  harry:  { gender: 'male',   locale: 'en-GB', accent: 'British' },
  arthur: { gender: 'male',   locale: 'en-GB', accent: 'British' },
  caleb:  { gender: 'male',   locale: 'en-GB', accent: 'British' },
  archie: { gender: 'male',   locale: 'en-GB', accent: 'Scottish' },
  liam:   { gender: 'male',   locale: 'en-AU', accent: 'Australian' },
  rosie:  { gender: 'female', locale: 'en-GB', accent: 'British' },
  amelia: { gender: 'female', locale: 'en-GB', accent: 'British' },
  chloe:  { gender: 'female', locale: 'en-GB', accent: 'British' },
  amy:    { gender: 'female', locale: 'en-GB', accent: 'Northern English' },
  emilio: { gender: 'male',   locale: 'en-US', accent: 'American' },
  ella:   { gender: 'female', locale: 'en-US', accent: 'American' }
};
function acapelaVoiceEntry(id, name, gender, locale) {
  const nm = name || id;
  const kid = ACAPELA_KIDS[String(nm).toLowerCase()];
  const age = kid ? 'child' : 'adult';
  const g = (kid && kid.gender) || gender || '';
  const loc = (kid && kid.locale) || locale || '';
  const accent = (kid && kid.accent) || loc;
  return {
    id,
    label: nm + ' (Acapela) — ' + [age + ' ' + (g || 'voice'), accent].filter(Boolean).join(' · '),
    name: nm,
    gender: g,
    age,
    locale: loc
  };
}
const ACAPELA_FALLBACK = Object.keys(ACAPELA_KIDS).map(k => {
  const nm = k.charAt(0).toUpperCase() + k.slice(1);
  return acapelaVoiceEntry(nm, nm);
});

// Azure Speech. Microsoft's two English child voices are tagged age 'child';
// every other voice is adult. Only en-GB / en-US are served. "(Azure)" in every
// label keeps e.g. Ana distinct from voices of the same name elsewhere.
const AZURE_KIDS = new Set(['en-GB-MaisieNeural', 'en-US-AnaNeural']);
const AZURE_ACCENTS = { 'en-GB': 'British', 'en-US': 'American' };
function azureVoiceEntry(id, name, gender, locale) {
  const age = AZURE_KIDS.has(id) ? 'child' : 'adult';
  const g = String(gender || '').toLowerCase();
  const nm = name || String(id).replace(/^[a-z]{2,3}-[A-Z]{2}-/, '').replace(/Neural$/, '');
  return {
    id,
    label: nm + ' (Azure) — ' + [age + ' ' + (g || 'voice'), AZURE_ACCENTS[locale] || locale].filter(Boolean).join(' · '),
    name: nm,
    gender: g,
    age,
    locale
  };
}
const AZURE_FALLBACK = [
  azureVoiceEntry('en-GB-MaisieNeural', 'Maisie', 'female', 'en-GB'),
  azureVoiceEntry('en-US-AnaNeural', 'Ana', 'female', 'en-US')
];

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
        supportsBoundaries: false, // mp3 synthesis only; reader estimates highlighting
        tier: 'premium',
        // Static fallback: Microsoft's child voices (Maisie, Ana). Served when the
        // key/region are missing or voices/list fails; replaced by the live
        // en-GB / en-US list otherwise.
        voices: AZURE_FALLBACK
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
      },
      polly: {
        providerId: 'polly',
        providerName: 'Amazon Polly',
        supportsBoundaries: false, // mp3 synthesis only; reader estimates highlighting
        tier: 'premium',
        // en-US / en-GB neural catalogue. Amazon tags Ivy, Justin and Kevin as
        // child voices (that is why the twins and Auren are cast on them); the
        // rest are adult. Catalogue is stable, so it is served without an API
        // call (DescribeVoices would need the AWS credentials).
        voices: [
          { id: 'Ivy',      label: 'Ivy — child female · American',     name: 'Ivy',      gender: 'female', age: 'child', locale: 'en-US' },
          { id: 'Justin',   label: 'Justin — child male · American',     name: 'Justin',   gender: 'male',   age: 'child', locale: 'en-US' },
          { id: 'Kevin',    label: 'Kevin — child male · American',      name: 'Kevin',    gender: 'male',   age: 'child', locale: 'en-US' },
          { id: 'Joanna',   label: 'Joanna — adult female · American',   name: 'Joanna',   gender: 'female', age: 'adult', locale: 'en-US' },
          { id: 'Kendra',   label: 'Kendra — adult female · American',   name: 'Kendra',   gender: 'female', age: 'adult', locale: 'en-US' },
          { id: 'Kimberly', label: 'Kimberly — adult female · American', name: 'Kimberly', gender: 'female', age: 'adult', locale: 'en-US' },
          { id: 'Salli',    label: 'Salli — adult female · American',    name: 'Salli',    gender: 'female', age: 'adult', locale: 'en-US' },
          { id: 'Ruth',     label: 'Ruth — adult female · American',     name: 'Ruth',     gender: 'female', age: 'adult', locale: 'en-US' },
          { id: 'Danielle', label: 'Danielle — adult female · American', name: 'Danielle', gender: 'female', age: 'adult', locale: 'en-US' },
          { id: 'Joey',     label: 'Joey — adult male · American',       name: 'Joey',     gender: 'male',   age: 'adult', locale: 'en-US' },
          { id: 'Matthew',  label: 'Matthew — adult male · American',    name: 'Matthew',  gender: 'male',   age: 'adult', locale: 'en-US' },
          { id: 'Stephen',  label: 'Stephen — adult male · American',    name: 'Stephen',  gender: 'male',   age: 'adult', locale: 'en-US' },
          { id: 'Gregory',  label: 'Gregory — adult male · American',    name: 'Gregory',  gender: 'male',   age: 'adult', locale: 'en-US' },
          { id: 'Amy',      label: 'Amy — adult female · British',       name: 'Amy',      gender: 'female', age: 'adult', locale: 'en-GB' },
          { id: 'Emma',     label: 'Emma — adult female · British',      name: 'Emma',     gender: 'female', age: 'adult', locale: 'en-GB' },
          { id: 'Brian',    label: 'Brian — adult male · British',       name: 'Brian',    gender: 'male',   age: 'adult', locale: 'en-GB' },
          { id: 'Arthur',   label: 'Arthur — adult male · British',      name: 'Arthur',   gender: 'male',   age: 'adult', locale: 'en-GB' }
        ]
      },
      acapela: {
        providerId: 'acapela',
        providerName: 'Acapela',
        supportsBoundaries: false, // mp3 synthesis only; reader estimates highlighting
        tier: 'premium',
        // Static fallback: Acapela's catalogue children's voices. Served when the
        // account creds are missing or /api/account/ fails; replaced by the live
        // account list otherwise. Ids are bare names — the proxy resolves them to
        // the account's full ids (e.g. "Rosie22k_..."). "(Acapela)" in every label
        // keeps Archie distinct from Speechify's archie.
        voices: ACAPELA_FALLBACK
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
            const mapped = (Array.isArray(list) ? list : [])
              .filter(v => v.ShortName && (v.Locale === 'en-GB' || v.Locale === 'en-US'))
              .map(v => azureVoiceEntry(v.ShortName, v.DisplayName, v.Gender, v.Locale));
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

      // For Acapela, list the account's own voices (login server-side, token never
      // leaves the function). Any failure keeps the static fallback list.
      if (providerId === 'acapela' && process.env.ACAPELA_EMAIL && process.env.ACAPELA_PASSWORD) {
        try {
          const { _acapelaAccountVoices } = require('./tts-proxy.js');
          const mapped = (await _acapelaAccountVoices())
            .filter(v => !v.locale || /^en/i.test(v.locale))
            .map(v => acapelaVoiceEntry(v.id, v.name, v.gender, v.locale));
          if (mapped.length) provider.voices = mapped;
        } catch (error) {
          console.log('Could not fetch Acapela voices:', error.message);
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
