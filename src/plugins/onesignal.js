// src/plugins/onesignal.js
const fp = require('fastify-plugin');
const axios = require('axios');

module.exports = fp(async function (fastify) {
  const { ONESIGNAL_APP_ID, ONESIGNAL_API_KEY } = process.env;

  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    fastify.log.warn('⚠️ OneSignal: ONESIGNAL_APP_ID/ONESIGNAL_API_KEY não definidos. Envio de push ficará inoperante.');
  }

  const http = axios.create({
    baseURL: 'https://onesignal.com/api/v1',
    timeout: 10000,
    headers: { Authorization: `Basic ${ONESIGNAL_API_KEY}` }
  });

  async function sendPush({ message, title, playerIds = [], externalUserIds = [], data = {}, url = undefined }) {
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
      throw new Error('OneSignal não configurado (.env).');
    }
    if ((!playerIds || playerIds.length === 0) && (!externalUserIds || externalUserIds.length === 0)) {
      throw new Error('Nenhum destino informado (playerIds/externalUserIds).');
    }

    const payload = {
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: playerIds && playerIds.length ? playerIds : undefined,
      include_external_user_ids: externalUserIds && externalUserIds.length ? externalUserIds : undefined,
      contents: { en: message, pt: message },
      headings: title ? { en: title, pt: title } : undefined,
      data: data || {},
      url
    };

    const { data: resp } = await http.post('/notifications', payload);
    return resp;
  }

  fastify.decorate('oneSignalSend', sendPush);

  // helper: enviar para todos os devices OneSignal do usuário
  fastify.decorate('sendPushToUser', async (userId, { message, title, data, url }) => {
    const Device = require('../models/device');
    const devices = await Device.find({ user: userId, provider: 'onesignal' }).select('playerId').lean();
    const playerIds = devices.map(d => d.playerId).filter(Boolean);
    if (!playerIds.length) {
      fastify.log.info({ userId }, 'Usuário sem devices OneSignal cadastrados');
      return { skipped: true, reason: 'no-devices' };
    }
    return sendPush({ message, title, playerIds, data, url });
  });
});
