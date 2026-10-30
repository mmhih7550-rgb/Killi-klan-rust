'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, getSettings, nowIso, getAdminCreds } = require('../db');
const { UPLOAD_DIR } = require('../config');
const {
  SPECIALIZATIONS,
  HOUR_RANGES,
  serializeUser,
  hasMemberAccess,
  requireUser,
  requireMember,
  publicSettings,
  parseJson,
  getBaseUrl,
} = require('../helpers');
const { rateLimit, resetRateLimit, verifyPassword, sha256 } = require('../security');

const router = express.Router();

/* ------------------------------- helpers -------------------------------- */

const clean = (value, max = 4000) => String(value == null ? '' : value).trim().slice(0, max);

function appCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM applications WHERE status = 'pending'").get().c;
}

function memberCount() {
  return db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role IN ('member','moderator') AND clan_status != 'excluded'")
    .get().c;
}

function publicMemberRow(row, viewer) {
  const user = serializeUser(row, viewer);
  return {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    specialization: user.specialization,
    extra_roles: user.extra_roles,
    rust_hours: user.rust_hours,
    member_since: user.member_since,
    manual_status: user.manual_status,
    role: user.role,
    steam: user.steam,
    discord: user.discord,
    status: presence(row),
  };
}

function presence(row) {
  if (row.manual_status === 'ingame') return { key: 'ingame', label: 'In Game', manual: true };
  if (row.manual_status === 'afk') return { key: 'afk', label: 'AFK', manual: true };
  if (row.manual_status === 'offline') return { key: 'offline', label: 'Offline', manual: true };
  const last = row.last_seen ? new Date(row.last_seen).getTime() : 0;
  const online = Date.now() - last < 1000 * 60 * 5;
  return online ? { key: 'online', label: 'Online', manual: false } : { key: 'offline', label: 'Offline', manual: false };
}

function fileSizeLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function downloadRow(row, viewer) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    version: row.version,
    category: row.category,
    icon: row.icon,
    file_name: row.file_name,
    size: row.size,
    size_label: fileSizeLabel(row.size),
    status: row.status,
    download_count: row.download_count,
    created_at: row.created_at,
    published_at: row.published_at,
    can_download: hasMemberAccess(viewer) && Boolean(row.stored_name) && row.status === 'published',
  };
}

function newsRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tag: row.tag,
    pinned: Boolean(row.pinned),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function releaseRow(row) {
  return {
    id: row.id,
    version: row.version,
    changelog: row.changelog,
    file_name: row.file_name,
    size: row.size,
    size_label: fileSizeLabel(row.size),
    status: row.status,
    download_count: row.download_count,
    created_at: row.created_at,
    published_at: row.published_at,
  };
}

function latestRelease() {
  return db
    .prepare("SELECT * FROM app_releases WHERE status = 'published' ORDER BY datetime(published_at) DESC, id DESC LIMIT 1")
    .get();
}

/* ------------------------------- site data ------------------------------ */

router.get('/site', (req, res) => {
  const settings = getSettings();
  const stats = {
    members: memberCount(),
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    pending: appCount(),
    downloads: db.prepare("SELECT COUNT(*) AS c FROM downloads WHERE status = 'published'").get().c,
    online: db
      .prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role IN ('member','moderator') AND last_seen > ? AND clan_status = 'active'"
      )
      .get(new Date(Date.now() - 1000 * 60 * 5).toISOString()).c,
  };
  const latest = latestRelease();
  res.json({
    settings: publicSettings(settings),
    stats,
    user: serializeUser(req.user, req.user),
    owner: Boolean(req.admin),
    features: {
      steam: true,
      steamProfile: Boolean(process.env.STEAM_API_KEY),
      discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
    },
    specializations: SPECIALIZATIONS,
    hourRanges: HOUR_RANGES,
    app: latest ? releaseRow(latest) : null,
    ownerSetupRequired: (() => {
      const creds = getAdminCreds();
      return Boolean(creds && creds.must_change);
    })(),
  });
});

