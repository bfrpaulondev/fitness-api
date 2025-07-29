// src/models/workout.js
const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema(
  {
    exercise: { type: mongoose.Schema.Types.ObjectId, ref: 'Exercise', required: true },
    sets: { type: Number, default: 3, min: 1 },
    reps: { type: Number, default: 10, min: 1 },
    restSeconds: { type: Number, default: 60, min: 0 },
    durationSeconds: { type: Number, default: 0, min: 0 }, // para exercícios por tempo
    notes: { type: String, default: '' }
  },
  { _id: false }
);

const workoutSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    // Ordenados: a ordem dos blocos é relevante na execução
    blocks: { type: [blockSchema], default: [] },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'workouts' }
);

workoutSchema.index({ user: 1, name: 1 }, { unique: false });

workoutSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Workout', workoutSchema);
