'use strict';

const express = require('express');
const { db, nowIso, getSettings } = require('../db');
const { rateLimit, resetRateLimit } = require('../security');
const { requireChat, requireMember, serializeUser, hasMemberAccess, isModerator, canUseChat } = require('../helpers');
const bus = require('../lib/chatBus');

const router = express.Router();

const MAX_LENGTH = 800;

function serializeMessage(row) {
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  const user = serializeUser(author, author);
  return {
    id: row.id,
    channel: row.channel,
    body: row.deleted_at ? null : row.body,
    created_at: row.created_at,
    deleted: Boolean(row.deleted_at),
    deleted_reason: row.deleted_reason || null,
    author: author
      ? {
          id: author.id,
          nickname: author.nickname,
          avatar: author.avatar || author.steam_avatar || author.discord_avatar || null,
          specialization: author.specialization,
          role: author.role,
          online: author.last_seen ? Date.now() - new Date(author.last_seen).getTime() < 5 * 60 * 1000 : false,
        }
      : { id: row.user_id, nickname: 'Удалённый игрок', avatar: null, specialization: null, role: 'user', online: false },
    links: user ? user.links : { steam: false, discord: false },
  };
}

function canModerate(req) {
  return isModerator(req.user) || Boolean(req.admin);
}

function fetchMessages(limit = 80) {
  const rows = db
    .prepare("SELECT * FROM messages WHERE channel = 'general' ORDER BY id DESC LIMIT ?")
    .all(limit)
    .reverse();
  return rows.map(serializeMessage);
}

router.get('/chat/messages', requireMember, (req, res) => {
  const conversations = db
    .prepare("SELECT id, nickname FROM users WHERE role IN ('member','moderator') AND clan_status = 'active' ORDER BY nickname")
    .all();
  res.json({
    messages: fetchMessages(),
    online: conversations.filter((u) => {
      const row = db.prepare('SELECT last_seen FROM users WHERE id = ?').get(u.id);
      return row?.last_seen && Date.now() - new Date(row.last_seen).getTime() < 5 * 60 * 1000;
    }).length,
    total_members: conversations.length,
    enabled: getSettings().chat_enabled === '1',
    can_post: canUseChat(req.user),
    blocked_until: req.user.chat_blocked_until || null,
    moderator: canModerate(req),
  });
});

router.post('/chat/messages', requireChat, (req, res) => {
  const check = rateLimit(`chat:${req.user.id}`, { limit: 8, windowMs: 20000 });
  if (!check.allowed) {
    return res.status(429).json({
      error: 'rate_limited',
      message: `Слишком часто. Подождите ${check.retryAfter} с.`,
    });
  }
  const body = String((req.body && req.body.body) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
  if (body.length < 1) return res.status(400).json({ error: 'empty', message: 'Сообщение пустое.' });
  const now = nowIso();
  const info = db
    .prepare("INSERT INTO messages (channel, user_id, body, created_at) VALUES ('general', ?, ?, ?)")
    .run(req.user.id, body, now);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  const message = serializeMessage(row);
  bus.broadcast('message', message);
  res.status(201).json({ ok: true, message });
});

router.delete('/chat/messages/:id', requireMember, (req, res) => {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found', message: 'Сообщение не найдено.' });
  const own = row.user_id === req.user.id && !row.deleted_at;
  if (!own && !canModerate(req)) {
    return res.status(403).json({ error: 'forbidden', message: 'Можно удалять только свои сообщения.' });
  }
  const reason = canModerate(req) && !own ? String((req.body && req.body.reason) || '').slice(0, 200) : 'author';
  db.prepare('UPDATE messages SET deleted_at = ?, deleted_by = ?, deleted_reason = ? WHERE id = ?').run(
    nowIso(),
    String(req.user.id),
    reason,
    row.id
  );
  bus.broadcast('message_deleted', { id: Number(row.id), reason });
  res.json({ ok: true });
});

router.post('/chat/messages/:id/report', requireMember, (req, res) => {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) return res.status(404).json({ error: 'not_found', message: 'Сообщение не найдено.' });
  if (row.user_id === req.user.id) {
    return res.status(400).json({ error: 'self_report', message: 'Нельзя пожаловаться на своё сообщение.' });
  }
  const existing = db
    .prepare("SELECT id FROM message_reports WHERE message_id = ? AND reporter_id = ? AND status = 'open'")
    .get(row.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'duplicate', message: 'Жалоба уже отправлена.' });
  const reason = String((req.body && req.body.reason) || '').slice(0, 300);
  db.prepare("INSERT INTO message_reports (message_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)").run(
    row.id,
    req.user.id,
    reason,
    nowIso()
  );
  res.status(201).json({ ok: true, message: 'Жалоба отправлена владельцу клана.' });
});

router.get('/chat/stream', requireMember, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ online: bus.count() + 1 })}\n\n`);
  const remove = bus.addClient(res, req.user);
  req.on('close', () => {
    remove();
    try {
      res.end();
    } catch {
      /* ignore */
    }
  });
});

module.exports = { router };
