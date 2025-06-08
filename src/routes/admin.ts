import { Router } from 'express';

const router = Router();

// Temporary admin routes
router.get('/dashboard', (req, res) => {
  res.json({ message: 'Admin dashboard - coming soon' });
});

router.get('/users', (req, res) => {
  res.json({ message: 'Users management - coming soon' });
});

export default router;