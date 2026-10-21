import express from 'express';
import { apiRouter } from './api';

const app = express();
const PORT = Number(process.env.PORT) || 8555;
const BIND_HOST = process.env.HOST || '127.0.0.1';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Bounded request sizes (max 50MB for APK transfers)
app.use(express.json({ limit: '50mb' }));

// Token Authentication Middleware (allow unauthenticated /api/health and /api/pairing/*)
app.use((req, res, next) => {
  if (req.path === '/api/health' || req.path.startsWith('/api/pairing/')) {
    return next();
  }
  const token = req.headers['authorization'];
  const expectedToken = process.env.AUTH_TOKEN || 'default-secret';
  if (token !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'AUTHENTICATION_FAILED: Invalid or missing Bearer token' });
  }
  next();
});

app.use('/api', apiRouter);

app.listen(PORT, BIND_HOST, () => {
  console.log(`Arclight Android Host Agent listening on http://${BIND_HOST}:${PORT} (auth token redacted)`);
});
