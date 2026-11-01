'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const { db, getSettings, updateSettings, DEFAULT_SETTINGS, getAdminCreds, updateAdminCreds, createAdminSession, nowIso } = require('../db');
const {
  generateTotpSecret,
  verifyTotp,
  otpauthUri,
  hashPassword,
  verifyPassword,
  randomToken,
  setCookie,
  clearCookie,
  sha256,
  rateLimit,
  resetRateLimit,
} = require('../security');
const { UPLOAD_DIR } = require('../config');
const {
  ADMIN_COOKIE,
  requireOwner,
  serializeUser,
  SPECIALIZATIONS,
  HOUR_RANGES,
  parseJson,
  hasMemberAccess,
} = require('../helpers');
const { fileSizeLabel, presence } = require('./api.routes');

const router = express.Router();

/* ------------------------------ owner auth ------------------------------ */

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

function lockedUntil(creds) {
  if (!creds.locked_until) return null;
  const ts = new Date(creds.locked_until).getTime();
  return ts > Date.now() ? new Date(ts) : null;
}

function registerFailure(reason, req) {
  const creds = getAdminCreds();
  const failed = (creds.failed_count || 0) + 1;
  const patch = { failed_count: failed };
  if (failed >= MAX_ATTEMPTS) {
    patch.locked_until = new Date(Date.now() + LOCK_MS).toISOString();
    patch.failed_count = 0;
  }
  updateAdminCreds(patch);
  db.prepare('INSERT INTO login_audit (kind, ok, ip, detail, created_at) VALUES (?, 0, ?, ?, ?)').run(
    'owner',
    req.ip || '',
    reason,
    nowIso()
  );
  return getAdminCreds();
}