router.get('/news', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const rows = db
    .prepare('SELECT * FROM news ORDER BY pinned DESC, datetime(created_at) DESC LIMIT ?')
    .all(limit);
  res.json({ news: rows.map(newsRow) });
});

router.get('/downloads', (req, res) => {
  const rows = db
    .prepare("SELECT * FROM downloads WHERE status = 'published' ORDER BY datetime(published_at) DESC, id DESC")
    .all();
  res.json({
    downloads: rows.map((row) => downloadRow(row, req.user)),
    member: hasMemberAccess(req.user),
  });
});

router.get('/app', (req, res) => {
  const settings = getSettings();
  const releases = db
    .prepare("SELECT * FROM app_releases WHERE status = 'published' ORDER BY datetime(published_at) DESC, id DESC")
    .all();
  const latest = releases[0] || null;
  res.json({
    app: {
      name: settings.app_name,
      tagline: settings.app_tagline,
      description: settings.app_description,
      features: settings.app_features,
      disclaimer: settings.app_disclaimer,
      latest: latest ? { ...releaseRow(latest), can_download: hasMemberAccess(req.user) } : null,
      releases: releases.map(releaseRow),
    },
  });
});

/* ------------------------------- members -------------------------------- */

router.get('/members', (req, res) => {
  const settings = getSettings();
  const memberLike = hasMemberAccess(req.user) || Boolean(req.admin);
  if (!memberLike && settings.members_public !== '1') {
    return res.status(403).json({
      error: 'member_only',
      message: 'Состав клана доступен участникам CLAN KILLI.',
      total: memberCount(),
    });
  }
  const q = clean(req.query.q, 60).toLowerCase();
  const spec = clean(req.query.spec, 20);
  const rows = db
    .prepare(
      "SELECT * FROM users WHERE role IN ('member','moderator') AND clan_status != 'excluded' ORDER BY datetime(member_since) ASC, id ASC"
    )
    .all();
  let members = rows.map((row) => publicMemberRow(row, req.user));
  if (q) {
    members = members.filter(
      (m) => m.nickname.toLowerCase().includes(q) || (m.steam?.name || '').toLowerCase().includes(q)
    );
  }
  if (spec && SPECIALIZATIONS.includes(spec)) {
    members = members.filter((m) => m.specialization === spec || m.extra_roles.includes(spec));
  }
  const counts = SPECIALIZATIONS.reduce((acc, key) => {
    acc[key] = rows.filter((r) => r.specialization === key).length;
    return acc;
  }, {});
  res.json({ members, counts, total: rows.length });
});

router.get('/roles', (req, res) => {
  const rows = db
    .prepare("SELECT * FROM users WHERE role IN ('member','moderator') AND clan_status = 'active'")
    .all();
  const data = SPECIALIZATIONS.map((key) => ({
    key,
    count: rows.filter((r) => r.specialization === key).length,
    players: rows
      .filter((r) => r.specialization === key)
      .map((r) => ({ id: r.id, nickname: r.nickname, avatar: r.avatar || r.steam_avatar || r.discord_avatar })),
  }));
  res.json({ roles: data, total: rows.length });
});

/* ------------------------------ profile/me ------------------------------ */

