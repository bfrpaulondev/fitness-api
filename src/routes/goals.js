// src/routes/goals.js
const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const Goal = require('../models/goal');
const WorkoutLog = require('../models/workoutLog');

module.exports = async function goalsRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // Swagger
  const GoalSchema = {
    $id: 'goals.Goal',
    type: 'object',
    properties: {
      _id: { type: 'string' }, user: { type: 'string' },
      title: { type: 'string' }, description: { type: 'string' },
      smart: {
        type: 'object',
        properties: {
          specific: { type: 'string' }, measurable: { type: 'string' },
          achievable: { type: 'string' }, relevant: { type: 'string' }, timeBound: { type: 'string' }
        }
      },
      startDate: { type: 'string', format: 'date-time' },
      endDate: { type: 'string', format: 'date-time', nullable: true },
      targetMetric: { type: 'string' }, targetValue: { type: 'number' },
      currentValue: { type: 'number' },
      status: { type: 'string', enum: ['active','paused','completed','failed'] },
      tags: { type: 'array', items: { type: 'string' } },
      points: { type: 'number' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','title','status']
  };

  const GoalPage = {
    $id: 'goals.Page',
    type: 'object',
    properties: {
      page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'goals.Goal#' } }
    },
    required: ['page','limit','total','items']
  };

  [GoalSchema, GoalPage].forEach(addOnce);

  // Zod
  const smartZ = z.object({
    specific: z.string().optional(),
    measurable: z.string().optional(),
    achievable: z.string().optional(),
    relevant: z.string().optional(),
    timeBound: z.string().optional()
  }).partial();

  const createZ = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    smart: smartZ.optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional().nullable(),
    targetMetric: z.string().optional(),
    targetValue: z.number().optional(),
    currentValue: z.number().optional(),
    status: z.enum(['active','paused','completed','failed']).optional(),
    tags: z.array(z.string()).optional(),
    points: z.number().optional()
  });

  const updateZ = createZ.partial();

  // CRUD
  fastify.post('/goals', {
    schema: {
      tags: ['goals'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'goals.Goal#' }, // só para documentação; validação real via zod
      response: { 201: { $ref: 'goals.Goal#' } }
    }
  }, async (request, reply) => {
    const parsed = createZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const now = new Date();
    const created = await Goal.create({
      user: request.user.sub,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : now,
      ...parsed.data
    });
    const raw = await Goal.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  fastify.get('/goals', {
    schema: {
      tags: ['goals'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active','paused','completed','failed'] },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
        }
      },
      response: { 200: { $ref: 'goals.Page#' } }
    }
  }, async (request) => {
    const { status, page = 1, limit = 20 } = request.query || {};
    const filter = { user: request.user.sub };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Goal.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Goal.countDocuments(filter)
    ]);
    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(items) };
  });

  fastify.get('/goals/:id', {
    schema: {
      tags: ['goals'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'goals.Goal#' } }
    }
  }, async (request, reply) => {
    const g = await Goal.findOne({ _id: request.params.id, user: request.user.sub }).lean();
    if (!g) return reply.notFound('Meta não encontrada');
    return normalize(g);
  });

  fastify.put('/goals/:id', {
    schema: {
      tags: ['goals'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      body: { $ref: 'goals.Goal#' },
      response: { 200: { $ref: 'goals.Goal#' } }
    }
  }, async (request, reply) => {
    const parsed = updateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    const g = await Goal.findOne({ _id: request.params.id, user: request.user.sub });
    if (!g) return reply.notFound('Meta não encontrada');

    Object.assign(g, parsed.data);
    if (parsed.data.startDate) g.startDate = new Date(parsed.data.startDate);
    if (parsed.data.endDate) g.endDate = new Date(parsed.data.endDate);
    await g.save();
    const raw = await Goal.findById(g._id).lean();
    return normalize(raw);
  });

  fastify.delete('/goals/:id', {
    schema: {
      tags: ['goals'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const g = await Goal.findOne({ _id: request.params.id, user: request.user.sub });
    if (!g) return reply.notFound('Meta não encontrada');
    await g.deleteOne();
    return reply.code(204).send();
  });

  // Status helpers
  fastify.patch('/goals/:id/complete', {
    schema: {
      tags: ['goals'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'goals.Goal#' } }
    }
  }, async (request, reply) => {
    const g = await Goal.findOneAndUpdate(
      { _id: request.params.id, user: request.user.sub },
      { $set: { status: 'completed', updatedAt: new Date() } },
      { new: true }
    ).lean();
    if (!g) return reply.notFound('Meta não encontrada');
    return normalize(g);
  });

  fastify.patch('/goals/:id/pause', {
    schema: {
      tags: ['goals'], security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'goals.Goal#' } }
    }
  }, async (request, reply) => {
    const g = await Goal.findOneAndUpdate(
      { _id: request.params.id, user: request.user.sub },
      { $set: { status: 'paused', updatedAt: new Date() } },
      { new: true }
    ).lean();
    if (!g) return reply.notFound('Meta não encontrada');
    return normalize(g);
  });

  fastify.patch('/goals/:id/resume', {
    schema: {
      tags: ['goals'], security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'goals.Goal#' } }
    }
  }, async (request, reply) => {
    const g = await Goal.findOneAndUpdate(
      { _id: request.params.id, user: request.user.sub },
      { $set: { status: 'active', updatedAt: new Date() } },
      { new: true }
    ).lean();
    if (!g) return reply.notFound('Meta não encontrada');
    return normalize(g);
  });

  // Insights simples (heurísticas)
  fastify.get('/goals/insights', {
    schema: {
      tags: ['goals'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { days: { type: 'integer', default: 14, minimum: 1, maximum: 90 } }
      }
    }
  }, async (request) => {
    const { days = 14 } = request.query || {};
    const since = new Date(Date.now() - Number(days) * 24 * 3600 * 1000);
    const sessions = await WorkoutLog.countDocuments({ user: request.user.sub, date: { $gte: since } });
    const tips = [];
    if (sessions === 0) tips.push(`Sem treinos nos últimos ${days} dias — comece por um treino leve amanhã.`);
    if (sessions > 0 && sessions < Math.ceil(days / 4)) tips.push('Baixa frequência de treinos — defina lembretes 3x na semana.');
    if (sessions >= Math.ceil(days / 2)) tips.push('Boa consistência! Considere metas mais desafiadoras.');

    return { windowDays: Number(days), sessions, tips };
  });
};
