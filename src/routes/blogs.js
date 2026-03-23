const express = require('express');
const Blog = require('../models/Blog');

const router = express.Router();

// Public endpoint: list blog posts
router.get('/', async (req, res) => {
  try {
    const blogs = await Blog.find().sort({ createdAt: -1 }).lean();
    res.json(blogs);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch blog posts', error: error.message });
  }
});

module.exports = router;
