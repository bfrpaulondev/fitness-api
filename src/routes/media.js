// src/routes/media.js
const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const Media = require('../models/media');
const Album = require('../models/album');
const Comparison = require('../models/comparison');

module.exports = async function mediaRoutes(fastify) {
  fastify.addHook('preValidation', fastify.authenticate);

  // helpers
  const addOnce = (schema) => { if (!fastify.getSchemas()[schema.$id]) fastify.addSchema(schema); };
  const normalize = (doc) => JSON.parse(JSON.stringify(doc));
  const normalizeMany = (arr) => JSON.parse(JSON.stringify(arr));

  // ------------- Swagger Schemas (resumido) -------------
  const MediaSchema = {
    $id: 'media.Media',
    type: 'object',
    properties: {
      _id: { type: 'string' }, user: { type: 'string' }, provider: { type: 'string' },
      type: { type: 'string', enum: ['image','video'] },
      publicId: { type: 'string' }, url: { type: 'string' }, format: { type: 'string' },
      bytes: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
      duration: { type: 'number' }, originalFilename: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      album: { type: 'string', nullable: true },
      measurementId: { type: 'string', nullable: true },
      workoutLogId: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','type','publicId','url']
  };

  const MediaPageSchema = {
    $id: 'media.Page',
    type: 'object',
    properties: {
      page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'media.Media#' } }
    },
    required: ['page','limit','total','items']
  };

  const AlbumSchema = {
    $id: 'media.Album',
    type: 'object',
    properties: {
      _id: { type: 'string' }, user: { type: 'string' }, name: { type: 'string' },
      description: { type: 'string' }, coverMedia: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','name']
  };

  const AlbumPageSchema = {
    $id: 'media.AlbumPage',
    type: 'object',
    properties: {
      page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'media.Album#' } }
    },
    required: ['page','limit','total','items']
  };

  const UploadBodySchema = {
    $id: 'media.UploadBody',
    type: 'object',
    properties: {
      file: { type: 'string', format: 'binary' },
      albumId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
      tags: {
        oneOf: [
          { type: 'string', description: 'CSV ex.: peito,progresso' },
          { type: 'array', items: { type: 'string' } }
        ]
      },
      measurementId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
      workoutLogId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
    },
    required: ['file']
  };

  const UpdateTagsBodySchema = {
    $id: 'media.UpdateTagsBody',
    type: 'object',
    properties: { tags: { type: 'array', items: { type: 'string' } } },
    required: ['tags']
  };

  const MoveAlbumBodySchema = {
    $id: 'media.MoveAlbumBody',
    type: 'object',
    properties: { albumId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$', nullable: true } }
  };

  const ComparisonSchema = {
    $id: 'media.Comparison',
    type: 'object',
    properties: {
      _id: { type: 'string' }, user: { type: 'string' },
      beforeMedia: { type: 'string' }, afterMedia: { type: 'string' },
      notes: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }
    },
    required: ['_id','user','beforeMedia','afterMedia']
  };

  const ComparisonPageSchema = {
    $id: 'media.ComparisonPage',
    type: 'object',
    properties: {
      page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' },
      items: { type: 'array', items: { $ref: 'media.Comparison#' } }
    },
    required: ['page','limit','total','items']
  };

  [
    MediaSchema, MediaPageSchema, AlbumSchema, AlbumPageSchema,
    UploadBodySchema, UpdateTagsBodySchema, MoveAlbumBodySchema,
    ComparisonSchema, ComparisonPageSchema
  ].forEach(addOnce);

  // ------------- Utilidades -------------
  const updateTagsZ = z.object({ tags: z.array(z.string()).min(0) });
  const moveAlbumZ = z.object({ albumId: z.string().refine(isValidObjectId).nullable().optional() });

  const parseTags = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String).map(t => t.trim()).filter(Boolean);
    if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };

  // ------------- UPLOAD -------------
  fastify.post('/media/upload', {
    attachValidation: true, // permite multipart mesmo sem body JSON válido
    schema: {
      tags: ['media'],
      consumes: ['multipart/form-data'],
      security: [{ bearerAuth: [] }],
      body: { $ref: 'media.UploadBody#' },
      response: { 201: { $ref: 'media.Media#' } }
    }
  }, async (request, reply) => {
    if (request.validationError) {
      request.log.debug({ err: request.validationError }, 'Multipart: ignorando validationError');
    }

    // lê o stream multipart
    const parts = request.parts();
    let filePart = null;
    const fields = {};
    for await (const part of parts) {
      if (part.type === 'file' && !filePart) filePart = part;
      else if (part.type === 'field') fields[part.fieldname] = part.value;
    }
    if (!filePart) return reply.badRequest('Campo "file" é obrigatório');

    // album opcional
    let albumId = fields.albumId || null;
    if (albumId && !isValidObjectId(albumId)) return reply.badRequest('albumId inválido');
    if (albumId) {
      const album = await Album.findOne({ _id: albumId, user: request.user.sub }).lean();
      if (!album) return reply.badRequest('Álbum inexistente ou inacessível');
    }

    // vínculos opcionais
    let measurementId = fields.measurementId || null;
    if (measurementId && !isValidObjectId(measurementId)) return reply.badRequest('measurementId inválido');
    let workoutLogId = fields.workoutLogId || null;
    if (workoutLogId && !isValidObjectId(workoutLogId)) return reply.badRequest('workoutLogId inválido');

    const tags = parseTags(fields.tags);

    // upload para Cloudinary
    let uploadRes;
    try {
      uploadRes = await fastify.cloudinaryUpload(filePart.file, {
        tags,
        use_filename: true,
        unique_filename: true,
        overwrite: false
      });
    } catch (err) {
      request.log.error({ err }, 'Falha no upload Cloudinary');
      return reply.internalServerError('Falha no upload');
    }

    const isVideo = uploadRes.resource_type === 'video';
    const mediaDoc = await Media.create({
      user: request.user.sub,
      provider: 'cloudinary',
      type: isVideo ? 'video' : 'image',
      publicId: uploadRes.public_id,
      url: uploadRes.secure_url,
      format: uploadRes.format || '',
      bytes: uploadRes.bytes || 0,
      width: uploadRes.width || 0,
      height: uploadRes.height || 0,
      duration: uploadRes.duration || 0,
      originalFilename: uploadRes.original_filename || filePart.filename || '',
      tags,
      album: albumId,
      measurementId,
      workoutLogId
    });

    const raw = await Media.findById(mediaDoc._id).lean();
    return reply.code(201).send(normalize(raw));
  });


  // -------------------- Rotas: Media CRUD --------------------
  fastify.get('/media', {
    schema: {
      tags: ['media'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          type: { type: 'string', enum: ['image','video'] },
          tags: { type: 'string', description: 'CSV' },
          albumId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
        }
      },
      response: { 200: { $ref: 'media.Page#' } }
    }
  }, async (request) => {
    const { search = '', type, tags = '', albumId, page = 1, limit = 20 } = request.query || {};
    const filter = { user: request.user.sub };
    if (type) filter.type = type;
    if (albumId && isValidObjectId(albumId)) filter.album = albumId;

    const tagList = parseTags(tags);
    if (tagList.length) filter.tags = { $all: tagList };

    if (search) {
      filter.$or = [
        { originalFilename: { $regex: search, $options: 'i' } },
        { tags: { $elemMatch: { $regex: search, $options: 'i' } } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [itemsRaw, total] = await Promise.all([
      Media.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Media.countDocuments(filter)
    ]);

    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(itemsRaw) };
  });

  fastify.get('/media/:id', {
    schema: {
      tags: ['media'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'media.Media#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const m = await Media.findOne({ _id: id, user: request.user.sub }).lean();
    if (!m) return reply.notFound('Mídia não encontrada');
    return normalize(m);
  });

  fastify.delete('/media/:id', {
    schema: {
      tags: ['media'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 204: { type: 'null' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const m = await Media.findOne({ _id: id, user: request.user.sub });
    if (!m) return reply.notFound('Mídia não encontrada');

    // apaga no Cloudinary
    try {
      const resource_type = m.type === 'video' ? 'video' : 'image';
      await fastify.cloudinary.uploader.destroy(m.publicId, { resource_type });
    } catch (err) {
      request.log.warn({ err }, 'Falha ao remover no Cloudinary (segue removendo no DB)');
    }

    await m.deleteOne();
    return reply.code(204).send();
  });

  // Atualizar tags (substitui)
  fastify.patch('/media/:id/tags', {
    schema: {
      tags: ['media'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      body: { $ref: 'media.UpdateTagsBody#' },
      response: { 200: { $ref: 'media.Media#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const parsed = updateTagsZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    const m = await Media.findOne({ _id: id, user: request.user.sub });
    if (!m) return reply.notFound('Mídia não encontrada');
    m.tags = parsed.data.tags;
    await m.save();
    const raw = await Media.findById(m._id).lean();
    return normalize(raw);
  });

  // Mover para álbum (ou remover do álbum)
  fastify.patch('/media/:id/move-to-album', {
    schema: {
      tags: ['media'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      body: { $ref: 'media.MoveAlbumBody#' },
      response: { 200: { $ref: 'media.Media#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const parsed = moveAlbumZ.safeParse(request.body || {});
    if (!parsed.success) return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));

    const m = await Media.findOne({ _id: id, user: request.user.sub });
    if (!m) return reply.notFound('Mídia não encontrada');

    if (parsed.data.albumId) {
      const album = await Album.findOne({ _id: parsed.data.albumId, user: request.user.sub }).lean();
      if (!album) return reply.badRequest('Álbum inexistente ou inacessível');
      m.album = parsed.data.albumId;
    } else {
      m.album = null;
    }

    await m.save();
    const raw = await Media.findById(m._id).lean();
    return normalize(raw);
  });

  // -------------------- Rotas: Álbuns --------------------
  fastify.post('/albums', {
    schema: {
      tags: ['albums'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['name']
      },
      response: { 201: { $ref: 'media.Album#' } }
    }
  }, async (request, reply) => {
    const { name, description = '' } = request.body || {};
    if (!name || name.trim().length < 1) return reply.badRequest('name é obrigatório');
    const created = await Album.create({ user: request.user.sub, name: name.trim(), description });
    const raw = await Album.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  fastify.get('/albums', {
    schema: {
      tags: ['albums'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 100 }
        }
      },
      response: { 200: { $ref: 'media.AlbumPage#' } }
    }
  }, async (request) => {
    const { search = '', page = 1, limit = 50 } = request.query || {};
    const filter = { user: request.user.sub };
    if (search) filter.name = { $regex: search, $options: 'i' };

    const skip = (Number(page) - 1) * Number(limit);
    const [itemsRaw, total] = await Promise.all([
      Album.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Album.countDocuments(filter)
    ]);

    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(itemsRaw) };
  });

  fastify.get('/albums/:id', {
    schema: {
      tags: ['albums'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'media.Album#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const album = await Album.findOne({ _id: id, user: request.user.sub }).lean();
    if (!album) return reply.notFound('Álbum não encontrado');
    return normalize(album);
  });

  fastify.put('/albums/:id', {
    schema: {
      tags: ['albums'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          coverMedia: { type: 'string', pattern: '^[a-fA-F0-9]{24}$', nullable: true }
        }
      },
      response: { 200: { $ref: 'media.Album#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, description, coverMedia } = request.body || {};
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const album = await Album.findOne({ _id: id, user: request.user.sub });
    if (!album) return reply.notFound('Álbum não encontrado');

    if (name !== undefined) album.name = String(name);
    if (description !== undefined) album.description = String(description);
    if (coverMedia !== undefined) {
      if (coverMedia === null) album.coverMedia = null;
      else if (!isValidObjectId(coverMedia)) return reply.badRequest('coverMedia inválido');
      else {
        const ok = await Media.findOne({ _id: coverMedia, user: request.user.sub }).lean();
        if (!ok) return reply.badRequest('coverMedia não acessível');
        album.coverMedia = coverMedia;
      }
    }

    await album.save();
    const raw = await Album.findById(album._id).lean();
    return normalize(raw);
  });

  fastify.delete('/albums/:id', {
    schema: {
      tags: ['albums'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');

    const album = await Album.findOne({ _id: id, user: request.user.sub });
    if (!album) return reply.notFound('Álbum não encontrado');

    // remover referência de mídias que apontam para este álbum
    await Media.updateMany({ user: request.user.sub, album: id }, { $set: { album: null } });
    await album.deleteOne();

    return reply.code(204).send();
  });

  // -------------------- Rotas: Comparações antes/depois --------------------
  fastify.post('/media/compare', {
    schema: {
      tags: ['media'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          beforeMediaId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
          afterMediaId:  { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
          notes: { type: 'string' }
        },
        required: ['beforeMediaId', 'afterMediaId']
      },
      response: { 201: { $ref: 'media.Comparison#' } }
    }
  }, async (request, reply) => {
    const { beforeMediaId, afterMediaId, notes = '' } = request.body || {};
    if (!isValidObjectId(beforeMediaId) || !isValidObjectId(afterMediaId)) {
      return reply.badRequest('IDs inválidos');
    }
    const [b, a] = await Promise.all([
      Media.findOne({ _id: beforeMediaId, user: request.user.sub }).lean(),
      Media.findOne({ _id: afterMediaId, user: request.user.sub }).lean()
    ]);
    if (!b || !a) return reply.badRequest('Mídias não encontradas ou inacessíveis');

    const created = await Comparison.create({
      user: request.user.sub,
      beforeMedia: beforeMediaId,
      afterMedia: afterMediaId,
      notes
    });
    const raw = await Comparison.findById(created._id).lean();
    return reply.code(201).send(normalize(raw));
  });

  fastify.get('/media/compare', {
    schema: {
      tags: ['media'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
        }
      },
      response: { 200: { $ref: 'media.ComparisonPage#' } }
    }
  }, async (request) => {
    const { page = 1, limit = 20 } = request.query || {};
    const skip = (Number(page) - 1) * Number(limit);
    const [itemsRaw, total] = await Promise.all([
      Comparison.find({ user: request.user.sub }).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Comparison.countDocuments({ user: request.user.sub })
    ]);
    return { page: Number(page), limit: Number(limit), total, items: normalizeMany(itemsRaw) };
  });

  fastify.get('/media/compare/:id', {
    schema: {
      tags: ['media'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] },
      response: { 200: { $ref: 'media.Comparison#' } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const c = await Comparison.findOne({ _id: id, user: request.user.sub }).lean();
    if (!c) return reply.notFound('Comparação não encontrada');
    return normalize(c);
  });

  fastify.delete('/media/compare/:id', {
    schema: {
      tags: ['media'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidObjectId(id)) return reply.badRequest('ID inválido');
    const c = await Comparison.findOne({ _id: id, user: request.user.sub });
    if (!c) return reply.notFound('Comparação não encontrada');
    await c.deleteOne();
    return reply.code(204).send();
  });
};
