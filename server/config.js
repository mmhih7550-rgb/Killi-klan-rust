'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  ROOT,
  DATA_DIR,
  UPLOAD_DIR,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DB_PATH: process.env.DB_PATH || path.join(DATA_DIR, 'killi.db'),
  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || '0.0.0.0',
  // OAuth / integrations (configured through environment variables)
  STEAM_API_KEY: process.env.STEAM_API_KEY || '',
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || '',
  APP_BASE_URL: (process.env.APP_BASE_URL || '').replace(/\/+$/, ''),
  IS_PROD: process.env.NODE_ENV !== 'development',
};
