// src/models/media.js
const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, default: 'cloudinary' },
    type: { type: String, enum: ['image', 'video'], required: true },

    publicId: { type: String, required: true },
    url: { type: String, required: true },
    format: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    duration: { type: Number, default: 0 }, // videos

    originalFilename: { type: String, default: '' },
    tags: { type: [String], default: [] },

    album: { type: mongoose.Schema.Types.ObjectId, ref: 'Album', default: null },

    // vínculos opcionais
    measurementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Measurement', default: null },
    workoutLogId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkoutLog', default: null },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'media' }
);

mediaSchema.index({ user: 1, createdAt: -1 });
mediaSchema.index({ user: 1, tags: 1 });
mediaSchema.index({ album: 1, createdAt: -1 });

mediaSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Media', mediaSchema);