router.get('/owner/status', (req, res) => {
  const creds = getAdminCreds();
  const lock = lockedUntil(creds);
  const pendingToken = req.cookies[ADMIN_COOKIE];
  let pending = false;
  if (pendingToken && !req.admin) {
    pending = Boolean(
      db
        .prepare('SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
        .get(sha256(pendingToken), nowIso())
    );
  }
  res.json({
    authed: Boolean(req.admin),
    pending,
    must_change: Boolean(creds.must_change),
    totp_enabled: Boolean(creds.totp_enabled),
    // Внутренние детали блокировки наружу не отдаём: серверная защита от
    // перебора работает, но посетитель не видит ни таймера, ни счётчика.
    last_login: creds.last_login,
  });
});

router.post('/owner/login', (req, res) => {
  const creds = getAdminCreds();
  const lock = lockedUntil(creds);
  if (lock) {
    return res.status(423).json({
      error: 'locked',
      message: `Вход временно заблокирован до ${lock.toLocaleTimeString('ru-RU')}.`,
      locked_until: lock.toISOString(),
    });
  }
  const limiter = rateLimit(`owner:${req.ip}`, { limit: 8, windowMs: 10 * 60 * 1000 });
  if (!limiter.allowed) {
    return res.status(429).json({ error: 'rate_limited', message: 'Слишком много попыток. Попробуйте позже.' });
  }
  const password = String((req.body && req.body.password) || '');
  if (!verifyPassword(password, creds.pass1_hash)) {
    const updated = registerFailure('step1 failed', req);
    const nowLocked = lockedUntil(updated);
    return res.status(401).json({
      error: 'bad_password',
      message: nowLocked
        ? `Неверный пароль. Вход заблокирован до ${nowLocked.toLocaleTimeString('ru-RU')}.`
        : `Неверный пароль. Осталось попыток: ${Math.max(0, MAX_ATTEMPTS - (updated.failed_count || 0))}.`,
      attempts_left: Math.max(0, MAX_ATTEMPTS - (updated.failed_count || 0)),
    });
  }
  const { token } = createAdminSession({ ip: req.ip, ua: req.headers['user-agent'], pending: true });
  setCookie(res, ADMIN_COOKIE, token, { maxAge: 1000 * 60 * 10, secure: req.secure, sameSite: 'Strict' });
  res.json({ ok: true, step: 2, totp_enabled: Boolean(creds.totp_enabled) });
});

router.post('/owner/verify', (req, res) => {
  const token = req.cookies[ADMIN_COOKIE];
  if (!token) return res.status(401).json({ error: 'no_step', message: 'Начните вход заново.' });
  const session = db
    .prepare('SELECT * FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(sha256(token), nowIso());
  if (!session) return res.status(401).json({ error: 'no_step', message: 'Сессия истекла, начните заново.' });

  const creds = getAdminCreds();
  const lock = lockedUntil(creds);
  if (lock) {
    return res.status(423).json({ error: 'locked', message: 'Вход временно заблокирован.' });
  }
  const password = String((req.body && req.body.password) || '');
  const code = String((req.body && req.body.code) || '').trim();

  if (!verifyPassword(password, creds.pass2_hash)) {
    const updated = registerFailure('step2 failed', req);
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
    clearCookie(res, ADMIN_COOKIE);
    const nowLocked = lockedUntil(updated);
    return res.status(401).json({
      error: 'bad_password',
      message: nowLocked
        ? `Неверный второй пароль. Вход заблокирован до ${nowLocked.toLocaleTimeString('ru-RU')}.`
        : 'Неверный второй пароль. Начните вход заново.',
    });
  }
  if (creds.totp_enabled) {
    if (!verifyTotp(creds.totp_secret, code)) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
      clearCookie(res, ADMIN_COOKIE);
      registerFailure('totp failed', req);
      return res.status(401).json({ error: 'bad_totp', message: 'Неверный код двухфакторной аутентификации.' });
    }
  }

  db.prepare('UPDATE admin_sessions SET pending_auth = 0, expires_at = ? WHERE token_hash = ?').run(
    new Date(Date.now() + 1000 * 60 * 60 * 8).toISOString(),
    sha256(token)
  );
  updateAdminCreds({ failed_count: 0, locked_until: null, last_login: nowIso() });
  db.prepare('INSERT INTO login_audit (kind, ok, ip, detail, created_at) VALUES (?, 1, ?, ?, ?)').run(
    'owner',
    req.ip || '',
    'success',
    nowIso()
  );
  res.json({ ok: true, must_change: Boolean(creds.must_change) });
});

router.post('/owner/logout', (req, res) => {
  const token = req.cookies[ADMIN_COOKIE];
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
  clearCookie(res, ADMIN_COOKIE);
  res.json({ ok: true });
});

router.post('/owner/security/bootstrap', requireOwner, (req, res) => {
  const creds = getAdminCreds();
  if (!creds.must_change) {
    return res.status(409).json({ error: 'already_set', message: 'Пароли уже изменены.' });
  }
  const first = String((req.body && req.body.pass1) || '');
  const second = String((req.body && req.body.pass2) || '');
  if (first.length < 10 || second.length < 10) {
    return res.status(400).json({ error: 'weak', message: 'Каждый пароль должен содержать минимум 10 символов.' });
  }
  if (first === second) {
    return res.status(400).json({ error: 'same', message: 'Пароли должны отличаться друг от друга.' });
  }
  updateAdminCreds({ pass1_hash: hashPassword(first), pass2_hash: hashPassword(second), must_change: 0 });
  res.json({ ok: true, message: 'Пароли обновлены.' });
});

router.post('/owner/security/password', requireOwner, (req, res) => {
  const creds = getAdminCreds();
  const which = req.body && req.body.which;
  if (!['first', 'second'].includes(which)) {
    return res.status(400).json({ error: 'bad_request', message: 'Укажите, какой пароль меняется.' });
  }
  if (!verifyPassword(String((req.body && req.body.current) || ''), creds.pass1_hash)) {
    return res.status(401).json({ error: 'bad_current', message: 'Неверный текущий первый пароль.' });
  }
  if (creds.totp_enabled && !verifyTotp(creds.totp_secret, req.body && req.body.code)) {
    return res.status(401).json({ error: 'bad_totp', message: 'Неверный код 2FA.' });
  }
  const value = String((req.body && req.body.value) || '');
  if (value.length < 10) return res.status(400).json({ error: 'weak', message: 'Минимум 10 символов.' });
  updateAdminCreds(which === 'first' ? { pass1_hash: hashPassword(value) } : { pass2_hash: hashPassword(value) });
  res.json({ ok: true, message: 'Пароль обновлён.' });
});

router.post('/owner/security/totp/setup', requireOwner, async (req, res) => {
  const creds = getAdminCreds();
  if (creds.totp_enabled) {
    return res.status(409).json({ error: 'enabled', message: '2FA уже включена.' });
  }
  const secret = generateTotpSecret();
  updateAdminCreds({ totp_secret: secret, totp_enabled: 0 });
  const uri = otpauthUri(secret, 'owner', getSettings().site_name);
  try {
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, color: { dark: '#111111', light: '#ffffff' } });
    res.json({ ok: true, secret, uri, qr });
  } catch {
    res.json({ ok: true, secret, uri, qr: null });
  }
});

