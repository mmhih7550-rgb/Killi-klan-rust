#!/usr/bin/env node
'use strict';

/**
 * End-to-end flow check for CLAN KILLI.
 *
 * Boots the real server on a throwaway DATA_DIR, seeds two users with real
 * session rows (a normal applicant and a sub-700-hours exception applicant),
 * then drives the actual HTTP API through the whole lifecycle:
 *
 *   guest guards → application → owner 2-step login → admin review →
 *   accept → member access (members/chat/downloads/app) → settings propagate →
 *   draft/publish visibility → member-only download → restriction → reporting.
 *
 * Every assertion hits a live HTTP endpoint or the real SQLite database, so it
 * verifies the server-side role checks rather than hidden buttons.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = Number(process.env.CHECK_PORT || 3123);
const BASE = `http://127.0.0.1:${PORT}`;

// Текущие пароли владельца (совпадают с INITIAL_HASHES в server/db.js).
// Нигде в клиентском коде они не встречаются — проверяется отдельной проверкой.
const OWNER_PASS_1 = 'V7!qN4#zK9@pR2$xM8wL6t';
const OWNER_PASS_2 = 'C3@mX8!vT5#kL9$wQ2nH7r';
// Пароли, которые использовались раньше и после ротации работать не должны.
const LEGACY_PASS_1 = 'Moti3003';
const LEGACY_PASS_2 = 'Kili clan 26';
// Значения для проверки независимой смены первого и второго пароля.
const ROTATED_PASS_1 = 'Qw8#Rt2$Yp5!Nm7@Zx4C';
const ROTATED_PASS_2 = 'Hb6^Vc3%Ks9&Ld1*Pf8E';
// Пара для проверки переопределения через KILLI_OWNER_PASSWORD_1/2.
const ENV_PASS_1 = 'Env9#Kp2$Vt7!Rs4@Lw6B';
const ENV_PASS_2 = 'Nq5^Zd8&Hm3*Cx1(Gb7T';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'killi-flow-'));
const DB_PATH = path.join(dataDir, 'killi.db');
const serverEntry = path.join(__dirname, '..', 'server', 'index.js');

let passed = 0;
const failures = [];

function check(name, ok, extra) {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------ HTTP client ------------------------------ */

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function absorbCookies(res, jar) {
  const list =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')]
        : [];
  for (const raw of list) {
    const pair = String(raw).split(';')[0];
    const at = pair.indexOf('=');
    if (at < 0) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (value) jar[name] = value;
    else delete jar[name];
  }
}

async function api(jar, method, urlPath, body, base = BASE) {
  const headers = {};
  if (jar && Object.keys(jar).length) headers.cookie = cookieHeader(jar);
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + urlPath, { method, headers, body: payload, redirect: 'manual' });
  if (jar) absorbCookies(res, jar);
  const type = res.headers.get('content-type') || '';
  let data = null;
  if (type.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text();
  }
  return { status: res.status, data, type, headers: res.headers };
}

/* -------------------------------- fixtures ------------------------------- */

