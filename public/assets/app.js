'use strict';

/* CLAN KILLI — application shell: router, navigation, theme, owner entry */

import { state, api, esc, toast, SETTINGS, avatarHtml, chatHub } from './core.js';
import { home, about, members, downloads, appPage, discordPage } from './views.js';
import { accountPage, applyPage, chatPage } from './account.js';
import { adminPage, openOwnerLogin } from './admin.js';

/* ---------------------------------- nav ---------------------------------- */

const NAV = [
  { key: 'home', hash: '#/', label: 'Главная', icon: '⌂' },
  { key: 'about', hash: '#/about', label: 'О клане', icon: '◈' },
  { key: 'members', hash: '#/members', label: 'Участники', icon: '❖' },
  { key: 'chat', hash: '#/chat', label: 'Чат', icon: '✉' },
  { key: 'downloads', hash: '#/downloads', label: 'Загрузки', icon: '⤓' },
  { key: 'app', hash: '#/app', label: 'Приложение', icon: '⚙' },
  { key: 'discord', hash: '#/discord', label: 'Discord', icon: '◉' },
  { key: 'account', hash: '#/account', label: 'Личный кабинет', icon: '◐' },
];

/* Mobile bottom bar: five shortcuts, «Ещё» opens the full sheet. */
const MOBILE_NAV = [
  { key: 'home', hash: '#/', label: 'Главная', icon: '⌂' },
  { key: 'chat', hash: '#/chat', label: 'Чат', icon: '✉' },
  { key: 'downloads', hash: '#/downloads', label: 'Файлы', icon: '⤓' },
  { key: 'app', hash: '#/app', label: 'App', icon: '⚙' },
  { key: 'more', hash: '#more', label: 'Ещё', icon: '☰' },
];

const ROUTES = {
  '': { view: home, nav: 'home', title: 'Главная' },
  '/': { view: home, nav: 'home', title: 'Главная' },
  '/about': { view: about, nav: 'about', title: 'О клане' },
  '/members': { view: members, nav: 'members', title: 'Участники' },
  '/chat': { view: chatPage, nav: 'chat', title: 'Чат клана' },
  '/downloads': { view: downloads, nav: 'downloads', title: 'Загрузки' },
  '/app': { view: appPage, nav: 'app', title: 'KILLI ULTIMATE APP' },
  '/discord': { view: discordPage, nav: 'discord', title: 'Discord' },
  '/account': { view: accountPage, nav: 'account', title: 'Личный кабинет' },
  '/apply': { view: applyPage, nav: 'account', title: 'Заявка в клан' },
  '/admin': { view: adminPage, nav: 'admin', title: 'Панель владельца', raw: true },
};

/* -------------------------------- elements ------------------------------- */

const el = {};
function cache() {
  el.app = document.getElementById('app');
  el.nav = document.getElementById('nav');
  el.brand = document.getElementById('brand');
  el.drawer = document.getElementById('navDrawer');
  el.toggle = document.getElementById('navToggle');
  el.mobileNav = document.getElementById('mobileNav');
  el.topbar = document.getElementById('topbar');
  el.accountBtn = document.getElementById('accountBtn');
  el.footerLinks = document.getElementById('footerLinks');
  el.footerNote = document.getElementById('footerNote');
  el.byFreak = document.getElementById('byFreak');
  el.boot = document.getElementById('boot');
}

/* --------------------------------- theme --------------------------------- */

const BG_STYLES = ['tech', 'grid', 'aurora', 'minimal'];

function applyTheme() {
  const s = SETTINGS();
  const root = document.documentElement;
  if (s.accent) root.style.setProperty('--accent', s.accent);
  if (s.accent_soft) root.style.setProperty('--accent-soft', s.accent_soft);
  const style = BG_STYLES.includes(s.bg_style) ? s.bg_style : 'tech';
  document.body.dataset.bg = style;
  document.body.classList.toggle('has-bg-image', Boolean(s.bg_image));
  const bgLayer = document.getElementById('bgImage');
  if (bgLayer) bgLayer.style.backgroundImage = s.bg_image ? `url("${s.bg_image}")` : '';
  renderBrand();
  renderFooter();
}

