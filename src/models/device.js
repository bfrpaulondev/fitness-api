// src/models/device.js
const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['onesignal'], default: 'onesignal' },
    playerId: { type: String, required: true }, // OneSignal Player ID
    platform: { type: String, default: '' },    // ios|android|web (opcional)
    tags: { type: Object, default: {} },
    lastSeenAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
  },
  { collection: 'devices' }
);

deviceSchema.index({ user: 1, provider: 1, playerId: 1 }, { unique: true });

module.exports = mongoose.model('Device', deviceSchema);
