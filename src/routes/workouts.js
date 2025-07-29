// src/routes/workouts.js
const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const Workout = require('../models/workout');
const Exercise = require('../models/exercise');

module.exports = async function workoutsRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  // ---------------------------------------------------------------------------
  // Helper: registra schema só uma vez
  function addOnce(schema) {
    if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema);
  }

  // Helper: normaliza (evita enviar ObjectId "bruto" / doc do Mongoose)
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // ---------------------------------------------------------------------------
  // 📘 JSON Schemas (Swagger) — namespace "workouts.*"

  const ExerciseSummarySchema = {
    $id: 'workouts.ExerciseSummary',
    type: 'object',
    properties: {
      _id:         { type: 'string' },
      name:        { type: 'string' },
      muscleGroup: { type: 'string' },
      equipment:   { type: 'string' },
      difficulty:  { type: 'string' },
      imageUrl:    { type: 'string' },
      videoUrl:    { type: 'string' },
    },
    required: ['_id', 'name']
  };

  const BlockRequestSchema = {
    $id: 'workouts.WorkoutBlockRequest',
    type: 'object',
    properties: {
      exercise: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'MongoDB ObjectId (24 caracteres hexadecimais)'
      },
      sets:            { type: 'integer', minimum: 1, default: 3 },
      reps:            { type: 'integer', minimum: 1, default: 10 },
      restSeconds:     { type: 'integer', minimum: 0,  default: 60 },
      durationSeconds: { type: 'integer', minimum: 0,  default: 0 },
      notes:           { type: 'string' },
    },
    required: ['exercise']
  };

  const BlockResponseSchema = {
    $id: 'workouts.WorkoutBlock',
    type: 'object',
    properties: {
      // string (ObjectId) OU objeto (exercício populado resumido)
      exercise: {
        oneOf: [
          { type: 'string' },
          { $ref: 'workouts.ExerciseSummary#' }
        ]
      },
      sets:            { type: 'integer' },
      reps:            { type: 'integer' },
      restSeconds:     { type: 'integer' },
      durationSeconds: { type: 'integer' },
      notes:           { type: 'string' },
    },
    required: ['exercise']
  };

  const WorkoutCreateSchema = {
    $id: 'workouts.WorkoutCreate',
    type: 'object',
    properties: {
      name:        { type: 'string' },
      description: { type: 'string' },
      blocks: {
        type: 'array',
        items: { $ref: 'workouts.WorkoutBlockRequest#' },
        minItems: 1
      }
    },
    required: ['name', 'blocks']
  };

  const WorkoutUpdateSchema = {
    $id: 'workouts.WorkoutUpdate',
    type: 'object',
    properties: {
      name:        { type: 'string' },
      description: { type: 'string' },
      blocks: {
        type: 'array',
        items: { $ref: 'workouts.WorkoutBlockRequest#' },
        minItems: 1
      }
    }
  };

  const WorkoutSchema = {
    $id: 'workouts.Workout',
    type: 'object',
    properties: {
      _id:        { type: 'string' },
      user:       { type: 'string' },
      name:       { type: 'string' },
      description:{ type: 'string' },
      blocks:     { type: 'array', items: { $ref: 'workouts.WorkoutBlock#' } },
      createdAt:  { type: 'string', format: 'date-time' },
      updatedAt:  { type: 'string', format: 'date-time' },
    },
    required: ['_id', 'name', 'blocks']
  };

  const WorkoutPageSchema = {
    $id: 'workouts.WorkoutPage',
    type: 'object',
    properties: {
      page:  { type: 'integer' },
      limit: { type: 'integer' },
      total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'workouts.Workout#' } }
    },
    required: ['page', 'limit', 'total', 'items']
  };

  [
    ExerciseSummarySchema,
    BlockRequestSchema,
    BlockResponseSchema,
    WorkoutCreateSchema,
    WorkoutUpdateSchema,
    WorkoutSchema,
    WorkoutPageSchema,
  ].forEach(addOnce);

  // ---------------------------------------------------------------------------
  // ✅ Zod (entrada)

  const blockZ = z.object({
    exercise: z.string().refine(isValidObjectId, 'exercise deve ser um ObjectId válido (24 hex)'),
    sets: z.number().int().min(1).max(100).optional().default(3),
    reps: z.number().int().min(1).max(1000).optional().default(10),
    restSeconds: z.number().int().min(0).max(3600).optional().default(60),
    durationSeconds: z.number().int().min(0).max(36000).optional().default(0),
    notes: z.string().optional().default(''),
  });

  const workoutBodyZ = z.object({
    name: z.string().min(2),
    description: z.string().optional().default(''),
    blocks: z.array(blockZ).min(1),
  });

  // ---------------------------------------------------------------------------
  // 🧭 Rotas

  // LISTAR
  fastify.get('/workouts', {
    schema: {
      tags: ['workouts'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          page:   { type: 'integer', default: 1, minimum: 1 },
          limit:  { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        }
      },
      response: { 200: { $ref: 'workouts.WorkoutPage#' } }
    }
  }, async (request) => {
    const { search = '', page = 1, limit = 20 } = request.query || {};
    const filter = { user: request.user.sub };
    if (search) filter.name = { $regex: search, $options: 'i' };

    const skip = (Number(page) - 1) * Number(limit);
    const [rawItems, total] = await Promise.all([
      Workout.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('blocks.exercise')
        .lean(), // ← retorna objetos simples
      Workout.countDocuments(filter),
    ]);

    const items = normalizeMany(rawItems); // ← garante ObjectId -> string
    return { page: Number(page), limit: Number(limit), total, items };
  });

  // CRIAR
  fastify.post('/workouts', {
    schema: {
      tags: ['workouts'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'workouts.WorkoutCreate#' },
      response: { 201: { $ref: 'workouts.Workout#' } }
    }
  }, async (request, reply) => {
    const parsed = workoutBodyZ.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    // valida ids de exercícios e acessibilidade (público ou do dono)
    const exIds = [...new Set(parsed.data.blocks.map(b => b.exercise))];

    // (opcional, reforço) valida formato de ObjectId
    const invalid = exIds.filter(id => !isValidObjectId(id));
    if (invalid.length) {
      return reply.badRequest('Cada bloco deve ter "exercise" como ObjectId válido (24 hex).');
    }

    const accessible = await Exercise.find({
      _id: { $in: exIds },
      $or: [{ isPublic: true }, { owner: request.user.sub }]
    }).select('_id');

    if (accessible.length !== exIds.length) {
      return reply.badRequest('Um ou mais exercícios não existem ou não são acessíveis');
    }

    const created = await Workout.create({
      user: request.user.sub,
      name: parsed.data.name,
      description: parsed.data.description,
      blocks: parsed.data.blocks,
    });

    // Recarrega com populate + lean e normaliza (evita ObjectId bruto)
    const raw = await Workout.findById(created._id)
      .populate('blocks.exercise')
      .lean();

    return reply.code(201).send(normalize(raw));
  });

  // DETALHE
  fastify.get('/workouts/:id', {
    schema: {
      tags: ['workouts'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } },
        required: ['id']
      },
      response: { 200: { $ref: 'workouts.Workout#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido (use ObjectId de 24 hex).');

    const raw = await Workout.findOne({ _id: id, user: request.user.sub })
      .populate('blocks.exercise')
      .lean();

    if (!raw) return reply.notFound('Treino não encontrado');
    return normalize(raw);
  });

  // ATUALIZAR
  fastify.put('/workouts/:id', {
    schema: {
      tags: ['workouts'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } },
        required: ['id']
      },
      body: { $ref: 'workouts.WorkoutUpdate#' },
      response: { 200: { $ref: 'workouts.Workout#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido (use ObjectId de 24 hex).');

    const parsed = workoutBodyZ.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const w = await Workout.findOne({ _id: id, user: request.user.sub });
    if (!w) return reply.notFound('Treino não encontrado');

    if (parsed.data.blocks) {
      const exIds = [...new Set(parsed.data.blocks.map(b => b.exercise))];
      const invalid = exIds.filter(x => !isValidObjectId(x));
      if (invalid.length) {
        return reply.badRequest('Cada bloco deve ter "exercise" como ObjectId válido (24 hex).');
      }

      const accessible = await Exercise.find({
        _id: { $in: exIds },
        $or: [{ isPublic: true }, { owner: request.user.sub }]
      }).select('_id');

      if (accessible.length !== exIds.length) {
        return reply.badRequest('Um ou mais exercícios não existem ou não são acessíveis');
      }
      w.blocks = parsed.data.blocks;
    }

    if (parsed.data.name !== undefined) w.name = parsed.data.name;
    if (parsed.data.description !== undefined) w.description = parsed.data.description;

    await w.save();

    const raw = await Workout.findById(w._id)
      .populate('blocks.exercise')
      .lean();

    return normalize(raw);
  });

  // APAGAR
  fastify.delete('/workouts/:id', {
    schema: {
      tags: ['workouts'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } },
        required: ['id']
      },
      response: { 204: { type: 'null' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido (use ObjectId de 24 hex).');

    const w = await Workout.findOne({ _id: id, user: request.user.sub });
    if (!w) return reply.notFound('Treino não encontrado');

    await w.deleteOne();
    return reply.code(204).send();
  });
};
