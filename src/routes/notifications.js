// src/routes/notifications.js
const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const Device = require('../models/device');

module.exports = async function notificationsRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // Schemas Swagger
  const DeviceSchema = {
    $id: 'notif.Device',
    type: 'object',
    properties: {
      _id: { type: 'string' }, user: { type: 'string' }, provider: { type: 'string' },
      playerId: { type: 'string' }, platform: { type: 'string' },
      tags: { type: 'object', additionalProperties: true },
      lastSeenAt: { type: 'string', format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','provider','playerId']
  };

  const DevicePage = {
    $id: 'notif.DevicePage',
    type: 'object',
    properties: {
      page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'notif.Device#' } }
    },
    required: ['page','limit','total','items']
  };

  [DeviceSchema, DevicePage].forEach(addOnce);

  const upsertZ = z.object({
    playerId: z.string().min(5),
    platform: z.string().optional(),
    tags: z.record(z.any()).optional()
  });

  // Registrar/atualizar device do usuário
  fastify.post('/notifications/devices', {
    schema: {
      tags: ['notifications'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          playerId: { type: 'string' },
          platform: { type: 'string' },
          tags: { type: 'object', additionalProperties: true }
        },
        required: ['playerId']
      },
      response: { 201: { $ref: 'notif.Device#' } }
    }
  }, async (request, reply) => {
    const parsed = upsertZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const { playerId, platform, tags } = parsed.data;
    const doc = await Device.findOneAndUpdate(
      { user: request.user.sub, provider: 'onesignal', playerId },
      { $set: { platform: platform || '', tags: tags || {}, lastSeenAt: new Date() } },
      { upsert: true, new: true }
    ).lean();

    return reply.code(201).send(normalize(doc));
  });

  // Listar devices
  fastify.get('/notifications/devices', {
    schema: {
      tags: ['notifications'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 100 }
        }
      },
      response: { 200: { $ref: 'notif.DevicePage#' } }
    }
  }, async (request) => {
    const { page = 1, limit = 50 } = request.query || {};
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Device.find({ user: request.user.sub }).sort({ lastSeenAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Device.countDocuments({ user: request.user.sub })
    ]);
    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(items) };
  });

  // Remover device
  fastify.delete('/notifications/devices/:id', {
    schema: {
      tags: ['notifications'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const d = await Device.findOne({ _id: id, user: request.user.sub });
    if (!d) return reply.notFound('Device não encontrado');
    await d.deleteOne();
    return reply.code(204).send();
  });

  // Enviar push de teste
  fastify.post('/notifications/test', {
    schema: {
      tags: ['notifications'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          title: { type: 'string' },
          playerId: { type: 'string' }, // se não enviar, vai para todos os devices do usuário
          data: { type: 'object', additionalProperties: true }
        },
        required: ['message']
      }
    }
  }, async (request, reply) => {
    const { message, title, playerId, data } = request.body || {};
    try {
      if (playerId) {
        const resp = await fastify.oneSignalSend({ message, title, playerIds: [playerId], data });
        return { ok: true, result: resp };
      } else {
        const resp = await fastify.sendPushToUser(request.user.sub, { message, title, data });
        return { ok: true, result: resp };
      }
    } catch (err) {
      request.log.error({ err }, 'Falha ao enviar push');
      return reply.internalServerError('Falha ao enviar push: ' + err.message);
    }
  });
};
