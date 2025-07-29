// src/routes/workoutLogs.js
const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const Workout = require('../models/workout');
const WorkoutLog = require('../models/workoutLog');
const Exercise = require('../models/exercise');

module.exports = async function workoutLogsRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  // ---------------------------------------------------------------------------
  // Helpers
  function addOnce(schema) {
    if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema);
  }
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // ---------------------------------------------------------------------------
  // 📘 JSON Schemas (Swagger) — namespace "workoutLogs.*"

  const SetResultSchema = {
    $id: 'workoutLogs.SetResult',
    type: 'object',
    properties: {
      setNumber:       { type: 'integer', minimum: 1 },
      weightKg:        { type: 'number', minimum: 0 },
      repsPlanned:     { type: 'integer', minimum: 0 },
      repsDone:        { type: 'integer', minimum: 0 },
      durationSeconds: { type: 'integer', minimum: 0 },
      rpe:             { type: 'number', minimum: 0, maximum: 10 },
      completed:       { type: 'boolean' },
      notes:           { type: 'string' },
    },
    required: ['setNumber']
  };

  const EntrySchema = {
    $id: 'workoutLogs.Entry',
    type: 'object',
    properties: {
      blockIndex: { type: 'integer', minimum: 0 },
      exercise: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'ObjectId do exercício'
      },
      notes: { type: 'string' },
      sets:  { type: 'array', items: { $ref: 'workoutLogs.SetResult#' } }
    },
    required: ['blockIndex', 'exercise', 'sets']
  };

  const WorkoutLogSchema = {
    $id: 'workoutLogs.WorkoutLog',
    type: 'object',
    properties: {
      _id:             { type: 'string' },
      user:            { type: 'string' },
      workout:         { type: 'string' },
      date:            { type: 'string', format: 'date-time' },
      durationSeconds: { type: 'integer' },
      notes:           { type: 'string' },
      entries:         { type: 'array', items: { $ref: 'workoutLogs.Entry#' } },
      createdAt:       { type: 'string', format: 'date-time' },
      updatedAt:       { type: 'string', format: 'date-time' },
    },
    required: ['_id', 'user', 'workout', 'date', 'entries']
  };

  const WorkoutLogPageSchema = {
    $id: 'workoutLogs.WorkoutLogPage',
    type: 'object',
    properties: {
      page:  { type: 'integer' },
      limit: { type: 'integer' },
      total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'workoutLogs.WorkoutLog#' } }
    },
    required: ['page', 'limit', 'total', 'items']
  };

  const CreateFromWorkoutBodySchema = {
    $id: 'workoutLogs.CreateFromWorkoutBody',
    type: 'object',
    properties: {
      date:  { type: 'string', format: 'date-time' },
      notes: { type: 'string' }
    }
  };

  const CreateCustomBodySchema = {
    $id: 'workoutLogs.CreateCustomBody',
    type: 'object',
    properties: {
      workout: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'ObjectId do workout de referência'
      },
      date:            { type: 'string', format: 'date-time' },
      durationSeconds: { type: 'integer', minimum: 0 },
      notes:           { type: 'string' },
      entries:         { type: 'array', items: { $ref: 'workoutLogs.Entry#' }, minItems: 1 }
    },
    required: ['workout', 'entries']
  };

  const UpdateBodySchema = {
    $id: 'workoutLogs.UpdateBody',
    type: 'object',
    properties: {
      date:            { type: 'string', format: 'date-time' },
      durationSeconds: { type: 'integer', minimum: 0 },
      notes:           { type: 'string' },
      entries:         { type: 'array', items: { $ref: 'workoutLogs.Entry#' } }
    }
  };

  // --- Schemas de estatística (re-adicionados) ---
  const StatsSummarySchema = {
    $id: 'workoutLogs.StatsSummary',
    type: 'object',
    properties: {
      sessions:         { type: 'integer' },
      totalSets:        { type: 'integer' },
      totalReps:        { type: 'integer' },
      totalTonnageKg:   { type: 'number' },
      totalDurationSec: { type: 'integer' },
      dateFrom:         { type: 'string', format: 'date-time', nullable: true },
      dateTo:           { type: 'string', format: 'date-time', nullable: true }
    }
  };

  const StatsByMuscleItem = {
    $id: 'workoutLogs.StatsByMuscleItem',
    type: 'object',
    properties: {
      muscleGroup: { type: 'string' },
      tonnageKg:   { type: 'number' },
      sets:        { type: 'integer' },
      reps:        { type: 'integer' }
    }
  };

  const StatsByMuscleSchema = {
    $id: 'workoutLogs.StatsByMuscle',
    type: 'object',
    properties: {
      dateFrom: { type: 'string', format: 'date-time', nullable: true },
      dateTo:   { type: 'string', format: 'date-time', nullable: true },
      items:    { type: 'array', items: { $ref: 'workoutLogs.StatsByMuscleItem#' } }
    }
  };

  // --- NOVOS SCHEMAS para os 3 PATCHs ---
  const UpdateSetBodySchema = {
    $id: 'workoutLogs.UpdateSetBody',
    type: 'object',
    properties: {
      weightKg:        { type: 'number',  minimum: 0, description: 'Carga usada em kg' },
      repsPlanned:     { type: 'integer', minimum: 0, description: 'Meta de reps do set' },
      repsDone:        { type: 'integer', minimum: 0, description: 'Reps realizadas' },
      durationSeconds: { type: 'integer', minimum: 0, description: 'Duração do set (ex.: prancha/cardio)' },
      rpe:             { type: 'number',  minimum: 0, maximum: 10, description: 'Esforço percebido 0-10' },
      completed:       { type: 'boolean', description: 'Se o set foi concluído' },
      notes:           { type: 'string',  description: 'Observações do set' }
    }
  };

  const UpdateEntryBodySchema = {
    $id: 'workoutLogs.UpdateEntryBody',
    type: 'object',
    properties: {
      exercise: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'Novo ObjectId do exercício para o bloco (opcional)'
      },
      notes: { type: 'string', description: 'Notas do bloco (opcional)' }
    }
  };

  const ReorderSetsBodySchema = {
    $id: 'workoutLogs.ReorderSetsBody',
    type: 'object',
    properties: {
      order: {
        type: 'array',
        items: { type: 'integer', minimum: 1 },
        minItems: 1,
        description: 'Nova ordem baseada nos setNumber existentes. Ex.: [3,1,2]'
      }
    },
    required: ['order']
  };

  [
    SetResultSchema,
    EntrySchema,
    WorkoutLogSchema,
    WorkoutLogPageSchema,
    CreateFromWorkoutBodySchema,
    CreateCustomBodySchema,
    UpdateBodySchema,
    // estatísticas
    StatsSummarySchema,
    StatsByMuscleItem,
    StatsByMuscleSchema,
    // patch bodies
    UpdateSetBodySchema,
    UpdateEntryBodySchema,
    ReorderSetsBodySchema,
  ].forEach(addOnce);

  // ---------------------------------------------------------------------------
  // ✅ Zod (validação de entrada)

  const setZ = z.object({
    setNumber: z.number().int().min(1),
    weightKg: z.number().min(0).optional().default(0),
    repsPlanned: z.number().int().min(0).optional().default(0),
    repsDone: z.number().int().min(0).optional().default(0),
    durationSeconds: z.number().int().min(0).optional().default(0),
    rpe: z.number().min(0).max(10).optional().default(0),
    completed: z.boolean().optional().default(false),
    notes: z.string().optional().default(''),
  });

  const entryZ = z.object({
    blockIndex: z.number().int().min(0),
    exercise: z.string().refine(isValidObjectId, 'exercise deve ser ObjectId válido (24 hex)'),
    notes: z.string().optional().default(''),
    sets: z.array(setZ).min(1),
  });

  const createFromWorkoutZ = z.object({
    date: z.string().datetime().optional(),
    notes: z.string().optional().default(''),
  });

  const createCustomZ = z.object({
    workout: z.string().refine(isValidObjectId, 'workout deve ser ObjectId válido (24 hex)'),
    date: z.string().datetime().optional(),
    durationSeconds: z.number().int().min(0).optional().default(0),
    notes: z.string().optional().default(''),
    entries: z.array(entryZ).min(1),
  });

  const updateZ = z.object({
    date: z.string().datetime().optional(),
    durationSeconds: z.number().int().min(0).optional(),
    notes: z.string().optional(),
    entries: z.array(entryZ).optional(),
  });

  // validadores dos PATCHs
  const updateSetZ = z.object({
    weightKg: z.number().min(0).optional(),
    repsPlanned: z.number().int().min(0).optional(),
    repsDone: z.number().int().min(0).optional(),
    durationSeconds: z.number().int().min(0).optional(),
    rpe: z.number().min(0).max(10).optional(),
    completed: z.boolean().optional(),
    notes: z.string().optional(),
  });

  const updateEntryZ = z.object({
    exercise: z.string().refine(isValidObjectId, 'exercise deve ser ObjectId válido (24 hex)').optional(),
    notes: z.string().optional(),
  });

  const reorderSetsZ = z.object({
    order: z.array(z.number().int().min(1)).min(1),
  });

  // ---------------------------------------------------------------------------
  // 🧭 Rotas

  // 1) Criar log a partir de um workout
  fastify.post('/workout-logs/from-workout/:workoutId', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { workoutId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } },
        required: ['workoutId']
      },
      body: { $ref: 'workoutLogs.CreateFromWorkoutBody#' },
      response: { 201: { $ref: 'workoutLogs.WorkoutLog#' } }
    }
  }, async (request, reply) => {
    const { workoutId } = request.params;
    if (!isValidObjectId(workoutId)) return reply.badRequest('workoutId inválido');

    const parsed = createFromWorkoutZ.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const workout = await Workout.findOne({ _id: workoutId, user: request.user.sub }).lean();
    if (!workout) return reply.notFound('Workout não encontrado');

    const entries = workout.blocks.map((b, idx) => {
      const sets = [];
      const totalSets = b.sets > 0 ? b.sets : 1;
      for (let s = 1; s <= totalSets; s++) {
        sets.push({
          setNumber: s,
          weightKg: 0,
          repsPlanned: b.reps || 0,
          repsDone: 0,
          durationSeconds: b.durationSeconds || 0,
          rpe: 0,
          completed: false,
          notes: '',
        });
      }
      return {
        blockIndex: idx,
        exercise: b.exercise,
        sets,
        notes: '',
      };
    });

    const created = await WorkoutLog.create({
      user: request.user.sub,
      workout: workout._id,
      date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
      notes: parsed.data.notes || '',
      entries,
    });

    const raw = await WorkoutLog.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  // 2) Criar log custom
  fastify.post('/workout-logs', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'workoutLogs.CreateCustomBody#' },
      response: { 201: { $ref: 'workoutLogs.WorkoutLog#' } }
    }
  }, async (request, reply) => {
    const parsed = createCustomZ.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const workout = await Workout.findOne({ _id: parsed.data.workout, user: request.user.sub }).lean();
    if (!workout) return reply.badRequest('Workout inválido ou inacessível');

    const exIds = [...new Set(parsed.data.entries.map(e => e.exercise))];
    const accessible = await Exercise.find({
      _id: { $in: exIds },
      $or: [{ isPublic: true }, { owner: request.user.sub }]
    }).select('_id');
    if (accessible.length !== exIds.length) {
      return reply.badRequest('Um ou mais exercícios nas entries não existem ou não são acessíveis');
    }

    const created = await WorkoutLog.create({
      user: request.user.sub,
      workout: workout._id,
      date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
      durationSeconds: parsed.data.durationSeconds || 0,
      notes: parsed.data.notes || '',
      entries: parsed.data.entries,
    });

    const raw = await WorkoutLog.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  // 3) Listar logs (por período)
  fastify.get('/workout-logs', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          workoutId: { type: 'string' },
          dateFrom:  { type: 'string', format: 'date-time' },
          dateTo:    { type: 'string', format: 'date-time' },
          page:      { type: 'integer', default: 1, minimum: 1 },
          limit:     { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        }
      },
      response: { 200: { $ref: 'workoutLogs.WorkoutLogPage#' } }
    }
  }, async (request) => {
    const { workoutId, dateFrom, dateTo, page = 1, limit = 20 } = request.query || {};
    const filter = { user: request.user.sub };

    if (workoutId && isValidObjectId(workoutId)) filter.workout = workoutId;
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = new Date(dateFrom);
      if (dateTo)   filter.date.$lte = new Date(dateTo);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [itemsRaw, total] = await Promise.all([
      WorkoutLog.find(filter).sort({ date: -1 }).skip(skip).limit(Number(limit)).lean(),
      WorkoutLog.countDocuments(filter),
    ]);

    const items = normalizeMany(itemsRaw);
    return { page: Number(page), limit: Number(limit), total, items };
  });

  // 4) Detalhe
  fastify.get('/workout-logs/:id', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'workoutLogs.WorkoutLog#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const raw = await WorkoutLog.findOne({ _id: id, user: request.user.sub }).lean();
    if (!raw) return reply.notFound('Log não encontrado');
    return normalize(raw);
  });

  // 5) Atualizar (substitui campos enviados; se enviar entries, substitui o array inteiro)
  fastify.put('/workout-logs/:id', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      body: { $ref: 'workoutLogs.UpdateBody#' },
      response: { 200: { $ref: 'workoutLogs.WorkoutLog#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const parsed = updateZ.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const wl = await WorkoutLog.findOne({ _id: id, user: request.user.sub });
    if (!wl) return reply.notFound('Log não encontrado');

    if (parsed.data.entries) {
      const exIds = [...new Set(parsed.data.entries.map(e => e.exercise))];
      const invalid = exIds.filter(x => !isValidObjectId(x));
      if (invalid.length) {
        return reply.badRequest('entries.*.exercise deve ser ObjectId válido (24 hex)');
      }
      const accessible = await Exercise.find({
        _id: { $in: exIds },
        $or: [{ isPublic: true }, { owner: request.user.sub }]
      }).select('_id');
      if (accessible.length !== exIds.length) {
        return reply.badRequest('Um ou mais exercícios nas entries não existem ou não são acessíveis');
      }
      wl.entries = parsed.data.entries;
    }

    if (parsed.data.date !== undefined) wl.date = new Date(parsed.data.date);
    if (parsed.data.durationSeconds !== undefined) wl.durationSeconds = parsed.data.durationSeconds;
    if (parsed.data.notes !== undefined) wl.notes = parsed.data.notes;

    await wl.save();
    const raw = await WorkoutLog.findById(wl._id).lean();
    return normalize(raw);
  });

  // 6) Apagar
  fastify.delete('/workout-logs/:id', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 204: { type: 'null' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const wl = await WorkoutLog.findOne({ _id: id, user: request.user.sub });
    if (!wl) return reply.notFound('Log não encontrado');

    await wl.deleteOne();
    return reply.code(204).send();
  });

  // 7) Estatísticas — resumo
  fastify.get('/workout-logs/stats/summary', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo:   { type: 'string', format: 'date-time' },
        }
      },
      response: { 200: { $ref: 'workoutLogs.StatsSummary#' } }
    }
  }, async (request) => {
    const { dateFrom, dateTo } = request.query || {};
    const filter = { user: request.user.sub };
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = new Date(dateFrom);
      if (dateTo)   filter.date.$lte = new Date(dateTo);
    }

    const logs = await WorkoutLog.find(filter).lean();
    let sessions = logs.length;
    let totalSets = 0;
    let totalReps = 0;
    let totalTonnageKg = 0;
    let totalDurationSec = 0;

    for (const l of logs) {
      totalDurationSec += l.durationSeconds || 0;
      for (const e of l.entries || []) {
        for (const s of e.sets || []) {
          totalSets += 1;
          totalReps += (s.repsDone || 0);
          totalTonnageKg += (s.weightKg || 0) * (s.repsDone || 0);
        }
      }
    }

    return {
      sessions,
      totalSets,
      totalReps,
      totalTonnageKg,
      totalDurationSec,
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : null,
      dateTo:   dateTo   ? new Date(dateTo).toISOString()   : null,
    };
  });

  // 8) Estatísticas — por grupo muscular
  fastify.get('/workout-logs/stats/by-muscle', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo:   { type: 'string', format: 'date-time' },
        }
      },
      response: { 200: { $ref: 'workoutLogs.StatsByMuscle#' } }
    }
  }, async (request) => {
    const { dateFrom, dateTo } = request.query || {};
    const match = { user: request.user.sub };
    if (dateFrom || dateTo) {
      match.date = {};
      if (dateFrom) match.date.$gte = new Date(dateFrom);
      if (dateTo)   match.date.$lte = new Date(dateTo);
    }

    const pipeline = [
      { $match: match },
      { $unwind: '$entries' },
      { $unwind: '$entries.sets' },
      {
        $lookup: {
          from: 'exercises',
          localField: 'entries.exercise',
          foreignField: '_id',
          as: 'ex'
        }
      },
      { $unwind: '$ex' },
      {
        $group: {
          _id: { muscleGroup: '$ex.muscleGroup' },
          tonnageKg: { $sum: { $multiply: ['$entries.sets.weightKg', '$entries.sets.repsDone'] } },
          sets: { $sum: 1 },
          reps: { $sum: '$entries.sets.repsDone' }
        }
      },
      {
        $project: {
          _id: 0,
          muscleGroup: '$_id.muscleGroup',
          tonnageKg: 1,
          sets: 1,
          reps: 1
        }
      },
      { $sort: { tonnageKg: -1 } }
    ];

    const items = await WorkoutLog.aggregate(pipeline);
    return {
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : null,
      dateTo:   dateTo   ? new Date(dateTo).toISOString()   : null,
      items
    };
  });

  // ---------------------------------------------------------------------------
  // 🚀 NOVOS 3 PATCHs

  // (1) PATCH de 1 set específico (cria se for o próximo sequencial)
  fastify.patch('/workout-logs/:id/entry/:blockIndex/set/:setNumber', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id:         { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
          blockIndex: { type: 'integer', minimum: 0 },
          setNumber:  { type: 'integer', minimum: 1 }
        },
        required: ['id', 'blockIndex', 'setNumber']
      },
      body: { $ref: 'workoutLogs.UpdateSetBody#' },
      response: { 200: { $ref: 'workoutLogs.WorkoutLog#' } }
    }
  }, async (request, reply) => {
    const { id, blockIndex, setNumber } = request.params;

    if (!isValidObjectId(id)) return reply.badRequest('ID inválido (ObjectId de 24 hex).');

    const bi = Number(blockIndex);
    const sn = Number(setNumber);
    if (!Number.isInteger(bi) || bi < 0) return reply.badRequest('blockIndex inválido');
    if (!Number.isInteger(sn) || sn < 1) return reply.badRequest('setNumber inválido');

    const parsed = updateSetZ.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const wl = await WorkoutLog.findOne({ _id: id, user: request.user.sub });
    if (!wl) return reply.notFound('Log não encontrado');

    if (!Array.isArray(wl.entries) || bi >= wl.entries.length) {
      return reply.badRequest('blockIndex fora do intervalo');
    }

    const entry = wl.entries[bi];
    if (!Array.isArray(entry.sets)) entry.sets = [];

    let set = entry.sets.find(s => s.setNumber === sn);

    if (!set) {
      if (sn !== entry.sets.length + 1) {
        return reply.notFound('Set não encontrado; para adicionar um novo set use o próximo número sequencial');
      }
      set = {
        setNumber: sn,
        weightKg: 0,
        repsPlanned: 0,
        repsDone: 0,
        durationSeconds: 0,
        rpe: 0,
        completed: false,
        notes: '',
      };
      entry.sets.push(set);
    }

    const { weightKg, repsPlanned, repsDone, durationSeconds, rpe, completed, notes } = parsed.data;
    if (weightKg !== undefined) set.weightKg = weightKg;
    if (repsPlanned !== undefined) set.repsPlanned = repsPlanned;
    if (repsDone !== undefined) set.repsDone = repsDone;
    if (durationSeconds !== undefined) set.durationSeconds = durationSeconds;
    if (rpe !== undefined) set.rpe = rpe;
    if (completed !== undefined) set.completed = completed;
    if (notes !== undefined) set.notes = notes;

    await wl.save();

    const raw = await WorkoutLog.findById(wl._id).lean();
    return normalize(raw);
  });

  // (2) PATCH de nível "entry" (trocar exercício e/ou notas do bloco)
  fastify.patch('/workout-logs/:id/entry/:blockIndex', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id:         { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
          blockIndex: { type: 'integer', minimum: 0 }
        },
        required: ['id', 'blockIndex']
      },
      body: { $ref: 'workoutLogs.UpdateEntryBody#' },
      response: { 200: { $ref: 'workoutLogs.WorkoutLog#' } }
    }
  }, async (request, reply) => {
    const { id, blockIndex } = request.params;

    if (!isValidObjectId(id)) return reply.badRequest('ID inválido (ObjectId de 24 hex).');

    const bi = Number(blockIndex);
    if (!Number.isInteger(bi) || bi < 0) return reply.badRequest('blockIndex inválido');

    const parsed = updateEntryZ.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const wl = await WorkoutLog.findOne({ _id: id, user: request.user.sub });
    if (!wl) return reply.notFound('Log não encontrado');

    if (!Array.isArray(wl.entries) || bi >= wl.entries.length) {
      return reply.badRequest('blockIndex fora do intervalo');
    }

    const entry = wl.entries[bi];

    if (parsed.data.exercise !== undefined) {
      const exId = parsed.data.exercise;
      if (!isValidObjectId(exId)) return reply.badRequest('exercise inválido (24 hex).');

      const canUse = await Exercise.findOne({
        _id: exId,
        $or: [{ isPublic: true }, { owner: request.user.sub }]
      }).select('_id');

      if (!canUse) return reply.badRequest('Exercício não existe ou não é acessível');

      entry.exercise = exId;
    }

    if (parsed.data.notes !== undefined) {
      entry.notes = parsed.data.notes;
    }

    await wl.save();

    const raw = await WorkoutLog.findById(wl._id).lean();
    return normalize(raw);
  });

  // (3) PATCH para reordenar sets do bloco (por array de setNumbers)
  fastify.patch('/workout-logs/:id/entry/:blockIndex/reorder-sets', {
    schema: {
      tags: ['workout-logs'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id:         { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
          blockIndex: { type: 'integer', minimum: 0 }
        },
        required: ['id', 'blockIndex']
      },
      body: { $ref: 'workoutLogs.ReorderSetsBody#' },
      response: { 200: { $ref: 'workoutLogs.WorkoutLog#' } }
    }
  }, async (request, reply) => {
    const { id, blockIndex } = request.params;

    if (!isValidObjectId(id)) return reply.badRequest('ID inválido (ObjectId de 24 hex).');

    const bi = Number(blockIndex);
    if (!Number.isInteger(bi) || bi < 0) return reply.badRequest('blockIndex inválido');

    const parsed = reorderSetsZ.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const wl = await WorkoutLog.findOne({ _id: id, user: request.user.sub });
    if (!wl) return reply.notFound('Log não encontrado');

    if (!Array.isArray(wl.entries) || bi >= wl.entries.length) {
      return reply.badRequest('blockIndex fora do intervalo');
    }

    const entry = wl.entries[bi];
    if (!Array.isArray(entry.sets) || entry.sets.length === 0) {
      return reply.badRequest('Bloco não possui sets para reordenar');
    }

    const currentNumbers = entry.sets.map(s => s.setNumber).sort((a,b)=>a-b);
    const desired = [...parsed.data.order].sort((a,b)=>a-b);

    if (currentNumbers.length !== desired.length ||
        !currentNumbers.every((v,i) => v === desired[i])) {
      return reply.badRequest('order deve conter exatamente os setNumber existentes, sem duplicar/omitir');
    }

    const map = {};
    for (const s of entry.sets) {
      const plain = s.toObject ? s.toObject() : { ...s };
      map[s.setNumber] = plain;
    }

    const reordered = parsed.data.order.map((n, idx) => {
      const obj = map[n];
      obj.setNumber = idx + 1;
      return obj;
    });

    entry.sets = reordered;

    await wl.save();

    const raw = await WorkoutLog.findById(wl._id).lean();
    return normalize(raw);
  });
};
