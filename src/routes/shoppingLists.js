// src/routes/shoppingLists.js
const { z } = require('zod');
const ShoppingList = require('../models/shoppingList');

module.exports = async function shoppingListsRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // =============== Helpers gerais ===============
  function mapUnit(u) {
    const u0 = String(u || '').trim().toLowerCase();
    if (['g', 'gram', 'grams'].includes(u0)) return 'g';
    if (['kg', 'kilogram', 'kilograms'].includes(u0)) return 'kg';
    if (['ml', 'milliliter', 'milliliters'].includes(u0)) return 'ml';
    if (['l', 'liter', 'liters'].includes(u0)) return 'l';
    if (['tbsp', 'tablespoon'].includes(u0)) return 'colher';
    if (['tsp', 'teaspoon'].includes(u0)) return 'colher chá';
    if (['cup', 'cups'].includes(u0)) return 'xícara';
    if (['slice', 'slices'].includes(u0)) return 'fatia';
    if (['pinch', 'pinches'].includes(u0)) return 'pitada';
    if (['clove', 'cloves'].includes(u0)) return 'dente';
    if (['piece', 'pieces', 'unidade', 'unidades', 'uni', 'un'].includes(u0)) return 'un';
    return u0 || 'un';
  }
  const keyOf = (name, unit) =>
    `${String(name || '').trim().toLowerCase()}::${mapUnit(unit)}`;

  function autoCategory(name = '') {
    const s = String(name || '').toLowerCase();
    const m = [
      { cat: 'proteinas',     kw: ['frango','carne','bife','peru','atum','salmão','ovos','ovo'] },
      { cat: 'frutas',        kw: ['banana','maça','maçã','laranja','abacate','morango','uva','kiwi'] },
      { cat: 'vegetais',      kw: ['alface','tomate','cenoura','brócolis','couve','pepino','cebola','alho'] },
      { cat: 'graos',         kw: ['arroz','feijao','feijão','aveia','massa','macarrão','pão','trigo'] },
      { cat: 'laticinios',    kw: ['leite','queijo','iogurte','manteiga','requeijão'] },
      { cat: 'bebidas',       kw: ['água','agua','refrigerante','sumo','suco','café','cha','chá'] },
      { cat: 'higiene',       kw: ['sabão','sabonete','shampoo','pasta de dente','creme dental','papel higiénico','papel higienico'] },
      { cat: 'limpeza',       kw: ['detergente','amaciante','desinfetante','limpa','alvejante','água sanitária'] },
    ];
    for (const g of m) {
      if (g.kw.some(k => s.includes(k))) return g.cat;
    }
    return 'outros';
  }

  function sum(items, field) {
    return (items || []).reduce((acc, it) => acc + Number(it[field] || 0), 0);
  }

  async function sendOverspendAlert(userId, list, status) {
    try {
      if (!list.alerts?.notify) return { skipped: true };
      const title = status === 'over' ? '💸 Orçamento estourado' : '⚠️ Gastos quase no limite';
      const message = `Lista ${list.name || `${list.month}/${list.year}`}: ${status === 'over' ? 'excedeu' : 'atingiu'} o limite do orçamento.`;
      return await fastify.sendPushToUser(userId, { title, message, data: { type: 'shopping-budget', listId: String(list._id) } });
    } catch (err) {
      fastify.log.warn({ err }, 'Falha ao enviar alerta de orçamento');
      return { skipped: true, reason: 'notify-failed' };
    }
  }

  // ========== Agregação de histórico (somente dados do usuário) ==========
  /**
   * Agrega histórico dos itens COMPRADOS (purchased=true) do usuário,
   * retornando um mapa key(name+unit) -> { records[], categoryMode }.
   *
   * records: { name, unit, qty, price, unitPrice, store, date, category }
   *
   * Filtros:
   *  - store: restringe a uma loja
   *  - days: apenas registros dos últimos X dias
   */
  async function aggregateUserHistory(userId, { store, days } = {}) {
    const q = { user: userId, 'items.purchased': true };
    // Buscamos listas inteiras do usuário; vamos iterar itens
    const lists = await ShoppingList.find(q)
      .select('items updatedAt')
      .lean();

    const map = new Map(); // key -> { records: [], catCount: Map }
    const since = days ? Date.now() - (Number(days) * 24 * 60 * 60 * 1000) : null;

    for (const l of lists) {
      for (const it of (l.items || [])) {
        if (!it.purchased) continue;

        const name = String(it.name || '').trim();
        const unit = mapUnit(it.unit);
        if (!name) continue;

        const date = it.updatedAt || it.createdAt || l.updatedAt || new Date();
        if (since && new Date(date).getTime() < since) continue;

        const recStore = it.store || ''; // opcional
        if (store && recStore && recStore.toLowerCase() !== String(store).toLowerCase()) continue;

        const qty = Number(it.qty || 0);
        const price = Number(it.purchasedPrice || 0);
        if (price <= 0) continue; // só consideramos preços que você inseriu

        const unitPrice = qty > 0 ? price / qty : null;

        const key = keyOf(name, unit);
        if (!map.has(key)) map.set(key, { records: [], catCount: new Map() });
        const entry = map.get(key);

        entry.records.push({
          name, unit, qty, price, unitPrice,
          store: recStore || null,
          date: new Date(date),
          category: it.category || null
        });

        if (it.category) {
          const k = it.category.toLowerCase();
          entry.catCount.set(k, (entry.catCount.get(k) || 0) + 1);
        }
      }
    }

    // Define category "mode" (mais frequente) e ordena por data desc
    for (const v of map.values()) {
      v.records.sort((a, b) => new Date(b.date) - new Date(a.date));
      let bestCat = null, bestCnt = -1;
      for (const [cat, cnt] of v.catCount.entries()) {
        if (cnt > bestCnt) { bestCat = cat; bestCnt = cnt; }
      }
      v.categoryMode = bestCat || null;
    }
    return map;
  }

  function suggestPrice(records, qtyWanted, strategy = 'median') {
    const valid = records.filter(r => r.unitPrice && isFinite(r.unitPrice) && r.unitPrice > 0);
    const fallback = records[0]; // mais recente (já está ordenado)
    if (valid.length === 0) {
      // Sem unitPrice (faltou qty no passado) — cai no preço “cheio” do último registro
      const lastPrice = Number(fallback?.price || 0);
      if (!qtyWanted || qtyWanted <= 0) return lastPrice;
      return lastPrice > 0 ? lastPrice * (qtyWanted / (fallback?.qty || 1 || 1)) : 0; // melhor esforço
    }

    if (strategy === 'last') {
      const up = valid[0].unitPrice;
      return Number((up * (qtyWanted || 1)).toFixed(2));
    }

    if (strategy === 'avg') {
      const avg = valid.reduce((a, r) => a + r.unitPrice, 0) / valid.length;
      return Number((avg * (qtyWanted || 1)).toFixed(2));
    }

    // median (default)
    const arr = valid.map(r => r.unitPrice).sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const med = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    return Number((med * (qtyWanted || 1)).toFixed(2));
  }

  // =============== Swagger Schemas (resumo) ===============
  const ItemSchema = {
    $id: 'shopping.Item',
    type: 'object',
    properties: {
      _id: { type: 'string' }, name: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' },
      category: { type: 'string' }, plannedPrice: { type: 'number' }, purchasedPrice: { type: 'number' },
      purchased: { type: 'boolean' }, store: { type: 'string' }, notes: { type: 'string' },
      priceHistory: {
        type: 'array',
        items: { type: 'object', properties: { date: { type: 'string', format: 'date-time' }, store: { type: 'string' }, price: { type: 'number' } } }
      },
      createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','name']
  };

  const ListSchema = {
    $id: 'shopping.List',
    type: 'object',
    properties: {
      _id: { type: 'string' }, user: { type: 'string' }, name: { type: 'string' }, year: { type: 'number' }, month: { type: 'number' },
      budget: { type: 'number' },
      alerts: { type: 'object', properties: { warnPct: { type: 'number' }, errorPct: { type: 'number' }, notify: { type: 'boolean' } } },
      items: { type: 'array', items: { $ref: 'shopping.Item#' } },
      createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','year','month']
  };

  const PageSchema = {
    $id: 'shopping.Page',
    type: 'object',
    properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, items: { type: 'array', items: { $ref: 'shopping.List#' } } },
    required: ['page','limit','total','items']
  };

  const SummarySchema = {
    $id: 'shopping.Summary',
    type: 'object',
    properties: {
      listId: { type: 'string' },
      planned: { type: 'number' },
      spent: { type: 'number' },
      budget: { type: 'number' },
      remaining: { type: 'number' },
      status: { type: 'string', enum: ['ok','warn','over'] },
      byCategory: {
        type: 'array',
        items: {
          type: 'object',
          properties: { category: { type: 'string' }, planned: { type: 'number' }, spent: { type: 'number' } },
          required: ['category','planned','spent']
        }
      }
    },
    required: ['listId','planned','spent','budget','remaining','status']
  };

  const EstimateReqSchema = {
    $id: 'shopping.EstimateReq',
    type: 'object',
    properties: {
      strategy: { type: 'string', enum: ['last','median','avg'], default: 'median' },
      store: { type: 'string' },
      days: { type: 'integer', minimum: 1 },
      onlyMissing: { type: 'boolean', default: true }
    }
  };

  const MealPlanReqSchema = {
    $id: 'shopping.MealPlanReq',
    type: 'object',
    properties: {
      name: { type: 'string' },
      year: { type: 'integer' },
      month: { type: 'integer', minimum: 1, maximum: 12 },
      budget: { type: 'number' },
      allowUnknown: { type: 'boolean', default: false },
      strategy: { type: 'string', enum: ['last','median','avg'], default: 'median' },
      store: { type: 'string' },
      days: { type: 'integer', minimum: 1 },
      plan: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'object', properties: {
              name: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, notes: { type: 'string' }
            }, required: ['name','qty'] }
          }
        },
        required: ['items']
      }
    },
    required: ['plan']
  };

  [ItemSchema, ListSchema, PageSchema, SummarySchema, EstimateReqSchema, MealPlanReqSchema].forEach(addOnce);

  // =============== Zod (validação efetiva) ===============
  const itemCreateZ = z.object({
    name: z.string().min(1),
    qty: z.number().nonnegative().optional(),
    unit: z.string().optional(),
    category: z.string().optional(),
    plannedPrice: z.number().nonnegative().optional(),
    store: z.string().optional(),
    notes: z.string().optional()
  });

  const itemPatchZ = z.object({
    name: z.string().min(1).optional(),
    qty: z.number().nonnegative().optional(),
    unit: z.string().optional(),
    category: z.string().optional(),
    plannedPrice: z.number().nonnegative().optional(),
    purchasedPrice: z.number().nonnegative().optional(),
    purchased: z.boolean().optional(),
    store: z.string().optional(),
    notes: z.string().optional()
  });

  const listCreateZ = z.object({
    name: z.string().optional(),
    year: z.number().int().min(2000).max(3000).optional(),
    month: z.number().int().min(1).max(12).optional(),
    budget: z.number().nonnegative().optional(),
    alerts: z.object({
      warnPct: z.number().min(0).max(10).optional(),
      errorPct: z.number().min(0).max(10).optional(),
      notify: z.boolean().optional()
    }).optional()
  });

  const listUpdateZ = listCreateZ;

  const estimateReqZ = z.object({
    strategy: z.enum(['last','median','avg']).default('median').optional(),
    store: z.string().optional(),
    days: z.number().int().min(1).optional(),
    onlyMissing: z.boolean().default(true).optional()
  });

  const mealPlanReqZ = z.object({
    name: z.string().optional(),
    year: z.number().int().min(2000).max(3000).optional(),
    month: z.number().int().min(1).max(12).optional(),
    budget: z.number().nonnegative().optional(),
    allowUnknown: z.boolean().default(false).optional(),
    strategy: z.enum(['last','median','avg']).default('median').optional(),
    store: z.string().optional(),
    days: z.number().int().min(1).optional(),
    plan: z.object({
      items: z.array(z.object({
        name: z.string().min(1),
        qty: z.number().nonnegative(),
        unit: z.string().optional(),
        notes: z.string().optional()
      })).min(1)
    })
  });

  // =============== CRUD de Listas ===============
  fastify.post('/shopping-lists', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'shopping.List#' }, // doc; validação real via zod
      response: { 201: { $ref: 'shopping.List#' } }
    }
  }, async (request, reply) => {
    const parsed = listCreateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const now = new Date();
    const year = parsed.data.year || now.getUTCFullYear();
    const month = parsed.data.month || now.getUTCMonth() + 1;
    const name = parsed.data.name || `Lista ${String(month).padStart(2,'0')}/${year}`;

    const created = await ShoppingList.create({
      user: request.user.sub,
      name,
      year,
      month,
      budget: parsed.data.budget || 0,
      alerts: parsed.data.alerts || {},
      items: []
    });

    const raw = await ShoppingList.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  fastify.get('/shopping-lists', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          year: { type: 'integer' }, month: { type: 'integer', minimum: 1, maximum: 12 },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
        }
      },
      response: { 200: { $ref: 'shopping.Page#' } }
    }
  }, async (request) => {
    const { year, month, page = 1, limit = 20 } = request.query || {};
    const filter = { user: request.user.sub };
    if (year) filter.year = Number(year);
    if (month) filter.month = Number(month);
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ShoppingList.find(filter).sort({ year: -1, month: -1, updatedAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      ShoppingList.countDocuments(filter)
    ]);
    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(items) };
  });

  fastify.get('/shopping-lists/:id', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'shopping.List#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const list = await ShoppingList.findOne({ _id: id, user: request.user.sub }).lean();
    if (!list) return reply.notFound('Lista não encontrada');
    return normalize(list);
  });

  fastify.put('/shopping-lists/:id', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      body: { $ref: 'shopping.List#' },
      response: { 200: { $ref: 'shopping.List#' } }
    }
  }, async (request, reply) => {
    const parsed = listUpdateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const { id } = request.params;
    const list = await ShoppingList.findOne({ _id: id, user: request.user.sub });
    if (!list) return reply.notFound('Lista não encontrada');

    const fields = parsed.data;
    if (fields.name !== undefined) list.name = fields.name;
    if (fields.year !== undefined) list.year = fields.year;
    if (fields.month !== undefined) list.month = fields.month;
    if (fields.budget !== undefined) list.budget = fields.budget;
    if (fields.alerts !== undefined) list.alerts = { ...list.alerts, ...fields.alerts };

    await list.save();
    const raw = await ShoppingList.findById(list._id).lean();
    return normalize(raw);
  });

  fastify.delete('/shopping-lists/:id', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const list = await ShoppingList.findOne({ _id: id, user: request.user.sub });
    if (!list) return reply.notFound('Lista não encontrada');
    await list.deleteOne();
    return reply.code(204).send();
  });

  // =============== Itens ===============
  fastify.post('/shopping-lists/:id/items', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' },
          category: { type: 'string' }, plannedPrice: { type: 'number' },
          store: { type: 'string' }, notes: { type: 'string' }
        },
        required: ['name']
      },
      response: { 201: { $ref: 'shopping.List#' } }
    }
  }, async (request, reply) => {
    const parsed = itemCreateZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const list = await ShoppingList.findOne({ _id: request.params.id, user: request.user.sub });
    if (!list) return reply.notFound('Lista não encontrada');

    const payload = { ...parsed.data };
    if (!payload.category) payload.category = autoCategory(payload.name);
    payload.unit = mapUnit(payload.unit);

    list.items.push(payload);
    await list.save();
    const raw = await ShoppingList.findById(list._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  fastify.patch('/shopping-lists/:id/items/:itemId', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' }, itemId: { type: 'string' } },
        required: ['id','itemId']
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, category: { type: 'string' },
          plannedPrice: { type: 'number' }, purchasedPrice: { type: 'number' }, purchased: { type: 'boolean' },
          store: { type: 'string' }, notes: { type: 'string' }
        }
      },
      response: { 200: { $ref: 'shopping.List#' } }
    }
  }, async (request, reply) => {
    const parsed = itemPatchZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const { id, itemId } = request.params;
    const list = await ShoppingList.findOne({ _id: id, user: request.user.sub });
    if (!list) return reply.notFound('Lista não encontrada');

    const item = list.items.id(itemId);
    if (!item) return reply.notFound('Item não encontrado');

    Object.assign(item, parsed.data);
    if (parsed.data.name && !parsed.data.category) item.category = autoCategory(parsed.data.name);
    if (parsed.data.unit) item.unit = mapUnit(parsed.data.unit);

    await list.save();
    const raw = await ShoppingList.findById(list._id).lean();
    return normalize(raw);
  });

  fastify.delete('/shopping-lists/:id/items/:itemId', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' }, itemId: { type: 'string' } },
        required: ['id','itemId']
      }
    }
  }, async (request, reply) => {
    const { id, itemId } = request.params;
    const list = await ShoppingList.findOne({ _id: id, user: request.user.sub });
    if (!list) return reply.notFound('Lista não encontrada');
    const item = list.items.id(itemId);
    if (!item) return reply.notFound('Item não encontrado');
    item.remove();
    await list.save();
    return reply.code(204).send();
  });

  // Histórico de preços por item (busca global por nome)
  fastify.get('/shopping-lists/prices/search', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      querystring: { type: 'object', properties: { name: { type: 'string' }, store: { type: 'string' } }, required: ['name'] }
    }
  }, async (request) => {
    const { name, store } = request.query || {};
    const lists = await ShoppingList.find({ user: request.user.sub, 'items.name': new RegExp(name, 'i') })
      .select('items')
      .lean();

    const results = [];
    for (const l of lists) {
      for (const it of (l.items || [])) {
        if (!new RegExp(name, 'i').test(it.name)) continue;
        for (const ph of (it.priceHistory || [])) {
          if (store && (!ph.store || ph.store.toLowerCase() !== store.toLowerCase())) continue;
          results.push({
            itemName: it.name,
            store: ph.store || '',
            date: ph.date instanceof Date ? ph.date.toISOString() : ph.date,
            price: ph.price
          });
        }
      }
    }
    results.sort((a,b) => new Date(b.date) - new Date(a.date));
    return { name, store: store || null, count: results.length, history: results };
  });

  // =============== Sumário / orçamento ===============
  fastify.get('/shopping-lists/:id/summary', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: { 200: { $ref: 'shopping.Summary#' } }
    }
  }, async (request) => {
    const list = await ShoppingList.findOne({ _id: request.params.id, user: request.user.sub }).lean();
    if (!list) return request.reply.notFound('Lista não encontrada');
    const planned = sum(list.items, 'plannedPrice');
    const spent = sum(list.items.filter(i => i.purchased), 'purchasedPrice');
    const budget = Number(list.budget || 0);
    const remaining = Math.max(0, budget - spent);

    let status = 'ok';
    const warn = (list.alerts?.warnPct ?? 0.8) * budget;
    const errL = (list.alerts?.errorPct ?? 1.0) * budget;
    if (budget > 0 && spent >= errL) status = 'over';
    else if (budget > 0 && spent >= warn) status = 'warn';

    const byCatMap = new Map();
    for (const it of list.items || []) {
      const cat = it.category || 'outros';
      if (!byCatMap.has(cat)) byCatMap.set(cat, { planned: 0, spent: 0 });
      const x = byCatMap.get(cat);
      x.planned += Number(it.plannedPrice || 0);
      if (it.purchased) x.spent += Number(it.purchasedPrice || 0);
    }
    const byCategory = Array.from(byCatMap.entries()).map(([category, v]) => ({ category, planned: v.planned, spent: v.spent }));

    if (status === 'warn' || status === 'over') {
      sendOverspendAlert(list.user, list, status).catch(() => {});
    }

    return { listId: String(list._id), planned, spent, budget, remaining, status, byCategory };
  });

  // =============== NOVO: Estimar plannedPrice com base no histórico do usuário ===============
  fastify.post('/shopping-lists/:id/estimate-prices', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: { $ref: 'shopping.EstimateReq#' },
      response: { 200: { $ref: 'shopping.List#' } }
    }
  }, async (request, reply) => {
    const opts = estimateReqZ.safeParse(request.body || {});
    if (!opts.success) return reply.badRequest(opts.error.errors.map(e => e.message).join(', '));
    const { strategy = 'median', store, days, onlyMissing = true } = opts.data;

    const list = await ShoppingList.findOne({ _id: request.params.id, user: request.user.sub });
    if (!list) return reply.notFound('Lista não encontrada');

    const hist = await aggregateUserHistory(request.user.sub, { store, days });

    for (const it of list.items || []) {
      // Se onlyMissing, só estima onde plannedPrice está vazio/0/undefined
      if (onlyMissing && Number(it.plannedPrice || 0) > 0) continue;

      const key = keyOf(it.name, it.unit);
      const h = hist.get(key);
      if (!h || !h.records.length) continue; // sem histórico seu, pula

      const qtyWanted = Number(it.qty || 1);
      const price = suggestPrice(h.records, qtyWanted, strategy);
      it.plannedPrice = price;

      // Preenche categoria se faltando (pela categoria mais frequente do histórico)
      if (!it.category && h.categoryMode) {
        it.category = h.categoryMode;
      }
    }

    await list.save();
    const raw = await ShoppingList.findById(list._id).lean();
    return normalize(raw);
  });

  // =============== NOVO: Gerar lista a partir de Meal Plan (somente itens já comprados) ===============
  fastify.post('/shopping-lists/from-mealplan', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'shopping.MealPlanReq#' },
      response: { 201: { $ref: 'shopping.List#' } }
    }
  }, async (request, reply) => {
    const parsed = mealPlanReqZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    const { name, year, month, budget, allowUnknown = false, strategy = 'median', store, days, plan } = parsed.data;

    const now = new Date();
    const y = year || now.getUTCFullYear();
    const m = month || now.getUTCMonth() + 1;
    const listName = name || `Meal Plan ${String(m).padStart(2,'0')}/${y}`;

    // Históricos de compras do usuário
    const hist = await aggregateUserHistory(request.user.sub, { store, days });

    // Monta itens a partir do plano
    const itemsToInsert = [];
    const unknown = [];

    for (const inItem of plan.items || []) {
      const nm = String(inItem.name || '').trim();
      const unit = mapUnit(inItem.unit);
      const qty = Number(inItem.qty || 0);

      const key = keyOf(nm, unit);
      const h = hist.get(key);

      if (!h || !h.records.length) {
        if (!allowUnknown) {
          unknown.push({ name: nm, unit, qty });
          continue;
        } else {
          itemsToInsert.push({
            name: nm,
            qty,
            unit,
            category: autoCategory(nm),
            plannedPrice: 0,
            purchasedPrice: 0,
            purchased: false,
            store: '',
            notes: inItem.notes || ''
          });
          continue;
        }
      }

      const price = suggestPrice(h.records, qty, strategy);
      itemsToInsert.push({
        name: nm,
        qty,
        unit,
        category: h.categoryMode || autoCategory(nm),
        plannedPrice: price,
        purchasedPrice: 0,
        purchased: false,
        store: store || '',
        notes: inItem.notes || ''
      });
    }

    if (unknown.length) {
      return reply.badRequest({
        message: 'Alguns itens do meal plan não existem no seu histórico de compras.',
        unknown
      });
    }

    const created = await ShoppingList.create({
      user: request.user.sub,
      name: listName,
      year: y,
      month: m,
      budget: budget || 0,
      alerts: {},
      items: itemsToInsert
    });

    const raw = await ShoppingList.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });
};
