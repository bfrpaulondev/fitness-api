// src/routes/workoutTemplates.js
const { z } = require('zod');
const { isValidObjectId } = require('mongoose');

const WorkoutTemplate = require('../models/workoutTemplate');
const Workout = require('../models/workout');
const Exercise = require('../models/exercise');

module.exports = async function workoutTemplatesRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  // Helpers
  const addOnce = (schema) => {
    if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema);
  };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // ---------------------------------------------------------------------------
  // 📘 Schemas (Swagger) — namespace "wtemplates.*"

  const BlockRequestSchema = {
    $id: 'wtemplates.BlockRequest',
    type: 'object',
    properties: {
      exercise: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'ObjectId do exercício (tem de ser acessível pelo autor)'
      },
      sets:            { type: 'integer', minimum: 1, default: 3 },
      reps:            { type: 'integer', minimum: 0, default: 10 },
      restSeconds:     { type: 'integer', minimum: 0, default: 60 },
      durationSeconds: { type: 'integer', minimum: 0, default: 0 },
      notes:           { type: 'string' }
    },
    required: ['exercise']
  };

  const BlockSchema = {
    $id: 'wtemplates.Block',
    type: 'object',
    properties: {
      exercise: { type: 'string' },
      sets:            { type: 'integer' },
      reps:            { type: 'integer' },
      restSeconds:     { type: 'integer' },
      durationSeconds: { type: 'integer' },
      notes:           { type: 'string' }
    },
    required: ['exercise']
  };

  const TemplateCreateSchema = {
    $id: 'wtemplates.TemplateCreate',
    type: 'object',
    properties: {
      name:        { type: 'string' },
      description: { type: 'string' },
      tags:        { type: 'array', items: { type: 'string' } },
      level:       { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      isPublic:    { type: 'boolean', default: false },
      blocks:      { type: 'array', items: { $ref: 'wtemplates.BlockRequest#' }, minItems: 1 }
    },
    required: ['name', 'blocks']
  };

  const TemplateUpdateSchema = {
    $id: 'wtemplates.TemplateUpdate',
    type: 'object',
    properties: {
      name:        { type: 'string' },
      description: { type: 'string' },
      tags:        { type: 'array', items: { type: 'string' } },
      level:       { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      isPublic:    { type: 'boolean' },
      blocks:      { type: 'array', items: { $ref: 'wtemplates.BlockRequest#' }, minItems: 1 }
    }
  };

  const TemplateSchema = {
    $id: 'wtemplates.Template',
    type: 'object',
    properties: {
      _id:        { type: 'string' },
      user:       { type: 'string' },
      name:       { type: 'string' },
      description:{ type: 'string' },
      tags:       { type: 'array', items: { type: 'string' } },
      level:      { type: 'string' },
      isPublic:   { type: 'boolean' },
      blocks:     { type: 'array', items: { $ref: 'wtemplates.Block#' } },
      usesCount:  { type: 'integer' },
      forkedFrom: { type: 'string', nullable: true },
      createdAt:  { type: 'string', format: 'date-time' },
      updatedAt:  { type: 'string', format: 'date-time' }
    },
    required: ['_id', 'user', 'name', 'blocks']
  };

  const TemplatePageSchema = {
    $id: 'wtemplates.TemplatePage',
    type: 'object',
    properties: {
      page:  { type: 'integer' },
      limit: { type: 'integer' },
      total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'wtemplates.Template#' } }
    },
    required: ['page', 'limit', 'total', 'items']
  };

  [
    BlockRequestSchema,
    BlockSchema,
    TemplateCreateSchema,
    TemplateUpdateSchema,
    TemplateSchema,
    TemplatePageSchema
  ].forEach(addOnce);

  // ---------------------------------------------------------------------------
  // ✅ Zod (entrada)

  const blockZ = z.object({
    exercise: z.string().refine(isValidObjectId, 'exercise deve ser ObjectId válido (24 hex)'),
    sets: z.number().int().min(1).max(100).optional().default(3),
    reps: z.number().int().min(0).max(1000).optional().default(10),
    restSeconds: z.number().int().min(0).max(3600).optional().default(60),
    durationSeconds: z.number().int().min(0).max(36000).optional().default(0),
    notes: z.string().optional().default(''),
  });

  const createZ = z.object({
    name: z.string().min(2),
    description: z.string().optional().default(''),
    tags: z.array(z.string()).optional().default([]),
    level: z.enum(['beginner', 'intermediate', 'advanced']).optional().default('beginner'),
    isPublic: z.boolean().optional().default(false),
    blocks: z.array(blockZ).min(1),
  });

  const updateZ = z.object({
    name: z.string().min(2).optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    isPublic: z.boolean().optional(), // atenção: publicar via endpoint dedicado
    blocks: z.array(blockZ).min(1).optional(),
  });

  // ---------------------------------------------------------------------------
  // 🧭 Rotas

  // Criar template
  fastify.post('/workout-templates', {
    schema: {
      tags: ['workout-templates'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'wtemplates.TemplateCreate#' },
      response: { 201: { $ref: 'wtemplates.Template#' } }
    }
  }, async (request, reply) => {
    const parsed = createZ.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    // valida acessibilidade de exercícios (público ou do autor)
    const exIds = [...new Set(parsed.data.blocks.map(b => b.exercise))];
    const accessible = await Exercise.find({
      _id: { $in: exIds },
      $or: [{ isPublic: true }, { owner: request.user.sub }]
    }).select('_id');

    if (accessible.length !== exIds.length) {
      return reply.badRequest('Um ou mais exercícios não existem ou não são acessíveis');
    }

    // se vier isPublic: true, é obrigatório que TODOS os exercícios sejam públicos
    if (parsed.data.isPublic) {
      const nonPublic = await Exercise.countDocuments({ _id: { $in: exIds }, isPublic: { $ne: true } });
      if (nonPublic > 0) {
        return reply.badRequest('Para publicar o template, todos os exercícios devem ser públicos.');
      }
    }

    const created = await WorkoutTemplate.create({
      user: request.user.sub,
      name: parsed.data.name,
      description: parsed.data.description,
      tags: parsed.data.tags,
      level: parsed.data.level,
      isPublic: parsed.data.isPublic || false,
      blocks: parsed.data.blocks
    });

    const raw = await WorkoutTemplate.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  // Criar template a partir de um workout teu
  fastify.post('/workout-templates/from-workout/:workoutId', {
    schema: {
      tags: ['workout-templates'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { workoutId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['workoutId'] },
      response: { 201: { $ref: 'wtemplates.Template#' } }
    }
  }, async (request, reply) => {
    const { workoutId } = request.params;
    if (!isValidObjectId(workoutId)) return reply.badRequest('workoutId inválido');

    const w = await Workout.findOne({ _id: workoutId, user: request.user.sub }).lean();
    if (!w) return reply.notFound('Workout não encontrado');

    const exIds = [...new Set(w.blocks.map(b => String(b.exercise)))];
    const accessible = await Exercise.find({
      _id: { $in: exIds },
      $or: [{ isPublic: true }, { owner: request.user.sub }]
    }).select('_id');

    if (accessible.length !== exIds.length) {
      return reply.badRequest('O workout contém exercícios que não são acessíveis como template');
    }

    const created = await WorkoutTemplate.create({
      user: request.user.sub,
      name: w.name,
      description: w.description || '',
      tags: [],
      level: 'beginner',
      isPublic: false,
      blocks: w.blocks.map(b => ({
        exercise: b.exercise,
        sets: b.sets || 3,
        reps: b.reps || 10,
        restSeconds: b.restSeconds || 60,
        durationSeconds: b.durationSeconds || 0,
        notes: b.notes || ''
      }))
    });

    const raw = await WorkoutTemplate.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  // Listar templates (públicos + meus) com filtros
  fastify.get('/workout-templates', {
    schema: {
      tags: ['workout-templates'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          search:    { type: 'string' },
          tags:      { type: 'string', description: 'Lista separada por vírgula' },
          level:     { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
          onlyMine:  { type: 'boolean', default: false },
          page:      { type: 'integer', default: 1, minimum: 1 },
          limit:     { type: 'integer', default: 20, minimum: 1, maximum: 100 }
        }
      },
      response: { 200: { $ref: 'wtemplates.TemplatePage#' } }
    }
  }, async (request) => {
    const { search = '', tags = '', level, onlyMine = false, page = 1, limit = 20 } = request.query || {};

    const filter = onlyMine
      ? { user: request.user.sub }
      : { $or: [{ isPublic: true }, { user: request.user.sub }] };

    if (search) filter.name = { $regex: search, $options: 'i' };

    const tagList = (tags || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    if (tagList.length) filter.tags = { $in: tagList };
    if (level) filter.level = level;

    const skip = (Number(page) - 1) * Number(limit);
    const [itemsRaw, total] = await Promise.all([
      WorkoutTemplate.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      WorkoutTemplate.countDocuments(filter),
    ]);

    const items = normalizeMany(itemsRaw);
    return { page: Number(page), limit: Number(limit), total, items };
  });

  // Detalhe (público ou meu)
  fastify.get('/workout-templates/:id', {
    schema: {
      tags: ['workout-templates'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'wtemplates.Template#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const t = await WorkoutTemplate.findOne({
      _id: id,
      $or: [{ isPublic: true }, { user: request.user.sub }]
    }).lean();

    if (!t) return reply.notFound('Template não encontrado ou inacessível');
    return normalize(t);
  });

  // Atualizar (apenas do autor)
  fastify.put('/workout-templates/:id', {
    schema: {
      tags: ['workout-templates'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      body: { $ref: 'wtemplates.TemplateUpdate#' },
      response: { 200: { $ref: 'wtemplates.Template#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const parsed = updateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const t = await WorkoutTemplate.findOne({ _id: id, user: request.user.sub });
    if (!t) return reply.notFound('Template não encontrado');

    // Se vierem novos blocks, validar acessibilidade
    if (parsed.data.blocks) {
      const exIds = [...new Set(parsed.data.blocks.map(b => b.exercise))];
      const accessible = await Exercise.find({
        _id: { $in: exIds },
        $or: [{ isPublic: true }, { owner: request.user.sub }]
      }).select('_id');

      if (accessible.length !== exIds.length) {
        return reply.badRequest('Um ou mais exercícios não existem ou não são acessíveis');
      }
      t.blocks = parsed.data.blocks;
    }

    if (parsed.data.name !== undefined) t.name = parsed.data.name;
    if (parsed.data.description !== undefined) t.description = parsed.data.description;
    if (parsed.data.tags !== undefined) t.tags = parsed.data.tags;
    if (parsed.data.level !== undefined) t.level = parsed.data.level;

    // Ignoramos isPublic aqui; publicar via endpoints dedicados
    await t.save();

    const raw = await WorkoutTemplate.findById(t._id).lean();
    return normalize(raw);
  });

  // Publicar (apenas autor) — exige todos os exercícios públicos
  fastify.patch('/workout-templates/:id/publish', {
    schema: {
      tags: ['workout-templates'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'wtemplates.Template#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const t = await WorkoutTemplate.findOne({ _id: id, user: request.user.sub });
    if (!t) return reply.notFound('Template não encontrado');

    const exIds = [...new Set(t.blocks.map(b => String(b.exercise)))];
    if (exIds.length) {
      const nonPublic = await Exercise.countDocuments({ _id: { $in: exIds }, isPublic: { $ne: true } });
      if (nonPublic > 0) {
        return reply.badRequest('Para publicar, todos os exercícios do template devem ser públicos.');
      }
    }

    t.isPublic = true;
    await t.save();

    const raw = await WorkoutTemplate.findById(t._id).lean();
    return normalize(raw);
  });

  // Despublicar (apenas autor)
  fastify.patch('/workout-templates/:id/unpublish', {
    schema: {
      tags: ['workout-templates'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'wtemplates.Template#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const t = await WorkoutTemplate.findOne({ _id: id, user: request.user.sub });
    if (!t) return reply.notFound('Template não encontrado');

    t.isPublic = false;
    await t.save();

    const raw = await WorkoutTemplate.findById(t._id).lean();
    return normalize(raw);
  });

  // Clonar template → cria um Workout para o utilizador corrente
  fastify.post('/workout-templates/:id/clone', {
    schema: {
      tags: ['workout-templates'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 201: { type: 'object', properties: { workoutId: { type: 'string' } }, required: ['workoutId'] } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    // template tem de ser público ou do próprio
    const t = await WorkoutTemplate.findOne({
      _id: id,
      $or: [{ isPublic: true }, { user: request.user.sub }]
    }).lean();

    if (!t) return reply.notFound('Template não encontrado ou inacessível');

    // Para clonar, o utilizador atual tem de conseguir aceder aos exercícios do template
    const exIds = [...new Set((t.blocks || []).map(b => String(b.exercise)))];
    if (exIds.length) {
      const accessible = await Exercise.find({
        _id: { $in: exIds },
        $or: [{ isPublic: true }, { owner: request.user.sub }]
      }).select('_id');
      if (accessible.length !== exIds.length) {
        return reply.badRequest('Este template possui exercícios não públicos para si; não é possível clonar.');
      }
    }

    // cria o workout
    const created = await Workout.create({
      user: request.user.sub,
      name: t.name,
      description: t.description || '',
      blocks: (t.blocks || []).map(b => ({
        exercise: b.exercise,
        sets: b.sets || 3,
        reps: b.reps || 10,
        restSeconds: b.restSeconds || 60,
        durationSeconds: b.durationSeconds || 0,
        notes: b.notes || ''
      }))
    });

    // incrementa usesCount (não precisa ser transacional aqui)
    await WorkoutTemplate.updateOne({ _id: id }, { $inc: { usesCount: 1 } });

    return reply.code(201).send({ workoutId: String(created._id) });
  });

  // Apagar (apenas autor)
  fastify.delete('/workout-templates/:id', {
    schema: {
      tags: ['workout-templates'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 204: { type: 'null' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const t = await WorkoutTemplate.findOne({ _id: id, user: request.user.sub });
    if (!t) return reply.notFound('Template não encontrado');
    await WorkoutTemplate.deleteOne({ _id: id });

    return reply.code(204).send();
  });
};
