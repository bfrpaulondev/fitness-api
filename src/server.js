// src/server.js
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const fastify = require('fastify')({
  logger: {
    transport: { target: 'pino-pretty' },
    level: 'info',
  },
});

// Plugins base
const cors = require('@fastify/cors');
const sensible = require('@fastify/sensible');
const multipart = require('@fastify/multipart');
const swagger = require('@fastify/swagger');
const swaggerUI = require('@fastify/swagger-ui');

// Prefixo de versão
const API_PREFIX = '/v1';
const PORT = process.env.PORT || 3000;

// 🔧 Registra plugins básicos (CORS, Swagger, etc.)
async function registerBasePlugins() {
  await fastify.register(cors, { origin: true });
  await fastify.register(sensible);
  await fastify.register(require('@fastify/multipart'), { attachFieldsToBody: false });

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Fitness API',
        description: 'API para app de fitness (Fastify + MongoDB + Zod + JWT + Swagger).',
        version: '0.1.0',
      },
      tags: [
        { name: 'health', description: 'Health check' },
        { name: 'auth', description: 'Autenticação e utilizadores' },
        { name: 'workouts', description: 'Treinos personalizados' },
        { name: 'exercises', description: 'Biblioteca de exercícios' },
        { name: 'workout-logs', description: 'Logs de treino e métricas' },
        { name: 'workout-templates', description: 'Templates de treinos (públicos/privados) e clonagem' },
        { name: 'stats', description: 'Dashboard e estatísticas' },
        { name: 'shopping-lists', description: 'Lista de compras inteligente' },
        { name: 'body-measurements', description: 'Medições corporais e fotos' },
        { name: 'goals', description: 'Metas, lembretes e gamificação' },
        { name: 'media', description: 'Galeria de fotos e vídeos (Cloudinary), tags, comparação' },
        { name: 'albums', description: 'Álbuns de mídia' },
        { name: 'measurements', description: 'Medições corporais e progresso' },
        { name: 'timers', description: 'Cronômetros e timers' },
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

// 🧩 Plugins do projeto (DB, JWT, integrações)
async function registerProjectPlugins() {
  // Banco de dados (MongoDB via Mongoose)
  await fastify.register(require('./plugins/db'));

  // Autenticação JWT (adiciona fastify.authenticate)
  await fastify.register(require('./plugins/auth'));

  // Integrações externas — deixe comentado até configurarmos as fases correspondentes:
  await fastify.register(require('./plugins/cloudinary'));
  // await fastify.register(require('./plugins/onesignal'));
  // await fastify.register(require('./plugins/spoonacular'));
}


// 🛣️ Rotas
async function registerRoutes() {
  // Health sempre disponível (fora do prefixo)
  fastify.get('/health', {
    schema: {
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async () => ({ status: 'ok', uptime: process.uptime() }));

  // Redireciona raiz para Swagger
  fastify.get('/', async (_, reply) => reply.redirect('/documentation'));

  // ===== Rotas da API v1 =====

  // 1) Autenticação/Usuários (já vamos usar na Fase 2)
  await fastify.register(require('./routes/users'), { prefix: API_PREFIX });

  // 2) Treinos (CRUD completo)
  await fastify.register(require('./routes/workouts'), { prefix: API_PREFIX });

  // 3) Biblioteca de Exercícios (CRUD)
  await fastify.register(require('./routes/exercises'), { prefix: API_PREFIX });

  // 4) Logs de treino (métricas, histórico)
  await fastify.register(require('./routes/workoutLogs'), { prefix: API_PREFIX });

  // 5) Templates de treino (públicos/privados)
  await fastify.register(require('./routes/workoutTemplates'), { prefix: API_PREFIX });

  // 6) Dashboard/Estatísticas/Insights
  await fastify.register(require('./routes/stats'), { prefix: API_PREFIX });
  await fastify.register(require('./routes/dashboard'), { prefix: API_PREFIX });

  // 7) Lista de Compras Inteligente
  // await fastify.register(require('./routes/shoppingLists'), { prefix: API_PREFIX });

  // 8) Medidas Corporais (com fotos de progresso)
  // await fastify.register(require('./routes/bodyMeasurements'), { prefix: API_PREFIX });

  // 9) Metas e Lembretes (gamificação + OneSignal)
  // await fastify.register(require('./routes/goals'), { prefix: API_PREFIX });

  // 10) Galeria e Mídia (upload via Cloudinary)

  // rotas Media & Measurements
  await fastify.register(require('./routes/media'), { prefix: API_PREFIX });
  await fastify.register(require('./routes/measurements'), { prefix: API_PREFIX });
  // 11) Cronômetros e Timers
  // await fastify.register(require('./routes/timers'), { prefix: API_PREFIX });
}

// 🚀 Bootstrap
(async () => {
  try {
    await registerBasePlugins();
    await fastify.register(require('./plugins/schemas'));
    await registerProjectPlugins();
    await registerRoutes();

    await fastify.ready();
    fastify.swagger(); // gera/spec carrega o OpenAPI

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`🚀 Server rodando em http://localhost:${PORT}`);
    fastify.log.info(`📘 Swagger em http://localhost:${PORT}/documentation`);
  } catch (err) {
    fastify.log.error(err, 'Falha ao iniciar o servidor');
    process.exit(1);
  }
})();
