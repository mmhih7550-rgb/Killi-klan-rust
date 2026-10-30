'use strict';

const express = require('express');
const { db, nowIso, createSession } = require('../db');
const { randomToken, setCookie, clearCookie, sha256 } = require('../security');
const config = require('../config');
const {
  USER_COOKIE,
  ADMIN_COOKIE,
  getBaseUrl,
  serializeUser,
  hasMemberAccess,
  isModerator,
} = require('../helpers');

const router = express.Router();

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const DISCORD_API = 'https://discord.com/api';

/* --------------------------------- utils -------------------------------- */

function oauthConfigured() {
  return {
    steam: true, // Steam OpenID needs no API key; only profile details are enriched with one
    steamProfile: Boolean(config.STEAM_API_KEY),
    discord: Boolean(config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET),
  };
}

function safeRedirect(value, fallback = '/account') {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

function loginFail(res, code, redirect = '/login') {
  return res.redirect(`${redirect}?error=${encodeURIComponent(code)}`);
}

function findUserByProvider(provider, id) {
  if (provider === 'steam') return db.prepare('SELECT * FROM users WHERE steam_id = ?').get(id);
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(id);
}

function createUserFromProfile(profile) {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO users (nickname, avatar, steam_id, steam_name, steam_avatar, steam_url,
        discord_id, discord_name, discord_avatar, discord_url, role, clan_status, created_at, updated_at, last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'user', 'active', ?, ?, ?)`
    )
    .run(
      profile.nickname,
      profile.avatar || null,
      profile.steamId || null,
      profile.steamName || null,
      profile.steamAvatar || null,
      profile.steamUrl || null,
      profile.discordId || null,
      profile.discordName || null,
      profile.discordAvatar || null,
      profile.discordUrl || null,
      now,
      now,
      now
    );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function linkProvider(user, provider, profile) {
  const now = nowIso();
  if (provider === 'steam') {
    db.prepare(
      'UPDATE users SET steam_id = ?, steam_name = ?, steam_avatar = ?, steam_url = ?, updated_at = ? WHERE id = ?'
    ).run(profile.steamId, profile.steamName, profile.steamAvatar, profile.steamUrl, now, user.id);
  } else {
    db.prepare(
      'UPDATE users SET discord_id = ?, discord_name = ?, discord_avatar = ?, discord_url = ?, updated_at = ? WHERE id = ?'
    ).run(profile.discordId, profile.discordName, profile.discordAvatar, profile.discordUrl, now, user.id);
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

function startSession(res, req, user) {
  const { token } = createSession(user.id);
  setCookie(res, USER_COOKIE, token, {
    maxAge: 1000 * 60 * 60 * 24 * 30,
    secure: getBaseUrl(req).startsWith('https'),
    sameSite: 'Lax',
  });
}

function saveOauthState(state) {
  db.prepare('INSERT INTO oauth_states (state, provider, link_user_id, redirect, created_at) VALUES (?, ?, ?, ?, ?)').run(
    state.state,
    state.provider,
    state.linkUserId || null,
    state.redirect || null,
    nowIso()
  );
}

function takeOauthState(state, provider) {
  if (!state) return null;
  const row = db.prepare('SELECT * FROM oauth_states WHERE state = ? AND provider = ?').get(String(state), provider);
  if (!row) return null;
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(String(state));
  if (Date.now() - new Date(row.created_at).getTime() > 10 * 60 * 1000) return null;
  return row;
}

function audit(kind, ok, req, detail) {
  db.prepare('INSERT INTO login_audit (kind, ok, ip, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
    kind,
    ok ? 1 : 0,
    req.ip || '',
    detail || '',
    nowIso()
  );
}

/* -------------------------------- Steam --------------------------------- */

router.get('/steam', (req, res) => {
  const base = getBaseUrl(req);
  const state = randomToken(16);
  saveOauthState({
    state,
    provider: 'steam',
    linkUserId: req.user && req.query.link === '1' ? req.user.id : null,
    redirect: safeRedirect(req.query.redirect, '/account'),
  });
  const proto = base.startsWith('https') ? 'https' : 'http';
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${base}/auth/steam/callback?state=${state}`,
    'openid.realm': base,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  res.redirect(`${STEAM_OPENID}?${params.toString()}`);
});

