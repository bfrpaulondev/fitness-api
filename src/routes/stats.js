// src/routes/stats.js
const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const WorkoutLog = require('../models/workoutLog');
const Exercise = require('../models/exercise');

module.exports = async function statsRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  // Helpers
  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // -------------------- Swagger Schemas --------------------
  const TimeSeriesSchema = {
    $id: 'stats.TimeSeries',
    type: 'object',
    properties: {
      metric: { type: 'string', enum: ['tonnage','sets','reps','duration','sessions'] },
      period: { type: 'string', enum: ['day','week','month'] },
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            bucket: { type: 'string' }, // ex.: 2025-07-01 (day), 2025-W31 (week), 2025-07 (month)
            value: { type: 'number' }
          },
          required: ['bucket','value']
        }
      },
      total: { type: 'number' }
    },
    required: ['metric','period','items','total']
  };

  const CompareSchema = {
    $id: 'stats.Compare',
    type: 'object',
    properties: {
      metric: { type: 'string', enum: ['tonnage','sets','reps','duration','sessions'] },
      a: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' }, value: { type: 'number' } },
        required: ['from','to','value']
      },
      b: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' }, value: { type: 'number' } },
        required: ['from','to','value']
      },
      deltaAbs: { type: 'number' },
      deltaPct: { type: 'number' }
    },
    required: ['metric','a','b','deltaAbs','deltaPct']
  };

  const PRItem = {
    $id: 'stats.PRItem',
    type: 'object',
    properties: {
      exerciseId: { type: 'string' },
      exerciseName: { type: 'string' },
      oneRm: { type: 'number' },
      bestSet: {
        type: 'object',
        properties: {
          weightKg: { type: 'number' },
          repsDone: { type: 'number' },
          date: { type: 'string', format: 'date-time' },
          workoutLogId: { type: 'string' }
        },
        required: ['weightKg','repsDone','date','workoutLogId']
      }
    },
    required: ['exerciseId','exerciseName','oneRm','bestSet']
  };

  const PRsSchema = {
    $id: 'stats.PRs',
    type: 'object',
    properties: {
      items: { type: 'array', items: { $ref: 'stats.PRItem#' } }
    },
    required: ['items']
  };

  const TopSchema = {
    $id: 'stats.Top',
    type: 'object',
    properties: {
      metric: { type: 'string', enum: ['tonnage','sets','reps','duration'] },
      by: { type: 'string', enum: ['exercise','muscle'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },     // exerciseId ou muscleGroup
            name: { type: 'string' },   // exercise name ou muscleGroup
            value: { type: 'number' }
          },
          required: ['id','name','value']
        }
      }
    },
    required: ['metric','by','items']
  };

  [TimeSeriesSchema, CompareSchema, PRItem, PRsSchema, TopSchema].forEach(addOnce);

  // -------------------- Util/Calc --------------------
  function getBucket(d, period) {
    const dt = new Date(d);
    if (period === 'day') {
      return dt.toISOString().slice(0, 10); // YYYY-MM-DD
    }
    if (period === 'month') {
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2,'0')}`; // YYYY-MM
    }
    // week (ISO week)
    const date = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    const dayNum = date.getUTCDay() || 7; // 1..7; Monday is 1 (Portugal Monday start)
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
  }

  function computeFromLogs(logs) {
    let tonnage = 0, sets = 0, reps = 0, duration = 0;
    for (const log of logs) {
      duration += Number(log.durationSeconds || 0);
      for (const entry of (log.entries || [])) {
        for (const s of (entry.sets || [])) {
          const w = Number(s.weightKg || 0);
          const r = Number(s.repsDone || 0);
          tonnage += w * r;
          sets += 1;
          reps += r;
        }
      }
    }
    return { tonnage, sets, reps, duration, sessions: logs.length };
  }

  function oneRmEpley(weightKg, reps) {
    if (!weightKg || !reps || reps < 1) return 0;
    return Number(weightKg) * (1 + Number(reps) / 30);
  }

  // -------------------- Zod --------------------
  const metricEnum = z.enum(['tonnage','sets','reps','duration','sessions']);
  const periodEnum = z.enum(['day','week','month']);

  // -------------------- Rotas --------------------

  // Time-series
  fastify.get('/stats/time-series', {
    schema: {
      tags: ['stats'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['tonnage','sets','reps','duration','sessions'], default: 'tonnage' },
          period: { type: 'string', enum: ['day','week','month'], default: 'week' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' }
        }
      },
      response: { 200: { $ref: 'stats.TimeSeries#' } }
    }
  }, async (request, reply) => {
    const qz = z.object({
      metric: metricEnum.default('tonnage'),
      period: periodEnum.default('week'),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional()
    }).safeParse(request.query || {});
    if (!qz.success) return reply.badRequest(qz.error.errors.map(e => e.message).join(', '));
    const { metric, period, from, to } = qz.data;

    const filter = { user: request.user.sub };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }

    const logs = await WorkoutLog.find(filter).select('date entries durationSeconds').lean();
    const buckets = new Map();
    for (const log of logs) {
      const key = getBucket(log.date, period);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(log);
    }

    let total = 0;
    const items = [];
    for (const [bucket, arr] of Array.from(buckets.entries()).sort()) {
      const c = computeFromLogs(arr);
      const val = c[metric];
      items.push({ bucket, value: val });
      total += val;
    }

    return { metric, period, from: from || null, to: to || null, items, total };
  });

  // Compare períodos A vs B
  fastify.get('/stats/compare', {
    schema: {
      tags: ['stats'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['tonnage','sets','reps','duration','sessions'], default: 'tonnage' },
          fromA: { type: 'string', format: 'date-time' },
          toA: { type: 'string', format: 'date-time' },
          fromB: { type: 'string', format: 'date-time' },
          toB: { type: 'string', format: 'date-time' }
        },
        required: ['fromA','toA','fromB','toB']
      },
      response: { 200: { $ref: 'stats.Compare#' } }
    }
  }, async (request, reply) => {
    const qz = z.object({
      metric: metricEnum.default('tonnage'),
      fromA: z.string().datetime(),
      toA: z.string().datetime(),
      fromB: z.string().datetime(),
      toB: z.string().datetime()
    }).safeParse(request.query || {});
    if (!qz.success) return reply.badRequest(qz.error.errors.map(e => e.message).join(', '));
    const { metric, fromA, toA, fromB, toB } = qz.data;

    async function sumForRange(from, to) {
      const logs = await WorkoutLog.find({
        user: request.user.sub,
        date: { $gte: new Date(from), $lte: new Date(to) }
      }).select('date entries durationSeconds').lean();
      return computeFromLogs(logs)[metric];
    }

    const [aVal, bVal] = await Promise.all([sumForRange(fromA, toA), sumForRange(fromB, toB)]);
    const deltaAbs = aVal - bVal;
    const deltaPct = bVal === 0 ? (aVal > 0 ? 100 : 0) : (deltaAbs / bVal) * 100;

    return {
      metric,
      a: { from: fromA, to: toA, value: aVal },
      b: { from: fromB, to: toB, value: bVal },
      deltaAbs,
      deltaPct
    };
  });

  // PRs (1RM estimada) - por exercício (opcional) ou top N gerais
  fastify.get('/stats/prs', {
    schema: {
      tags: ['stats'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          exerciseId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
          limit: { type: 'integer', default: 5, minimum: 1, maximum: 50 }
        }
      },
      response: { 200: { $ref: 'stats.PRs#' } }
    }
  }, async (request, reply) => {
    const qz = z.object({
      exerciseId: z.string().refine(isValidObjectId).optional(),
      limit: z.number().int().min(1).max(50).default(5)
    }).safeParse(request.query || {});
    if (!qz.success) return reply.badRequest(qz.error.errors.map(e => e.message).join(', '));
    const { exerciseId, limit } = qz.data;

    // Para eficiência, puxamos somente campos necessários
    const logs = await WorkoutLog.find({ user: request.user.sub })
      .select('date entries.exercise entries.sets.weightKg entries.sets.repsDone')
      .lean();

    const bestByExercise = new Map(); // exerciseId -> { oneRm, weightKg, repsDone, date, workoutLogId }
    for (const log of logs) {
      for (const entry of (log.entries || [])) {
        const exId = String(entry.exercise);
        for (const s of (entry.sets || [])) {
          const w = Number(s.weightKg || 0);
          const r = Number(s.repsDone || 0);
          if (w <= 0 || r <= 0) continue;
          const est = oneRmEpley(w, r);
          const prev = bestByExercise.get(exId);
          if (!prev || est > prev.oneRm) {
            bestByExercise.set(exId, { oneRm: est, weightKg: w, repsDone: r, date: log.date, workoutLogId: String(log._id) });
          }
        }
      }
    }

    let pairs = Array.from(bestByExercise.entries());
    if (exerciseId) pairs = pairs.filter(([ex]) => ex === String(exerciseId));
    pairs.sort((a,b) => b[1].oneRm - a[1].oneRm);
    pairs = pairs.slice(0, limit);

    const exIds = pairs.map(([id]) => id);
    const exDocs = await Exercise.find({ _id: { $in: exIds } }).select('_id name').lean();
    const nameById = new Map(exDocs.map(d => [String(d._id), d.name || 'Exercise']));

    const items = pairs.map(([id, pr]) => ({
      exerciseId: id,
      exerciseName: nameById.get(id) || 'Exercise',
      oneRm: pr.oneRm,
      bestSet: {
        weightKg: pr.weightKg,
        repsDone: pr.repsDone,
        date: pr.date instanceof Date ? pr.date.toISOString() : pr.date,
        workoutLogId: pr.workoutLogId
      }
    }));

    return { items: normalizeMany(items) };
  });

  // Top N por exercício ou grupo muscular
  fastify.get('/stats/top', {
    schema: {
      tags: ['stats'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['tonnage','sets','reps','duration'], default: 'tonnage' },
          by: { type: 'string', enum: ['exercise','muscle'], default: 'exercise' },
          limit: { type: 'integer', default: 5, minimum: 1, maximum: 50 }
        }
      },
      response: { 200: { $ref: 'stats.Top#' } }
    }
  }, async (request, reply) => {
    const qz = z.object({
      metric: z.enum(['tonnage','sets','reps','duration']).default('tonnage'),
      by: z.enum(['exercise','muscle']).default('exercise'),
      limit: z.number().int().min(1).max(50).default(5)
    }).safeParse(request.query || {});
    if (!qz.success) return reply.badRequest(qz.error.errors.map(e => e.message).join(', '));
    const { metric, by, limit } = qz.data;

    const logs = await WorkoutLog.find({ user: request.user.sub })
      .select('date durationSeconds entries.exercise entries.sets.weightKg entries.sets.repsDone')
      .lean();

    // somatório por chave
    const acc = new Map(); // key -> value
    const exSet = new Set();
    for (const log of logs) {
      if (metric === 'duration') {
        // duração soma por sessão (atribuir a chave 'duration' não tem por-exercise sentido; vamos colocar em uma chave única)
        const key = by === 'exercise' ? 'ALL' : 'ALL';
        acc.set(key, (acc.get(key) || 0) + Number(log.durationSeconds || 0));
      } else {
        for (const entry of (log.entries || [])) {
          const key = by === 'exercise' ? String(entry.exercise) : 'muscle:' + String(entry.exercise);
          // Guardar exercise ids para buscar nomes/músculos depois
          if (by === 'exercise') exSet.add(String(entry.exercise));
          for (const s of (entry.sets || [])) {
            const w = Number(s.weightKg || 0);
            const r = Number(s.repsDone || 0);
            const inc = metric === 'tonnage' ? (w * r) : (metric === 'sets' ? 1 : r);
            acc.set(key, (acc.get(key) || 0) + inc);
          }
        }
      }
    }

    let items = [];
    if (by === 'exercise') {
      const exDocs = await Exercise.find({ _id: { $in: Array.from(exSet) } }).select('_id name').lean();
      const nameById = new Map(exDocs.map(d => [String(d._id), d.name || 'Exercise']));
      items = Array.from(acc.entries())
        .filter(([k]) => k !== 'ALL')
        .map(([k,v]) => ({ id: k, name: nameById.get(k) || 'Exercise', value: v }))
        .sort((a,b) => b.value - a.value)
        .slice(0, limit);
    } else {
      // by muscle — precisamos mapear exerciseId -> muscleGroup
      const exIds = Array.from(new Set(Array.from(acc.keys()).map(k => k.startsWith('muscle:') ? k.slice(7) : null).filter(Boolean)));
      const exDocs = await Exercise.find({ _id: { $in: exIds } }).select('_id muscleGroup name').lean();
      const muscleAcc = new Map(); // muscle -> value
      const valByEx = new Map();
      for (const [k, v] of acc.entries()) {
        if (!k.startsWith('muscle:')) continue;
        valByEx.set(k.slice(7), v);
      }
      for (const ex of exDocs) {
        const mg = ex.muscleGroup || 'desconhecido';
        muscleAcc.set(mg, (muscleAcc.get(mg) || 0) + (valByEx.get(String(ex._id)) || 0));
      }
      items = Array.from(muscleAcc.entries())
        .map(([mg, v]) => ({ id: mg, name: mg, value: v }))
        .sort((a,b) => b.value - a.value)
        .slice(0, limit);
    }

    return { metric, by, items: normalizeMany(items) };
  });
};
