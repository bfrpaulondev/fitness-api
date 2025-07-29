// src/plugins/db.js
const fp = require('fastify-plugin');
const mongoose = require('mongoose');

module.exports = fp(async function dbPlugin(fastify) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Defina MONGODB_URI no .env');
  }

  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(uri);
    fastify.log.info('🗄️  MongoDB conectado');
  } catch (err) {
    fastify.log.error({ err }, 'Erro ao conectar no MongoDB');
    throw err;
  }

  fastify.addHook('onClose', async () => {
    await mongoose.connection.close();
    fastify.log.info('MongoDB desconectado');
  });
});
