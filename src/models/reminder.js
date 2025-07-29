// src/models/reminder.js
const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },

    // RRULE simplificado (FREQ=DAILY|WEEKLY;BYHOUR=..;BYMINUTE=..;BYSECOND=..;BYDAY=MO,TU,WE,TH,FR,SA,SU)
    rrule: { type: String, required: true },
    timezone: { type: String, default: process.env.DEFAULT_TZ || 'UTC' },

    active: { type: Boolean, default: true },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },

    // payload extra no push
    data: { type: Object, default: {} },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'reminders' }
);

reminderSchema.index({ user: 1, active: 1, nextRunAt: 1 });

reminderSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Reminder', reminderSchema);
