// src/routes/shoppingLists.js
const { z } = require('zod');
const ShoppingList = require('../models/shoppingList');

module.exports = async function shoppingListsRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // --- Helpers ---
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

  // --- Swagger Schemas (resumo) ---
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
      alerts: {
        type: 'object',
        properties: { warnPct: { type: 'number' }, errorPct: { type: 'number' }, notify: { type: 'boolean' } }
      },
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

  [ItemSchema, ListSchema, PageSchema, SummarySchema].forEach(addOnce);

  // --- Zod ---
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

  // --- CRUD de listas ---
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

  // --- Itens ---
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

  // --- Histórico de preços por item ---
  fastify.post('/shopping-lists/:id/items/:itemId/price', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' }, itemId: { type: 'string' } },
        required: ['id','itemId']
      },
      body: { type: 'object', properties: { date: { type: 'string', format: 'date-time' }, store: { type: 'string' }, price: { type: 'number' } }, required: ['price'] },
      response: { 200: { $ref: 'shopping.List#' } }
    }
  }, async (request, reply) => {
    const { id, itemId } = request.params;
    const { date, store, price } = request.body || {};
    const list = await ShoppingList.findOne({ _id: id, user: request.user.sub });
    if (!list) return reply.notFound('Lista não encontrada');

    const item = list.items.id(itemId);
    if (!item) return reply.notFound('Item não encontrado');

    item.priceHistory.push({ date: date ? new Date(date) : new Date(), store: store || '', price: Number(price) });
    await list.save();
    const raw = await ShoppingList.findById(list._id).lean();
    return normalize(raw);
  });

  // --- Sumário / orçamento ---
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

  // --- Gerar itens da lista a partir de receitas Spoonacular ---
  fastify.post('/shopping-lists/:id/from-recipes', {
    schema: {
      tags: ['shopping-lists'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          recipeIds: { type: 'array', items: { type: 'integer' } },
          servingsPerRecipe: { type: 'integer', minimum: 1, default: 1 },
          overwriteExisting: { type: 'boolean', default: false } // se true, substitui qty de itens com mesmo nome
        },
        required: ['recipeIds']
      }
    }
  }, async (request, reply) => {
    if (!fastify.spoonacularEnabled) {
      return reply.code(501).send({ message: 'Spoonacular não configurado no servidor (.env).' });
    }
    const { id } = request.params;
    const { recipeIds, servingsPerRecipe = 1, overwriteExisting = false } = request.body || {};
    if (!Array.isArray(recipeIds) || recipeIds.length === 0) return reply.badRequest('recipeIds deve conter ao menos um id.');

    const list = await ShoppingList.findOne({ _id: id, user: request.user.sub });
    if (!list) return reply.notFound('Lista não encontrada');

    // 1) Busca info de cada receita (com extendedIngredients)
    const infos = [];
    for (const rid of recipeIds) {
      try {
        const info = await fastify.spoonacular.getRecipeInfo(rid);
        infos.push(info);
      } catch (err) {
        request.log.warn({ err }, `Falha ao obter receita ${rid}`);
      }
    }
    if (!infos.length) return reply.badRequest('Nenhuma receita válida foi retornada pelo Spoonacular.');

    // 2) Consolida ingredientes em um mapa (nome + unidade)
    //    Preferimos medidas métricas quando disponíveis
    const keyOf = (name, unit) => `${name.toLowerCase()}::${(unit || '').toLowerCase()}`;

    const acc = new Map(); // key -> { name, qty, unit }
    for (const info of infos) {
      const factor = Number(servingsPerRecipe) / Number(info.servings || 1);
      for (const ing of info.extendedIngredients || []) {
        const name = (ing.name || '').trim() || (ing.original || '').trim();
        if (!name) continue;

        let amount = Number(ing.amount || 0);
        let unit = String(ing.unit || '').trim();

        // Tenta usar medidas métricas se existirem
        if (ing.measures && ing.measures.metric && ing.measures.metric.amount) {
          amount = Number(ing.measures.metric.amount || amount);
          unit = String(ing.measures.metric.unitShort || ing.measures.metric.unitLong || unit || '').trim();
        }

        // Ajusta pela quantidade de porções desejada
        if (factor && factor !== 1 && amount > 0) {
          amount = amount * factor;
        }

        // Normalização simples de unidades comuns
        const mapUnit = (u) => {
          const u0 = (u || '').toLowerCase();
          if (['g','gram','grams'].includes(u0)) return 'g';
          if (['kg','kilogram','kilograms'].includes(u0)) return 'kg';
          if (['ml','milliliter','milliliters'].includes(u0)) return 'ml';
          if (['l','liter','liters'].includes(u0)) return 'l';
          if (['tbsp','tablespoon'].includes(u0)) return 'colher';
          if (['tsp','teaspoon'].includes(u0)) return 'colher chá';
          if (['cup','cups'].includes(u0)) return 'xícara';
          if (['slice','slices'].includes(u0)) return 'fatia';
          if (['pinch','pinches'].includes(u0)) return 'pitada';
          if (['clove','cloves'].includes(u0)) return 'dente';
          if (['piece','pieces'].includes(u0)) return 'un';
          return u0 || 'un';
        };
        unit = mapUnit(unit);

        const key = keyOf(name, unit);
        const prev = acc.get(key);
        const qty = Number(amount || 0);

        if (!prev) acc.set(key, { name, qty, unit, category: autoCategory(name) });
        else acc.set(key, { ...prev, qty: Number(prev.qty || 0) + qty });
      }
    }

    // 3) Aplica na lista (merge com existentes ou overwrite)
    const byNameUnit = (a, b) =>
      a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
      (a.unit || '').trim().toLowerCase() === (b.unit || '').trim().toLowerCase();

    const toAdd = Array.from(acc.values());
    for (const it of toAdd) {
      const exists = list.items.find(x => byNameUnit(x, it));
      if (exists) {
        if (overwriteExisting) {
          exists.qty = it.qty;
          if (!exists.category) exists.category = it.category;
        } else {
          exists.qty = Number(exists.qty || 0) + Number(it.qty || 0);
          if (!exists.category) exists.category = it.category;
        }
      } else {
        list.items.push({
          name: it.name,
          qty: it.qty,
          unit: it.unit || 'un',
          category: it.category || 'outros',
          plannedPrice: 0,
          purchasedPrice: 0,
          purchased: false,
          store: '',
          notes: ''
        });
      }
    }

    await list.save();
    const raw = await ShoppingList.findById(list._id).lean();
    return reply.code(200).send(normalize(raw));
  });

  // --- Busca global do histórico de preços por nome (entre listas) ---
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
};
