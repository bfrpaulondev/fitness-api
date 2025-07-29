// src/models/dashboardLayout.js
const mongoose = require('mongoose');

const widgetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },            // identificador único do widget no layout do user
    type: { type: String, enum: ['kpi','chart','ranking'], required: true },
    title: { type: String, default: '' },
    order: { type: Number, default: 0 },
    size: { type: String, enum: ['sm','md','lg'], default: 'md' },
    config: { type: Object, default: {} }             // parâmetros por widget (e.g., metric, period, filters)
  },
  { _id: false }
);

const dashboardLayoutSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    widgets: { type: [widgetSchema], default: [] },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'dashboard_layouts' }
);

dashboardLayoutSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('DashboardLayout', dashboardLayoutSchema);
