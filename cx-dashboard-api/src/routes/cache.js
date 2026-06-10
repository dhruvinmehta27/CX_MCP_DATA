import { Router } from 'express';
import { clearUserCache, cacheStats } from '../cache.js';

const router = Router();

// Clears the current user's cache entries only (per-user isolation)
router.delete('/clear', (req, res) => {
  const removed = clearUserCache(req.userEmail);
  res.json({ cleared: true, entriesRemoved: removed });
});

router.get('/stats', (req, res) => {
  res.json(cacheStats());
});

export default router;
