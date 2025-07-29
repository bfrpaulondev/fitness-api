// src/routes/measurements.js
const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const Measurement = require('../models/measurement');
const Media = require('../models/media');

module.exports = async function measurementsRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // -------------------- Swagger Schemas --------------------
  const MeasurementSchema = {
    $id: 'measurements.Measurement',
    type: 'object',
    properties: {
      _id: { type: 'string' },
      user: { type: 'string' },
      date: { type: 'string', format: 'date-time' },
      weightKg: { type: 'number' },
      bodyFatPct: { type: 'number' },
      neckCm: { type: 'number' },
      shoulderCm: { type: 'number' },
      chestCm: { type: 'number' },
      waistCm: { type: 'number' },
      hipsCm: { type: 'number' },
      thighCm: { type: 'number' },
      calfCm: { type: 'number' },
      armCm: { type: 'number' },
      forearmCm: { type: 'number' },
      notes: { type: 'string' },
      photos: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','date']
  };

  // 👉 Schemas de ENTRADA (body) corretos para POST/PUT
  const MeasurementCreateBody = {
    $id: 'measurements.CreateBody',
    type: 'object',
    properties: {
      date: { type: 'string', format: 'date-time' },
      weightKg: { type: 'number', minimum: 0 },
      bodyFatPct: { type: 'number', minimum: 0, maximum: 100 },
      neckCm: { type: 'number', minimum: 0 },
      shoulderCm: { type: 'number', minimum: 0 },
      chestCm: { type: 'number', minimum: 0 },
      waistCm: { type: 'number', minimum: 0 },
      hipsCm: { type: 'number', minimum: 0 },
      thighCm: { type: 'number', minimum: 0 },
      calfCm: { type: 'number', minimum: 0 },
      armCm: { type: 'number', minimum: 0 },
      forearmCm: { type: 'number', minimum: 0 },
      notes: { type: 'string' },
      photos: { type: 'array', items: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }
    }
  };

  const MeasurementUpdateBody = { ...MeasurementCreateBody, $id: 'measurements.UpdateBody' };

  const MeasurementPage = {
    $id: 'measurements.Page',
    type: 'object',
    properties: {
      page: { type: 'integer' },
      limit: { type: 'integer' },
      total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'measurements.Measurement#' } }
    },
    required: ['page','limit','total','items']
  };

  const ProgressSchema = {
    $id: 'measurements.Progress',
    type: 'object',
    properties: {
      fields: { type: 'array', items: { type: 'string' } },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date-time' }
          },
          additionalProperties: { type: ['number','null','string','boolean'] }
        }
      }
    },
    required: ['fields','items']
  };

  [MeasurementSchema, MeasurementCreateBody, MeasurementUpdateBody, MeasurementPage, ProgressSchema].forEach(addOnce);

  // -------------------- Zod --------------------
  const numeric = z.number().min(0).optional();
  const createZ = z.object({
    date: z.string().datetime().optional(),
    weightKg: numeric,
    bodyFatPct: z.number().min(0).max(100).optional(),
    neckCm: numeric,
    shoulderCm: numeric,
    chestCm: numeric,
    waistCm: numeric,
    hipsCm: numeric,
    thighCm: numeric,
    calfCm: numeric,
    armCm: numeric,
    forearmCm: numeric,
    notes: z.string().optional(),
    photos: z.array(z.string().refine(isValidObjectId)).optional()
  });
  const updateZ = createZ;

  // -------------------- CRUD --------------------
  fastify.post('/measurements', {
    schema: {
      tags: ['measurements'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'measurements.CreateBody#' },     // ✅ schema de entrada correto
      response: { 201: { $ref: 'measurements.Measurement#' } }
    }
  }, async (request, reply) => {
    const parsed = createZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    if (parsed.data.photos && parsed.data.photos.length) {
      const count = await Media.countDocuments({ _id: { $in: parsed.data.photos }, user: request.user.sub });
      if (count !== parsed.data.photos.length) return reply.badRequest('Uma ou mais fotos não são acessíveis');
    }

    const created = await Measurement.create({
      user: request.user.sub,
      date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
      ...parsed.data
    });

    const raw = await Measurement.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  fastify.get('/measurements', {
    schema: {
      tags: ['measurements'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo: { type: 'string', format: 'date-time' },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
        }
      },
      response: { 200: { $ref: 'measurements.Page#' } }
    }
  }, async (request) => {
    const { dateFrom, dateTo, page = 1, limit = 20 } = request.query || {};
    const filter = { user: request.user.sub };
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = new Date(dateFrom);
      if (dateTo) filter.date.$lte = new Date(dateTo);
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [itemsRaw, total] = await Promise.all([
      Measurement.find(filter).sort({ date: -1 }).skip(skip).limit(Number(limit)).lean(),
      Measurement.countDocuments(filter)
    ]);
    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(itemsRaw) };
  });

  fastify.get('/measurements/:id', {
    schema: {
      tags: ['measurements'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'measurements.Measurement#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const m = await Measurement.findOne({ _id: id, user: request.user.sub }).lean();
    if (!m) return reply.notFound('Medição não encontrada');
    return normalize(m);
  });

  fastify.put('/measurements/:id', {
    schema: {
      tags: ['measurements'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      body: { $ref: 'measurements.UpdateBody#' },      // ✅ schema de entrada correto
      response: { 200: { $ref: 'measurements.Measurement#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const parsed = updateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const m = await Measurement.findOne({ _id: id, user: request.user.sub });
    if (!m) return reply.notFound('Medição não encontrada');

    if (parsed.data.photos && parsed.data.photos.length) {
      const count = await Media.countDocuments({ _id: { $in: parsed.data.photos }, user: request.user.sub });
      if (count !== parsed.data.photos.length) return reply.badRequest('Uma ou mais fotos não são acessíveis');
      m.photos = parsed.data.photos;
    }

    const fields = { ...parsed.data };
    delete fields.photos;
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) m[k] = v; });

    await m.save();
    const raw = await Measurement.findById(m._id).lean();
    return normalize(raw);
  });

  fastify.delete('/measurements/:id', {
    schema: {
      tags: ['measurements'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const m = await Measurement.findOne({ _id: id, user: request.user.sub });
    if (!m) return reply.notFound('Medição não encontrada');

    await Media.updateMany({ user: request.user.sub, measurementId: id }, { $set: { measurementId: null } });
    await m.deleteOne();
    return reply.code(204).send();
  });

  fastify.patch('/measurements/:id/photos', {
    schema: {
      tags: ['measurements'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } } },
      body: {
        type: 'object',
        properties: {
          add: { type: 'array', items: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } },
          remove: { type: 'array', items: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }
        }
      },
      response: { 200: { $ref: 'measurements.Measurement#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { add = [], remove = [] } = request.body || {};
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const m = await Measurement.findOne({ _id: id, user: request.user.sub });
    if (!m) return reply.notFound('Medição não encontrada');

    const allIds = [...add, ...remove].filter(Boolean);
    const invalid = allIds.filter(x => !isValidObjectId(x));
    if (invalid.length) return reply.badRequest('IDs de mídia inválidos');

    if (add.length) {
      const countAdd = await Media.countDocuments({ _id: { $in: add }, user: request.user.sub });
      if (countAdd !== add.length) return reply.badRequest('Alguma mídia em "add" não é acessível');
    }
    if (remove.length) {
      const countRem = await Media.countDocuments({ _id: { $in: remove }, user: request.user.sub });
      if (countRem !== remove.length) return reply.badRequest('Alguma mídia em "remove" não é acessível');
    }

    const set = new Set((m.photos || []).map(x => String(x)));
    for (const mid of add) set.add(String(mid));
    for (const mid of remove) set.delete(String(mid));
    m.photos = Array.from(set);

    await m.save();
    const raw = await Measurement.findById(m._id).lean();
    return normalize(raw);
  });

  fastify.get('/measurements/progress', {
    schema: {
      tags: ['measurements'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo: { type: 'string', format: 'date-time' },
          fields: { type: 'string', description: 'CSV de campos. Ex.: weightKg,waistCm,bodyFatPct' }
        }
      },
      response: { 200: { $ref: 'measurements.Progress#' } }
    }
  }, async (request, reply) => {
    const { dateFrom, dateTo, fields = '' } = request.query || {};
    const allow = new Set([
      'weightKg','bodyFatPct',
      'neckCm','shoulderCm','chestCm','waistCm','hipsCm',
      'thighCm','calfCm','armCm','forearmCm'
    ]);

    const selected = fields
      .split(',')
      .map(s => s.trim())
      .filter(s => s && allow.has(s));

    if (!selected.length) return reply.badRequest('Informe ao menos 1 campo válido em "fields"');

    const filter = { user: request.user.sub };
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = new Date(dateFrom);
      if (dateTo) filter.date.$lte = new Date(dateTo);
    }

    const docs = await Measurement.find(filter).sort({ date: 1 }).lean();
    const items = docs.map(d => {
      const row = { date: d.date.toISOString() };
      for (const f of selected) row[f] = d[f] ?? null;
      return row;
    });

    return { fields: selected, items };
  });
};
