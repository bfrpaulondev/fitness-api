// src/models/timerSession.js
const mongoose = require('mongoose');

const segmentSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    seconds: { type: Number, default: 0 },
    startedAt: { type: Date },
    finishedAt: { type: Date }
  },
  { _id: false }
);

const timerSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'TimerTemplate' },
    startedAt: { type: Date, default: () => new Date() },
    finishedAt: { type: Date, default: null },
    totalSeconds: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '' },
    segments: { type: [segmentSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'timer_sessions' }
);

timerSessionSchema.index({ user: 1, startedAt: -1 });
timerSessionSchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });

module.exports = mongoose.model('TimerSession', timerSessionSchema);
