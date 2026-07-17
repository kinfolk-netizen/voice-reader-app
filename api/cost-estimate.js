/**
 * Cost Estimate API - Netlify Serverless Function
 * Provides cost estimates and comparisons across TTS providers
 * 
 * Timestamp: 2:46PM, 12.10.24
 * Document ID: VR-API-Cost-Estimate-241210-1446
 */

exports.handler = async (event, context) => {
  // Handle CORS preflight
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

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { text, providerId, providers, options = {} } = JSON.parse(event.body);

    if (!text) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: 'Missing required field: text'
        })
      };
    }

    // Provider cost data
    const PROVIDER_COSTS = {
      local: { costPerChar: 0, name: 'Local Browser TTS', tier: 'free' },
      openai: { costPerChar: 0.000015, name: 'OpenAI TTS', tier: 'premium' },
      azure: { costPerChar: 0.000016, name: 'Azure Speech', tier: 'premium' },
      elevenlabs: { costPerChar: 0.00003, name: 'ElevenLabs', tier: 'premium' },
      speechify: { costPerChar: 0.00001, name: 'Speechify', tier: 'premium' }
    };

    const characters = text.length;
    
    // Calculate for single provider
    if (providerId) {
      const provider = PROVIDER_COSTS[providerId];
      if (!provider) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            success: false,
            error: `Unknown provider: ${providerId}`
          })
        };
      }

      const cost = characters * provider.costPerChar;
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          providerId,
          providerName: provider.name,
          characters,
          costPerChar: provider.costPerChar,
          estimatedCost: cost.toFixed(6),
          tier: provider.tier,
          currency: 'USD'
        })
      };
    }

    // Calculate for multiple providers (comparison)
    const providerList = providers || ['local', 'openai', 'azure', 'elevenlabs'];
    const estimates = providerList.map(id => {
      const provider = PROVIDER_COSTS[id];
      if (!provider) return null;
      
      const cost = characters * provider.costPerChar;
      return {
        providerId: id,
        providerName: provider.name,
        costPerChar: provider.costPerChar,
        estimatedCost: cost.toFixed(6),
        tier: provider.tier
      };
    }).filter(Boolean);

    // Find cheapest and most expensive
    const paidEstimates = estimates.filter(e => e.tier === 'premium');
    const cheapest = paidEstimates.reduce((min, curr) => 
      parseFloat(curr.estimatedCost) < parseFloat(min.estimatedCost) ? curr : min
    , paidEstimates[0]);
    
    const mostExpensive = paidEstimates.reduce((max, curr) => 
      parseFloat(curr.estimatedCost) > parseFloat(max.estimatedCost) ? curr : max
    , paidEstimates[0]);

    const savings = (parseFloat(mostExpensive.estimatedCost) - parseFloat(cheapest.estimatedCost)).toFixed(6);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        characters,
        estimates,
        cheapest: cheapest.providerId,
        mostExpensive: mostExpensive.providerId,
        savings: `$${savings}`,
        currency: 'USD'
      })
    };

  } catch (error) {
    console.error('Cost Estimate Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
