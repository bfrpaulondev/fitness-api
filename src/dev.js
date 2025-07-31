// dev.js
/**
 * Hot-reload local com nodemon.
 * Usado apenas em desenvolvimento.
 */
(async () => {
  const build = require('./src/app');
  const fastify = await build();

  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';

  await fastify.listen({ port: PORT, host: HOST });
  console.log(`✅ Fitness API (dev) → http://${HOST}:${PORT}`);
  console.log(`📘 Swagger          → http://${HOST}:${PORT}/documentation`);
})();
