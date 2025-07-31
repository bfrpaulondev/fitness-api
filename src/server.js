// src/server.js
/**
 * Modo tradicional (não-serverless).
 * Ideal p/ Docker, Render, Railway ou execução local “simples”.
 */
const build = require('./app');

(async () => {
  try {
    const fastify = await build();

    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`🚀 Fitness API up → http://${HOST}:${PORT}`);
    fastify.log.info(`📘 Swagger       → http://${HOST}:${PORT}/documentation`);
  } catch (err) {
    // Falha crítica
    // eslint-disable-next-line no-console
    console.error('Cannot start server:', err);
    process.exit(1);
  }
})();