router.patch('/me', requireUser, (req, res) => {
  const body = req.body || {};
  const fields = {};
  if (body.nickname !== undefined) {
    const nickname = clean(body.nickname, 32);
    if (nickname.length < 2) return res.status(400).json({ error: 'bad_nickname', message: 'Никнейм слишком короткий.' });
    fields.nickname = nickname;
  }
  if (body.rust_nick !== undefined) fields.rust_nick = clean(body.rust_nick, 40);
  if (body.timezone !== undefined) fields.timezone = clean(body.timezone, 40);
  if (body.bio !== undefined) fields.bio = clean(body.bio, 600);
  if (body.manual_status !== undefined && ['online', 'offline', 'afk', 'ingame'].includes(body.manual_status)) {
    fields.manual_status = body.manual_status;
  }
  if (body.show_steam !== undefined) fields.show_steam = body.show_steam ? 1 : 0;
  if (body.show_discord !== undefined) fields.show_discord = body.show_discord ? 1 : 0;
  if (body.rust_hours !== undefined && HOUR_RANGES.includes(body.rust_hours)) fields.rust_hours = body.rust_hours;
  if (body.specialization !== undefined && SPECIALIZATIONS.includes(body.specialization)) {
    fields.specialization = body.specialization;
  }
  if (!Object.keys(fields).length) return res.json({ ok: true, user: serializeUser(req.user, req.user) });
  fields.updated_at = nowIso();
  const sql = `UPDATE users SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...Object.values(fields), req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: serializeUser(updated, updated) });
});

/* ----------------------------- applications ----------------------------- */

function serializeApplication(row, user) {
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
    exception: row.is_exception
      ? {
          why: row.exception_why,
          skills: row.exception_skills,
          clan_experience: row.exception_clan_experience,
          useful: row.exception_useful,
        }
      : null,
    status: row.status,
    admin_note: row.admin_note,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    user: user ? serializeUser(user, user) : null,
  };
}

router.get('/applications/me', requireUser, (req, res) => {
  const row = db
    .prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ application: row ? serializeApplication(row, user) : null });
});

router.post('/applications', requireUser, (req, res) => {
  const settings = getSettings();
  if (settings.registration_open !== '1') {
    return res.status(403).json({ error: 'closed', message: 'Приём заявок временно закрыт.' });
  }
  if (hasMemberAccess(req.user)) {
    return res.status(409).json({ error: 'already_member', message: 'Вы уже участник клана.' });
  }
  const pending = db
    .prepare("SELECT id FROM applications WHERE user_id = ? AND status IN ('pending','info_requested')")
    .get(req.user.id);
  if (pending) {
    return res.status(409).json({ error: 'already_pending', message: 'Ваша заявка уже находится на рассмотрении.' });
  }

  const body = req.body || {};
  const nickname = clean(body.nickname || req.user.nickname, 40);
  const rustNick = clean(body.rust_nick, 40);
  const hoursRange = clean(body.hours_range, 20);
  const specialization = clean(body.specialization, 20);
  const whyJoin = clean(body.why_join, 2000);
  const extraRoles = Array.isArray(body.extra_roles)
    ? body.extra_roles.filter((r) => SPECIALIZATIONS.includes(r) && r !== specialization).slice(0, 4)
    : [];
  const gameModes = Array.isArray(body.game_modes) ? body.game_modes.map((m) => clean(m, 40)).slice(0, 12) : [];

  if (!nickname) return res.status(400).json({ error: 'nickname', message: 'Укажите никнейм.' });
  if (!HOUR_RANGES.includes(hoursRange)) return res.status(400).json({ error: 'hours', message: 'Укажите часы в Rust.' });
  if (!SPECIALIZATIONS.includes(specialization)) {
    return res.status(400).json({ error: 'specialization', message: 'Выберите основную специализацию.' });
  }
  if (whyJoin.length < 20) return res.status(400).json({ error: 'why_join', message: 'Опишите причину вступления (минимум 20 символов).' });

  const isException = hoursRange === 'under700';
  if (isException && settings.allow_exceptions !== '1') {
    return res.status(403).json({ error: 'exceptions_closed', message: 'Заявки-исключения сейчас не принимаются.' });
  }

  let exception = {};
  if (isException) {
    exception = {
      why: clean(body.exception_why, 1200),
      skills: clean(body.exception_skills, 1200),
      clan_experience: clean(body.exception_clan_experience, 600),
      useful: clean(body.exception_useful, 1200),
    };
    if (exception.why.length < 20 || exception.skills.length < 10 || exception.useful.length < 10) {
      return res.status(400).json({
        error: 'exception_fields',
        message: 'Для заявки-исключения заполните обоснование, навыки и пользу для команды.',
      });
    }
  }

  const steamLink =
    clean(body.steam_link, 200) ||
    (req.user.steam_url ? req.user.steam_url : '') ||
    '';
  const discordLink =
    clean(body.discord_link, 200) ||
    (req.user.discord_url ? req.user.discord_url : '') ||
    '';

  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO applications (user_id, nickname, rust_nick, steam_link, discord_link, hours_range, is_exception,
        specialization, extra_roles, play_time, game_modes, clan_experience, has_mic, timezone, extra_skills,
        why_join, extra_info, exception_why, exception_skills, exception_clan_experience, exception_useful,
        status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`
    )
    .run(
      req.user.id,
      nickname,
      rustNick,
      steamLink,
      discordLink,
      hoursRange,
      isException ? 1 : 0,
      specialization,
      JSON.stringify(extraRoles),
      clean(body.play_time, 60),
      JSON.stringify(gameModes),
      clean(body.clan_experience, 1200),
      clean(body.has_mic, 10),
      clean(body.timezone, 60),
      clean(body.extra_skills, 1500),
      whyJoin,
      clean(body.extra_info, 1500),
      exception.why || null,
      exception.skills || null,
      exception.clan_experience || null,
      exception.useful || null,
      now,
      now
    );

  db.prepare('UPDATE users SET rust_nick = ?, rust_hours = ?, specialization = ?, updated_at = ? WHERE id = ?').run(
    rustNick || null,
    hoursRange,
    specialization,
    now,
    req.user.id
  );

  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(info.lastInsertRowid);
  db.prepare('INSERT INTO news (title, body, tag, pinned, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run(
    'Новая заявка в клан',
    `Поступила заявка от ${nickname}${isException ? ' (исключение по часам)' : ''}.`,
    'applications',
    now,
    now
  );
  res.status(201).json({ ok: true, application: serializeApplication(row, req.user) });
});

