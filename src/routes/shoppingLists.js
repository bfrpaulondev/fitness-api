// src/routes/shoppingLists.js
const { z } = require('zod');
const ShoppingList = require('../models/shoppingList');

module.exports = async function shoppingListsRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  /* ===================================================================
   * 🔧 UTILIDADES GERAIS (inclui conversões kg↔g e l↔ml)
   * =================================================================== */

  // Mapeamento de unidades → forma canónica e informações de conversão
  // Grupos:
  //   weight  → base: g  (g, kg)
  //   volume  → base: ml (ml, l)
  //   other   → base: unidade própria (sem conversão genérica)
  const UNIT_MAP = {
    // peso
    g:  { base: 'g',  factor: 1,     group: 'weight' },
    gram: 'g', grams: 'g',
    kg: { base: 'g',  factor: 1000,  group: 'weight' },

    // volume
    ml: { base: 'ml', factor: 1,     group: 'volume' },
    milliliter: 'ml', milliliters: 'ml',
    l:  { base: 'ml', factor: 1000,  group: 'volume' },
    liter: 'l', liters: 'l',

    // outras unidades ficam no grupo "other" sem conversão automática
    // (xícara, colher, un, fatia, pitada, etc.)
  };

  function mapUnit(u) {
    const key = String(u || '').trim().toLowerCase();
    const r = UNIT_MAP[key];
    if (!r) return key || 'un';
    return typeof r === 'string' ? r : key; // devolve a chave canónica
  }

  function unitInfo(u) {
    const canonKey = mapUnit(u);
    const entry = UNIT_MAP[canonKey];
    if (entry && typeof entry === 'object') {
      return { base: entry.base, factor: entry.factor, group: entry.group, canon: canonKey };
    }
    return { base: canonKey, factor: 1, group: 'other', canon: canonKey };
  }

  // Mesmo item = mesmo nome + mesmo GRUPO de unidade (weight, volume, other)
  const keyOf = (name, unit) => {
    const ui = unitInfo(unit);
    return `${String(name || '').trim().toLowerCase()}::${ui.group}`;
  };

  // Converte uma quantidade para a unidade base do grupo (g ou ml). "other" = sem conversão (factor 1)
  function toBaseQty(qty, unit) {
    const ui = unitInfo(unit);
    const n = Number(qty || 0);
    return n * ui.factor;
  }

  // Preço por unidade base (€/g, €/ml ou €/un para "other")
  function pricePerBase(price, qty, unit) {
    const baseQty = toBaseQty(qty, unit);
    return baseQty > 0 ? price / baseQty : null;
  }

  /* ---------------- restante de helpers (categoria, soma, alerta) ------------- */

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
    for (const g of m) { if (g.kw.some(k => s.includes(k))) return g.cat; }
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

  /* ===================================================================
   * 📈 AGREGAÇÃO DO HISTÓRICO (purchased=true) COM CONVERSÕES
   * =================================================================== */

  /**
   * Retorna um Map:
   *   key(name+group) -> {
   *     records: [{ name, unit, qty, baseQty, price, unitPriceBase, store, date, category }],
   *     categoryMode: 'categoria mais frequente'
   *   }
   * Filtros opcionais: { store, days }
   */
  async function aggregateUserHistory(userId, { store, days } = {}) {
    const lists = await ShoppingList.find({ user: userId, 'items.purchased': true })
      .select('items updatedAt')
      .lean();

    const map = new Map();
    const since = days ? Date.now() - (Number(days) * 86_400_000) : null;

    for (const l of lists) {
      for (const it of (l.items || [])) {
        if (!it.purchased) continue;

        const name = String(it.name || '').trim();
        const qty = Number(it.qty || 0);
        const price = Number(it.purchasedPrice || 0);
        const recStore = it.store || '';
        const date = it.updatedAt || it.createdAt || l.updatedAt || new Date();

        if (!name || price <= 0 || qty <= 0) continue;
        if (store && recStore && recStore.toLowerCase() !== String(store).toLowerCase()) continue;
        if (since && new Date(date).getTime() < since) continue;

        const key = keyOf(name, it.unit);
        if (!map.has(key)) map.set(key, { records: [], catCount: new Map() });
        const entry = map.get(key);

        const baseQty = toBaseQty(qty, it.unit);
        if (baseQty <= 0) continue;

        entry.records.push({
          name,
          unit: unitInfo(it.unit).canon,
          qty,
          baseQty,
          price,
          unitPriceBase: price / baseQty, // €/g, €/ml ou €/un (grupo other)
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

    for (const v of map.values()) {
      v.records.sort((a, b) => new Date(b.date) - new Date(a.date));
      // categoria mais frequente
      let bestCat = null, bestCnt = -1;
      for (const [cat, cnt] of v.catCount.entries()) {
        if (cnt > bestCnt) { bestCat = cat; bestCnt = cnt; }
      }
      v.categoryMode = bestCat || null;
    }
    return map;
  }

  /**
   * Gera preço estimado para uma quantidade desejada e unidade desejada,
   * usando os registros (com unitPriceBase) e estratégia: 'median' | 'last' | 'avg'
   */
  function suggestPrice(records, qtyWanted, unitWanted, strategy = 'median') {
    if (!records || !records.length) return 0;

    const qtyBase = toBaseQty(qtyWanted || 1, unitWanted);
    const valid = records.filter(r => isFinite(r.unitPriceBase) && r.unitPriceBase > 0);

    if (valid.length === 0) {
      // Fallback: sem unitPriceBase válido (deveria ser raro)
      const last = records[0];
      if (!last || !isFinite(last.baseQty) || last.baseQty <= 0) return 0;
      const pricePerBaseFallback = last.price / last.baseQty;
      return Number((pricePerBaseFallback * qtyBase).toFixed(2));
    }

    const pickUnitPrice = () => {
      if (strategy === 'last') return valid[0].unitPriceBase;
      if (strategy === 'avg')  return valid.reduce((a, r) => a + r.unitPriceBase, 0) / valid.length;
      // median (default)
      const arr = valid.map(r => r.unitPriceBase).sort((a, b) => a - b);
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    };

    const up = pickUnitPrice();
    return Number((up * qtyBase).toFixed(2));
  }

  /* ===================================================================
   * 📦 SCHEMAS (Swagger) + ZOD (validação)
   * =================================================================== */

  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // Swagger
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

  // Zod (validação real)
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

  /* ===================================================================
   * 🧰 CRUD de LISTAS
   * =================================================================== */

  fastify.post('/shopping-lists', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'shopping.List#' }, // doc; validação via zod
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

  /* ===================================================================
   * 🧾 ITENS
   * =================================================================== */

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
    payload.unit = mapUnit(payload.unit);
    if (!payload.category) payload.category = autoCategory(payload.name);

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

  /* ===================================================================
   * 🔎 BUSCA GLOBAL DE HISTÓRICO DE PREÇOS POR NOME (entre listas)
   * =================================================================== */

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

  /* ===================================================================
   * 📊 SUMÁRIO / ORÇAMENTO
   * =================================================================== */

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

  /* ===================================================================
   * 💡 ESTIMAR plannedPrice A PARTIR DO SEU HISTÓRICO (com conversão)
   * =================================================================== */

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
      if (onlyMissing && Number(it.plannedPrice || 0) > 0) continue;

      const key = keyOf(it.name, it.unit);
      const h = hist.get(key);
      if (!h || !h.records.length) continue;

      const qtyWanted = Number(it.qty || 1);
      const price = suggestPrice(h.records, qtyWanted, it.unit, strategy);
      it.plannedPrice = price;

      if (!it.category && h.categoryMode) {
        it.category = h.categoryMode;
      }
    }

    await list.save();
    const raw = await ShoppingList.findById(list._id).lean();
    return normalize(raw);
  });

  /* ===================================================================
   * 🧑‍🍳 FROM MEAL PLAN (gera nova lista) — só itens do seu histórico
   * =================================================================== */

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

    const hist = await aggregateUserHistory(request.user.sub, { store, days });

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

      const price = suggestPrice(h.records, qty, unit, strategy);
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
