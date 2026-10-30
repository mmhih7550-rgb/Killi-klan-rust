'use strict';

const { db, getSettings, nowIso } = require('./db');
const { parseCookies, sha256 } = require('./security');

const USER_COOKIE = 'ck_session';
const ADMIN_COOKIE = 'ck_key';

const SPECIALIZATIONS = ['combat', 'builder', 'farmer', 'electric', 'other'];
const HOUR_RANGES = ['700-1000', '1000-2000', '2000-3000', '3000-5000', '5000-plus', 'under700'];
const MEMBER_ROLES = ['member', 'moderator'];

function getBaseUrl(req) {
  const settings = getSettings();
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (settings.base_url) return settings.base_url.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function hasMemberAccess(user) {
  return Boolean(user) && MEMBER_ROLES.includes(user.role) && user.clan_status === 'active';
}

function isExcluded(user) {
  return Boolean(user) && user.clan_status === 'excluded';
}

function isModerator(user) {
  return Boolean(user) && user.role === 'moderator' && user.clan_status === 'active';
}

function canUseChat(user) {
  if (!hasMemberAccess(user)) return false;
  if (user.chat_blocked_until && new Date(user.chat_blocked_until).getTime() > Date.now()) return false;
  return getSettings().chat_enabled === '1';
}

function serializeUser(user, viewer) {
  if (!user) return null;
  const isSelf = viewer && viewer.id === user.id;
  const memberLike = hasMemberAccess(viewer) || (viewer && viewer.role === 'moderator');
  const steamVisible = Boolean(user.steam_id) && (isSelf || memberLike || Boolean(user.show_steam));
  const discordVisible = Boolean(user.discord_id) && (isSelf || memberLike || Boolean(user.show_discord));
  return {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar || user.steam_avatar || user.discord_avatar || null,
    role: user.role,
    clan_status: user.clan_status,
    specialization: user.specialization,
    extra_roles: parseJson(user.extra_roles, []),
    rust_hours: user.rust_hours,
    rust_nick: user.rust_nick,
    timezone: user.timezone,
    bio: user.bio,
    manual_status: user.manual_status,
    member_since: user.member_since,
    created_at: user.created_at,
    last_seen: user.last_seen,
    chat_blocked_until: user.chat_blocked_until || null,
    steam: steamVisible
      ? { id: user.steam_id, name: user.steam_name, url: user.steam_url, avatar: user.steam_avatar }
      : null,
    discord: discordVisible
      ? { id: user.discord_id, name: user.discord_name, url: user.discord_url, avatar: user.discord_avatar }
      : null,
    links: {
      steam: Boolean(user.steam_id),
      discord: Boolean(user.discord_id),
    },
    permissions: {
      member: hasMemberAccess(user),
      moderator: isModerator(user),
      chat: canUseChat(user),
      chat_blocked: Boolean(user.chat_blocked_until && new Date(user.chat_blocked_until).getTime() > Date.now()),
      restricted: user.clan_status === 'restricted',
    },
    show_steam: Boolean(user.show_steam),
    show_discord: Boolean(user.show_discord),
  };
}

function attachContext(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  const now = nowIso();
  req.user = null;
  const sessionToken = req.cookies[USER_COOKIE];
  if (sessionToken) {
    const session = db
      .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
      .get(sha256(sessionToken), now);
    if (session) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
      if (user) {
        req.user = user;
        req.sessionToken = sessionToken;
        db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, sha256(sessionToken));
        const lastSeen = user.last_seen ? new Date(user.last_seen).getTime() : 0;
        if (Date.now() - lastSeen > 45000) {
          db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, user.id);
        }
      }
    }
  }

  req.admin = null;
  const adminToken = req.cookies[ADMIN_COOKIE];
  if (adminToken) {
    const adminSession = db
      .prepare('SELECT * FROM admin_sessions WHERE token_hash = ? AND expires_at > ? AND pending_auth = 0')
      .get(sha256(adminToken), now);
    if (adminSession) req.admin = adminSession;
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required', message: 'Требуется вход через Steam или Discord.' });
  next();
}

function requireMember(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required', message: 'Требуется вход через Steam или Discord.' });
  if (!hasMemberAccess(req.user)) {
    const restricted = req.user.clan_status === 'restricted';
    return res.status(403).json({
      error: restricted ? 'access_restricted' : 'member_only',
      message: restricted
        ? 'Доступ к разделу временно ограничен владельцем клана.'
        : 'Раздел доступен только принятым участникам CLAN KILLI.',
    });
  }
  next();
}

function requireOwner(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ error: 'owner_required', message: 'Требуется вход владельца.' });
  }
  next();
}

function requireChat(req, res, next) {
  requireMember(req, res, () => {
    if (!canUseChat(req.user)) {
      const blocked = req.user.chat_blocked_until && new Date(req.user.chat_blocked_until).getTime() > Date.now();
      return res.status(403).json({
        error: blocked ? 'chat_blocked' : 'chat_disabled',
        message: blocked
          ? `Отправка сообщений ограничена до ${new Date(req.user.chat_blocked_until).toLocaleString('ru-RU')}.`
          : 'Чат клана сейчас отключён.',
      });
    }
    next();
  });
}

function publicSettings(settings) {
  return {
    site_name: settings.site_name,
    site_tagline: settings.site_tagline,
    logo_letter: settings.logo_letter,
    logo_image: settings.logo_image,
    accent: settings.accent,
    accent_soft: settings.accent_soft,
    bg_style: settings.bg_style,
    bg_image: settings.bg_image,
    clan_description: settings.clan_description,
    clan_about: settings.clan_about,
    rules: settings.rules,
    discord_name: settings.discord_name,
    discord_description: settings.discord_description,
    discord_invite: settings.discord_invite,
    discord_exception_invite: settings.discord_exception_invite,
    discord_members_text: settings.discord_members_text,
    app_name: settings.app_name,
    app_tagline: settings.app_tagline,
    app_description: settings.app_description,
    app_features: settings.app_features,
    app_disclaimer: settings.app_disclaimer,
    footer_note: settings.footer_note,
    min_hours: settings.min_hours,
    registration_open: settings.registration_open,
    allow_exceptions: settings.allow_exceptions,
    chat_enabled: settings.chat_enabled,
    members_public: settings.members_public,
    upload_max_mb: settings.upload_max_mb,
    upload_ext: settings.upload_ext,
    maintenance_note: settings.maintenance_note,
  };
}

module.exports = {
  USER_COOKIE,
  ADMIN_COOKIE,
  SPECIALIZATIONS,
  HOUR_RANGES,
  MEMBER_ROLES,
  getBaseUrl,
  parseJson,
  hasMemberAccess,
  isModerator,
  isExcluded,
  canUseChat,
  serializeUser,
  attachContext,
  requireUser,
  requireMember,
  requireOwner,
  requireChat,
  publicSettings,
};