/* ------------------------------- downloads ------------------------------ */

function resolveStored(stored) {
  if (!stored) return null;
  const base = path.basename(String(stored));
  const full = path.join(UPLOAD_DIR, base);
  if (!full.startsWith(UPLOAD_DIR)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

router.get('/downloads/:id/file', requireMember, (req, res) => {
  const row = db.prepare('SELECT * FROM downloads WHERE id = ? AND status = ?').get(req.params.id, 'published');
  if (!row) return res.status(404).json({ error: 'not_found', message: 'Файл не найден.' });
  const full = resolveStored(row.stored_name);
  if (!full) return res.status(404).json({ error: 'file_missing', message: 'Файл недоступен.' });
  db.prepare('UPDATE downloads SET download_count = download_count + 1 WHERE id = ?').run(row.id);
  res.download(full, row.file_name || path.basename(full));
});

router.get('/app/download', requireMember, (req, res) => {
  const release = req.query.version
    ? db
        .prepare("SELECT * FROM app_releases WHERE version = ? AND status = 'published' ORDER BY id DESC LIMIT 1")
        .get(String(req.query.version))
    : latestRelease();
  if (!release) return res.status(404).json({ error: 'not_found', message: 'Сборка ещё не опубликована.' });
  const full = resolveStored(release.stored_name);
  if (!full) return res.status(404).json({ error: 'file_missing', message: 'Файл сборки недоступен.' });
  db.prepare('UPDATE app_releases SET download_count = download_count + 1 WHERE id = ?').run(release.id);
  res.download(full, release.file_name || path.basename(full));
});

/* ------------------------------- diagnostics ---------------------------- */

router.get('/diagnostics', (req, res) => {
  if (!req.admin) return res.status(401).json({ error: 'owner_required' });
  const settings = getSettings();
  res.json({
    baseUrl: getBaseUrl(req),
    features: {
      steamOpenId: true,
      steamProfileApi: Boolean(process.env.STEAM_API_KEY),
      discordOAuth: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
    },
    storage: UPLOAD_DIR,
    database: 'SQLite',
    integrations: {
      requiredEnv: ['STEAM_API_KEY', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
      callbacks: {
        steam: `${getBaseUrl(req)}/auth/steam/callback`,
        discord: `${getBaseUrl(req)}/auth/discord/callback`,
      },
    },
    uploads: {
      maxMb: settings.upload_max_mb,
      extensions: settings.upload_ext,
    },
  });
});

module.exports = { router, presence, fileSizeLabel };
