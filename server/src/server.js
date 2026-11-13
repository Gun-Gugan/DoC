'use strict';
const path = require('path');

// Load server/.env when present (Node >= 20.12 built-in, no dotenv dependency). Real env vars win.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* no .env file — rely on the environment (e.g. Render dashboard) */
}
const { connect } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'ajaia_docs';

async function main() {
  const store = await connect(MONGODB_URI, MONGODB_DB);
  const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  const clientDist = process.env.CLIENT_DIST ? path.resolve(__dirname, '..', process.env.CLIENT_DIST) : undefined;
  const app = createApp(store, { secureCookies: process.env.NODE_ENV === 'production', corsOrigins, clientDist });
  if (clientDist) console.log(`Serving web client from ${clientDist}`);
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.listen(PORT, () => console.log(`Ajaia Docs API listening on http://localhost:${PORT}`));
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
