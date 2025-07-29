// src/routes/users.js
const { z } = require('zod');
const bcrypt = require('bcrypt');
const User = require('../models/user');

module.exports = async function usersRoutes(fastify) {
  // Helper: adiciona schema apenas se ainda não existir
  function addSchemaOnce(id, schemaWithoutId) {
    const all = fastify.getSchemas(); // objeto com todos os schemas já registados
    if (!all[id]) {
      fastify.addSchema({ $id: id, ...schemaWithoutId });
    }
  }

  // ---------------------------------------------------------------------------
  // 📘 JSON Schemas (Swagger Models) — agora com namespace "auth.*"

  addSchemaOnce('auth.UserPublic', {
    type: 'object',
    properties: {
      id:    { type: 'string' },
      name:  { type: 'string' },
      email: { type: 'string', format: 'email' },
    },
    required: ['id', 'name', 'email']
  });

  addSchemaOnce('auth.AuthRegisterRequest', {
    type: 'object',
    properties: {
      name:     { type: 'string', minLength: 2 },
      email:    { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 6 },
    },
    required: ['name', 'email', 'password']
  });

  addSchemaOnce('auth.AuthLoginRequest', {
    type: 'object',
    properties: {
      email:    { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 6 },
    },
    required: ['email', 'password']
  });

  addSchemaOnce('auth.AuthResponse', {
    type: 'object',
    properties: {
      token: { type: 'string' },
      user:  { $ref: 'auth.UserPublic#' },
    },
    required: ['token', 'user']
  });

  addSchemaOnce('auth.AuthMeResponse', {
    type: 'object',
    properties: {
      user: { $ref: 'auth.UserPublic#' }
    },
    required: ['user']
  });

  // ---------------------------------------------------------------------------
  // ✅ Zod (validação de entrada)

  const registerZ = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
  });

  const loginZ = z.object({
    email: z.string().email(),
    password: z.string().min(6),
  });

  // ---------------------------------------------------------------------------
  // 🧭 Rotas

  // POST /auth/register
  fastify.post('/auth/register', {
    schema: {
      tags: ['auth'],
      summary: 'Registrar utilizador',
      body: { $ref: 'auth.AuthRegisterRequest#' },
      response: {
        201: { $ref: 'auth.AuthResponse#' },
        400: { type: 'object', properties: { message: { type: 'string' } } },
        409: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const parsed = registerZ.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }
    const name = parsed.data.name.trim();
    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;

    const exists = await User.findOne({ email });
    if (exists) return reply.conflict('E-mail já cadastrado');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });

    const token = fastify.jwt.sign(
      { sub: user._id.toString(), name: user.name, email: user.email },
      { expiresIn: '7d' }
    );

    return reply.code(201).send({
      token,
      user: { id: user._id.toString(), name: user.name, email: user.email },
    });
  });

  // POST /auth/login
  fastify.post('/auth/login', {
    schema: {
      tags: ['auth'],
      summary: 'Login do utilizador',
      body: { $ref: 'auth.AuthLoginRequest#' },
      response: {
        200: { $ref: 'auth.AuthResponse#' },
        400: { type: 'object', properties: { message: { type: 'string' } } },
        401: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const parsed = loginZ.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }

    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;

    const user = await User.findOne({ email });
    if (!user) return reply.unauthorized('Credenciais inválidas');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.unauthorized('Credenciais inválidas');

    const token = fastify.jwt.sign(
      { sub: user._id.toString(), name: user.name, email: user.email },
      { expiresIn: '7d' }
    );

    return {
      token,
      user: { id: user._id.toString(), name: user.name, email: user.email },
    };
  });

  // GET /auth/me (protegida)
  fastify.get('/auth/me', {
    schema: {
      tags: ['auth'],
      summary: 'Dados do utilizador autenticado',
      security: [{ bearerAuth: [] }],
      response: {
        200: { $ref: 'auth.AuthMeResponse#' },
        401: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
    preValidation: [fastify.authenticate],
  }, async (request) => {
    const user = await User.findById(request.user.sub).select('name email');
    return { user: { id: user._id.toString(), name: user.name, email: user.email } };
  });
};
