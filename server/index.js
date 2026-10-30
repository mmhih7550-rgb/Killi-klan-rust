'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const { PORT, HOST, PUBLIC_DIR, UPLOAD_DIR } = require('./config');
const { getSettings } = require('./db');
const { attachContext } = require('./helpers');

const auth = require('./routes/auth.routes');
const api = require('./routes/api.routes');
const chat = require('./routes/chat.routes');
const admin = require('./routes/admin.routes');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);

/* ------------------------------ middleware ------------------------------ */

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "font-src 'self' data:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self' https://steamcommunity.com https://discord.com",
    ].join('; ')
  );
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(attachContext);

/* media (logo / background) is public, everything else in uploads is gated */
app.use(
  '/media',
  express.static(path.join(UPLOAD_DIR, 'media'), {
    maxAge: '7d',
    fallthrough: true,
    index: false,
  })
);

app.use(
  '/assets',
  express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: '1h', fallthrough: true, index: false })
);

/* --------------------------------- routes -------------------------------- */

app.get('/healthz', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), ts: new Date().toISOString() });
});

app.use('/auth', auth.router);
app.use('/api', chat.router);
app.use('/api', api.router);
app.use('/api', admin.router);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Эндпоинт не найден.' });
});

/* ------------------------------- SPA shell ------------------------------- */

function sendIndex(req, res) {
  const file = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(file)) {
    return res.status(503).type('text/plain').send('CLAN KILLI: frontend is not built yet.');
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(file);
}

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return res.status(404).json({ error: 'not_found' });
  }
  sendIndex(req, res);
});

/* ------------------------------ error handler ---------------------------- */

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  const message =
    status === 413 ? 'Файл слишком большой.' : status < 500 ? err.message || 'Ошибка запроса.' : 'Внутренняя ошибка сервера.';
  if (status >= 500) console.error('[killi]', err);
  if (req.path.startsWith('/api')) {
    return res.status(status).json({ error: 'server_error', message });
  }
  res.status(status).type('text/plain').send(message);
});

/* --------------------------------- start --------------------------------- */

const server = app.listen(PORT, HOST, () => {
  const settings = getSettings();
  console.log(`[killi] CLAN KILLI listening on http://${HOST}:${PORT}`);
  console.log(`[killi] site: ${settings.site_name} • uploads: ${UPLOAD_DIR}`);
});

server.on('error', (err) => {
  console.error('[killi] failed to start:', err.message);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`[killi] ${signal} received, closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server };
