import dotenv from 'dotenv';
import app from './app.js';
import { pool } from './config/postgresClient.js';

dotenv.config();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SalesMesh API running on http://localhost:${PORT}`);
  pool
    ?.query('select 1')
    .then(() => console.log('Local PostgreSQL mirror connected'))
    .catch((err) => console.error('Local PostgreSQL mirror unreachable — writes will only reach Supabase:', err.message));
});