function renderBrand() {
  const s = SETTINGS();
  if (!el.brand) return;
  const name = s.site_name || 'CLAN KILLI';
  const mark = s.logo_image
    ? `<span class="brand-mark has-image"><img src="${esc(s.logo_image)}" alt="${esc(name)}" /></span>`
    : `<span class="brand-mark"><span>${esc(s.logo_letter || 'K')}</span></span>`;
  el.brand.innerHTML = `${mark}
    <span class="brand-text">
      <strong>${esc(name)}</strong>
      <small>${esc(s.site_tagline || 'Единство. Контроль. Сообщество.')}</small>
    </span>`;
}

function renderFooter() {
  const s = SETTINGS();
  if (el.footerNote) el.footerNote.textContent = s.footer_note || 'Закрытый игровой клан Rust. Сообщество по заявкам.';
  if (el.footerLinks) {
    el.footerLinks.innerHTML = NAV.slice(0, 7)
      .map((item) => `<a href="${item.hash}">${esc(item.label)}</a>`)
      .join('');
  }
  if (el.byFreak) el.byFreak.setAttribute('aria-label', 'BY FREAK');
}

/* ------------------------------ navigation ------------------------------- */

function chatBadge(item) {
  return item.key === 'chat' ? '<em class="nav-badge" hidden></em>' : '';
}

function navItemHtml(item, active) {
  return `<a class="nav-link${item.key === active ? ' is-active' : ''}" href="${item.hash}" data-nav="${item.key}">
    <i aria-hidden="true">${item.icon}</i><span>${esc(item.label)}</span>${chatBadge(item)}
  </a>`;
}

function renderNav(active) {
  if (el.nav) el.nav.innerHTML = NAV.map((item) => navItemHtml(item, active)).join('');
  if (el.drawer) {
    el.drawer.innerHTML = `
      <div class="drawer-head">
        <span class="drawer-title">Навигация</span>
        <button class="icon-btn" data-close-drawer aria-label="Закрыть меню">✕</button>
      </div>
      <nav class="drawer-list" aria-label="Мобильная навигация">
        ${NAV.map((item) => navItemHtml(item, active)).join('')}
      </nav>
      <div class="drawer-foot">
        ${accountChip()}
      </div>`;
  }
  if (el.mobileNav) {
    el.mobileNav.innerHTML = MOBILE_NAV.map(
      (item) =>
        `<button class="mobile-nav-item${item.key === active ? ' is-active' : ''}" data-mobile="${item.key}" type="button"${
          item.key === 'more' ? ' data-more="1"' : ''
        }><i aria-hidden="true">${item.icon}</i><span>${esc(item.label)}</span>${chatBadge(item)}</button>`
    ).join('');
  }
  renderAccountButton();
}

/* --------------------------- chat notifications -------------------------- */

const chatWatch = { off: null, count: 0, lastToastAt: 0 };

function chatEligible() {
  return Boolean(state.user && state.user.permissions && state.user.permissions.member);
}

function isChatRoute() {
  return String(state.route || '').indexOf('/chat') === 0;
}

function renderChatNotify() {
  const count = chatWatch.count;
  const label = count > 99 ? '99+' : String(count);
  const badges = document.querySelectorAll('.nav-badge');
  Array.prototype.forEach.call(badges, (node) => {
    node.textContent = label;
    node.hidden = count === 0;
  });
  const links = document.querySelectorAll('[data-nav="chat"], [data-mobile="chat"]');
  Array.prototype.forEach.call(links, (node) => {
    node.classList.toggle('has-unread', count > 0);
  });
}

function clearChatNotify() {
  if (!chatWatch.count) return;
  chatWatch.count = 0;
  renderChatNotify();
}

function startChatWatch() {
  if (chatWatch.off || !chatEligible() || !window.EventSource) return;
  chatWatch.off = chatHub.subscribe((name, payload) => {
    if (name !== 'message' || !payload || !payload.author) return;
    if (state.user && payload.author.id === state.user.id) return;
    if (isChatRoute()) return;
    chatWatch.count += 1;
    renderChatNotify();
    const now = Date.now();
    if (now - chatWatch.lastToastAt < 6000) return;
    chatWatch.lastToastAt = now;
    const body = String(payload.body || '').replace(/\s+/g, ' ').slice(0, 70);
    toast(`Чат · ${payload.author.nickname}: ${body}`, 'info');
  });
}