router.post('/owner/security/totp/enable', requireOwner, (req, res) => {
  const creds = getAdminCreds();
  if (!creds.totp_secret) return res.status(400).json({ error: 'no_secret', message: 'Сначала создайте секрет.' });
  if (!verifyTotp(creds.totp_secret, req.body && req.body.code)) {
    return res.status(401).json({ error: 'bad_totp', message: 'Неверный код. Проверьте время на устройстве.' });
  }
  updateAdminCreds({ totp_enabled: 1 });
  res.json({ ok: true, message: 'Двухфакторная аутентификация включена.' });
});

router.post('/owner/security/totp/disable', requireOwner, (req, res) => {
  const creds = getAdminCreds();
  if (!verifyPassword(String((req.body && req.body.password) || ''), creds.pass1_hash)) {
    return res.status(401).json({ error: 'bad_current', message: 'Неверный первый пароль.' });
  }
  updateAdminCreds({ totp_enabled: 0, totp_secret: null });
  res.json({ ok: true, message: '2FA отключена.' });
});

router.get('/owner/security/audit', requireOwner, (req, res) => {
  const rows = db.prepare('SELECT * FROM login_audit ORDER BY id DESC LIMIT 60').all();
  const sessions = db
    .prepare('SELECT token_hash, created_at, expires_at, ip, pending_auth FROM admin_sessions ORDER BY created_at DESC')
    .all()
    .map((s) => ({ ...s, token_hash: `${s.token_hash.slice(0, 8)}…`, current: false }));
  res.json({
    audit: rows,
    sessions,
    credentials: {
      must_change: Boolean(getAdminCreds().must_change),
      totp_enabled: Boolean(getAdminCreds().totp_enabled),
      last_login: getAdminCreds().last_login,
    },
  });
});

router.post('/owner/security/revoke-sessions', requireOwner, (req, res) => {
  db.prepare('DELETE FROM admin_sessions').run();
  clearCookie(res, ADMIN_COOKIE);
  res.json({ ok: true, message: 'Все сессии владельца завершены.' });
});

/* ------------------------------- uploads -------------------------------- */

