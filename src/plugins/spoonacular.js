// src/plugins/spoonacular.js
const fp = require('fastify-plugin');
const axios = require('axios');

module.exports = fp(async function (fastify) {
  const { SPOONACULAR_API_KEY } = process.env;

  // Se não houver chave, habilita modo "desligado", sem quebrar o servidor
  if (!SPOONACULAR_API_KEY) {
    fastify.decorate('spoonacularEnabled', false);
    fastify.decorate('spoonacularFetch', async () => {
      throw new Error('Spoonacular não configurado (.env).');
    });
    fastify.decorate('spoonacular', {
      searchRecipes: async () => { throw new Error('Spoonacular não configurado (.env).'); },
      getRecipeInfo: async () => { throw new Error('Spoonacular não configurado (.env).'); },
      getRecipeNutrition: async () => { throw new Error('Spoonacular não configurado (.env).'); },
    });
    fastify.log.warn('⚠️ Spoonacular: SPOONACULAR_API_KEY não definido. Integrações ficarão inoperantes.');
    return;
  }

  fastify.decorate('spoonacularEnabled', true);

  const http = axios.create({
    baseURL: 'https://api.spoonacular.com',
    timeout: 15000,
  });

  async function spoonacularFetch(path, params = {}, config = {}, attempt = 1) {
    const url = path.startsWith('/') ? path : `/${path}`;
    try {
      const { data } = await http.get(url, {
        ...config,
        params: { apiKey: SPOONACULAR_API_KEY, ...params },
      });
      return data;
    } catch (err) {
      const status = err.response?.status;
      // Recuo simples em 429 (rate limit) e 5xx
      if ((status === 429 || (status >= 500 && status < 600)) && attempt < 3) {
        const delay = 300 * attempt;
        await new Promise(r => setTimeout(r, delay));
        return spoonacularFetch(path, params, config, attempt + 1);
      }
      // Mensagens mais amigáveis
      if (status === 402) {
        // 402 no Spoonacular costuma ser "quota" ou plano
        throw fastify.httpErrors.paymentRequired('Spoonacular: limite/quotas atingidos ou plano insuficiente (HTTP 402).');
      }
      if (status === 401 || status === 403) {
        throw fastify.httpErrors.unauthorized('Spoonacular: API key inválida ou sem permissão.');
      }
      throw fastify.httpErrors.badGateway(`Spoonacular: falha na chamada (${status || 'sem status'})`);
    }
  }

  async function searchRecipes(params = {}) {
    // /recipes/complexSearch
    // Docs: aceita q, cuisine, diet, intolerances, includeIngredients, excludeIngredients, maxReadyTime, number, offset...
    const data = await spoonacularFetch('/recipes/complexSearch', {
      query: params.q || params.query || undefined,
      cuisine: params.cuisine,
      diet: params.diet,
      intolerances: params.intolerances,
      includeIngredients: params.includeIngredients,
      excludeIngredients: params.excludeIngredients,
      maxReadyTime: params.maxReadyTime,
      addRecipeInformation: true,   // inclui info extra (servings, readyInMinutes, etc.)
      instructionsRequired: false,
      fillIngredients: false,
      number: Math.min(Math.max(Number(params.number || 10), 1), 50),
      offset: Number(params.offset || 0),
    });

    // Normaliza
    const items = (data.results || []).map(r => ({
      id: r.id,
      title: r.title,
      image: r.image,
      readyInMinutes: r.readyInMinutes,
      servings: r.servings,
      summary: r.summary ? String(r.summary).replace(/<[^>]*>/g, '') : '',
      cuisines: r.cuisines || [],
      diets: r.diets || [],
      dishTypes: r.dishTypes || [],
    }));
    return { total: data.totalResults || items.length, items };
  }

  async function getRecipeInfo(id) {
    const data = await spoonacularFetch(`/recipes/${id}/information`, {
      includeNutrition: false,
    });
    // Normaliza o mínimo necessário
    return {
      id: data.id,
      title: data.title,
      image: data.image,
      readyInMinutes: data.readyInMinutes,
      servings: data.servings,
      sourceUrl: data.sourceUrl,
      vegetarian: !!data.vegetarian,
      vegan: !!data.vegan,
      glutenFree: !!data.glutenFree,
      dairyFree: !!data.dairyFree,
      veryHealthy: !!data.veryHealthy,
      summary: data.summary ? String(data.summary).replace(/<[^>]*>/g, '') : '',
      extendedIngredients: (data.extendedIngredients || []).map(ing => ({
        id: ing.id,
        name: ing.nameClean || ing.name || ing.originalName || '',
        original: ing.original,
        amount: ing.amount,
        unit: ing.unit,
        measures: ing.measures || null, // tem .metric e .us
        aisle: ing.aisle || '',
      })),
    };
  }

  async function getRecipeNutrition(id) {
    // Widget JSON (nutrientes resumidos)
    const data = await spoonacularFetch(`/recipes/${id}/nutritionWidget.json`);
    return data; // já é JSON com calories, carbs, fat, protein, etc.
  }

  fastify.decorate('spoonacularFetch', spoonacularFetch);
  fastify.decorate('spoonacular', {
    searchRecipes,
    getRecipeInfo,
    getRecipeNutrition,
  });

  fastify.log.info('🥄 Spoonacular: plugin habilitado.');
});
