// api/index.js
const build = require('./src/app');
const { proxy } = require('fastify-vercel');

let cached;

module.exports = async (req, res) => {
  if (!cached) cached = await build();
  return proxy(req, res, cached);
};