function seedUser(nickname, extra = {}) {
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  const token = crypto.randomBytes(24).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const info = db
    .prepare(
      `INSERT INTO users (nickname, role, clan_status, manual_status, specialization, rust_hours, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      nickname,
      extra.role || 'user',
      'active',
      'offline',
      extra.specialization || null,
      extra.rust_hours || null,
      now,
      now
    );
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?,?,?,?,?)').run(
    hash,
    info.lastInsertRowid,
    now,
    expires,
    now
  );
  db.close();
  return { id: Number(info.lastInsertRowid), token, jar: { ck_session: token } };
}

const APPLICATION = {
  nickname: 'FlowTester',
  rust_nick: 'FlowTester',
  hours_range: '2000-3000',
  specialization: 'combat',
  extra_roles: ['builder', 'electric'],
  play_time: '4-6 часов в день',
  game_modes: ['vanilla', 'modded'],
  clan_experience: 'Играл в двух кланах, был офицером.',
  has_mic: 'yes',
  timezone: 'UTC+3',
  extra_skills: 'Строю компактные базы и провожу рейды.',
  why_join: 'Хочу играть в организованном составе и помогать клану на вайпах.',
  extra_info: 'Готов к вайпу в любое время.',
};

/* --------------------------------- server -------------------------------- */

let child = null;
let serverLog = '';

async function startServer(envOverrides = {}) {
  const env = {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
  };
  // По умолчанию полагаемся на встроенные хеши из server/db.js (INITIAL_HASHES):
  // внешние переменные окружения не должны влиять на изолированную проверку.
  delete env.KILLI_OWNER_PASSWORD_1;
  delete env.KILLI_OWNER_PASSWORD_2;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === null || value === undefined) delete env[key];
    else env[key] = value;
  }

  child = spawn(process.execPath, [serverEntry], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });

  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(120);
  }
  throw new Error(`server did not become ready in time:\n${serverLog}`);
}

/* Останавливает текущий инстанс и дожидается освобождения файла БД. */
function stopChild() {
  if (!child || child.killed) return Promise.resolve();
  const proc = child;
  child = null;
  return new Promise((resolve) => {
    proc.once('exit', () => setTimeout(resolve, 400));
    proc.kill('SIGKILL');
  });
}

function stopServer() {
  if (child && !child.killed) child.kill('SIGKILL');
  child = null;
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/* ---------------------------------- run ---------------------------------- */

async function run() {
  await startServer();
  check('server boots and serves the app-level health probe', true);

  const guest = {};
  const userA = seedUser('FlowTester');
  const userB = seedUser('RookieFlow');
  const mod = seedUser('ModFlow', { role: 'moderator', specialization: 'builder' });

  /* ---- guest guards ---- */
  let res = await api(guest, 'GET', '/api/health');
  check('GET /api/health → json ok', res.status === 200 && res.data && res.data.ok === true, `status ${res.status}`);

  res = await api(guest, 'GET', '/api/site');
  check('GET /api/site → 200 with settings', res.status === 200 && Boolean(res.data && res.data.settings));

  res = await api(guest, 'POST', '/api/applications', APPLICATION);
  check('guest cannot submit an application (401)', res.status === 401, `status ${res.status}`);

  res = await api(guest, 'GET', '/api/members');
  check('guest cannot read the members list (403)', res.status === 403, `status ${res.status}`);

  res = await api(guest, 'GET', '/api/chat/messages');
  check('guest cannot read clan chat (401/403)', [401, 403].includes(res.status), `status ${res.status}`);

  res = await api(guest, 'GET', '/api/admin/overview');
  check('guest cannot call admin API (401)', res.status === 401, `status ${res.status}`);

  /* ---- application from a registered user ---- */
  res = await api(userA.jar, 'POST', '/api/applications', APPLICATION);
  check('registered user submits an application (201)', res.status === 201, `status ${res.status}`);

  res = await api(userA.jar, 'GET', '/api/applications/me');
  const pendingApp = res.data && res.data.application;
  check('application is stored as pending', Boolean(pendingApp) && pendingApp.status === 'pending', JSON.stringify(res.data));

  res = await api(userA.jar, 'POST', '/api/applications', APPLICATION);
  check('duplicate pending application is rejected (409)', res.status === 409, `status ${res.status}`);

  res = await api(userA.jar, 'GET', '/api/members');
  check('applicant still cannot read members list (403)', res.status === 403, `status ${res.status}`);

  res = await api(userA.jar, 'GET', '/api/downloads');
  const applicantDownloads = (res.data && res.data.downloads) || [];
  check('applicant sees downloads list but without clan files', res.status === 200 && res.data && res.data.member === false);

  res = await api(userA.jar, 'GET', '/api/admin/overview');
  check('ordinary user cannot reach the admin panel (401)', res.status === 401, `status ${res.status}`);

  /* ---- user cannot promote themselves ---- */
  res = await api(userA.jar, 'PATCH', '/api/admin/members/1', { role: 'member' });
  check('user cannot self-promote through the admin route (401)', res.status === 401, `status ${res.status}`);

  /* ---- owner two-step login ---- */
  // Внимание: каждая неудачная попытка увеличивает failed_count (лимит 5 до
  // блокировки), поэтому в этом блоке не больше трёх ошибок.
  const owner = {};
  res = await api(owner, 'POST', '/api/owner/login', { password: 'wrong-password' });
  check('owner login rejects a wrong first password (401)', res.status === 401, `status ${res.status}`);

  res = await api(owner, 'GET', '/api/admin/overview');
  check('failed attempt does not grant admin access', res.status === 401, `status ${res.status}`);

  res = await api(owner, 'POST', '/api/owner/login', { password: LEGACY_PASS_1 });
  check('legacy first password no longer works (401)', res.status === 401, `status ${res.status}`);

  res = await api(owner, 'POST', '/api/owner/login', { password: OWNER_PASS_1 });
  check('owner login accepts the new first password and asks for the second', res.status === 200 && res.data && res.data.step === 2, JSON.stringify(res.data));

  res = await api(owner, 'GET', '/api/admin/overview');
  check('pending second step alone grants no admin access (401)', res.status === 401, `status ${res.status}`);

  // неудачный второй шаг сжигает pending-сессию, поэтому дальше логинимся заново
  res = await api(owner, 'POST', '/api/owner/verify', { password: LEGACY_PASS_2 });
  check('legacy second password no longer works (401)', res.status === 401, `status ${res.status}`);

  res = await api(owner, 'POST', '/api/owner/login', { password: OWNER_PASS_1 });
  check('owner can restart the two-step login', res.status === 200 && res.data && res.data.step === 2, JSON.stringify(res.data));

  res = await api(owner, 'POST', '/api/owner/verify', { password: OWNER_PASS_2 });
  check('owner login completes after the new second password', res.status === 200, JSON.stringify(res.data));

  res = await api(owner, 'GET', '/api/owner/status');
  check('owner status reports an authenticated session', res.data && res.data.authed === true);
  check(
    'owner status exposes no lockout counters to the visitor',
    res.data && !('locked_until' in res.data) && !('failed_count' in res.data) && !('retry_after' in res.data),
    JSON.stringify(res.data)
  );

  res = await api(owner, 'GET', '/api/admin/overview');
  check('admin overview is reachable for the owner', res.status === 200 && Boolean(res.data), `status ${res.status}`);

  /* ---- admin review of the application ---- */
  res = await api(owner, 'GET', '/api/admin/applications?status=pending');
  const pendingList = (res.data && res.data.applications) || [];
  const target = pendingList.find((app) => app.nickname === 'FlowTester');
  check('application appears in the admin queue', Boolean(target), `count ${pendingList.length}`);
  check('admin sees specialization and hours in the review card', Boolean(target) && target.specialization === 'combat' && target.hours_range === '2000-3000');

  res = await api(owner, 'GET', '/api/admin/applications?status=pending&spec=builder');
  check(
    'specialization filter matches extra roles',
    ((res.data && res.data.applications) || []).some((app) => app.nickname === 'FlowTester')
  );

  res = await api(owner, 'POST', `/api/admin/applications/${target.id}/decision`, { action: 'accept' });
  check('owner accepts the application', res.status === 200, JSON.stringify(res.data));

  /* ---- accepted member access ---- */
  res = await api(userA.jar, 'GET', '/api/applications/me');
  check('applicant sees the accepted status', res.data && res.data.application && res.data.application.status === 'accepted');

  res = await api(userA.jar, 'GET', '/api/members');
  const memberRows = (res.data && res.data.members) || [];
  const self = memberRows.find((m) => m.nickname === 'FlowTester');
  check('accepted user can read the members list', res.status === 200 && memberRows.length >= 1, `status ${res.status}`);
  check('member row exposes only a manual status', Boolean(self) && ['online', 'offline', 'afk', 'ingame'].includes(self.manual_status));

  res = await api(userA.jar, 'GET', '/api/roles');
  check(
    'roles statistics are available to members',
    res.status === 200 && Array.isArray(res.data && res.data.roles) && res.data.roles.length === 5,
    JSON.stringify(res.data && Object.keys(res.data))
  );

  res = await api(userA.jar, 'PATCH', '/api/me', { bio: 'Тестовый профиль', show_discord: false });
  check(
    'member can edit their profile',
    res.status === 200 && res.data && res.data.user && res.data.user.bio === 'Тестовый профиль',
    `status ${res.status}`
  );

  /* ---- chat ---- */
  res = await api(userA.jar, 'POST', '/api/chat/messages', { body: 'Привет, клан! Я с вайпа.' });
  const msg = res.data && (res.data.message || res.data);
  check('member can post a chat message', res.status === 201 && Boolean(msg && msg.id), JSON.stringify(res.data));

  res = await api(userA.jar, 'GET', '/api/chat/messages');
  const messages = (res.data && res.data.messages) || [];
  check('message is persisted and returned to members', messages.some((m) => m.id === msg.id));

  res = await api(userA.jar, 'POST', `/api/chat/messages/${msg.id}/report`, { reason: 'Проверка жалобы' });
  check('member cannot report their own message (400)', res.status === 400, `status ${res.status}`);

  res = await api(mod.jar, 'POST', `/api/chat/messages/${msg.id}/report`, { reason: 'Проверка жалобы' });
  check('another member can report a message (201)', res.status === 201, `status ${res.status}`);

  res = await api(owner, 'GET', '/api/admin/chat');
  check(
    'owner sees chat and open reports in moderation',
    res.status === 200 && JSON.stringify(res.data).includes('Проверка жалобы'),
    `status ${res.status}`
  );

  res = await api(owner, 'POST', `/api/admin/chat/${msg.id}/delete`, { reason: 'moderation-test' });
  check('owner can delete a message as moderation', [200, 204].includes(res.status), `status ${res.status}`);

  res = await api(userA.jar, 'GET', '/api/chat/messages');
  const afterDelete = ((res.data && res.data.messages) || []).find((m) => m.id === msg.id);
  check(
    'deleted message body is hidden from members (soft delete)',
    Boolean(afterDelete) && afterDelete.deleted === true && afterDelete.body === null,
    JSON.stringify(afterDelete)
  );

  /* ---- exception application ---- */
  res = await api(
    userB.jar,
    'POST',
    '/api/applications',
    {
      ...APPLICATION,
      nickname: 'RookieFlow',
      rust_nick: 'RookieFlow',
      hours_range: 'under700',
      specialization: 'farmer',
      extra_roles: [],
      exception_why: 'Меньше 700 часов, но играю стабильно и быстро учусь.',
      exception_skills: 'Фарм, логистика, быстрый крафт.',
      exception_clan_experience: 'Без опыта в кланах, но играю ежедневно.',
      exception_useful: 'Могу закрывать фарм и обеспечивать состав ресурсами.',
      extra_skills: 'Фарм и логистика.',
    }
  );
  const exceptionOk = res.status === 201;
  check('sub-700-hours application is accepted as an exception', exceptionOk, `status ${res.status} ${JSON.stringify(res.data)}`);

  res = await api(owner, 'GET', '/api/admin/applications?status=pending&hours=under700&exception=only');
  const exceptions = (res.data && res.data.applications) || [];
  const rookie = exceptions.find((app) => app.nickname === 'RookieFlow');
  check('exception application is highlighted by the admin filter', Boolean(rookie) && Boolean(rookie.is_exception || rookie.hours_range === 'under700'));

  res = await api(owner, 'POST', `/api/admin/applications/${rookie.id}/decision`, { action: 'request_info' });
  check('request-info without a comment is rejected (400)', res.status === 400, `status ${res.status}`);

  res = await api(owner, 'POST', `/api/admin/applications/${rookie.id}/decision`, {
    action: 'request_info',
    note: 'Пришлите ссылку на Steam-профиль для ручной проверки часов.',
  });
  check('owner can request additional information', res.status === 200, JSON.stringify(res.data));

  res = await api(userB.jar, 'GET', '/api/applications/me');
  check(
    'applicant is notified about the information request',
    res.data && res.data.application && ['info_requested', 'info'].includes(res.data.application.status),
    JSON.stringify(res.data && res.data.application && res.data.application.status)
  );

  /* ---- owner settings propagate instantly ---- */
  res = await api(owner, 'PATCH', '/api/admin/settings', {
    discord_invite: 'https://discord.gg/killi-flow',
    discord_exception_invite: 'https://discord.gg/killi-exceptions',
    clan_description: 'Проверка мгновенного применения настроек.',
  });
  check('owner can save Discord links and clan description', res.status === 200, JSON.stringify(res.data));

  res = await api(guest, 'GET', '/api/site');
  check('saved Discord link is served to the public site immediately', res.data && res.data.settings && res.data.settings.discord_invite === 'https://discord.gg/killi-flow');
  check('exception Discord link is served too', res.data && res.data.settings && res.data.settings.discord_exception_invite === 'https://discord.gg/killi-exceptions');

  res = await api(owner, 'PATCH', '/api/admin/settings', { discord_invite: 'not-a-link' });
  check('invalid Discord link is rejected (400)', res.status === 400, `status ${res.status}`);

  /* ---- downloads: draft → publish → member-only download ---- */
  const upload = new FormData();
  upload.append('title', 'Flow Rules Pack');
  upload.append('description', 'Правила клана для проверки загрузок.');
  upload.append('version', '1.2.3');
  upload.append('category', 'clan');
  upload.append('status', 'draft');
  upload.append('file', new Blob([Buffer.from('flow-rules-payload')], { type: 'text/plain' }), 'rules.txt');

  res = await api(owner, 'POST', '/api/admin/downloads', upload);
  const downloadId = res.data && res.data.id;
  check('owner uploads a draft file', res.status === 201 && Boolean(downloadId), JSON.stringify(res.data));

  res = await api(guest, 'GET', '/api/downloads');
  check('draft file is hidden from visitors', !((res.data && res.data.downloads) || []).some((d) => d.title === 'Flow Rules Pack'));

  res = await api(userA.jar, 'GET', '/api/downloads');
  check('draft file is hidden from members too', !((res.data && res.data.downloads) || []).some((d) => d.title === 'Flow Rules Pack'));

  res = await api(owner, 'PATCH', `/api/admin/downloads/${downloadId}`, { status: 'published' });
  check('owner publishes the file', res.status === 200, JSON.stringify(res.data));

  res = await api(guest, 'GET', '/api/downloads');
  const published = ((res.data && res.data.downloads) || []).find((d) => d.title === 'Flow Rules Pack');
  check('published file appears on the downloads page', Boolean(published));
  check('visitor cannot download clan files', Boolean(published) && published.can_download === false);

  res = await api(guest, 'GET', `/api/downloads/${downloadId}/file`);
  check('guest download request is blocked (401/403)', [401, 403].includes(res.status), `status ${res.status}`);

  res = await api(userA.jar, 'GET', `/api/downloads/${downloadId}/file`);
  check('member downloads the published file', res.status === 200 && String(res.data).includes('flow-rules-payload'), `status ${res.status}`);

  res = await api(owner, 'PATCH', `/api/admin/downloads/${downloadId}`, { status: 'draft' });
  res = await api(guest, 'GET', '/api/downloads');
  check('unpublished file disappears again', !((res.data && res.data.downloads) || []).some((d) => d.title === 'Flow Rules Pack'));

  /* ---- app releases ---- */
  const release = new FormData();
  release.append('version', '9.9.9-flow');
  release.append('changelog', 'Проверочный релиз.');
  release.append('status', 'draft');
  release.append('file', new Blob([Buffer.from('killi-app-payload')], { type: 'application/octet-stream' }), 'killi.exe');

  res = await api(owner, 'POST', '/api/admin/app-releases', release);
  const releaseId = res.data && res.data.id;
  check('owner uploads a draft app release', res.status === 201 && Boolean(releaseId), JSON.stringify(res.data));

  res = await api(guest, 'GET', '/api/app');
  const draftLatest = res.data && res.data.app && res.data.app.latest;
  check('draft release is not shown as the current version', !draftLatest || draftLatest.version !== '9.9.9-flow');

  res = await api(owner, 'POST', `/api/admin/app-releases/${releaseId}/publish`);
  check('owner publishes the release', res.status === 200, JSON.stringify(res.data));

  res = await api(guest, 'GET', '/api/app');
  const latest = res.data && res.data.app && res.data.app.latest;
  check('published release becomes the current version', Boolean(latest) && latest.version === '9.9.9-flow');
  check('visitor sees the download disabled', Boolean(latest) && latest.can_download === false);

  res = await api(guest, 'GET', '/api/app/download');
  check('guest cannot download the app (401/403)', [401, 403].includes(res.status), `status ${res.status}`);

  res = await api(userA.jar, 'GET', '/api/app/download');
  check('member downloads the current app build', res.status === 200 && String(res.data).includes('killi-app-payload'), `status ${res.status}`);

  res = await api(guest, 'GET', '/api/app');
  check('app page never promises guaranteed cheat detection', !/все читы|гарантированн/i.test(JSON.stringify(res.data)));

  /* ---- news ---- */
  res = await api(owner, 'POST', '/api/admin/news', { title: 'Вайп в пятницу', body: 'Собираемся в 18:00 по МСК.', pinned: true });
  const newsId = res.data && res.data.id;
  check('owner publishes a news post', res.status === 201 && Boolean(newsId), JSON.stringify(res.data));

  res = await api(guest, 'GET', '/api/news');
  check('news appears on the public site', res.status === 200 && JSON.stringify(res.data).includes('Вайп в пятницу'));

  /* ---- member management: restrict / exclude / restore ---- */
  res = await api(owner, 'PATCH', `/api/admin/members/${userA.id}`, { clan_status: 'restricted' });
  check('owner can restrict a member', res.status === 200, JSON.stringify(res.data));

  res = await api(userA.jar, 'GET', '/api/members');
  check('restricted member loses member pages (403)', res.status === 403, `status ${res.status}`);

  res = await api(userA.jar, 'POST', '/api/chat/messages', { body: 'Должно быть заблокировано' });
  check('restricted member cannot post in chat (403)', res.status === 403, `status ${res.status}`);

  res = await api(owner, 'PATCH', `/api/admin/members/${userA.id}`, { clan_status: 'active' });
  res = await api(userA.jar, 'GET', '/api/members');
  check('access returns after the restriction is lifted', res.status === 200, `status ${res.status}`);

  res = await api(owner, 'PATCH', `/api/admin/members/${userA.id}`, { role: 'moderator' });
  check('owner can grant moderator rights', res.status === 200, JSON.stringify(res.data));

  res = await api(userA.jar, 'GET', '/api/admin/overview');
  check('moderator still has no owner admin access (401)', res.status === 401, `status ${res.status}`);

  /* ---- session lifecycle ---- */
  res = await api(owner, 'POST', '/api/owner/logout');
  check('owner can log out', [200, 204].includes(res.status), `status ${res.status}`);
  res = await api(owner, 'GET', '/api/admin/overview');
  check('admin session is invalid after logout (401)', res.status === 401, `status ${res.status}`);

  const beforeLogout = await api(userB.jar, 'GET', '/api/applications/me');
  check('user session works before logout', beforeLogout.status === 200);
  res = await api(userB.jar, 'POST', '/auth/logout');
  check('user can log out', [200, 204].includes(res.status), `status ${res.status}`);
  res = await api(userB.jar, 'GET', '/api/applications/me');
  check('user session is invalid after logout (401)', res.status === 401, `status ${res.status}`);

  if (/Error|UnhandledPromiseRejection/.test(serverLog) && /throw|at Object/.test(serverLog)) {
    console.log(`\n--- server log ---\n${serverLog.slice(-2000)}`);
  }

  await ownerCredentialLifecycle();
}

/* --------------------- owner credential lifecycle ------------------------ */
/*
 * Отдельная фаза: сервер поднимается заново на уже существующей БД без
 * переменных окружения. Это доказывает, что хеши в базе пережили рестарт,
 * что старые пароли мертвы, что смена первого и второго пароля независима и
 * что KILLI_OWNER_PASSWORD_1/2 переопределяют креденшелы при старте.
 */

async function loginOwner(jar) {
  const first = await api(jar, 'POST', '/api/owner/login', { password: OWNER_PASS_1, ...arguments[1] });
  return first;
}

async function ownerCredentialLifecycle() {
  /* ---- 1. рестарт на существующей БД: новые хеши сохранились ---- */
  await stopChild();
  await startServer();

  const owner = {};
  let res = await api(owner, 'POST', '/api/owner/login', { password: OWNER_PASS_1 });
  check('restart: new first password still works on the existing database', res.status === 200 && res.data && res.data.step === 2, `status ${res.status}`);

  res = await api(owner, 'POST', '/api/owner/verify', { password: OWNER_PASS_2 });
  check('restart: new second password completes the login', res.status === 200, `status ${res.status}`);

  res = await api(owner, 'GET', '/api/admin/overview');
  check('restart: admin panel data is served to the owner', res.status === 200 && Boolean(res.data), `status ${res.status}`);

  const legacyJar = {};
  res = await api(legacyJar, 'POST', '/api/owner/login', { password: LEGACY_PASS_1 });
  check('restart: legacy first password is rejected after rotation (401)', res.status === 401, `status ${res.status}`);

  /* ---- 2. прямой вход в админ-API без сессии ---- */
  const anon = {};
  res = await api(anon, 'GET', '/api/admin/overview');
  check('direct admin API call without an owner session returns 401', res.status === 401, `status ${res.status}`);
  res = await api(anon, 'GET', '/api/admin/applications');
  check('direct applications API call returns no data (401)', res.status === 401, `status ${res.status}`);
  res = await api(anon, 'GET', '/api/owner/security/audit');
  check('direct security audit call returns no data (401)', res.status === 401, `status ${res.status}`);

  /* ---- 3. независимая смена паролей ---- */
  res = await api(owner, 'POST', '/api/owner/security/password', {
    which: 'first',
    current: OWNER_PASS_2,
    value: ROTATED_PASS_1,
  });
  check('changing the first password requires the current first password (401)', res.status === 401, `status ${res.status}`);

  res = await api(owner, 'POST', '/api/owner/security/password', {
    which: 'third',
    current: OWNER_PASS_1,
    value: ROTATED_PASS_1,
  });
  check('unknown password slot is rejected (400)', res.status === 400, `status ${res.status}`);

  res = await api(owner, 'POST', '/api/owner/security/password', {
    which: 'first',
    current: OWNER_PASS_1,
    value: OWNER_PASS_2,
  });
  check('a password identical to the other one is rejected (400)', res.status === 400, `status ${res.status}`);

  res = await api(owner, 'POST', '/api/owner/security/password', {
    which: 'first',
    current: OWNER_PASS_1,
    value: 'short',
  });
  check('too short password is rejected (400)', res.status === 400, `status ${res.status}`);

  res = await api(owner, 'POST', '/api/owner/security/password', {
    which: 'first',
    current: OWNER_PASS_1,
    value: ROTATED_PASS_1,
  });
  check('owner can change the first password on its own', res.status === 200, JSON.stringify(res.data));

  const afterFirst = {};
  res = await api(afterFirst, 'POST', '/api/owner/login', { password: OWNER_PASS_1 });
  check('the replaced first password stops working immediately (401)', res.status === 401, `status ${res.status}`);

  res = await api(afterFirst, 'POST', '/api/owner/login', { password: ROTATED_PASS_1 });
  check('the new first password is accepted', res.status === 200 && res.data && res.data.step === 2, `status ${res.status}`);
  res = await api(afterFirst, 'POST', '/api/owner/verify', { password: OWNER_PASS_2 });
  check('the second password is untouched by the first password change', res.status === 200, `status ${res.status}`);

  res = await api(afterFirst, 'POST', '/api/owner/security/password', {
    which: 'second',
    current: OWNER_PASS_2,
    value: ROTATED_PASS_2,
  });
  check('owner can change the second password on its own', res.status === 200, JSON.stringify(res.data));

  const brokenSecond = {};
  res = await api(brokenSecond, 'POST', '/api/owner/login', { password: ROTATED_PASS_1 });
  check('first password still works after the second password change', res.status === 200, `status ${res.status}`);
  res = await api(brokenSecond, 'POST', '/api/owner/verify', { password: OWNER_PASS_2 });
  check('the replaced second password stops working immediately (401)', res.status === 401, `status ${res.status}`);

  const rotated = {};
  res = await api(rotated, 'POST', '/api/owner/login', { password: ROTATED_PASS_1 });
  check('rotated credentials: first step passes', res.status === 200 && res.data && res.data.step === 2, `status ${res.status}`);
  res = await api(rotated, 'POST', '/api/owner/verify', { password: ROTATED_PASS_2 });
  check('rotated credentials: login completes with the rotated pair', res.status === 200, `status ${res.status}`);

  /* ---- 4. ротация и переопределение через переменные окружения ---- */
  await stopChild();
  await startServer();
  const persisted = {};
  res = await api(persisted, 'POST', '/api/owner/login', { password: ROTATED_PASS_1 });
  check('rotated passwords survive a server restart', res.status === 200, `status ${res.status}`);
  res = await api(persisted, 'POST', '/api/owner/verify', { password: ROTATED_PASS_2 });
  check('rotated pair completes login after restart', res.status === 200, `status ${res.status}`);

  await stopChild();
  await startServer({
    KILLI_OWNER_PASSWORD_1: ENV_PASS_1,
    KILLI_OWNER_PASSWORD_2: ENV_PASS_2,
  });
  const envJar = {};
  res = await api(envJar, 'POST', '/api/owner/login', { password: ROTATED_PASS_1 });
  check('env override retires the previous database password (401)', res.status === 401, `status ${res.status}`);
  res = await api(envJar, 'POST', '/api/owner/login', { password: ENV_PASS_1 });
  check('KILLI_OWNER_PASSWORD_1 is accepted after the restart', res.status === 200 && res.data && res.data.step === 2, `status ${res.status}`);
  res = await api(envJar, 'POST', '/api/owner/verify', { password: ENV_PASS_2 });
  check('KILLI_OWNER_PASSWORD_2 completes the login', res.status === 200, `status ${res.status}`);

  /* ---- 5. паролей нет в клиентском коде ---- */
  const publicDir = path.join(__dirname, '..', 'public');
  const secretStrings = [OWNER_PASS_1, OWNER_PASS_2, LEGACY_PASS_1, LEGACY_PASS_2, ROTATED_PASS_1, ENV_PASS_1];
  const clientFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js|mjs|css|json|map)$/.test(entry.name)) clientFiles.push(full);
    }
  };
  walk(publicDir);
  const offenders = clientFiles.filter((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return secretStrings.some((secret) => text.includes(secret)) || /scrypt\$\d+\$/.test(text);
  });
  check(
    'no owner password or password hash is shipped to the browser',
    clientFiles.length > 0 && offenders.length === 0,
    offenders.map((file) => path.relative(publicDir, file)).join(', ')
  );

  await stopChild();
}

run()
  .then(() => {
    stopServer();
    if (failures.length) {
      console.error(`\n✗ flow check failed — ${failures.length} of ${passed + failures.length} assertions failed`);
      for (const name of failures) console.error(`  - ${name}`);
      process.exit(1);
    }
    console.log(`\n✓ flow check passed — ${passed} assertions (apply → accept → chat/members/downloads, admin + settings + moderation)`);
    process.exit(0);
  })
  .catch((err) => {
    stopServer();
    console.error(`\n✗ flow check crashed — ${err && err.stack ? err.stack : err}`);
    if (serverLog) console.error(`\n--- server log ---\n${serverLog.slice(-3000)}`);
    process.exit(1);
  });