router.get('/steam/callback', async (req, res) => {
  try {
    const stateRow = takeOauthState(req.query.state, 'steam');
    const claimed = String(req.query['openid.claimed_id'] || '');
    const match = claimed.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
    if (!match || req.query['openid.mode'] !== 'id_res') return loginFail(res, 'steam_cancelled');

    // Verify the OpenID assertion directly with Steam (real server-side check).
    const verifyParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key.startsWith('openid.')) verifyParams.append(key, String(value));
    }
    verifyParams.set('openid.mode', 'check_authentication');
    const verifyRes = await fetch(STEAM_OPENID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verifyParams.toString(),
    });
    const verifyText = await verifyRes.text();
    if (!/is_valid\s*:\s*true/i.test(verifyText)) {
      audit('steam', false, req, 'invalid assertion');
      return loginFail(res, 'steam_invalid');
    }

    const steamId = match[1];
    let steamName = `Steam_${steamId.slice(-6)}`;
    let steamAvatar = null;
    let steamUrl = `https://steamcommunity.com/profiles/${steamId}`;
    if (config.STEAM_API_KEY) {
      try {
        const apiRes = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(
            config.STEAM_API_KEY
          )}&steamids=${steamId}`
        );
        const data = await apiRes.json();
        const player = data?.response?.players?.[0];
        if (player) {
          steamName = player.personaname || steamName;
          steamAvatar = player.avatarfull || null;
          steamUrl = player.profileurl || steamUrl;
        }
      } catch {
        /* profile enrichment is optional */
      }
    }

    const profile = { steamId, steamName, steamAvatar, steamUrl, nickname: steamName };
    const existing = findUserByProvider('steam', steamId);

    if (stateRow?.link_user_id) {
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(stateRow.link_user_id);
      if (!target) return loginFail(res, 'link_failed');
      if (existing && existing.id !== target.id) return loginFail(res, 'steam_already_linked', '/account');
      linkProvider(target, 'steam', profile);
      audit('steam-link', true, req, `user:${target.id}`);
      return res.redirect('/account?linked=steam');
    }

    let user = existing;
    if (!user) {
      user = createUserFromProfile(profile);
      audit('steam-register', true, req, `user:${user.id}`);
    } else {
      linkProvider(user, 'steam', profile);
      audit('steam-login', true, req, `user:${user.id}`);
    }
    if (user.clan_status === 'excluded') return loginFail(res, 'account_excluded');
    startSession(res, req, user);
    res.redirect(safeRedirect(stateRow?.redirect, hasMemberAccess(user) ? '/dashboard' : '/account'));
  } catch (err) {
    console.error('steam callback error', err);
    loginFail(res, 'steam_error');
  }
});

/* -------------------------------- Discord -------------------------------- */

router.get('/discord', (req, res) => {
  if (!config.DISCORD_CLIENT_ID || !config.DISCORD_CLIENT_SECRET) {
    return res.redirect('/login?error=discord_not_configured');
  }
  const base = getBaseUrl(req);
  const state = randomToken(16);
  saveOauthState({
    state,
    provider: 'discord',
    linkUserId: req.user && req.query.link === '1' ? req.user.id : null,
    redirect: safeRedirect(req.query.redirect, '/account'),
  });
  const params = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    redirect_uri: `${base}/auth/discord/callback`,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'consent',
  });
  res.redirect(`${DISCORD_API}/oauth2/authorize?${params.toString()}`);
});

router.get('/discord/callback', async (req, res) => {
  try {
    if (req.query.error) return loginFail(res, 'discord_cancelled');
    const stateRow = takeOauthState(req.query.state, 'discord');
    if (!stateRow) return loginFail(res, 'discord_state');
    const base = getBaseUrl(req);
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.DISCORD_CLIENT_ID,
        client_secret: config.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(req.query.code || ''),
        redirect_uri: `${base}/auth/discord/callback`,
      }).toString(),
    });
    if (!tokenRes.ok) {
      audit('discord', false, req, `token ${tokenRes.status}`);
      return loginFail(res, 'discord_token');
    }
    const tokenJson = await tokenRes.json();
    const meRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!meRes.ok) return loginFail(res, 'discord_profile');
    const me = await meRes.json();
    const avatar = me.avatar
      ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=160`
      : null;
    const profile = {
      discordId: me.id,
      discordName: me.global_name || me.username || `discord_${String(me.id).slice(-4)}`,
      discordAvatar: avatar,
      discordUrl: `https://discord.com/users/${me.id}`,
      nickname: me.global_name || me.username,
    };
    const existing = findUserByProvider('discord', me.id);

    if (stateRow.link_user_id) {
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(stateRow.link_user_id);
      if (!target) return loginFail(res, 'link_failed');
      if (existing && existing.id !== target.id) return loginFail(res, 'discord_already_linked', '/account');
      linkProvider(target, 'discord', profile);
      audit('discord-link', true, req, `user:${target.id}`);
      return res.redirect('/account?linked=discord');
    }

    let user = existing;
    if (!user) {
      user = createUserFromProfile(profile);
      audit('discord-register', true, req, `user:${user.id}`);
    } else {
      linkProvider(user, 'discord', profile);
      audit('discord-login', true, req, `user:${user.id}`);
    }
    if (user.clan_status === 'excluded') return loginFail(res, 'account_excluded');
    startSession(res, req, user);
    res.redirect(safeRedirect(stateRow?.redirect, hasMemberAccess(user) ? '/dashboard' : '/account'));
  } catch (err) {
    console.error('discord callback error', err);
    loginFail(res, 'discord_error');
  }
});

/* ----------------------------- session routes ---------------------------- */

router.post('/logout', (req, res) => {
  const token = req.cookies[USER_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  clearCookie(res, USER_COOKIE);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({
    user: serializeUser(req.user, req.user),
    owner: Boolean(req.admin),
    providers: oauthConfigured(),
  });
});

module.exports = { router, oauthConfigured, audit };
