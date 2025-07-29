// src/routes/recipes.js
const { z } = require('zod');

module.exports = async function recipesRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  const addOnce = (s) => { if (!fastify.getSchemas()[s.$id]) fastify.addSchema(s); };

  // Swagger Schemas
  const RecipeListSchema = {
    $id: 'recipes.List',
    type: 'object',
    properties: {
      total: { type: 'integer' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            image: { type: 'string' },
            readyInMinutes: { type: 'integer' },
            servings: { type: 'integer' },
            summary: { type: 'string' },
            cuisines: { type: 'array', items: { type: 'string' } },
            diets: { type: 'array', items: { type: 'string' } },
            dishTypes: { type: 'array', items: { type: 'string' } },
          },
          required: ['id','title']
        }
      }
    },
    required: ['total','items']
  };

  const RecipeSchema = {
    $id: 'recipes.Recipe',
    type: 'object',
    properties: {
      id: { type: 'integer' },
      title: { type: 'string' },
      image: { type: 'string' },
      readyInMinutes: { type: 'integer' },
      servings: { type: 'integer' },
      sourceUrl: { type: 'string' },
      vegetarian: { type: 'boolean' },
      vegan: { type: 'boolean' },
      glutenFree: { type: 'boolean' },
      dairyFree: { type: 'boolean' },
      veryHealthy: { type: 'boolean' },
      summary: { type: 'string' },
      extendedIngredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            original: { type: 'string' },
            amount: { type: 'number' },
            unit: { type: 'string' },
            aisle: { type: 'string' }
          }
        }
      }
    },
    required: ['id','title']
  };

  const NutritionSchema = {
    $id: 'recipes.Nutrition',
    type: 'object',
    additionalProperties: true
  };

  [RecipeListSchema, RecipeSchema, NutritionSchema].forEach(addOnce);

  // Zod
  const searchZ = z.object({
    q: z.string().optional(),
    cuisine: z.string().optional(),
    diet: z.string().optional(),
    intolerances: z.string().optional(),
    includeIngredients: z.string().optional(),
    excludeIngredients: z.string().optional(),
    maxReadyTime: z.coerce.number().optional(),
    number: z.coerce.number().min(1).max(50).default(10),
    offset: z.coerce.number().min(0).default(0),
  });

  // Guard: se plugin não está habilitado
  function ensureEnabled(reply) {
    if (!fastify.spoonacularEnabled) {
      reply.code(501).send({ message: 'Spoonacular não configurado no servidor (.env).' });
      return false;
    }
    return true;
  }

  // GET /v1/recipes/search
  fastify.get('/recipes/search', {
    schema: {
      tags: ['recipes'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          cuisine: { type: 'string' },
          diet: { type: 'string' },
          intolerances: { type: 'string' },
          includeIngredients: { type: 'string' },
          excludeIngredients: { type: 'string' },
          maxReadyTime: { type: 'integer' },
          number: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
          offset: { type: 'integer', default: 0, minimum: 0 }
        }
      },
      response: { 200: { $ref: 'recipes.List#' } }
    }
  }, async (request, reply) => {
    if (!ensureEnabled(reply)) return;
    const parsed = searchZ.safeParse(request.query || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    const data = await fastify.spoonacular.searchRecipes(parsed.data);
    return data;
  });

  // GET /v1/recipes/{id}
  fastify.get('/recipes/:id', {
    schema: {
      tags: ['recipes'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      response: { 200: { $ref: 'recipes.Recipe#' } }
    }
  }, async (request, reply) => {
    if (!ensureEnabled(reply)) return;
    const info = await fastify.spoonacular.getRecipeInfo(request.params.id);
    return info;
  });

  // GET /v1/recipes/{id}/nutrition
  fastify.get('/recipes/:id/nutrition', {
    schema: {
      tags: ['recipes'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      response: { 200: { $ref: 'recipes.Nutrition#' } }
    }
  }, async (request, reply) => {
    if (!ensureEnabled(reply)) return;
    const nut = await fastify.spoonacular.getRecipeNutrition(request.params.id);
    return nut;
  });
};
