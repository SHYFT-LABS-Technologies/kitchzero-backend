import { Router } from 'express';

const router = Router();

// Temporary tenant routes
router.get('/dashboard', (req, res) => {
  res.json({ message: 'Tenant dashboard - coming soon' });
});

router.get('/branches', (req, res) => {
  res.json({ message: 'Branches management - coming soon' });
});

export default router;