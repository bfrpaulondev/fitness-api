// src/models/comparison.js
const mongoose = require('mongoose');

const comparisonSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    beforeMedia: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true },
    afterMedia: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true },
    notes: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  },
  { collection: 'comparisons' }
);

comparisonSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Comparison', comparisonSchema);
