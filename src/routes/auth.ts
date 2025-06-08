import { Router } from 'express';

const router = Router();

// Temporary auth routes - we'll implement these next
router.post('/login', (req, res) => {
  res.json({ message: 'Login endpoint - coming soon', body: req.body });
});

router.post('/logout', (req, res) => {
  res.json({ message: 'Logout endpoint - coming soon' });
});

router.get('/me', (req, res) => {
  res.json({ message: 'User profile endpoint - coming soon' });
});

export default router;