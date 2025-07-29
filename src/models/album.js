// src/models/album.js
const mongoose = require('mongoose');

const albumSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    coverMedia: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'albums' }
);

albumSchema.index({ user: 1, name: 1 }, { unique: false });

albumSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Album', albumSchema);
