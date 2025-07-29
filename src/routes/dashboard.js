// src/routes/dashboard.js
const { z } = require('zod');
const DashboardLayout = require('../models/dashboardLayout');

module.exports = async function dashboardRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));

  // Swagger Schemas
  const WidgetSchema = {
    $id: 'dash.Widget',
    type: 'object',
    properties: {
      key: { type: 'string' },
      type: { type: 'string', enum: ['kpi','chart','ranking'] },
      title: { type: 'string' },
      order: { type: 'integer' },
      size: { type: 'string', enum: ['sm','md','lg'] },
      config: { type: 'object', additionalProperties: true }
    },
    required: ['key','type']
  };
  const LayoutSchema = {
    $id: 'dash.Layout',
    type: 'object',
    properties: {
      user: { type: 'string' },
      widgets: { type: 'array', items: { $ref: 'dash.Widget#' } },
      updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['widgets']
  };

  [WidgetSchema, LayoutSchema].forEach(addOnce);

  const widgetZ = z.object({
    key: z.string().min(1),
    type: z.enum(['kpi','chart','ranking']),
    title: z.string().optional().default(''),
    order: z.number().int().min(0).optional().default(0),
    size: z.enum(['sm','md','lg']).optional().default('md'),
    config: z.record(z.any()).optional().default({})
  });
  const layoutZ = z.object({ widgets: z.array(widgetZ).max(50) });

  // GET layout (cria default se não existir)
  fastify.get('/dashboard/widgets', {
    schema: {
      tags: ['stats'],
      security: [{ bearerAuth: [] }],
      response: { 200: { $ref: 'dash.Layout#' } }
    }
  }, async (request) => {
    let d = await DashboardLayout.findOne({ user: request.user.sub }).lean();
    if (!d) {
      // layout default
      d = await DashboardLayout.create({
        user: request.user.sub,
        widgets: [
          { key: 'kpi-tonnage-week', type: 'kpi', title: 'Tonelagem (semana)', order: 0, size: 'sm', config: { metric: 'tonnage', period: 'week' } },
          { key: 'chart-tonnage-week', type: 'chart', title: 'Tendência (tonelagem)', order: 1, size: 'lg', config: { metric: 'tonnage', period: 'week' } },
          { key: 'ranking-exercises', type: 'ranking', title: 'Top Exercícios (tonelagem)', order: 2, size: 'md', config: { metric: 'tonnage', by: 'exercise', limit: 5 } }
        ]
      });
      d = await DashboardLayout.findById(d._id).lean();
    }
    return normalize(d);
  });

  // PUT layout (substitui)
  fastify.put('/dashboard/widgets', {
    schema: {
      tags: ['stats'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'dash.Layout#' },
      response: { 200: { $ref: 'dash.Layout#' } }
    }
  }, async (request, reply) => {
    const parsed = layoutZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const updated = await DashboardLayout.findOneAndUpdate(
      { user: request.user.sub },
      { $set: { widgets: parsed.data.widgets, updatedAt: new Date() } },
      { upsert: true, new: true }
    ).lean();

    return normalize(updated);
  });
};
