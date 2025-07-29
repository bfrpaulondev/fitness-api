// src/plugins/onesignal.noop.js
const fp = require('fastify-plugin');
module.exports = fp(async function (fastify) {
  fastify.decorate('oneSignalSend', async () => ({ skipped: true, reason: 'onesignal-disabled' }));
  fastify.decorate('sendPushToUser', async () => ({ skipped: true, reason: 'onesignal-disabled' }));
  fastify.log.info('🔕 OneSignal NO-OP: plugin carregado (push desativado).');
});
