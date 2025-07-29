// src/routes/exercises.js
const { z } = require('zod');
const Exercise = require('../models/exercise');

module.exports = async function exercisesRoutes(fastify) {
  // 🔐 Todas as rotas exigem autenticação
  fastify.addHook('preValidation', fastify.authenticate);

  // ---------------------------------------------------------------------------
  // Helper: registra um schema só uma vez (evita "already declared")
  function addOnce(schema) {
    if (!fastify.getSchemas()[schema.$id]) {
      fastify.addSchema(schema);
    }
  }

  // ---------------------------------------------------------------------------
  // 📘 JSON Schemas (Swagger) — com namespace "exercises.*"

  // Base sem _id/owner (usado para criação/atualização)
  const ExerciseBaseSchema = {
    $id: 'exercises.ExerciseBase',
    type: 'object',
    properties: {
      name:         { type: 'string' },
      description:  { type: 'string' },
      muscleGroup:  { type: 'string' },
      equipment:    { type: 'string' },
      difficulty:   { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      instructions: { type: 'string' },
      videoUrl:     { type: 'string' },
      imageUrl:     { type: 'string' },
      isPublic:     { type: 'boolean' },
    },
  };

  // Schema para criação (exige "name")
  const ExerciseCreateSchema = {
    $id: 'exercises.ExerciseCreate',
    allOf: [
      { $ref: 'exercises.ExerciseBase#' },
      { type: 'object', required: ['name'] }
    ]
  };

  // Modelo completo de resposta (com _id/owner/createdAt)
  const ExerciseSchema = {
    $id: 'exercises.Exercise',
    allOf: [
      { $ref: 'exercises.ExerciseBase#' },
      {
        type: 'object',
        properties: {
          _id:       { type: 'string' },
          owner:     { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['_id', 'name'],
      }
    ]
  };

  // Lista paginada
  const ExercisePageSchema = {
    $id: 'exercises.ExercisePage',
    type: 'object',
    properties: {
      page:  { type: 'integer' },
      limit: { type: 'integer' },
      total: { type: 'integer' },
      items: {
        type: 'array',
        items: { $ref: 'exercises.Exercise#' },
      }
    },
    required: ['page', 'limit', 'total', 'items']
  };

  // Regista com proteção contra duplicatas
  [ExerciseBaseSchema, ExerciseCreateSchema, ExerciseSchema, ExercisePageSchema].forEach(addOnce);

  // ---------------------------------------------------------------------------
  // ✅ Validação com Zod (entrada)

  const exerciseBodyZ = z.object({
    name: z.string().min(2),
    description: z.string().optional().default(''),
    muscleGroup: z.string().optional().default(''),
    equipment: z.string().optional().default(''),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional().default('beginner'),
    instructions: z.string().optional().default(''),
    videoUrl: z.union([z.string().url(), z.literal('')]).optional().default(''),
    imageUrl: z.union([z.string().url(), z.literal('')]).optional().default(''),
    isPublic: z.boolean().optional().default(false),
  });

  // ---------------------------------------------------------------------------
  // 🧭 Rotas

  // GET /exercises — lista com filtros (paginada)
  fastify.get('/exercises', {
    schema: {
      tags: ['exercises'],
      security: [{ bearerAuth: [] }],  
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          muscleGroup: { type: 'string' },
          onlyMine: { type: 'boolean', default: false },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        }
      },
      response: { 200: { $ref: 'exercises.ExercisePage#' } }
    }
  }, async (request) => {
    const { search = '', muscleGroup = '', onlyMine = false, page = 1, limit = 20 } = request.query || {};
    const userId = request.user.sub;

    const filter = onlyMine
      ? { owner: userId }
      : { $or: [{ isPublic: true }, { owner: userId }] };

    if (search) filter.name = { $regex: search, $options: 'i' };
    if (muscleGroup) filter.muscleGroup = { $regex: muscleGroup, $options: 'i' };

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Exercise.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Exercise.countDocuments(filter),
    ]);

    return { page: Number(page), limit: Number(limit), total, items };
  });

  // POST /exercises — criar
  fastify.post('/exercises', {
    schema: {
      tags: ['exercises'],
      security: [{ bearerAuth: [] }],  
      body: { $ref: 'exercises.ExerciseCreate#' },
      response: { 201: { $ref: 'exercises.Exercise#' } }
    }
  }, async (request, reply) => {
    const parsed = exerciseBodyZ.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const doc = { ...parsed.data, owner: request.user.sub };
    const exercise = await Exercise.create(doc);
    return reply.code(201).send(exercise);
  });

  // GET /exercises/:id — detalhe
  fastify.get('/exercises/:id', {
    schema: {
      tags: ['exercises'],
      security: [{ bearerAuth: [] }],  
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: { 200: { $ref: 'exercises.Exercise#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const ex = await Exercise.findById(id);
    if (!ex) return reply.notFound('Exercício não encontrado');

    const isOwner = ex.owner && ex.owner.toString() === request.user.sub;
    if (!ex.isPublic && !isOwner) return reply.notFound('Exercício não encontrado');

    return ex;
  });

  // PUT /exercises/:id — atualizar
  fastify.put('/exercises/:id', {
    schema: {
      tags: ['exercises'],
      security: [{ bearerAuth: [] }],  
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: { $ref: 'exercises.ExerciseBase#' }, // payload parcial aceitável
      response: { 200: { $ref: 'exercises.Exercise#' } }
    }
  }, async (request, reply) => {
    const parsed = exerciseBodyZ.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const { id } = request.params;
    const ex = await Exercise.findById(id);
    if (!ex) return reply.notFound('Exercício não encontrado');
    if (!ex.owner || ex.owner.toString() !== request.user.sub) return reply.forbidden('Sem permissão');

    Object.assign(ex, parsed.data);
    await ex.save();
    return ex;
  });

  // DELETE /exercises/:id — apagar
  fastify.delete('/exercises/:id', {
    schema: {
      tags: ['exercises'],
      security: [{ bearerAuth: [] }],  
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: { 204: { type: 'null' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const ex = await Exercise.findById(id);
    if (!ex) return reply.notFound('Exercício não encontrado');
    if (!ex.owner || ex.owner.toString() !== request.user.sub) return reply.forbidden('Sem permissão');

    await ex.deleteOne();
    return reply.code(204).send();
  });
};