const settingsNow = () => getSettings();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${randomToken(8)}${ext}`);
  },
});

function allowedExts() {
  return settingsNow()
    .upload_ext.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const upload = multer({
  storage,
  limits: { fileSize: Math.max(1, Number(settingsNow().upload_max_mb) || 200) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExts().includes(ext)) return cb(new Error(`extension ${ext} не разрешено`));
    cb(null, true);
  },
});

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, 'media');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(path.extname(file.originalname || '').toLowerCase())
      ? path.extname(file.originalname).toLowerCase()
      : '.png';
    cb(null, `${Date.now()}-${randomToken(6)}${ext}`);
  },
});
const uploadMedia = multer({
  storage: mediaStorage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(path.extname(file.originalname || '').toLowerCase());
    cb(ok ? null : new Error('только изображения'), ok);
  },
});

function handleUpload(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: 'upload_failed',
          message: `Не удалось загрузить файл: ${err.message}`,
        });
      }
      next();
    });
  };
}

function removeStored(stored) {
  if (!stored) return;
  const full = path.join(UPLOAD_DIR, path.basename(String(stored)));
  if (full.startsWith(UPLOAD_DIR) && fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------ overview -------------------------------- */

router.get('/admin/overview', requireOwner, (req, res) => {
  const count = (sql, ...params) => db.prepare(sql).get(...params).c;
  const members = db
    .prepare("SELECT * FROM users WHERE role IN ('member','moderator') AND clan_status != 'excluded'")
    .all();
  const specCounts = SPECIALIZATIONS.reduce((acc, key) => {
    acc[key] = members.filter((m) => m.specialization === key).length;
    return acc;
  }, {});
  res.json({
    stats: {
      users: count('SELECT COUNT(*) AS c FROM users'),
      members: members.length,
      moderators: members.filter((m) => m.role === 'moderator').length,
      restricted: members.filter((m) => m.clan_status === 'restricted').length,
      online: members.filter((m) => m.last_seen && Date.now() - new Date(m.last_seen).getTime() < 5 * 60 * 1000).length,
      pending: count("SELECT COUNT(*) AS c FROM applications WHERE status = 'pending'"),
      exceptions: count("SELECT COUNT(*) AS c FROM applications WHERE is_exception = 1 AND status = 'pending'"),
      accepted: count("SELECT COUNT(*) AS c FROM applications WHERE status = 'accepted'"),
      rejected: count("SELECT COUNT(*) AS c FROM applications WHERE status = 'rejected'"),
      downloads: count('SELECT COUNT(*) AS c FROM downloads'),
      publishedDownloads: count("SELECT COUNT(*) AS c FROM downloads WHERE status = 'published'"),
      messages: count('SELECT COUNT(*) AS c FROM messages WHERE deleted_at IS NULL'),
      reports: count("SELECT COUNT(*) AS c FROM message_reports WHERE status = 'open'"),
      releases: count('SELECT COUNT(*) AS c FROM app_releases'),
    },
    specializations: specCounts,
    recentApplications: db
      .prepare('SELECT * FROM applications ORDER BY id DESC LIMIT 6')
      .all()
      .map((a) => ({
        id: a.id,
        nickname: a.nickname,
        specialization: a.specialization,
        hours_range: a.hours_range,
        is_exception: Boolean(a.is_exception),
        status: a.status,
        created_at: a.created_at,
      })),
    recentAudit: db.prepare('SELECT * FROM login_audit ORDER BY id DESC LIMIT 8').all(),
    pendingReports: db
      .prepare(
        `SELECT r.*, m.body AS message_body, u.nickname AS author
         FROM message_reports r JOIN messages m ON m.id = r.message_id JOIN users u ON u.id = m.user_id
         WHERE r.status = 'open' ORDER BY r.id DESC LIMIT 10`
      )
      .all(),
  });
});

/* --------------------------- applications ------------------------------- */

function applicationFull(row) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  return {
    id: row.id,
    user_id: row.user_id,
    nickname: row.nickname,
    rust_nick: row.rust_nick,
    steam_link: row.steam_link,
    discord_link: row.discord_link,
    hours_range: row.hours_range,
    is_exception: Boolean(row.is_exception),
    specialization: row.specialization,
    extra_roles: parseJson(row.extra_roles, []),
    play_time: row.play_time,
    game_modes: parseJson(row.game_modes, []),
    clan_experience: row.clan_experience,
    has_mic: row.has_mic,
    timezone: row.timezone,
    extra_skills: row.extra_skills,
    why_join: row.why_join,
    extra_info: row.extra_info,
    exception_why: row.exception_why,
    exception_skills: row.exception_skills,
    exception_clan_experience: row.exception_clan_experience,
    exception_useful: row.exception_useful,
    status: row.status,
    admin_note: row.admin_note,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    user: user ? serializeUser(user, user) : null,
  };
}

router.get('/admin/applications', requireOwner, (req, res) => {
  const status = String(req.query.status || 'pending');
  const spec = String(req.query.spec || '');
  const hours = String(req.query.hours || '');
  const exception = String(req.query.exception || '');
  const q = String(req.query.q || '').toLowerCase().trim();

  let rows = db.prepare('SELECT * FROM applications ORDER BY id DESC').all();
  rows = rows.filter((row) => {
    if (status !== 'all' && row.status !== status) return false;
    if (spec && spec !== 'all') {
      const extras = parseJson(row.extra_roles, []);
      if (row.specialization !== spec && !extras.includes(spec)) return false;
    }
    if (hours === 'over700' && row.hours_range === 'under700') return false;
    if (hours === 'under700' && row.hours_range !== 'under700') return false;
    if (exception === 'only' && !row.is_exception) return false;
    if (exception === 'exclude' && row.is_exception) return false;
    if (q && !String(row.nickname || '').toLowerCase().includes(q)) return false;
    return true;
  });
  const counts = db.prepare('SELECT status, COUNT(*) AS c FROM applications GROUP BY status').all();
  res.json({
    applications: rows.map(applicationFull),
    counts: counts.reduce((acc, row) => ({ ...acc, [row.status]: row.c }), {}),
    total: rows.length,
  });
});

router.get('/admin/applications/:id', requireOwner, (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ application: applicationFull(row) });
});

router.post('/admin/applications/:id/decision', requireOwner, (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found', message: 'Заявка не найдена.' });
  const action = String((req.body && req.body.action) || '');
  const note = String((req.body && req.body.note) || '').slice(0, 1000);
  const now = nowIso();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user) return res.status(404).json({ error: 'user_missing' });

  if (action === 'accept') {
    const tx = db.transaction(() => {
      db.prepare("UPDATE applications SET status = 'accepted', admin_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?").run(
        note || null,
        now,
        'owner',
        row.id
      );
      db.prepare(
        `UPDATE users SET role = 'member', clan_status = 'active', specialization = ?, extra_roles = ?,
          rust_hours = ?, rust_nick = COALESCE(?, rust_nick), member_since = COALESCE(member_since, ?), updated_at = ?
         WHERE id = ?`
      ).run(
        row.specialization,
        row.extra_roles || '[]',
        row.hours_range,
        row.rust_nick,
        now,
        now,
        user.id
      );
    });
    tx();
    return res.json({ ok: true, message: `${row.nickname} принят в клан.` });
  }
  if (action === 'reject') {
    db.prepare("UPDATE applications SET status = 'rejected', admin_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?").run(
      note || null,
      now,
      'owner',
      row.id
    );
    return res.json({ ok: true, message: 'Заявка отклонена.' });
  }
  if (action === 'request_info') {
    if (note.length < 5) {
      return res.status(400).json({ error: 'note_required', message: 'Опишите, что нужно уточнить у игрока.' });
    }
    db.prepare("UPDATE applications SET status = 'info_requested', admin_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?").run(
      note,
      now,
      'owner',
      row.id
    );
    return res.json({ ok: true, message: 'Запрошена дополнительная информация.' });
  }
  res.status(400).json({ error: 'bad_action', message: 'Неизвестное действие.' });
});

/* ------------------------------ members --------------------------------- */

router.get('/admin/members', requireOwner, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const spec = String(req.query.spec || '');
  const rows = db.prepare('SELECT * FROM users ORDER BY id DESC').all();
  let list = rows.map((row) => ({
    ...serializeUser(row, row),
    email: null,
    status: presence(row),
    ip_hint: null,
  }));
  if (q) {
    list = list.filter(
      (m) => m.nickname.toLowerCase().includes(q) || String(m.steam?.id || '').includes(q)
    );
  }
  if (spec && spec !== 'all') list = list.filter((m) => m.specialization === spec);
  const members = rows.filter((r) => ['member', 'moderator'].includes(r.role) && r.clan_status !== 'excluded');
  res.json({
    members: list,
    stats: {
      total: members.length,
      ...SPECIALIZATIONS.reduce((acc, key) => {
        acc[key] = members.filter((m) => m.specialization === key).length;
        return acc;
      }, {}),
      moderators: members.filter((m) => m.role === 'moderator').length,
      restricted: members.filter((m) => m.clan_status === 'restricted').length,
    },
  });
});

router.patch('/admin/members/:id', requireOwner, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'Игрок не найден.' });
  const body = req.body || {};
  const fields = {};
  if (body.specialization !== undefined) {
    if (body.specialization && !SPECIALIZATIONS.includes(body.specialization)) {
      return res.status(400).json({ error: 'bad_spec' });
    }
    fields.specialization = body.specialization || null;
  }
  if (body.extra_roles !== undefined) {
    const list = Array.isArray(body.extra_roles)
      ? body.extra_roles.filter((r) => SPECIALIZATIONS.includes(r)).slice(0, 4)
      : [];
    fields.extra_roles = JSON.stringify(list);
  }
  if (body.role !== undefined) {
    if (!['user', 'member', 'moderator'].includes(body.role)) return res.status(400).json({ error: 'bad_role' });
    fields.role = body.role;
    if (body.role === 'member' || body.role === 'moderator') fields.member_since = user.member_since || nowIso();
  }
  if (body.clan_status !== undefined) {
    if (!['active', 'restricted', 'excluded'].includes(body.clan_status)) {
      return res.status(400).json({ error: 'bad_status' });
    }
    fields.clan_status = body.clan_status;
  }
  if (body.manual_status !== undefined && ['online', 'offline', 'afk', 'ingame'].includes(body.manual_status)) {
    fields.manual_status = body.manual_status;
  }
  if (body.nickname !== undefined) {
    const nickname = String(body.nickname).trim().slice(0, 32);
    if (nickname.length < 2) return res.status(400).json({ error: 'bad_nickname' });
    fields.nickname = nickname;
  }
  if (body.rust_nick !== undefined) fields.rust_nick = String(body.rust_nick).slice(0, 40);
  if (body.rust_hours !== undefined && HOUR_RANGES.includes(body.rust_hours)) fields.rust_hours = body.rust_hours;
  if (body.bio !== undefined) fields.bio = String(body.bio).slice(0, 600);
  if (body.chat_block_minutes !== undefined) {
    const minutes = Number(body.chat_block_minutes);
    fields.chat_blocked_until =
      minutes > 0 ? new Date(Date.now() + Math.min(minutes, 60 * 24 * 30) * 60000).toISOString() : null;
  }
  if (!Object.keys(fields).length) return res.json({ ok: true, member: serializeUser(user, user) });
  fields.updated_at = nowIso();
  db.prepare(`UPDATE users SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...Object.values(fields),
    user.id
  );
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ ok: true, member: serializeUser(updated, updated) });
});

