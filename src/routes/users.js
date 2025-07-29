// src/routes/users.js
const { z } = require('zod');
const bcrypt = require('bcrypt');
const User = require('../models/user');

module.exports = async function usersRoutes(fastify) {
  // Schemas Zod
  const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
  });

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
  });

  // Registro
  fastify.post('/auth/register', {
    schema: {
      tags: ['auth'],
      summary: 'Registrar utilizador',
      body: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 2 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }
    const { name, email, password } = parsed.data;

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
      user: { id: user._id, name: user.name, email: user.email }
    });
  });

  // Login
  fastify.post('/auth/login', {
    schema: {
      tags: ['auth'],
      summary: 'Login do utilizador',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id:   { type: 'string' },
                name: { type: 'string' },
                email:{ type: 'string' },
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors.map(e => e.message).join(', '));
    }
    const { email, password } = parsed.data;

    const user = await User.findOne({ email });
    if (!user) return reply.unauthorized('Credenciais inválidas');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.unauthorized('Credenciais inválidas');

    const token = fastify.jwt.sign(
      { sub: user._id.toString(), name: user.name, email: user.email },
      { expiresIn: '7d' }
    );

    return { token, user: { id: user._id, name: user.name, email: user.email } };
  });

  // Perfil do usuário logado
  fastify.get('/auth/me', {
    schema: {
      tags: ['auth'],
      summary: 'Dados do utilizador autenticado',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
              }
            }
          }
        }
      }
    },
    preValidation: [fastify.authenticate],
  }, async (request) => {
    const user = await User.findById(request.user.sub).select('name email');
    return { user: { id: user._id, name: user.name, email: user.email } };
  });
};
