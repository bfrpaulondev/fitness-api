// src/app.js
const buildSetup = require('./serverSetup');

module.exports = async () => {
  const fastify = require('fastify')({ logger: false });
  await buildSetup(fastify);
  await fastify.ready();
  return fastify;
};