router.post('/admin/members/:id/kick', requireOwner, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  db.prepare(
    "UPDATE users SET role = 'user', clan_status = 'excluded', member_since = NULL, chat_blocked_until = NULL, updated_at = ? WHERE id = ?"
  ).run(nowIso(), user.id);
  db.prepare('INSERT INTO login_audit (kind, ok, ip, detail, created_at) VALUES (?, 1, ?, ?, ?)').run(
    'kick',
    req.ip || '',
    `user:${user.id}`,
    nowIso()
  );
  res.json({ ok: true, message: `${user.nickname} исключён из клана.` });
});

/* -------------------------------- chat ---------------------------------- */

router.get('/admin/chat', requireOwner, (req, res) => {
  const messages = db
    .prepare(
      `SELECT m.*, u.nickname, u.role FROM messages m JOIN users u ON u.id = m.user_id
       ORDER BY m.id DESC LIMIT 150`
    )
    .all()
    .map((m) => ({
      id: m.id,
      body: m.deleted_at ? null : m.body,
      created_at: m.created_at,
      deleted: Boolean(m.deleted_at),
      deleted_reason: m.deleted_reason,
      author: { id: m.user_id, nickname: m.nickname, role: m.role },
    }));
  const reports = db
    .prepare(
      `SELECT r.*, m.body AS message_body, m.user_id AS author_id, u.nickname AS author, rep.nickname AS reporter
       FROM message_reports r
       JOIN messages m ON m.id = r.message_id
       JOIN users u ON u.id = m.user_id
       JOIN users rep ON rep.id = r.reporter_id
       ORDER BY r.id DESC LIMIT 60`
    )
    .all();
  res.json({ messages, reports, enabled: getSettings().chat_enabled === '1' });
});

