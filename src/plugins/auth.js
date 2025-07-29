// src/plugins/auth.js
const fp = require('fastify-plugin');
const jwt = require('@fastify/jwt');

module.exports = fp(async function authPlugin(fastify) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Defina JWT_SECRET no .env');
  }

  await fastify.register(jwt, { secret });

  // Middleware para proteger rotas
  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify(); // popula request.user
    } catch (err) {
      return reply.unauthorized('Token inválido ou ausente');
    }
  });
});
