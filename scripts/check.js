'use strict';

/*
 * CLAN KILLI — self-check for the static shell and route wiring.
 *
 * Runs in CI/dev via `npm run check` and verifies:
 *   1. required project files exist
 *   2. every JavaScript file parses (CommonJS on the server, ESM in the browser)
 *   3. every local asset referenced by index.html exists
 *   4. every endpoint the browser calls is declared by a server router
 *   5. every SSE event the browser listens for is emitted by the server
 *   6. every CSS class used by markup has a rule in styles.css
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* ------------------------------- 1. files -------------------------------- */

const REQUIRED = [
  'package.json',
  'Dockerfile',
  'server/index.js',
  'server/config.js',
  'server/db.js',
  'server/security.js',
  'server/helpers.js',
  'server/lib/chatBus.js',
  'server/routes/api.routes.js',
  'server/routes/auth.routes.js',
  'server/routes/chat.routes.js',
  'server/routes/admin.routes.js',
  'public/index.html',
  'public/styles.css',
  'public/favicon.svg',
  'public/assets/core.js',
  'public/assets/views.js',
  'public/assets/account.js',
  'public/assets/admin.js',
  'public/assets/app.js',
];

for (const rel of REQUIRED) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail(`missing required file: ${rel}`);
}

/* ------------------------------ 2. syntax -------------------------------- */

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'data' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const serverFiles = walk(path.join(ROOT, 'server'));
const browserFiles = walk(path.join(ROOT, 'public')).filter((f) => f.includes(`${path.sep}assets${path.sep}`));

for (const file of serverFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    fail(`syntax error in ${path.relative(ROOT, file)}: ${String(error.stderr || error.message).trim()}`);
  }
}

// Browser modules are ESM: node --check needs an .mjs extension to parse import/export.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'killi-check-'));
for (const file of browserFiles) {
  const tmp = path.join(tmpDir, `${path.basename(file, '.js')}.mjs`);
  fs.copyFileSync(file, tmp);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (error) {
    fail(`syntax error in ${path.relative(ROOT, file)}: ${String(error.stderr || error.message).trim()}`);
  }
}
fs.rmSync(tmpDir, { recursive: true, force: true });

/* --------------------------- 3. asset references -------------------------- */

const indexHtml = read('public/index.html');

for (const match of indexHtml.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
  const ref = match[1].split('?')[0];
  if (ref.startsWith('/api/') || ref.startsWith('/auth/') || ref.startsWith('/media/')) continue;
  const rel = ref.replace(/^\//, '');
  if (!rel || !fs.existsSync(path.join(ROOT, 'public', rel))) fail(`index.html references missing file: ${ref}`);
}

if (/<script(?![^>]*type="module")[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(indexHtml)) {
  warn('index.html contains a non-module inline script; CSP allows only /assets modules');
}

/* ---------------------------- 4/5. route + SSE ---------------------------- */

const MOUNTS = {
  'auth.routes.js': '/auth',
  'api.routes.js': '/api',
  'chat.routes.js': '/api',
  'admin.routes.js': '/api',
};

const serverRoutes = [];
for (const [file, prefix] of Object.entries(MOUNTS)) {
  const source = fs.readFileSync(path.join(ROOT, 'server/routes', file), 'utf8');
  for (const match of source.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']+)'/g)) {
    serverRoutes.push({ method: match[1].toUpperCase(), path: `${prefix}${match[2]}` });
  }
}

const clientSource = browserFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const calls = new Set();
for (const pattern of [/api\(\s*'([^']+)'/g, /api\(\s*`([^`]+)`/g, /fetch\(\s*'(\/[^']+)'/g, /EventSource\(\s*'([^']+)'/g]) {
  for (const match of clientSource.matchAll(pattern)) {
    const raw = match[1];
    const staticPart = raw.split('${')[0].split('?')[0];
    if (!staticPart.startsWith('/')) continue;
    calls.add(staticToPath(staticPart));
  }
}

function staticToPath(raw) {
  const withApi = raw.startsWith('/api') || raw.startsWith('/auth') ? raw : `/api${raw}`;
  return withApi.replace(/\/+$/, '') || '/';
}

function segments(p) {
  return p.split('/').filter(Boolean);
}

function matches(clientPath, routePath) {
  const a = segments(clientPath);
  const b = segments(routePath);
  const len = Math.min(a.length, b.length);
  if (len === 0) return false;
  for (let i = 0; i < len; i += 1) {
    if (b[i].startsWith(':')) continue;
    if (a[i] !== b[i]) return false;
  }
  return a.length === b.length || b.length > a.length;
}

for (const call of calls) {
  if (!serverRoutes.some((route) => matches(call, route.path))) {
    fail(`no server route for browser call: ${call}`);
  }
}

const serverStream = serverFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const emitted = new Set();
for (const match of serverStream.matchAll(/event:\s*([a-zA-Z_]+)\\n/g)) emitted.add(match[1]);
for (const match of serverStream.matchAll(/broadcast\(\s*'([a-zA-Z_]+)'/g)) emitted.add(match[1]);

const BUILTIN_EVENTS = new Set(['open', 'error', 'message']);
for (const match of clientSource.matchAll(/source\.addEventListener\(\s*'([a-zA-Z_]+)'/g)) {
  if (BUILTIN_EVENTS.has(match[1])) continue;
  if (!emitted.has(match[1])) fail(`browser listens for SSE event "${match[1]}" that the server never emits`);
}

/* ---------------------------- 6. CSS coverage ---------------------------- */

const styles = read('public/styles.css');
const defined = new Set();
for (const match of styles.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(match[1]);

function classNames(source) {
  const found = new Set();
  const CLASS_TOKEN = /^[a-z][a-z0-9_-]*$/;

  const addTokens = (text) => {
    for (const token of text.split(/[\s"'`]+/)) {
      if (token && CLASS_TOKEN.test(token) && token.length > 2) found.add(token);
    }
  };

  for (const match of source.matchAll(/class="([^"]*)"/g)) {
    const value = match[1];
    if (!value.includes('${')) {
      addTokens(value);
      continue;
    }
    // Literal part of a template literal, plus class strings returned by ternaries
    // inside `${...}`, so conditional classes such as 'is-mine' are still checked
    // while comparison values like `role === 'moderator'` are ignored.
    addTokens(value.replace(/\$\{[^}]*\}/g, ' '));
    for (const expr of value.matchAll(/\$\{([^}]*)\}/g)) {
      for (const segment of expr[1].split(/[?:]/)) {
        const literal = segment.match(/^\s*'([^']*)'/);
        if (literal) addTokens(literal[1]);
      }
    }
  }
  return found;
}

const markupClasses = new Set([
  ...classNames(indexHtml),
]);
const jsClasses = classNames(browserFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n'));

for (const name of markupClasses) {
  if (!defined.has(name)) fail(`index.html uses class ".${name}" with no rule in styles.css`);
}
for (const name of jsClasses) {
  if (!defined.has(name)) warn(`view markup uses class ".${name}" with no rule in styles.css`);
}

/* ------------------------------- reporting ------------------------------- */

for (const message of warnings) console.warn(`warn  ${message}`);

if (errors.length) {
  for (const message of errors) console.error(`error ${message}`);
  console.error(`\n✗ check failed: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}

console.log(
  `✓ check passed — ${serverFiles.length} server + ${browserFiles.length} browser modules parse, ` +
    `${serverRoutes.length} routes, ${calls.size} browser calls verified, ${defined.size} CSS selectors`
);