router.post('/admin/chat/:id/delete', requireOwner, (req, res) => {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('UPDATE messages SET deleted_at = ?, deleted_by = ?, deleted_reason = ? WHERE id = ?').run(
    nowIso(),
    'owner',
    String((req.body && req.body.reason) || 'moderation').slice(0, 200),
    row.id
  );
  require('../lib/chatBus').broadcast('message_deleted', { id: Number(row.id), reason: 'moderation' });
  res.json({ ok: true });
});

router.post('/admin/reports/:id/resolve', requireOwner, (req, res) => {
  const report = db.prepare('SELECT * FROM message_reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE message_reports SET status = 'resolved', resolved_at = ? WHERE id = ?").run(nowIso(), report.id);
  res.json({ ok: true });
});

/* ------------------------------ downloads ------------------------------- */

router.get('/admin/downloads', requireOwner, (req, res) => {
  const rows = db.prepare('SELECT * FROM downloads ORDER BY id DESC').all();
  res.json({
    downloads: rows.map((row) => ({
      ...row,
      size_label: fileSizeLabel(row.size),
    })),
  });
});

router.post('/admin/downloads', requireOwner, handleUpload('file'), (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'title', message: 'Укажите название файла.' });
  const status = body.status === 'published' ? 'published' : 'draft';
  const now = nowIso();
  const file = req.file;
  const info = db
    .prepare(
      `INSERT INTO downloads (title, description, version, category, icon, file_name, stored_name, mime, size, status, created_at, updated_at, published_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      title,
      String(body.description || '').slice(0, 2000),
      String(body.version || '1.0').slice(0, 40),
      String(body.category || 'clan').slice(0, 30),
      String(body.icon || '📦').slice(0, 8),
      file ? file.originalname : null,
      file ? file.filename : null,
      file ? file.mimetype : null,
      file ? file.size : 0,
      status,
      now,
      now,
      status === 'published' ? now : null
    );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/admin/downloads/:id', requireOwner, (req, res) => {
  const row = db.prepare('SELECT * FROM downloads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const body = req.body || {};
  const fields = {};
  for (const key of ['title', 'description', 'version', 'category', 'icon']) {
    if (body[key] !== undefined) fields[key] = String(body[key]).slice(0, key === 'description' ? 2000 : 120);
  }
  if (body.status !== undefined) {
    if (!['draft', 'published'].includes(body.status)) return res.status(400).json({ error: 'bad_status' });
    fields.status = body.status;
    if (body.status === 'published' && !row.published_at) fields.published_at = nowIso();
  }
  if (!Object.keys(fields).length) return res.json({ ok: true });
  fields.updated_at = nowIso();
  db.prepare(`UPDATE downloads SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...Object.values(fields),
    row.id
  );
  res.json({ ok: true });
});

