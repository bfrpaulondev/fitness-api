// src/server.js
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const fastify = require('fastify')({
  logger: {
    transport: { target: 'pino-pretty' }, // logs legíveis no dev
    level: 'info',
  },
});

const cors = require('@fastify/cors');
const sensible = require('@fastify/sensible');
const multipart = require('@fastify/multipart');
const swagger = require('@fastify/swagger');
const swaggerUI = require('@fastify/swagger-ui');

const PORT = process.env.PORT || 3333;

// Plugins básicos
async function registerBasePlugins() {
  await fastify.register(cors, { origin: true });
  await fastify.register(sensible);
  await fastify.register(multipart);

  // Swagger (OpenAPI) — por enquanto só o básico. Vamos aprimorar depois.
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Fitness API',
        description: 'API para app de fitness (Fastify + Mongo + Zod + JWT)',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      tags: [{ name: 'health', description: 'Health check' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await fastify.register(swaggerUI, {
    routePrefix: '/documentation',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}

// Rota simples de health check
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
}, async () => {
  return { status: 'ok', uptime: process.uptime() };
});

// Inicialização
(async () => {
  try {
    await registerBasePlugins();

    await fastify.ready();
    // Gera o JSON do OpenAPI (útil se quiser exportar depois)
    fastify.swagger();

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`🚀 Server rodando em http://localhost:${PORT}`);
    fastify.log.info(`📘 Swagger em http://localhost:${PORT}/documentation`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
})();
