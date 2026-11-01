'use strict';

const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  avatar TEXT,
  steam_id TEXT UNIQUE,
  steam_name TEXT,
  steam_avatar TEXT,
  steam_url TEXT,
  discord_id TEXT UNIQUE,
  discord_name TEXT,
  discord_avatar TEXT,
  discord_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  clan_status TEXT NOT NULL DEFAULT 'active',
  specialization TEXT,
  extra_roles TEXT NOT NULL DEFAULT '[]',
  rust_hours TEXT,
  rust_nick TEXT,
  timezone TEXT,
  bio TEXT,
  manual_status TEXT NOT NULL DEFAULT 'offline',
  show_steam INTEGER NOT NULL DEFAULT 1,
  show_discord INTEGER NOT NULL DEFAULT 1,
  member_since TEXT,
  chat_blocked_until TEXT,
  last_seen TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  rust_nick TEXT,
  steam_link TEXT,
  discord_link TEXT,
  hours_range TEXT,
  is_exception INTEGER NOT NULL DEFAULT 0,
  specialization TEXT,
  extra_roles TEXT NOT NULL DEFAULT '[]',
  play_time TEXT,
  game_modes TEXT NOT NULL DEFAULT '[]',
  clan_experience TEXT,
  has_mic TEXT,
  timezone TEXT,
  extra_skills TEXT,
  why_join TEXT,
  extra_info TEXT,
  exception_why TEXT,
  exception_skills TEXT,
  exception_clan_experience TEXT,
  exception_useful TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'general',
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  deleted_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(id DESC);

CREATE TABLE IF NOT EXISTS message_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen TEXT
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  link_user_id INTEGER,
  redirect TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pass1_hash TEXT NOT NULL,
  pass2_hash TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  must_change INTEGER NOT NULL DEFAULT 1,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  ua TEXT,
  pending_auth INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tag TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  version TEXT,
  category TEXT NOT NULL DEFAULT 'clan',
  icon TEXT,
  file_name TEXT,
  stored_name TEXT,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS app_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  changelog TEXT,
  file_name TEXT,
  stored_name TEXT,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS login_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  ok INTEGER,
  ip TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
