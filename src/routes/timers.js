// src/routes/timers.js
const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const TimerTemplate = require('../models/timerTemplate');
const TimerSession  = require('../models/timerSession');

module.exports = async function timersRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // --- Swagger Schemas ---
  const IntervalSchema = {
    $id: 'timers.Interval',
    type: 'object',
    properties: { label: { type: 'string' }, seconds: { type: 'number' }, repeats: { type: 'number' } },
    required: ['seconds']
  };
  const TemplateSchema = {
    $id: 'timers.Template',
    type: 'object',
    properties: {
      _id: { type: 'string' }, user: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
      type: { type: 'string', enum: ['simple','interval'] },
      intervals: { type: 'array', items: { $ref: 'timers.Interval#' } },
      sound: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','name']
  };
  const TemplatePage = {
    $id: 'timers.TemplatePage',
    type: 'object',
    properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, items: { type: 'array', items: { $ref: 'timers.Template#' } } },
    required: ['page','limit','total','items']
  };
  const SessionSchema = {
    $id: 'timers.Session',
    type: 'object',
    properties: {
      _id: { type: 'string' }, user: { type: 'string' }, template: { type: 'string', nullable: true },
      startedAt: { type: 'string', format: 'date-time' }, finishedAt: { type: 'string', format: 'date-time', nullable: true },
      totalSeconds: { type: 'number' }, notes: { type: 'string' },
      segments: {
        type: 'array',
        items: { type: 'object', properties: { label: { type: 'string' }, seconds: { type: 'number' }, startedAt: { type: 'string', format: 'date-time' }, finishedAt: { type: 'string', format: 'date-time' } } }
      },
      createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','startedAt']
  };
  const SessionPage = {
    $id: 'timers.SessionPage',
    type: 'object',
    properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, items: { type: 'array', items: { $ref: 'timers.Session#' } } },
    required: ['page','limit','total','items']
  };
  [IntervalSchema, TemplateSchema, TemplatePage, SessionSchema, SessionPage].forEach(addOnce);

  // --- Zod ---
  const intervalZ = z.object({
    label: z.string().optional(),
    seconds: z.number().int().min(1),
    repeats: z.number().int().min(1).default(1)
  });
  const templateCreateZ = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(['simple','interval']).default('interval'),
    intervals: z.array(intervalZ).min(1),
    sound: z.record(z.any()).optional()
  });
  const templateUpdateZ = templateCreateZ.partial();

  const sessionCreateZ = z.object({
    templateId: z.string().refine(isValidObjectId).optional(),
    startedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional().nullable(),
    totalSeconds: z.number().int().min(0).optional(),
    notes: z.string().optional(),
    segments: z.array(z.object({
      label: z.string().optional(),
      seconds: z.number().int().min(0),
      startedAt: z.string().datetime().optional(),
      finishedAt: z.string().datetime().optional()
    })).optional()
  });

  // --- Templates CRUD ---
  fastify.post('/timers/templates', {
    schema: { tags: ['timers'], security: [{ bearerAuth: [] }], body: { $ref: 'timers.Template#' }, response: { 201: { $ref: 'timers.Template#' } } }
  }, async (request, reply) => {
    const parsed = templateCreateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    const created = await TimerTemplate.create({ user: request.user.sub, ...parsed.data });
    const raw = await TimerTemplate.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  fastify.get('/timers/templates', {
    schema: {
      tags: ['timers'], security: [{ bearerAuth: [] }],
      querystring: { type: 'object', properties: { page: { type: 'integer', default: 1 }, limit: { type: 'integer', default: 50 } } },
      response: { 200: { $ref: 'timers.TemplatePage#' } }
    }
  }, async (request) => {
    const { page = 1, limit = 50 } = request.query || {};
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      TimerTemplate.find({ user: request.user.sub }).sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      TimerTemplate.countDocuments({ user: request.user.sub })
    ]);
    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(items) };
  });

  fastify.get('/timers/templates/:id', {
    schema: {
      tags: ['timers'], security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: { 200: { $ref: 'timers.Template#' } }
    }
  }, async (request, reply) => {
    const t = await TimerTemplate.findOne({ _id: request.params.id, user: request.user.sub }).lean();
    if (!t) return reply.notFound('Template não encontrado');
    return normalize(t);
  });

  fastify.put('/timers/templates/:id', {
    schema: { tags: ['timers'], security: [{ bearerAuth: [] }], params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, body: { $ref: 'timers.Template#' }, response: { 200: { $ref: 'timers.Template#' } } }
  }, async (request, reply) => {
    const parsed = templateUpdateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    const t = await TimerTemplate.findOne({ _id: request.params.id, user: request.user.sub });
    if (!t) return reply.notFound('Template não encontrado');
    Object.assign(t, parsed.data);
    await t.save();
    const raw = await TimerTemplate.findById(t._id).lean();
    return normalize(raw);
  });

  fastify.delete('/timers/templates/:id', {
    schema: { tags: ['timers'], security: [{ bearerAuth: [] }], params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  }, async (request, reply) => {
    const t = await TimerTemplate.findOne({ _id: request.params.id, user: request.user.sub });
    if (!t) return reply.notFound('Template não encontrado');
    await t.deleteOne();
    return reply.code(204).send();
  });

  // Expandir intervals (repeats) para execução no app
  fastify.get('/timers/templates/:id/expand', {
    schema: { tags: ['timers'], security: [{ bearerAuth: [] }], params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  }, async (request, reply) => {
    const t = await TimerTemplate.findOne({ _id: request.params.id, user: request.user.sub }).lean();
    if (!t) return reply.notFound('Template não encontrado');
    const expanded = [];
    for (const iv of t.intervals || []) {
      for (let i = 0; i < (iv.repeats || 1); i++) {
        expanded.push({ label: iv.label || '', seconds: iv.seconds });
      }
    }
    const totalSeconds = expanded.reduce((acc, e) => acc + e.seconds, 0);
    return { templateId: String(t._id), count: expanded.length, totalSeconds, intervals: expanded };
  });

  // --- Sessions (histórico de timers executados) ---
  fastify.post('/timers/sessions', {
    schema: { tags: ['timers'], security: [{ bearerAuth: [] }], body: { $ref: 'timers.Session#' }, response: { 201: { $ref: 'timers.Session#' } } }
  }, async (request, reply) => {
    const parsed = sessionCreateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    const d = parsed.data;

    let template = null;
    if (d.templateId) {
      template = await TimerTemplate.findOne({ _id: d.templateId, user: request.user.sub }).lean();
      if (!template) return reply.badRequest('Template inválido');
    }

    const startedAt = d.startedAt ? new Date(d.startedAt) : new Date();
    const finishedAt = d.finishedAt ? new Date(d.finishedAt) : null;
    const totalSeconds = d.totalSeconds !== undefined
      ? Number(d.totalSeconds)
      : (d.segments || []).reduce((acc, s) => acc + Number(s.seconds || 0), 0);

    const created = await TimerSession.create({
      user: request.user.sub,
      template: template ? template._id : undefined,
      startedAt,
      finishedAt,
      totalSeconds,
      notes: d.notes || '',
      segments: (d.segments || []).map(s => ({
        label: s.label || '',
        seconds: Number(s.seconds || 0),
        startedAt: s.startedAt ? new Date(s.startedAt) : undefined,
        finishedAt: s.finishedAt ? new Date(s.finishedAt) : undefined
      }))
    });

    const raw = await TimerSession.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  fastify.get('/timers/sessions', {
    schema: {
      tags: ['timers'], security: [{ bearerAuth: [] }],
      querystring: { type: 'object', properties: {
        dateFrom: { type: 'string', format: 'date-time' },
        dateTo: { type: 'string', format: 'date-time' },
        page: { type: 'integer', default: 1, minimum: 1 },
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
      } },
      response: { 200: { $ref: 'timers.SessionPage#' } }
    }
  }, async (request) => {
    const { dateFrom, dateTo, page = 1, limit = 20 } = request.query || {};
    const filter = { user: request.user.sub };
    if (dateFrom || dateTo) {
      filter.startedAt = {};
      if (dateFrom) filter.startedAt.$gte = new Date(dateFrom);
      if (dateTo) filter.startedAt.$lte = new Date(dateTo);
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      TimerSession.find(filter).sort({ startedAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      TimerSession.countDocuments(filter)
    ]);
    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(items) };
  });

  fastify.get('/timers/sessions/:id', {
    schema: { tags: ['timers'], security: [{ bearerAuth: [] }], params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, response: { 200: { $ref: 'timers.Session#' } } }
  }, async (request, reply) => {
    const s = await TimerSession.findOne({ _id: request.params.id, user: request.user.sub }).lean();
    if (!s) return reply.notFound('Sessão não encontrada');
    return normalize(s);
  });

  fastify.delete('/timers/sessions/:id', {
    schema: { tags: ['timers'], security: [{ bearerAuth: [] }], params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  }, async (request, reply) => {
    const s = await TimerSession.findOne({ _id: request.params.id, user: request.user.sub });
    if (!s) return reply.notFound('Sessão não encontrada');
    await s.deleteOne();
    return reply.code(204).send();
  });

  // Sumário simples
  fastify.get('/timers/stats/summary', {
    schema: {
      tags: ['timers'], security: [{ bearerAuth: [] }],
      querystring: { type: 'object', properties: { dateFrom: { type: 'string', format: 'date-time' }, dateTo: { type: 'string', format: 'date-time' } } }
    }
  }, async (request) => {
    const { dateFrom, dateTo } = request.query || {};
    const filter = { user: request.user.sub };
    if (dateFrom || dateTo) {
      filter.startedAt = {};
      if (dateFrom) filter.startedAt.$gte = new Date(dateFrom);
      if (dateTo) filter.startedAt.$lte = new Date(dateTo);
    }
    const sessions = await TimerSession.find(filter).select('totalSeconds').lean();
    const totalSeconds = sessions.reduce((acc, s) => acc + Number(s.totalSeconds || 0), 0);
    return { count: sessions.length, totalSeconds };
  });
};
