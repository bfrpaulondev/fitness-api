// src/plugins/schemas.js
const fp = require('fastify-plugin');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');

/**
 * Dica importante:
 * - Sempre defina um $id único para cada schema convertido.
 * - Depois, nas rotas, use $ref: 'SeuSchemaId#'
 */

module.exports = fp(async function schemasPlugin(fastify) {
  // ========== Comuns / Utilitários ==========
  const Id = z.string().min(1); // simplificado para ObjectId string

  const PaginationMeta = z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
  });

  // ========== USERS / AUTH ==========
  const UserPublic = z.object({
    id: Id,
    name: z.string(),
    email: z.string().email(),
  });

  const AuthRegisterBody = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
  });

  const AuthLoginBody = z.object({
    email: z.string().email(),
    password: z.string().min(6),
  });

  const AuthResponse = z.object({
    token: z.string(),
    user: UserPublic,
  });

  const MeResponse = z.object({
    user: UserPublic,
  });

  // ========== EXERCISES ==========
  const ExerciseBase = z.object({
    name: z.string().min(2),
    description: z.string().default(''),
    muscleGroup: z.string().default(''),
    equipment: z.string().default(''),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    instructions: z.string().default(''),
    videoUrl: z.string().url().optional().or(z.literal('')).default(''),
    imageUrl: z.string().url().optional().or(z.literal('')).default(''),
    isPublic: z.boolean().default(false),
  });

  const ExerciseCreate = ExerciseBase; // para POST
  const ExerciseUpdate = ExerciseBase.partial(); // para PUT/PATCH

  const Exercise = ExerciseBase.extend({
    _id: Id.optional(), // caso traga diretamente do Mongo
    id: Id.optional(),  // para quem preferir mapear _id -> id
    owner: Id.optional(),
    createdAt: z.string().optional(),
  });

  const ExerciseList = z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    items: z.array(Exercise),
  });

  // ========== WORKOUTS ==========
  const WorkoutBlock = z.object({
    exercise: Id,
    sets: z.number().int().min(1).max(100).default(3),
    reps: z.number().int().min(1).max(1000).default(10),
    restSeconds: z.number().int().min(0).max(3600).default(60),
    durationSeconds: z.number().int().min(0).max(36000).default(0),
    notes: z.string().default(''),
  });

  const WorkoutCreate = z.object({
    name: z.string().min(2),
    description: z.string().default(''),
    blocks: z.array(WorkoutBlock).min(1),
  });

  const WorkoutUpdate = WorkoutCreate.partial();

  const Workout = z.object({
    id: Id.optional(),
    _id: Id.optional(),
    user: Id,
    name: z.string(),
    description: z.string().default(''),
    blocks: z.array(WorkoutBlock),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  });

  const WorkoutList = z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    items: z.array(Workout),
  });

  // ========== Converte e registra todos ==========
  function addZodSchema(zodSchema, id) {
    const json = zodToJsonSchema(zodSchema, id, { target: 'openApi3' });
    // fastify.addSchema precisa de um objeto com $id na raiz
    // zod-to-json-schema inclui $schema etc; vamos garantir $id:
    json.$id = id;
    fastify.addSchema(json);
  }

  // Users/Auth
  addZodSchema(UserPublic, 'UserPublic');
  addZodSchema(AuthRegisterBody, 'AuthRegisterBody');
  addZodSchema(AuthLoginBody, 'AuthLoginBody');
  addZodSchema(AuthResponse, 'AuthResponse');
  addZodSchema(MeResponse, 'MeResponse');

  // Exercises
  addZodSchema(ExerciseBase, 'ExerciseBase');
  addZodSchema(ExerciseCreate, 'ExerciseCreate');
  addZodSchema(ExerciseUpdate, 'ExerciseUpdate');
  addZodSchema(Exercise, 'Exercise');
  addZodSchema(ExerciseList, 'ExerciseList');

  // Workouts
  addZodSchema(WorkoutBlock, 'WorkoutBlock');
  addZodSchema(WorkoutCreate, 'WorkoutCreate');
  addZodSchema(WorkoutUpdate, 'WorkoutUpdate');
  addZodSchema(Workout, 'Workout');
  addZodSchema(WorkoutList, 'WorkoutList');

  // Paginação genérica (se quiser usar em outros módulos)
  addZodSchema(PaginationMeta, 'PaginationMeta');
});