function stopChatWatch() {
  if (chatWatch.off) {
    try {
      chatWatch.off();
    } catch {
      /* ignore */
    }
    chatWatch.off = null;
  }
  chatHub.stop();
  chatWatch.count = 0;
  renderChatNotify();
}

function accountChip() {
  if (!state.user) {
    return `<a class="btn btn-ghost btn-block" href="#/account">Войти через Steam / Discord</a>`;
  }
  return `<a class="drawer-user" href="#/account">
      ${avatarHtml(state.user, 'avatar-sm')}
      <span><strong>${esc(state.user.nickname)}</strong><small>${esc(
    state.user.permissions && state.user.permissions.member ? 'участник клана' : 'зарегистрирован'
  )}</small></span>
    </a>`;
}

function renderAccountButton() {
  if (!el.accountBtn) return;
  if (!state.user) {
    el.accountBtn.href = '#/account';
    el.accountBtn.textContent = 'Личный кабинет';
    return;
  }
  el.accountBtn.href = '#/account';
  el.accountBtn.innerHTML = `${avatarHtml(state.user, 'avatar-xs')}<span>${esc(
    (state.user.nickname || '').split(' ')[0]
  )}</span>`;
}

function openDrawer() {
  if (!el.drawer) return;
  el.drawer.classList.add('is-open');
  document.body.classList.add('drawer-open');
  if (el.toggle) el.toggle.setAttribute('aria-expanded', 'true');
  const first = el.drawer.querySelector('.nav-link');
  if (first) first.focus({ preventScroll: true });
}

function closeDrawer() {
  if (!el.drawer) return;
  el.drawer.classList.remove('is-open');
  document.body.classList.remove('drawer-open');
  if (el.toggle) el.toggle.setAttribute('aria-expanded', 'false');
}

function toggleDrawer() {
  if (el.drawer && el.drawer.classList.contains('is-open')) closeDrawer();
  else openDrawer();
}

/* --------------------------------- router -------------------------------- */

let renderToken = 0;

function parseHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  if (!raw) return '/';
  const path = raw.split('?')[0];
  return path.startsWith('/') ? path : `/${path}`;
}

async function render() {
  const path = parseHash();
  const route = ROUTES[path] || null;
  if (!route) {
    state.route = path;
    renderNav('');
    el.app.innerHTML = `<section class="section">
      <div class="panel center notfound">
        <span class="kicker">404</span>
        <h1>Страница не найдена</h1>
        <p class="muted">Такого раздела в CLAN KILLI нет.</p>
        <a class="btn btn-primary" href="#/">На главную</a>
      </div>
    </section>`;
    document.title = 'CLAN KILLI — страница не найдена';
    return;
  }

  const token = ++renderToken;
  closeDrawer();
  state.route = path;
  renderNav(route.nav);
  if (chatEligible()) startChatWatch();
  else stopChatWatch();
  if (isChatRoute()) clearChatNotify();
  renderChatNotify();
  document.title = `${route.title} — ${(SETTINGS().site_name || 'CLAN KILLI')}`;
  window.scrollTo({ top: 0, behavior: 'auto' });

  if (route.raw) {
    el.app.className = 'shell shell-plain';
    el.app.innerHTML = '';
    await adminPage(el.app);
    return;
  }

  if (state.chat && typeof state.chat.close === 'function') {
    state.chat.close();
    state.chat = null;
  }

  el.app.className = 'shell';
  if (!el.app.querySelector('.route-view')) {
    el.app.innerHTML = '<div class="route-view"></div>';
  }
  const view = el.app.querySelector('.route-view');
  view.setAttribute('aria-busy', 'true');

  let result;
  try {
    result = await route.view();
  } catch (error) {
    if (token !== renderToken) return;
    view.innerHTML = `<section class="section"><div class="panel center">
        <span class="kicker">ошибка</span>
        <h2>Не удалось загрузить раздел</h2>
        <p class="muted">${esc(error.message || 'Повторите попытку позже.')}</p>
        <button class="btn btn-ghost" data-retry>Обновить</button>
      </div></section>`;
    view.removeAttribute('aria-busy');
    const retry = view.querySelector('[data-retry]');
    if (retry) retry.addEventListener('click', render);
    return;
  }
  if (token !== renderToken) return;

  const html = result && typeof result === 'object' ? result.html || '' : String(result || '');
  view.innerHTML = html;
  view.removeAttribute('aria-busy');
  view.classList.remove('route-in');
  // restart the entrance animation
  void view.offsetWidth;
  view.classList.add('route-in');

  if (result && typeof result.mount === 'function') {
    try {
      result.mount(view);
    } catch (error) {
      toast(error.message || 'Ошибка интерфейса', 'bad');
    }
  }
  if (result && typeof result.onMount === 'function') {
    try {
      result.onMount(view);
    } catch (error) {
      toast(error.message || 'Ошибка интерфейса', 'bad');
    }
  }
}

