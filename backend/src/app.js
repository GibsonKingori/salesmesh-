import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import dealsRoutes from './routes/deals.routes.js';
import contactsRoutes from './routes/contacts.routes.js';
import activitiesRoutes from './routes/activities.routes.js';
import campaignsRoutes from './routes/campaigns.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import settingsRoutes from './routes/settings.routes.js';

// Express app without a listening socket, so route tests can drive it with Supertest
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

// mirrorStatus is set by server.js when the local PostgreSQL mirror is enabled
app.get('/api/health', (req, res) => {
  const mirrorStatus = req.app.locals.mirrorStatus;
  res.json({ status: 'ok', service: 'salesmesh-api', postgresMirror: mirrorStatus ? mirrorStatus() : 'disabled' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
