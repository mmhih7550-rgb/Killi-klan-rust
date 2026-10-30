'use strict';

/* CLAN KILLI — shared client helpers (no inline scripts: served with strict CSP) */

export const state = {
  site: null,
  user: null,
  owner: false,
  route: '',
  chat: null,
  adminTab: 'applications',
};

export const SETTINGS = () => (state.site && state.site.settings) || {};

export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function fmtDate(value, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (!withTime) return date;
  return `${date} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

export function timeAgo(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} дн назад`;
  return fmtDate(value);
}

export function clockTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function splitLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function toast(message, kind = 'ok') {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.classList.add('toast-out'), 3400);
  setTimeout(() => node.remove(), 4000);
}

export async function api(path, options = {}) {
  const { method = 'GET', body, form, signal } = options;
  const init = { method, credentials: 'same-origin', headers: {}, signal };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => ({})) : { text: await res.text() };
  if (!res.ok) {
    const error = new Error(data.message || 'Не удалось выполнить запрос');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function formToObject(form) {
  const out = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = [].concat(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/* ------------------------------- modal -------------------------------- */

let modalCloser = null;

export function openModal(html, { wide = false, onMount } = {}) {
  closeModal();
  const root = document.getElementById('modalRoot');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('modal-in'));
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeModal();
  });
  const onKey = (event) => {
    if (event.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', onKey);
  modalCloser = () => {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('modal-in');
    setTimeout(() => overlay.remove(), 180);
  };
  const closeBtn = overlay.querySelector('[data-close]');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (onMount) onMount(overlay);
  return overlay;
}

export function closeModal() {
  if (modalCloser) {
    const fn = modalCloser;
    modalCloser = null;
    fn();
  }
}

export function confirmDialog(message, confirmLabel = 'Подтвердить') {
  return new Promise((resolve) => {
    const overlay = openModal(
      `<div class="modal-head"><h3>Подтверждение</h3><button class="icon-btn" data-close aria-label="Закрыть">✕</button></div>
       <p class="muted">${esc(message)}</p>
       <div class="modal-actions"><button class="btn btn-ghost" data-cancel>Отмена</button><button class="btn btn-danger" data-ok>${esc(
         confirmLabel
       )}</button></div>`
    );
    overlay.querySelector('[data-ok]').addEventListener('click', () => {
      closeModal();
      resolve(true);
    });
    overlay.querySelector('[data-cancel]').addEventListener('click', () => {
      closeModal();
      resolve(false);
    });
    overlay.querySelector('[data-close]').addEventListener('click', () => {
      closeModal();
      resolve(false);
    });
  });
}

/* ------------------------------ constants ------------------------------ */

export const SPECS = {
  combat: {
    label: 'COMBAT',
    title: 'Боец',
    icon: '⚔',
    text: 'PvP, рейды, защита базы и участие в сражениях.',
  },
  builder: {
    label: 'BUILDER',
    title: 'Строитель',
    icon: '🏗',
    text: 'Базы, укрепления, оборонные проекты и планировка.',
  },
  farmer: {
    label: 'FARMER',
    title: 'Фармер',
    icon: '⛏',
    text: 'Ресурсы, сбор материалов и снабжение клана.',
  },
  electric: {
    label: 'ELECTRIC',
    title: 'Электрик',
    icon: '⚡',
    text: 'Схемы, автоматизация, ловушки и технические системы.',
  },
  other: {
    label: 'OTHER',
    title: 'Другое',
    icon: '✦',
    text: 'Иные навыки: логистика, разведка, медиа, торговля.',
  },
};

export const HOURS = {
  '700-1000': '700–1000 часов',
  '1000-2000': '1000–2000 часов',
  '2000-3000': '2000–3000 часов',
  '3000-5000': '3000–5000 часов',
  '5000-plus': '5000+ часов',
  under700: 'Меньше 700 часов (Исключение)',
};

export const STATUS_META = {
  pending: { label: 'Ожидает рассмотрения', cls: 'warn' },
  info_requested: { label: 'Запрошена информация', cls: 'info' },
  accepted: { label: 'Принят', cls: 'ok' },
  rejected: { label: 'Отклонён', cls: 'bad' },
};

export function specMeta(key) {
  return SPECS[key] || { label: key || '—', title: key || '—', icon: '✦', text: '' };
}

export function statusMeta(key) {
  return STATUS_META[key] || { label: key || '—', cls: 'muted' };
}

export function avatarHtml(person, extra = '') {
  const name = person && person.nickname ? person.nickname : 'KILLI';
  if (person && person.avatar) {
    return `<span class="avatar ${extra}"><img src="${esc(person.avatar)}" alt="${esc(name)}" loading="lazy" /></span>`;
  }
  return `<span class="avatar ${extra} avatar-letter">${esc(String(name).slice(0, 1).toUpperCase())}</span>`;
}

export function statusDot(status) {
  const key = (status && status.key) || 'offline';
  return `<span class="status status-${esc(key)}"><i></i>${esc((status && status.label) || 'Offline')}</span>`;
}
