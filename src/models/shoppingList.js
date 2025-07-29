// src/models/shoppingList.js
const mongoose = require('mongoose');

const priceSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    store: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    qty: { type: Number, default: 1, min: 0 },
    unit: { type: String, default: 'un' }, // un, kg, g, l, ml, pct, etc.
    category: { type: String, default: 'outros' },
    plannedPrice: { type: Number, default: 0, min: 0 },
    purchasedPrice: { type: Number, default: 0, min: 0 },
    purchased: { type: Boolean, default: false },
    store: { type: String, default: '' },
    notes: { type: String, default: '' },
    priceHistory: { type: [priceSchema], default: [] }
  },
  { _id: true, timestamps: true }
);

const alertsSchema = new mongoose.Schema(
  {
    warnPct: { type: Number, default: 0.8, min: 0, max: 1 },
    errorPct: { type: Number, default: 1.0, min: 0, max: 10 },
    notify: { type: Boolean, default: true }
  },
  { _id: false }
);

const shoppingListSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: '' },
    year: { type: Number, default: () => new Date().getUTCFullYear() },
    month: { type: Number, default: () => new Date().getUTCMonth() + 1 }, // 1..12
    budget: { type: Number, default: 0, min: 0 },
    alerts: { type: alertsSchema, default: () => ({}) },
    items: { type: [itemSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'shopping_lists' }
);

shoppingListSchema.index({ user: 1, year: 1, month: 1 });
shoppingListSchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });

module.exports = mongoose.model('ShoppingList', shoppingListSchema);