function onHashChange() {
  render();
}

/* ------------------------------ owner entry ------------------------------ */

function wireByFreak() {
  if (!el.byFreak) return;
  let clicks = 0;
  let timer = null;
  el.byFreak.addEventListener('click', () => {
    clicks += 1;
    clearTimeout(timer);
    el.byFreak.classList.add('is-tapped');
    setTimeout(() => el.byFreak.classList.remove('is-tapped'), 220);
    if (clicks >= 5) {
      clicks = 0;
      openOwnerLogin();
      return;
    }
    timer = setTimeout(() => {
      clicks = 0;
    }, 2600);
  });
}

/* ------------------------------- bootstrap ------------------------------- */

async function loadSite() {
  const site = await api('/site');
  state.site = site;
  state.user = site.user || null;
  state.owner = Boolean(site.owner);
  return site;
}

async function boot() {
  cache();
  wireByFreak();

  if (el.toggle) el.toggle.addEventListener('click', toggleDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });
  document.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('[data-close-drawer]');
    if (closeBtn) {
      closeDrawer();
      return;
    }
    const more = event.target.closest('[data-more]');
    if (more) {
      openDrawer();
      return;
    }
    const mobile = event.target.closest('[data-mobile]');
    if (mobile && mobile.dataset.mobile !== 'more') {
      const item = MOBILE_NAV.find((entry) => entry.key === mobile.dataset.mobile);
      if (item) {
        closeDrawer();
        if (location.hash === item.hash) render();
        else location.hash = item.hash;
      }
    }
    if (el.drawer && el.drawer.classList.contains('is-open')) {
      const link = event.target.closest('.nav-link');
      if (link) closeDrawer();
    }
  });
  // close the drawer on outside click
  document.addEventListener('mousedown', (event) => {
    if (!el.drawer || !el.drawer.classList.contains('is-open')) return;
    if (el.drawer.contains(event.target) || (el.toggle && el.toggle.contains(event.target))) return;
    closeDrawer();
  });

  window.addEventListener(
    'scroll',
    () => {
      if (el.topbar) el.topbar.classList.toggle('is-stuck', window.scrollY > 24);
    },
    { passive: true }
  );

  try {
    await loadSite();
  } catch (error) {
    if (el.boot) el.boot.remove();
    el.app.innerHTML = `<section class="section"><div class="panel center">
        <h2>Сервер недоступен</h2>
        <p class="muted">${esc(error.message || 'Не удалось получить данные сайта.')}</p>
        <button class="btn btn-primary" data-reload>Повторить</button>
      </div></section>`;
    const retry = el.app.querySelector('[data-reload]');
    if (retry) retry.addEventListener('click', boot);
    return;
  }

  applyTheme();
  renderNav('home');
  if (el.boot) el.boot.classList.add('is-hidden');
  setTimeout(() => {
    if (el.boot && el.boot.parentNode) el.boot.remove();
  }, 420);

  if (!location.hash) location.replace('#/');
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('killi:refresh', async () => {
    try {
      await loadSite();
      applyTheme();
    } catch {
      /* keep the previous snapshot */
    }
    render();
  });
  await render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
