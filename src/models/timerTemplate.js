// src/models/timerTemplate.js
const mongoose = require('mongoose');

const intervalSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    seconds: { type: Number, required: true, min: 1 },
    repeats: { type: Number, default: 1, min: 1 } // repete este bloco X vezes
  },
  { _id: false }
);

const timerTemplateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    type: { type: String, enum: ['simple','interval'], default: 'interval' },
    intervals: { type: [intervalSchema], default: [] },
    sound: {
      type: Object,
      default: () => ({ start: 'beep', end: 'beep', interval: 'beep' })
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'timer_templates' }
);

timerTemplateSchema.index({ user: 1, name: 1 }, { unique: false });
timerTemplateSchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });

module.exports = mongoose.model('TimerTemplate', timerTemplateSchema);
