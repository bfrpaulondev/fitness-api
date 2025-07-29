// src/models/workoutTemplate.js
const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema(
  {
    exercise: { type: mongoose.Schema.Types.ObjectId, ref: 'Exercise', required: true },
    sets: { type: Number, default: 3, min: 1 },
    reps: { type: Number, default: 10, min: 0 },
    restSeconds: { type: Number, default: 60, min: 0 },
    durationSeconds: { type: Number, default: 0, min: 0 }, // para exercícios por tempo
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const workoutTemplateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // autor
    name: { type: String, required: true },
    description: { type: String, default: '' },
    tags: { type: [String], default: [] }, // ex.: ['peito', 'fullbody', 'hiit']
    level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
    isPublic: { type: Boolean, default: false },

    blocks: { type: [blockSchema], default: [] },

    usesCount: { type: Number, default: 0 },   // nº de clones efetuados
    forkedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkoutTemplate', default: null },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'workout_templates' }
);

workoutTemplateSchema.index({ isPublic: 1, level: 1, createdAt: -1 });
workoutTemplateSchema.index({ user: 1, name: 1 });
workoutTemplateSchema.index({ tags: 1 });

workoutTemplateSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('WorkoutTemplate', workoutTemplateSchema);
