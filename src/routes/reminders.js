// src/routes/reminders.js
const { z } = require('zod');
const Reminder = require('../models/reminder');

module.exports = async function remindersRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // ---------- Util: RRULE simples (DAILY/WEEKLY) ----------
  const WEEKDAYS = ['SU','MO','TU','WE','TH','FR','SA'];
  function parseRRule(rrule) {
    // Ex.: FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0
    // Ex.: FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=7;BYMINUTE=30;BYSECOND=0
    const obj = {};
    for (const part of String(rrule).split(';')) {
      const [k, v] = part.split('=');
      if (!k) continue;
      obj[k.trim().toUpperCase()] = (v || '').trim().toUpperCase();
    }
    const freq = obj.FREQ;
    const hour = Number(obj.BYHOUR || 9);
    const minute = Number(obj.BYMINUTE || 0);
    const second = Number(obj.BYSECOND || 0);
    let days = [];
    if (obj.BYDAY) {
      days = obj.BYDAY.split(',').map(s => s.trim().toUpperCase()).filter(s => WEEKDAYS.includes(s));
    }
    return { freq, hour, minute, second, days };
  }

  function nextOccurrence(rrule, now = new Date()) {
    const { freq, hour, minute, second, days } = parseRRule(rrule);
    if (!freq) return null;

    const d = new Date(now);
    d.setMilliseconds(0);

    function at(h, m, s) {
      const x = new Date(d);
      x.setUTCHours(h, m, s, 0); // usamos UTC para simplicidade
      return x;
    }

    if (freq === 'DAILY') {
      let candidate = at(hour, minute, second);
      if (candidate <= now) {
        candidate = new Date(candidate.getTime() + 24 * 3600 * 1000);
      }
      return candidate;
    }

    if (freq === 'WEEKLY') {
      // calcula próximo dia da semana dentre BYDAY
      const todayIdx = d.getUTCDay(); // 0..6 (0=Sun)
      const dayList = days.length ? days : WEEKDAYS; // se não especificado, todos
      const toIdx = (wd) => WEEKDAYS.indexOf(wd);
      // primeiro: tentar hoje
      let candidate = at(hour, minute, second);
      for (let off = 0; off <= 7; off++) {
        const check = new Date(candidate.getTime() + off * 24 * 3600 * 1000);
        const wd = check.getUTCDay();
        const wdCode = WEEKDAYS[wd];
        if (dayList.includes(wdCode) && check > now) {
          return check;
        }
      }
      // fallback 1 semana depois
      return new Date(candidate.getTime() + 7 * 24 * 3600 * 1000);
    }

    // TODO: pode estender para MONTHLY futuramente
    return null;
  }

  // ---------- Swagger Schemas ----------
  const ReminderSchema = {
    $id: 'reminders.Reminder',
    type: 'object',
    properties: {
      _id: { type: 'string' }, user: { type: 'string' },
      title: { type: 'string' }, message: { type: 'string' },
      rrule: { type: 'string' }, timezone: { type: 'string' },
      active: { type: 'boolean' },
      lastRunAt: { type: 'string', format: 'date-time', nullable: true },
      nextRunAt: { type: 'string', format: 'date-time', nullable: true },
      data: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','title','message','rrule']
  };

  const ReminderPage = {
    $id: 'reminders.Page',
    type: 'object',
    properties: {
      page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'reminders.Reminder#' } }
    },
    required: ['page','limit','total','items']
  };

  [ReminderSchema, ReminderPage].forEach(addOnce);

  // ---------- Zod ----------
  const createZ = z.object({
    title: z.string().min(1),
    message: z.string().min(1),
    rrule: z.string().min(6), // FREQ=...
    timezone: z.string().optional(),
    data: z.record(z.any()).optional(),
    active: z.boolean().optional()
  });
  const updateZ = createZ.partial();

  // ---------- CRUD ----------
  fastify.post('/reminders', {
    schema: {
      tags: ['reminders'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' }, message: { type: 'string' },
          rrule: { type: 'string' }, timezone: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
          active: { type: 'boolean' }
        },
        required: ['title','message','rrule']
      },
      response: { 201: { $ref: 'reminders.Reminder#' } }
    }
  }, async (request, reply) => {
    const parsed = createZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const nextRunAt = nextOccurrence(parsed.data.rrule, new Date());
    const created = await Reminder.create({
      user: request.user.sub,
      ...parsed.data,
      nextRunAt
    });
    const raw = await Reminder.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  fastify.get('/reminders', {
    schema: {
      tags: ['reminders'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 100 }
        }
      },
      response: { 200: { $ref: 'reminders.Page#' } }
    }
  }, async (request) => {
    const { active, page = 1, limit = 50 } = request.query || {};
    const filter = { user: request.user.sub };
    if (typeof active === 'boolean') filter.active = active;
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Reminder.find(filter).sort({ nextRunAt: 1 }).skip(skip).limit(Number(limit)).lean(),
      Reminder.countDocuments(filter)
    ]);
    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(items) };
  });

  fastify.get('/reminders/:id', {
    schema: {
      tags: ['reminders'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'reminders.Reminder#' } }
    }
  }, async (request, reply) => {
    const r = await Reminder.findOne({ _id: request.params.id, user: request.user.sub }).lean();
    if (!r) return reply.notFound('Lembrete não encontrado');
    return normalize(r);
  });

  fastify.put('/reminders/:id', {
    schema: {
      tags: ['reminders'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' }, message: { type: 'string' },
          rrule: { type: 'string' }, timezone: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
          active: { type: 'boolean' }
        }
      },
      response: { 200: { $ref: 'reminders.Reminder#' } }
    }
  }, async (request, reply) => {
    const parsed = updateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const r = await Reminder.findOne({ _id: request.params.id, user: request.user.sub });
    if (!r) return reply.notFound('Lembrete não encontrado');

    Object.assign(r, parsed.data);
    if (parsed.data.rrule || r.nextRunAt === null) {
      r.nextRunAt = nextOccurrence(r.rrule, new Date());
    }
    await r.save();
    const raw = await Reminder.findById(r._id).lean();
    return normalize(raw);
  });

  fastify.delete('/reminders/:id', {
    schema: {
      tags: ['reminders'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const r = await Reminder.findOne({ _id: request.params.id, user: request.user.sub });
    if (!r) return reply.notFound('Lembrete não encontrado');
    await r.deleteOne();
    return reply.code(204).send();
  });

  // Preview próximas N execuções
  fastify.get('/reminders/:id/preview', {
    schema: {
      tags: ['reminders'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      querystring: { type: 'object', properties: { count: { type: 'integer', default: 5, minimum: 1, maximum: 30 } } }
    }
  }, async (request, reply) => {
    const { count = 5 } = request.query || {};
    const r = await Reminder.findOne({ _id: request.params.id, user: request.user.sub }).lean();
    if (!r) return reply.notFound('Lembrete não encontrado');

    const items = [];
    let start = new Date();
    for (let i = 0; i < Number(count); i++) {
      const n = nextOccurrence(r.rrule, start);
      if (!n) break;
      items.push(n.toISOString());
      start = new Date(n.getTime() + 1000);
    }
    return { reminderId: String(r._id), rrule: r.rrule, next: items };
  });

  // Dispatch de lembretes vencidos (para usar em CRON externo)
  fastify.post('/reminders/dispatch-due', {
    schema: {
      tags: ['reminders'],
      security: [{ bearerAuth: [] }],
      body: { type: 'object', properties: { limit: { type: 'integer', default: 50, minimum: 1, maximum: 500 } } }
    }
  }, async (request) => {
    const { limit = 50 } = request.body || {};
    const now = new Date();
    const due = await Reminder.find({
      active: true,
      nextRunAt: { $ne: null, $lte: now }
    }).sort({ nextRunAt: 1 }).limit(Number(limit));

    let sent = 0, errors = 0;
    const results = [];
    for (const r of due) {
      try {
        await fastify.sendPushToUser(r.user, { message: r.message, title: r.title, data: r.data });
        r.lastRunAt = new Date();
        r.nextRunAt = nextOccurrence(r.rrule, new Date(Date.now() + 1000)) || null;
        await r.save();
        sent++;
        results.push({ id: String(r._id), ok: true, nextRunAt: r.nextRunAt });
      } catch (err) {
        fastify.log.error({ err, reminderId: r._id }, 'Falha ao enviar lembrete');
        errors++;
        results.push({ id: String(r._id), ok: false, error: err.message });
      }
    }

    return { processed: due.length, sent, errors, results };
  });
};
