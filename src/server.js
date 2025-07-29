// src/server.js
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const Fastify = require('fastify');

// ===== Config =====
const API_PREFIX = '/v1';
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const fastify = Fastify({
  logger: {
    transport: { target: 'pino-pretty' },
    level: LOG_LEVEL,
  },
});

// ===== Plugins base =====
const cors = require('@fastify/cors');
const sensible = require('@fastify/sensible');
const swagger = require('@fastify/swagger');
const swaggerUI = require('@fastify/swagger-ui');

// ---------------------------------------------------------
// Base plugins (CORS, sensible, multipart, Swagger/OpenAPI)
// ---------------------------------------------------------
async function registerBasePlugins() {
  // CORS robusto para DEV (localhost, LAN, Codespaces, ngrok, e whitelist via .env)
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Sem Origin (Swagger local, curl, Postman) -> permitir
      if (!origin) return cb(null, true);

      // .env CORS_ORIGINS=csv de origens permitidas
      const envAllow = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const devPatterns = [
        /^https?:\/\/localhost(:\d+)?$/i,
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
        /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/i,       // rede local
        /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/i,       // rede local
        /^https?:\/\/.+-?\d+-\d+\.app\.github\.dev$/i,   // GitHub Codespaces
        /^https?:\/\/.+\.ngrok(-free)?\.app$/i,          // ngrok
      ];

      const ok =
        envAllow.includes(origin) ||
        devPatterns.some(re => re.test(origin));

      cb(null, !!ok);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'ETag'],
    credentials: true,
    maxAge: 86400, // 24h
  });

  await fastify.register(sensible);

  // multipart (upload) – usamos request.parts(), então attachFieldsToBody: false
  await fastify.register(require('@fastify/multipart'), {
    attachFieldsToBody: false,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  });

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Fitness API',
        description: 'API para app de fitness (Fastify + MongoDB + Zod + JWT + Swagger).',
        version: '0.1.0',
      },
      servers: [
        { url: process.env.PUBLIC_URL || `http://localhost:${PORT}` },
      ],
      tags: [
        { name: 'health', description: 'Health check' },
        { name: 'auth', description: 'Autenticação e utilizadores' },
        { name: 'workouts', description: 'Treinos personalizados' },
        { name: 'exercises', description: 'Biblioteca de exercícios' },
        { name: 'workout-logs', description: 'Logs de treino e métricas' },
        { name: 'workout-templates', description: 'Templates de treinos (públicos/privados) e clonagem' },
        { name: 'stats', description: 'Dashboard e estatísticas' },
        { name: 'media', description: 'Galeria de fotos e vídeos (Cloudinary), tags, comparação' },
        { name: 'albums', description: 'Álbuns de mídia' },
        { name: 'measurements', description: 'Medições corporais e progresso' },
        { name: 'notifications', description: 'Notificações e dispositivos (OneSignal)' },
        { name: 'reminders', description: 'Lembretes (RRULE) e disparo' },
        { name: 'goals', description: 'Metas, lembretes e gamificação' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      // Segurança global (rotas públicas não usam preValidation e continuam acessíveis)
      security: [{ bearerAuth: [] }],
    },
  });

  await fastify.register(swaggerUI, {
    routePrefix: '/documentation',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}

// ---------------------------------------------------------
// Plugins do projeto (DB, JWT, integrações externas)
// ---------------------------------------------------------
async function registerProjectPlugins() {
  // Banco de dados (MongoDB via Mongoose)
  await fastify.register(require('./plugins/db'));

  // Schemas compartilhados (se houver)
  await fastify.register(require('./plugins/schemas'));

  // Autenticação JWT (adiciona fastify.authenticate)
  await fastify.register(require('./plugins/auth'));

  // Integrações externas
  await fastify.register(require('./plugins/cloudinary')); // Upload Cloudinary
  await fastify.register(require('./plugins/onesignal'));  // Push OneSignal
  // await fastify.register(require('./plugins/spoonacular')); // Sprint de compras (futuro)
}

// ---------------------------------------------------------
// Rotas
// ---------------------------------------------------------
async function registerRoutes() {
  // Health (pública)
  fastify.get('/health', {
    schema: {
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: { status: { type: 'string' }, uptime: { type: 'number' } },
        },
      },
    },
  }, async () => ({ status: 'ok', uptime: process.uptime() }));

  // Redireciona raiz para Swagger
  fastify.get('/', async (_, reply) => reply.redirect('/documentation'));

  // ===== Rotas da API v1 =====
  await fastify.register(require('./routes/users'),            { prefix: API_PREFIX });
  await fastify.register(require('./routes/workouts'),         { prefix: API_PREFIX });
  await fastify.register(require('./routes/exercises'),        { prefix: API_PREFIX });
  await fastify.register(require('./routes/workoutLogs'),      { prefix: API_PREFIX });
  await fastify.register(require('./routes/workoutTemplates'), { prefix: API_PREFIX });

  // Stats + Dashboard
  await fastify.register(require('./routes/stats'),            { prefix: API_PREFIX });
  await fastify.register(require('./routes/dashboard'),        { prefix: API_PREFIX });

  // Notificações / Lembretes / Metas
  await fastify.register(require('./routes/notifications'),    { prefix: API_PREFIX });
  await fastify.register(require('./routes/reminders'),        { prefix: API_PREFIX });
  await fastify.register(require('./routes/goals'),            { prefix: API_PREFIX });

  // Mídia e Medições
  await fastify.register(require('./routes/media'),            { prefix: API_PREFIX });
  await fastify.register(require('./routes/measurements'),     { prefix: API_PREFIX });

  // (Futuro) Lista de compras / timers / etc.
  // await fastify.register(require('./routes/shoppingLists'), { prefix: API_PREFIX });
  // await fastify.register(require('./routes/timers'),        { prefix: API_PREFIX });
}

// ---------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------
(async () => {
  try {
    await registerBasePlugins();
    await registerProjectPlugins();
    await registerRoutes();

    await fastify.ready();
    fastify.swagger(); // gera/carrega o OpenAPI

    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`🚀 Server rodando em http://localhost:${PORT}`);
    fastify.log.info(`📘 Swagger em http://localhost:${PORT}/documentation`);
  } catch (err) {
    fastify.log.error(err, 'Falha ao iniciar o servidor');
    process.exit(1);
  }
})();
