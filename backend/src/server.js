import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.routes.js';
import dealsRoutes from './routes/deals.routes.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'salesmesh-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/deals', dealsRoutes);
// Iteration 3 will add: /api/analytics (diagnostic, predictive), /api/campaigns
// Iteration 4 will add: /api/deals/priority (prescriptive scoring)

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SalesMesh API running on http://localhost:${PORT}`);
});
