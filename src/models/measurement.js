// src/models/measurement.js
const mongoose = require('mongoose');

const measurementSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, default: () => new Date() },

    weightKg: { type: Number, default: 0, min: 0 },
    bodyFatPct: { type: Number, default: 0, min: 0, max: 100 },

    neckCm: { type: Number, default: 0, min: 0 },
    shoulderCm: { type: Number, default: 0, min: 0 },
    chestCm: { type: Number, default: 0, min: 0 },
    waistCm: { type: Number, default: 0, min: 0 },
    hipsCm: { type: Number, default: 0, min: 0 },
    thighCm: { type: Number, default: 0, min: 0 },
    calfCm: { type: Number, default: 0, min: 0 },
    armCm: { type: Number, default: 0, min: 0 },
    forearmCm: { type: Number, default: 0, min: 0 },

    notes: { type: String, default: '' },

    photos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Media' }],

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'measurements' }
);

measurementSchema.index({ user: 1, date: -1 });

measurementSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Measurement', measurementSchema);