`);

const nowIso = () => new Date().toISOString();

/* ------------------------------ settings ------------------------------ */

const DEFAULT_SETTINGS = {
  site_name: 'CLAN KILLI',
  site_tagline: 'Единство. Контроль. Сообщество.',
  logo_letter: 'K',
  logo_image: '',
  accent: '#ff2b3d',
  accent_soft: '#ff6b5e',
  bg_style: 'tech',
  bg_image: '',
  clan_description:
    'CLAN KILLI — закрытое сообщество Rust-игроков, которое строится на дисциплине, взаимовыручке и постоянной практике. Мы играем вместе с первого дня вайпа, делим задачи по специализациям и держим высокий уровень организации.',
  clan_about:
    'CLAN KILLI появился как небольшой состав единомышленников, которым надоела случайная игра без плана. Сегодня это структурированный клан с распределением ролей, собственным чатом, библиотекой файлов и внутренними инструментами контроля состава.\n\nМы не собираем «как можно больше» людей. Нам важны активные игроки, которые понимают свою задачу: боец держит PvP и рейды, строитель отвечает за базу и оборону, фармер обеспечивает ресурсы, электрик настраивает автоматизацию и ловушки. Каждый участник проходит анкету и ручное рассмотрение владельцем клана.',
  rules:
    '1. Уважение к участникам клана — обязательное условие. Токсичность, оскорбления и травля недопустимы.\n2. Запрещено использовать читы, макросы и стороннее ПО, дающее нечестное преимущество. KILLI ULTIMATE APP — вспомогательный инструмент проверки, а не гарантия защиты.\n3. Не сливать внутреннюю информацию: координаты, состав, планы рейдов, файлы и ссылки клана.\n4. Участвовать в жизни клана: чат, общие вылазки, помощь составу.\n5. Конфликты решаются внутри клана через владельца или модератора, а не публичными разборками.\n6. Один аккаунт — один игрок. Повторная регистрация после исключения запрещена.\n7. Незнание правил не освобождает от ответственности за их нарушение.',
  discord_name: 'CLAN KILLI',
  discord_description:
    'Голосовые каналы, сборы на вайп, обсуждение рейдов и внутренние объявления. Основная площадка для координации состава.',
  discord_invite: '',
  discord_exception_invite: '',
  discord_members_text: 'Закрытый сервер клана. Доступ выдаётся после принятия заявки.',
  app_name: 'KILLI ULTIMATE APP',
  app_tagline: 'Проверка компьютера на подозрительные файлы и индикаторы читов',
  app_description:
    'Приложение предназначено для проверки компьютера на наличие подозрительных файлов и индикаторов читов. Оно помогает быстро просмотреть систему, найти подозрительные объекты и подготовить отчёт для владельца клана.\n\nПриложение не является антивирусом и не гарантирует обнаружение всех читов. Результаты проверки — вспомогательная информация, финальное решение всегда принимает владелец клана.',
  app_features:
    'Сканирование системы на подозрительные файлы и процессы\nПоиск индикаторов известных читов и сторонних инжекторов\nОтчёт о результате проверки для владельца клана\nБыстрый запуск без сложной настройки\nРегулярные обновления баз проверки',
  app_disclaimer:
    'KILLI ULTIMATE APP не является антивирусом и не гарантирует обнаружение всех читов. Приложение снижает риск, но не заменяет ручную проверку и человеческое решение.',
  footer_note: 'Закрытый игровой клан Rust. Сообщество по заявкам.',
  min_hours: '700',
  registration_open: '1',
  allow_exceptions: '1',
  chat_enabled: '1',
  members_public: '0',
  upload_max_mb: '200',
  upload_ext: '.zip,.rar,.7z,.exe,.msi,.pdf,.png,.jpg,.jpeg,.webp,.txt,.dll,.cfg,.json',
  base_url: '',
  maintenance_note: '',
};

const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

const seedSettings = db.transaction(() => {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
    if (!exists) setSettingStmt.run(key, value);
  }
});

seedSettings();

let settingsCache = null;
function getSettings() {
  if (settingsCache) return settingsCache;
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  settingsCache = out;
  return out;
}

function updateSettings(patch) {
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      setSettingStmt.run(key, value == null ? '' : String(value));
    }
  });
  tx(Object.entries(patch));
  settingsCache = null;
  return getSettings();
}

function invalidateSettings() {
  settingsCache = null;
}

/* --------------------------- owner credentials ------------------------ */

/*
 * Только scrypt-хеши (N=16384, r=8, p=1, соль 16 байт). Открытых паролей в
 * репозитории нет и быть не должно. Значения можно переопределить переменными
 * окружения KILLI_OWNER_PASSWORD_1 / KILLI_OWNER_PASSWORD_2 — в этом случае
 * при старте выполняется ротация хешей в уже существующей базе.
 */
const INITIAL_HASHES = {
  pass1: 'scrypt$16384$8$1$nLbUyEcMhK1M52EPUvNvZQ==$vFVDE5HSQVo612g6ApLz1piM8Ay6VrE77h9iW4xKtBp5Rqg1tKIoDYa47GTM+0Nm+eAhaTeSaqm90s789PRfFg==',
  pass2: 'scrypt$16384$8$1$v7JK/vrrr1Ebf364YS7HEw==$Csl4RYhB/3BhdbZBx9uKRXFBx71ivWuywR6FRdp+wmh6eSNy4TuICAmE9x6wmqruEvdCUwfefR7re/BTTHRstw==',
};

/* Версия набора креденшелов владельца. При изменении версии хеши в уже
   существующей базе принудительно перезаписываются — старые пароли умирают. */
const CREDS_VERSION = '2026-11-a';
const ENV_VERSION = 'env';

function ensureCredsVersionColumn() {  const columns = db.prepare('PRAGMA table_info(admin_credentials)').all();
  if (!columns.some((column) => column.name === 'creds_version')) {
    db.exec('ALTER TABLE admin_credentials ADD COLUMN creds_version TEXT');
  }
}
ensureCredsVersionColumn();

function seedAdmin() {
  const { hashPassword } = require('./security');
  const p1 = process.env.KILLI_OWNER_PASSWORD_1;
  const p2 = process.env.KILLI_OWNER_PASSWORD_2;
  const fromEnv = Boolean(p1 && p2);
  // Секреты из окружения всегда считаются актуальными; без них — INITIAL_HASHES.
  const version = fromEnv ? `${ENV_VERSION}:${sha256Short(`${p1}:${p2}`)}` : CREDS_VERSION;
  const pass1 = fromEnv ? hashPassword(p1) : INITIAL_HASHES.pass1;
  const pass2 = fromEnv ? hashPassword(p2) : INITIAL_HASHES.pass2;

  const existing = db.prepare('SELECT id, creds_version FROM admin_credentials WHERE id = 1').get();
  if (!existing) {
    db.prepare(
      `INSERT INTO admin_credentials (id, pass1_hash, pass2_hash, totp_enabled, must_change, creds_version, updated_at)
       VALUES (1, ?, ?, 0, 0, ?, ?)`
    ).run(pass1, pass2, version, nowIso());
    return;
  }
  if (existing.creds_version === version) return;
  // Ротация: новые хеши, сброс блокировок и полный отзыв сессий владельца.
  db.prepare(
    `UPDATE admin_credentials
        SET pass1_hash = ?, pass2_hash = ?, must_change = 0, creds_version = ?,
            failed_count = 0, locked_until = NULL, updated_at = ?
      WHERE id = 1`
  ).run(pass1, pass2, version, nowIso());
  db.prepare('DELETE FROM admin_sessions').run();
}
seedAdmin();

function getAdminCreds() {
  return db.prepare('SELECT * FROM admin_credentials WHERE id = 1').get();
}

function updateAdminCreds(patch) {
  const allowed = ['pass1_hash', 'pass2_hash', 'totp_secret', 'totp_enabled', 'must_change', 'failed_count', 'locked_until', 'last_login'];
  const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
  if (!entries.length) return getAdminCreds();
  const sql = `UPDATE admin_credentials SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = 1`;
  db.prepare(sql).run(...entries.map(([, v]) => v), nowIso());
  return getAdminCreds();
}

/* ------------------------------- seeding ------------------------------ */

const seedNews = db.transaction(() => {
  const row = db.prepare('SELECT COUNT(*) AS c FROM news').get();
  if (row.c > 0) return;
  const stmt = db.prepare('INSERT INTO news (title, body, tag, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(
    'CLAN KILLI: платформа запущена',
    'Открыта новая платформа клана: заявки через Steam и Discord, внутренний чат, состав по специализациям и раздел загрузок.\n\nПодать заявку может любой игрок Rust — решение по каждой анкете принимает владелец клана.',
    'clan',
    1,
    nowIso(),
    nowIso()
  );
  stmt.run(
    'KILLI ULTIMATE APP — раздел приложения',
    'Раздел приложения открыт: описание возможностей, история обновлений и актуальная версия. Первая сборка публикуется владельцем через админ-панель.',
    'app',
    0,
    nowIso(),
    nowIso()
  );
});
seedNews();

/* ------------------------------ utilities ----------------------------- */

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;

function createSession(userId) {
  const { randomToken, sha256 } = require('./security');
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(
    sha256(token),
    userId,
    nowIso(),
    expires,
    nowIso()
  );
  return { token, expires };
}

function createAdminSession(meta = {}) {
  const { randomToken, sha256 } = require('./security');
  const token = randomToken(32);
  const expires = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at, ip, ua, pending_auth) VALUES (?, ?, ?, ?, ?, ?)').run(
    sha256(token),
    nowIso(),
    expires,
    meta.ip || '',
    meta.ua || '',
    meta.pending ? 1 : 0
  );
  return { token, expires };
}

function cleanup() {
  const now = nowIso();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(new Date(Date.now() - 600000).toISOString());
}
setInterval(cleanup, 1000 * 60 * 30).unref();
cleanup();

module.exports = {
  db,
  getSettings,
  updateSettings,
  invalidateSettings,
  DEFAULT_SETTINGS,
  getAdminCreds,
  updateAdminCreds,
  createSession,
  createAdminSession,
  SESSION_TTL_MS,
  ADMIN_SESSION_TTL_MS,
  nowIso,
};
