// src/models/goal.js
const mongoose = require('mongoose');

const smartSchema = new mongoose.Schema(
  {
    specific: { type: String, default: '' },
    measurable: { type: String, default: '' },
    achievable: { type: String, default: '' },
    relevant: { type: String, default: '' },
    timeBound: { type: String, default: '' }
  },
  { _id: false }
);

const goalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },

    smart: { type: smartSchema, default: () => ({}) },

    startDate: { type: Date, default: () => new Date() },
    endDate: { type: Date, default: null },

    targetMetric: { type: String, default: '' }, // ex.: weightKg, bodyFatPct, sessions
    targetValue: { type: Number, default: 0 },
    currentValue: { type: Number, default: 0 },

    status: { type: String, enum: ['active','paused','completed','failed'], default: 'active' },

    // tags/gamificação
    tags: { type: [String], default: [] },
    points: { type: Number, default: 0 },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'goals' }
);

goalSchema.index({ user: 1, status: 1 });

goalSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Goal', goalSchema);