router.post('/admin/downloads/:id/file', requireOwner, handleUpload('file'), (req, res) => {
  const row = db.prepare('SELECT * FROM downloads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (!req.file) return res.status(400).json({ error: 'no_file', message: 'Выберите файл.' });
  removeStored(row.stored_name);
  db.prepare(
    'UPDATE downloads SET file_name = ?, stored_name = ?, mime = ?, size = ?, version = COALESCE(?, version), updated_at = ? WHERE id = ?'
  ).run(
    req.file.originalname,
    req.file.filename,
    req.file.mimetype,
    req.file.size,
    req.body && req.body.version ? String(req.body.version).slice(0, 40) : null,
    nowIso(),
    row.id
  );
  res.json({ ok: true, message: 'Файл заменён.' });
});

router.delete('/admin/downloads/:id', requireOwner, (req, res) => {
  const row = db.prepare('SELECT * FROM downloads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  removeStored(row.stored_name);
  db.prepare('DELETE FROM downloads WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

/* ----------------------------- app releases ----------------------------- */

router.get('/admin/app-releases', requireOwner, (req, res) => {
  const rows = db.prepare('SELECT * FROM app_releases ORDER BY id DESC').all();
  res.json({ releases: rows.map((row) => ({ ...row, size_label: fileSizeLabel(row.size) })) });
});

router.post('/admin/app-releases', requireOwner, handleUpload('file'), (req, res) => {
  const body = req.body || {};
  const version = String(body.version || '').trim().slice(0, 40);
  if (!version) return res.status(400).json({ error: 'version', message: 'Укажите версию.' });
  const status = body.status === 'published' ? 'published' : 'draft';
  const file = req.file;
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO app_releases (version, changelog, file_name, stored_name, mime, size, status, created_at, published_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      version,
      String(body.changelog || '').slice(0, 4000),
      file ? file.originalname : null,
      file ? file.filename : null,
      file ? file.mimetype : null,
      file ? file.size : 0,
      status,
      now,
      status === 'published' ? now : null
    );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

router.post('/admin/app-releases/:id/publish', requireOwner, (req, res) => {
  const row = db.prepare('SELECT * FROM app_releases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE app_releases SET status = 'published', published_at = ? WHERE id = ?").run(nowIso(), row.id);
  res.json({ ok: true });
});

router.delete('/admin/app-releases/:id', requireOwner, (req, res) => {
  const row = db.prepare('SELECT * FROM app_releases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  removeStored(row.stored_name);
  db.prepare('DELETE FROM app_releases WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

/* -------------------------------- news ---------------------------------- */

router.get('/admin/news', requireOwner, (req, res) => {
  res.json({ news: db.prepare('SELECT * FROM news ORDER BY pinned DESC, id DESC').all() });
});

router.post('/admin/news', requireOwner, (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim().slice(0, 160);
  const text = String(body.body || '').trim().slice(0, 4000);
  if (title.length < 3 || text.length < 3) {
    return res.status(400).json({ error: 'bad_news', message: 'Заполните заголовок и текст новости.' });
  }
  const now = nowIso();
  const info = db
    .prepare('INSERT INTO news (title, body, tag, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(title, text, String(body.tag || 'clan').slice(0, 20), body.pinned ? 1 : 0, now, now);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/admin/news/:id', requireOwner, (req, res) => {
  const row = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const body = req.body || {};
  db.prepare('UPDATE news SET title = ?, body = ?, tag = ?, pinned = ?, updated_at = ? WHERE id = ?').run(
    body.title !== undefined ? String(body.title).slice(0, 160) : row.title,
    body.body !== undefined ? String(body.body).slice(0, 4000) : row.body,
    body.tag !== undefined ? String(body.tag).slice(0, 20) : row.tag,
    body.pinned !== undefined ? (body.pinned ? 1 : 0) : row.pinned,
    nowIso(),
    row.id
  );
  res.json({ ok: true });
});

router.delete('/admin/news/:id', requireOwner, (req, res) => {
  db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ------------------------------- settings -------------------------------- */

const HEX = /^#[0-9a-fA-F]{6}$/;

router.get('/admin/settings', requireOwner, (req, res) => {
  res.json({ settings: getSettings(), defaults: DEFAULT_SETTINGS });
});

router.patch('/admin/settings', requireOwner, (req, res) => {
  const body = req.body || {};
  const patch = {};
  for (const [key, raw] of Object.entries(body)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    let value = raw == null ? '' : String(raw);
    if (['accent', 'accent_soft'].includes(key) && value && !HEX.test(value)) {
      return res.status(400).json({ error: `bad_${key}`, message: 'Цвет должен быть в формате #RRGGBB.' });
    }
    if (key === 'bg_style' && !['tech', 'grid', 'aurora', 'minimal'].includes(value)) {
      return res.status(400).json({ error: 'bad_bg_style', message: 'Неизвестный стиль фона.' });
    }
    if (['registration_open', 'allow_exceptions', 'chat_enabled', 'members_public'].includes(key)) {
      value = value === '1' || value === 'true' ? '1' : '0';
    }
    if (key === 'min_hours') {
      const n = Number(value);
      value = String(Number.isFinite(n) && n >= 0 ? Math.min(n, 10000) : 700);
    }
    if (['upload_max_mb'].includes(key)) {
      const n = Number(value);
      value = String(Number.isFinite(n) && n >= 1 ? Math.min(n, 1024) : 200);
    }
    if (key === 'base_url' && value && !/^https?:\/\//i.test(value)) {
      return res.status(400).json({ error: 'bad_base_url', message: 'Базовый URL должен начинаться с http:// или https://' });
    }
    if (['discord_invite', 'discord_exception_invite'].includes(key) && value && !/^https?:\/\//i.test(value)) {
      return res.status(400).json({ error: `bad_${key}`, message: 'Ссылка Discord должна начинаться с http:// или https://' });
    }
    patch[key] = value;
  }
  if (!Object.keys(patch).length) return res.json({ ok: true, settings: getSettings() });
  const settings = updateSettings(patch);
  res.json({ ok: true, settings });
});

router.post('/admin/design/upload', requireOwner, (req, res) => {
  uploadMedia.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'upload_failed', message: err.message });
    if (!req.file) return res.status(400).json({ error: 'no_file', message: 'Выберите изображение.' });
    const target = req.body && req.body.target === 'background' ? 'bg_image' : 'logo_image';
    const url = `/media/${req.file.filename}`;
    updateSettings({ [target]: url });
    res.json({ ok: true, url, target, settings: getSettings() });
  });
});

router.delete('/admin/design/upload', requireOwner, (req, res) => {
  const target = String(req.query.target || 'logo') === 'background' ? 'bg_image' : 'logo_image';
  updateSettings({ [target]: '' });
  res.json({ ok: true, settings: getSettings() });
});

/* ------------------------------- exports --------------------------------- */

module.exports = { router };
