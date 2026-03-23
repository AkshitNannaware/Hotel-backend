const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  author: { type: String, required: true },
  date: { type: Date, default: Date.now },
  summary: { type: String, required: true },
  image: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Blog', blogSchema);