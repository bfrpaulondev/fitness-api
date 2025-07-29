// src/models/exercise.js
const mongoose = require('mongoose');

const exerciseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    muscleGroup: { type: String, default: '' }, // ex.: peitoral, costas, pernas...
    equipment: { type: String, default: '' },   // ex.: halteres, barra, máquina...
    difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
    instructions: { type: String, default: '' }, // passo a passo
    videoUrl: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    isPublic: { type: Boolean, default: false },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // opcional se público
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'exercises' }
);

// Evita duplicar nomes por dono (mas permite mesmo nome se público de outro usuário)
exerciseSchema.index({ owner: 1, name: 1 }, { unique: true, partialFilterExpression: { owner: { $exists: true } } });

module.exports = mongoose.model('Exercise', exerciseSchema);
