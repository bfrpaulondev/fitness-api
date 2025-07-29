// src/models/workoutLog.js
const mongoose = require('mongoose');

const setResultSchema = new mongoose.Schema(
  {
    setNumber: { type: Number, required: true, min: 1 },
    weightKg: { type: Number, default: 0, min: 0 },        // carga usada
    repsPlanned: { type: Number, default: 0, min: 0 },     // meta de reps do bloco
    repsDone: { type: Number, default: 0, min: 0 },        // reps que fez
    durationSeconds: { type: Number, default: 0, min: 0 }, // para exercícios por tempo
    rpe: { type: Number, default: 0, min: 0, max: 10 },    // percepção de esforço (0-10)
    completed: { type: Boolean, default: false },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const entrySchema = new mongoose.Schema(
  {
    blockIndex: { type: Number, required: true, min: 0 }, // índice do bloco no workout
    exercise: { type: mongoose.Schema.Types.ObjectId, ref: 'Exercise', required: true },
    sets: { type: [setResultSchema], default: [] },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const workoutLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    workout: { type: mongoose.Schema.Types.ObjectId, ref: 'Workout', required: true },

    date: { type: Date, default: () => new Date() }, // dia/hora da sessão
    durationSeconds: { type: Number, default: 0, min: 0 }, // duração total da sessão (opcional)
    notes: { type: String, default: '' },

    entries: { type: [entrySchema], default: [] }, // uma entrada por bloco do treino
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'workout_logs' }
);

workoutLogSchema.index({ user: 1, date: -1 });
workoutLogSchema.index({ user: 1, workout: 1, date: -1 });

workoutLogSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('WorkoutLog', workoutLogSchema);
