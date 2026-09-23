import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.routes.js';
import dealsRoutes from './routes/deals.routes.js';
import contactsRoutes from './routes/contacts.routes.js';
import activitiesRoutes from './routes/activities.routes.js';
import campaignsRoutes from './routes/campaigns.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import settingsRoutes from './routes/settings.routes.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'salesmesh-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SalesMesh API running on http://localhost:${PORT}`);
});
