// src/server.js
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const fastify = require('fastify')({
  logger: {
    transport: { target: 'pino-pretty' },
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Plugins base
const cors = require('@fastify/cors');
const sensible = require('@fastify/sensible');
const multipart = require('@fastify/multipart');
const swagger = require('@fastify/swagger');
const swaggerUI = require('@fastify/swagger-ui');

const API_PREFIX = '/v1';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// ---------- Helpers ----------
function parseOrigins(str) {
  return String(str || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function registerBasePlugins() {
  // CORS: dev = libera tudo; prod = restringe por env
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowed = parseOrigins(process.env.CORS_ORIGINS);

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // chamadas sem origin (ex.: curl, apps nativas) → permitir
      if (!origin) return cb(null, true);
      if (!isProd) return cb(null, true); // DEV: libera geral
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

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Fitness API',
        description:
          'API para app de fitness (Fastify + MongoDB + Zod + JWT + Swagger). v1',
        version: '1.0.0',
      },
      tags: [
        { name: 'health', description: 'Health check' },
        { name: 'auth', description: 'Autenticação e utilizadores' },
        { name: 'exercises', description: 'Biblioteca de exercícios' },
        { name: 'workouts', description: 'Treinos personalizados' },
        { name: 'workout-logs', description: 'Logs de treino e métricas' },
        { name: 'workout-templates', description: 'Templates de treinos' },
        { name: 'media', description: 'Galeria (Cloudinary), tags, comparações' },
        { name: 'albums', description: 'Álbuns de mídia' },
        { name: 'measurements', description: 'Medições corporais e progresso' },
        { name: 'shopping-lists', description: 'Lista de compras inteligente' },
        { name: 'recipes', description: 'Receitas (Spoonacular)' },
        { name: 'stats', description: 'Dashboard e estatísticas' },
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
}

async function registerProjectPlugins() {
  // DB (Mongo)
  await fastify.register(require('./plugins/db'));

  // JWT (adiciona fastify.authenticate)
  await fastify.register(require('./plugins/auth'));

  // Cloudinary (upload de mídia)
  await fastify.register(require('./plugins/cloudinary'));

  // OneSignal (NO-OP se não tiver envs)
  try {
    await fastify.register(require('./plugins/onesignal'));
  } catch (e) {
    fastify.log.warn('⚠️ Plugin OneSignal não encontrado. Ignorando.');
  }

  // Spoonacular (desliga com 501 se sem API key)
  try {
    await fastify.register(require('./plugins/spoonacular'));
  } catch (e) {
    fastify.log.warn('⚠️ Plugin Spoonacular não encontrado. Ignorando.');
  }
}

async function registerRoutes() {
  // Health (fora do prefixo)
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
    async () => ({ status: 'ok', uptime: process.uptime() })
  );

  // Redireciona raiz para Swagger
  fastify.get('/', async (_, reply) => reply.redirect('/documentation'));

  // Schemas globais custom (se existir)
  try {
    await fastify.register(require('./plugins/schemas'));
  } catch (e) {
    fastify.log.debug('Sem plugins/schemas adicionais.');
  }

  // ===== Rotas v1 =====
  const pref = { prefix: API_PREFIX };

  await fastify.register(require('./routes/users'), pref);
  await fastify.register(require('./routes/exercises'), pref);
  await fastify.register(require('./routes/workouts'), pref);
  await fastify.register(require('./routes/workoutLogs'), pref);
  await fastify.register(require('./routes/workoutTemplates'), pref);

  await fastify.register(require('./routes/media'), pref);
  await fastify.register(require('./routes/measurements'), pref);
  await fastify.register(require('./routes/shoppingLists'), pref);

  // Integração receitas (Spoonacular) — se plugin estiver off, rotas retornam 501
  try {
    await fastify.register(require('./routes/recipes'), pref);
  } catch (e) {
    fastify.log.warn('⚠️ Rotas de recipes não encontradas. Ignorando.');
  }

  // Stats + Dashboard
  await fastify.register(require('./routes/stats'), pref);
  await fastify.register(require('./routes/dashboard'), pref);

  // (Opcional) Outras áreas — se não existirem, não quebram:
  const optionalRoutes = [
    './routes/goals',
    './routes/notifications',
    './routes/reminders',
    './routes/timers',
  ];
  for (const r of optionalRoutes) {
    try {
      await fastify.register(require(r), pref);
      fastify.log.info(`Rotas opcionais carregadas: ${r}`);
    } catch {
      fastify.log.debug(`Rotas opcionais ausentes: ${r} (ok)`);
    }
  }
}

// ---------- Bootstrap ----------
(async () => {
  try {
    await registerBasePlugins();
    await registerProjectPlugins();
    await registerRoutes();

    await fastify.ready();
    fastify.swagger();

    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`🚀 Server rodando em http://${HOST}:${PORT}`);
    fastify.log.info(`📘 Swagger em http://${HOST}:${PORT}/documentation`);
  } catch (err) {
    fastify.log.error(err, 'Falha ao iniciar o servidor');
    process.exit(1);
  }
})();

// Segurança extra em runtime
process.on('unhandledRejection', (reason) => {
  fastify.log.error({ reason }, 'Unhandled Rejection');
});
process.on('uncaughtException', (err) => {
  fastify.log.error({ err }, 'Uncaught Exception');
});
