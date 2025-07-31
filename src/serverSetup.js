// src/serverSetup.js
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const cors = require('@fastify/cors');
const sensible = require('@fastify/sensible');
const multipart = require('@fastify/multipart');
const swagger = require('@fastify/swagger');
const swaggerUI = require('@fastify/swagger-ui');

const API_PREFIX = '/v1';

/* ------------------------------------------------------------- *
 *  HELPERS                                                      *
 * ------------------------------------------------------------- */
const parseOrigins = (str) =>
  String(str || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/* ------------------------------------------------------------- *
 *  FUNÇÃO PRINCIPAL: recebe `fastify` já criado e injeta tudo   *
 * ------------------------------------------------------------- */
module.exports = async function setup(fastify) {
  /* ---------- Base plugins ---------- */
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowed = parseOrigins(process.env.CORS_ORIGINS);

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (!isProd) return cb(null, true);
      if (allowed.length === 0) return cb(null, false);
      if (allowed.includes(origin)) return cb(null, true);
      cb(new Error('CORS: Origin não permitido'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });

  await fastify.register(sensible);
  await fastify.register(multipart, { attachFieldsToBody: false });

  /* ---------- Swagger ---------- */
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Fitness API',
        description:
          'API for fitness mobile app (Fastify + MongoDB + Zod + JWT + Swagger).',
        version: '1.0.0',
      },
      tags: [
        { name: 'health', description: 'Health check' },
        { name: 'auth', description: 'Authentication & users' },
        { name: 'exercises', description: 'Exercise library' },
        { name: 'workouts', description: 'Custom workouts' },
        { name: 'workout-logs', description: 'Workout logs & metrics' },
        { name: 'workout-templates', description: 'Workout templates' },
        { name: 'media', description: 'Cloudinary media' },
        { name: 'albums', description: 'Media albums' },
        { name: 'measurements', description: 'Body measurements' },
        { name: 'shopping-lists', description: 'Smart shopping lists' },
        { name: 'recipes', description: 'Recipes (Spoonacular)' },
        { name: 'stats', description: 'Dashboard & stats' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await fastify.register(swaggerUI, {
    routePrefix: '/documentation',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  /* ---------- Project plugins ---------- */
  await fastify.register(require('./plugins/db'));
  await fastify.register(require('./plugins/auth'));
  await fastify.register(require('./plugins/cloudinary'));

  try {
    await fastify.register(require('./plugins/onesignal'));
  } catch {
    fastify.log.debug('OneSignal plugin off (NO-OP).');
  }
  try {
    await fastify.register(require('./plugins/spoonacular'));
  } catch {
    fastify.log.debug('Spoonacular plugin off (NO-OP).');
  }

  /* ---------- Schemas globais (se existirem) ---------- */
  try {
    await fastify.register(require('./plugins/schemas'));
  } catch {
    fastify.log.debug('Sem plugins/schemas extras.');
  }

  /* ---------- Rotas ---------- */
  const pref = { prefix: API_PREFIX };

  // Health
  fastify.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string' }, uptime: { type: 'number' } },
          },
        },
      },
    },
    () => ({ status: 'ok', uptime: process.uptime() })
  );
  fastify.get('/', (_, rep) => rep.redirect('/documentation'));

  await fastify.register(require('./routes/users'), pref);
  await fastify.register(require('./routes/exercises'), pref);
  await fastify.register(require('./routes/workouts'), pref);
  await fastify.register(require('./routes/workoutLogs'), pref);
  await fastify.register(require('./routes/workoutTemplates'), pref);

  await fastify.register(require('./routes/media'), pref);
  await fastify.register(require('./routes/measurements'), pref);
  await fastify.register(require('./routes/shoppingLists'), pref);

  try {
    await fastify.register(require('./routes/recipes'), pref);
  } catch {
    fastify.log.debug('Rotas recipes ausentes (ok).');
  }

  await fastify.register(require('./routes/stats'), pref);
  await fastify.register(require('./routes/dashboard'), pref);

  // rotas opcionais
  for (const r of [
    './routes/goals',
    './routes/notifications',
    './routes/reminders',
    './routes/timers',
  ]) {
    try {
      await fastify.register(require(r), pref);
    } catch {
      fastify.log.debug(`Rotas opcionais ausentes: ${r}`);
    }
  }
};
