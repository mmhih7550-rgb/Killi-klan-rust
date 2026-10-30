'use strict';

/* CLAN KILLI — closed owner panel (BY FREAK). All rights are enforced server-side. */

import {
  state,
  esc,
  api,
  toast,
  fmtDate,
  timeAgo,
  confirmDialog,
  openModal,
  closeModal,
  SPECS,
  HOURS,
  specMeta,
  statusMeta,
  avatarHtml,
  formToObject,
  SETTINGS,
} from './core.js';

/* ------------------------- owner login (5 clicks) ------------------------ */

function fieldError(host, message) {
  const box = host.querySelector('[data-error]');
  if (!box) return;
  box.textContent = message || '';
  box.classList.toggle('show', Boolean(message));
}

function busy(host, on) {
  host.querySelectorAll('button, input').forEach((el) => {
    el.disabled = Boolean(on);
  });
  host.classList.toggle('is-busy', Boolean(on));
}

export function openOwnerLogin() {
  if (state.owner) {
    location.hash = '#/admin';
    return;
  }
  const overlay = openModal(
    `<div class="owner-modal">
      <div class="owner-modal-glow"></div>
      <div class="owner-tag">BY FREAK</div>
      <h3 class="owner-title">Закрытая панель владельца</h3>
      <p class="muted small">Доступ только для владельца CLAN KILLI. Все попытки входа фиксируются.</p>
      <div id="ownerStep" class="owner-step"></div>
    </div>`
  );
  const host = overlay.querySelector('#ownerStep');
  renderStepOne(host);
}

function renderStepOne(host) {
  host.innerHTML = `
    <form class="owner-form" data-form="step1" autocomplete="off">
      <label class="field">
        <span>Первый пароль</span>
        <input class="input" type="password" name="password" required minlength="4" autocomplete="off" placeholder="••••••••" />
      </label>
      <p class="form-error" data-error></p>
      <button class="btn btn-primary btn-block" type="submit">Продолжить</button>
      <p class="muted tiny">Этап 1 из 2. Пять нажатий на «BY FREAK» лишь открывают форму — защита выполняется на сервере.</p>
    </form>`;
  const form = host.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError(host, '');
    busy(host, true);
    try {
      const data = await api('/owner/login', {
        method: 'POST',
        body: { password: form.password.value },
      });
      renderStepTwo(host, data);
    } catch (error) {
      fieldError(host, error.message);
      if (error.data && error.data.locked_until) {
        fieldError(host, `${error.message} Блокировка снимается автоматически.`);
      }
      busy(host, false);
    }
  });
}

function renderStepTwo(host, info = {}) {
  host.innerHTML = `
    <form class="owner-form" data-form="step2" autocomplete="off">
      <div class="owner-step-badge">Этап 2 из 2</div>
      <label class="field">
        <span>Второй пароль</span>
        <input class="input" type="password" name="password" required autocomplete="off" placeholder="••••••••" />
      </label>
      ${
        info.totp_enabled
          ? `<label class="field"><span>Код 2FA</span>
             <input class="input" name="code" inputmode="numeric" maxlength="6" placeholder="000000" required /></label>`
          : ''
      }
      <p class="form-error" data-error></p>
      <button class="btn btn-primary btn-block" type="submit">Войти в панель</button>
      <button class="btn btn-ghost btn-block" type="button" data-restart>Начать заново</button>
    </form>`;
  const form = host.querySelector('form');
  host.querySelector('[data-restart]').addEventListener('click', () => {
    api('/owner/logout', { method: 'POST' }).catch(() => {});
    renderStepOne(host);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError(host, '');
    busy(host, true);
    try {
      const data = await api('/owner/verify', {
        method: 'POST',
        body: { password: form.password.value, code: form.code ? form.code.value : '' },
      });
      if (data.must_change) {
        renderBootstrap(host);
        return;
      }
      completeLogin();
    } catch (error) {
      fieldError(host, error.message);
      busy(host, false);
      if (error.data && (error.data.error === 'bad_password' || error.data.error === 'no_step')) {
        setTimeout(() => renderStepOne(host), 900);
      }
    }
  });
}

function renderBootstrap(host) {
  host.innerHTML = `
    <form class="owner-form" data-form="bootstrap">
      <div class="owner-step-badge warn">Требуется смена стартовых паролей</div>
      <p class="muted small">Первоначальные пароли нужно заменить перед работой с панелью. Минимум 10 символов, пароли должны отличаться.</p>
      <label class="field"><span>Новый первый пароль</span>
        <input class="input" type="password" name="pass1" required minlength="10" autocomplete="new-password" /></label>
      <label class="field"><span>Новый второй пароль</span>
        <input class="input" type="password" name="pass2" required minlength="10" autocomplete="new-password" /></label>
      <p class="form-error" data-error></p>
      <button class="btn btn-primary btn-block" type="submit">Сохранить и открыть панель</button>
    </form>`;
  const form = host.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError(host, '');
    busy(host, true);
    try {
      await api('/owner/security/bootstrap', {
        method: 'POST',
        body: { pass1: form.pass1.value, pass2: form.pass2.value },
      });
      toast('Пароли владельца обновлены.');
      completeLogin();
    } catch (error) {
      fieldError(host, error.message);
      busy(host, false);
    }
  });
}

function completeLogin() {
  state.owner = true;
  closeModal();
  toast('Добро пожаловать, FREAK. Панель открыта.');
  location.hash = '#/admin';
  window.dispatchEvent(new CustomEvent('killi:refresh'));
}

/* --------------------------------- shell -------------------------------- */

const TABS = [
  { id: 'applications', label: 'Заявки', icon: '📝' },
  { id: 'members', label: 'Участники', icon: '👥' },
  { id: 'chat', label: 'Чат', icon: '💬' },
  { id: 'downloads', label: 'Загрузки', icon: '📦' },
  { id: 'app', label: 'Приложение', icon: '🚀' },
  { id: 'discord', label: 'Discord', icon: '🎧' },
  { id: 'news', label: 'Новости', icon: '📣' },
  { id: 'stats', label: 'Статистика', icon: '📊' },
  { id: 'security', label: 'Безопасность', icon: '🔐' },
  { id: 'design', label: 'Дизайн', icon: '🎨' },
];

export async function adminPage(root) {
  if (!state.owner) {
    root.innerHTML = `
      <section class="section">
        <div class="panel center">
          <div class="owner-tag">BY FREAK</div>
          <h2>Панель владельца закрыта</h2>
          <p class="muted">Вход выполняется через секретную форму: пять нажатий на надпись «BY FREAK» в подвале сайта.</p>
          <button class="btn btn-primary" data-login>Открыть форму входа</button>
        </div>
      </section>`;
    root.querySelector('[data-login]').addEventListener('click', openOwnerLogin);
    return;
  }

  root.innerHTML = `
    <section class="section admin">
      <div class="admin-head">
        <div>
          <span class="badge badge-owner">BY FREAK</span>
          <h1>Панель управления кланом</h1>
          <p class="muted small">Все изменения применяются к сайту сразу после сохранения.</p>
        </div>
        <div class="admin-head-actions">
          <a class="btn btn-ghost" href="#/">На сайт</a>
          <button class="btn btn-ghost" data-logout>Выйти</button>
        </div>
      </div>
      <div class="admin-body">
        <aside class="admin-tabs" role="tablist">
          ${TABS.map(
            (tab) =>
              `<button class="admin-tab${
                state.adminTab === tab.id ? ' active' : ''
              }" data-tab="${tab.id}" role="tab"><i>${tab.icon}</i><span>${tab.label}</span></button>`
          ).join('')}
        </aside>
        <div class="admin-content" id="adminContent"><div class="loader">Загрузка данных…</div></div>
      </div>
    </section>`;

  root.querySelector('[data-logout]').addEventListener('click', async () => {
    try {
      await api('/owner/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    state.owner = false;
    toast('Сессия владельца закрыта.', 'warn');
    location.hash = '#/';
    window.dispatchEvent(new CustomEvent('killi:refresh'));
  });

  const content = root.querySelector('#adminContent');
  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.adminTab = btn.dataset.tab;
      root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      loadTab(content, state.adminTab);
    });
  });
  loadTab(content, state.adminTab);
}

async function loadTab(content, tab) {
  content.innerHTML = '<div class="loader">Загрузка данных…</div>';
  try {
    if (tab === 'applications') return await tabApplications(content);
    if (tab === 'members') return await tabMembers(content);
    if (tab === 'chat') return await tabChat(content);
    if (tab === 'downloads') return await tabDownloads(content);
    if (tab === 'app') return await tabApp(content);
    if (tab === 'discord') return await tabDiscord(content);
    if (tab === 'news') return await tabNews(content);
    if (tab === 'stats') return await tabStats(content);
    if (tab === 'security') return await tabSecurity(content);
    if (tab === 'design') return await tabDesign(content);
    content.innerHTML = '<p class="muted">Неизвестный раздел.</p>';
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      state.owner = false;
      content.innerHTML = '<div class="panel center"><h3>Сессия истекла</h3><p class="muted">Войдите заново через «BY FREAK» в подвале.</p></div>';
      return;
    }
    content.innerHTML = `<div class="panel"><h3>Ошибка</h3><p class="muted">${esc(error.message)}</p></div>`;
  }
}

function statCard(label, value, hint = '') {
  return `<div class="admin-stat"><span class="admin-stat-value">${esc(value)}</span><span class="admin-stat-label">${esc(
    label
  )}</span>${hint ? `<span class="admin-stat-hint">${esc(hint)}</span>` : ''}</div>`;
}

function bar(label, value, total) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return `<div class="admin-bar"><span>${esc(label)}</span><div class="admin-bar-track"><i style="width:${pct}%"></i></div><b>${value}</b></div>`;
}

function answer(label, value) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  return `<div class="admin-answer"><span>${esc(label)}</span><p>${esc(text)}</p></div>`;
}

/* ------------------------------ applications ---------------------------- */

async function tabApplications(content) {
  const filters = { status: 'pending', spec: 'all', hours: 'all', exception: 'all', q: '' };

  const draw = async () => {
    const params = new URLSearchParams({
      status: filters.status,
      spec: filters.spec,
      hours: filters.hours,
      exception: filters.exception,
      q: filters.q,
    });
    const data = await api(`/admin/applications?${params.toString()}`);
    const counts = data.counts || {};
    content.innerHTML = `
      <div class="admin-section-head">
        <h2>Заявки в клан</h2>
        <div class="chips">
          <span class="chip">Ожидают: ${counts.pending || 0}</span>
          <span class="chip">Инфо: ${counts.info_requested || 0}</span>
          <span class="chip">Приняты: ${counts.accepted || 0}</span>
          <span class="chip">Отклонены: ${counts.rejected || 0}</span>
        </div>
      </div>
      <form class="admin-filters" data-filters>
        <label class="field"><span>Статус</span>
          <select class="input" name="status">
            ${[
              ['pending', 'Ожидают рассмотрения'],
              ['info_requested', 'Запрошена информация'],
              ['accepted', 'Принятые'],
              ['rejected', 'Отклонённые'],
              ['all', 'Все заявки'],
            ]
              .map(([v, l]) => `<option value="${v}"${filters.status === v ? ' selected' : ''}>${l}</option>`)
              .join('')}
          </select>
        </label>
        <label class="field"><span>Специализация</span>
          <select class="input" name="spec">
            <option value="all">Все</option>
            ${Object.entries(SPECS)
              .map(([key, meta]) => `<option value="${key}"${filters.spec === key ? ' selected' : ''}>${meta.label}</option>`)
              .join('')}
          </select>
        </label>
        <label class="field"><span>Часы</span>
          <select class="input" name="hours">
            <option value="all">Любые</option>
            <option value="over700"${filters.hours === 'over700' ? ' selected' : ''}>700+ часов</option>
            <option value="under700"${filters.hours === 'under700' ? ' selected' : ''}>Меньше 700</option>
          </select>
        </label>
        <label class="field"><span>Исключения</span>
          <select class="input" name="exception">
            <option value="all">Все</option>
            <option value="only"${filters.exception === 'only' ? ' selected' : ''}>Только исключения</option>
            <option value="exclude"${filters.exception === 'exclude' ? ' selected' : ''}>Без исключений</option>
          </select>
        </label>
        <label class="field"><span>Поиск</span>
          <input class="input" name="q" value="${esc(filters.q)}" placeholder="Никнейм" />
        </label>
        <button class="btn btn-primary" type="submit">Применить</button>
      </form>
      <div class="admin-list">
        ${
          data.applications.length
            ? data.applications.map(applicationCard).join('')
            : '<div class="panel center"><p class="muted">Заявок по этим фильтрам нет.</p></div>'
        }
      </div>`;

    content.querySelector('[data-filters]').addEventListener('submit', (event) => {
      event.preventDefault();
      const values = formToObject(event.target);
      Object.assign(filters, {
        status: values.status || 'pending',
        spec: values.spec || 'all',
        hours: values.hours || 'all',
        exception: values.exception || 'all',
        q: values.q || '',
      });
      draw();
    });

    content.querySelectorAll('[data-decision]').forEach((btn) => {
      btn.addEventListener('click', () => decide(btn.dataset.id, btn.dataset.decision, draw));
    });
  };

  await draw();
}

function applicationCard(app) {
  const user = app.user || {};
  const spec = specMeta(app.specialization);
  const extras = (app.extra_roles || []).map((r) => specMeta(r).label).join(' · ');
  const status = statusMeta(app.status);
  return `<article class="admin-card app-card${app.is_exception ? ' is-exception' : ''}">
    <header class="admin-card-head">
      <div class="admin-card-person">
        ${avatarHtml(user)}
        <div>
          <h3>${esc(app.nickname)} ${app.is_exception ? '<span class="badge badge-warn">Исключение</span>' : ''}</h3>
          <p class="muted small">${esc(spec.label)}${extras ? ` · доп: ${esc(extras)}` : ''} · ${esc(
    HOURS[app.hours_range] || app.hours_range || '—'
  )}</p>
        </div>
      </div>
      <div class="admin-card-meta">
        <span class="status-pill ${status.cls}">${esc(status.label)}</span>
        <span class="muted tiny">${esc(fmtDate(app.created_at, true))}</span>
      </div>
    </header>
    <div class="admin-card-body">
      ${answer('Ник в Rust', app.rust_nick)}
      ${answer('Steam', app.steam_link)}
      ${answer('Discord', app.discord_link)}
      ${answer('Часы в Rust', HOURS[app.hours_range] || app.hours_range)}
      ${answer('Режимы игры', app.game_modes)}
      ${answer('Обычное время игры', app.play_time)}
      ${answer('Микрофон', app.has_mic === '1' || app.has_mic === 1 || app.has_mic === true ? 'Есть' : 'Нет')}
      ${answer('Часовой пояс', app.timezone)}
      ${answer('Опыт в кланах', app.clan_experience)}
      ${answer('Дополнительные навыки', app.extra_skills)}
      ${answer('Почему хочет вступить', app.why_join)}
      ${answer('Дополнительно', app.extra_info)}
      ${
        app.is_exception
          ? `<div class="admin-exception">
              <h4>Исключение: меньше 700 часов</h4>
              ${answer('Почему стоит принять', app.exception_why)}
              ${answer('Навыки', app.exception_skills)}
              ${answer('Опыт в клане', app.exception_clan_experience)}
              ${answer('Чем полезен', app.exception_useful)}
            </div>`
          : ''
      }
      ${app.admin_note ? `<div class="admin-note"><span>Заметка владельца</span><p>${esc(app.admin_note)}</p></div>` : ''}
    </div>
    <footer class="admin-card-actions">
      <button class="btn btn-primary btn-sm" data-decision="accept" data-id="${app.id}">Принять</button>
      <button class="btn btn-ghost btn-sm" data-decision="request_info" data-id="${app.id}">Запросить информацию</button>
      <button class="btn btn-danger btn-sm" data-decision="reject" data-id="${app.id}">Отклонить</button>
      <span class="muted tiny">ID ${app.id}${user.nickname ? ` · аккаунт ${esc(user.nickname)}` : ''}</span>
    </footer>
  </article>`;
}

function decide(id, action, reload) {
  const labels = {
    accept: 'Принять игрока в клан',
    reject: 'Отклонить заявку',
    request_info: 'Запросить дополнительную информацию',
  };
  const overlay = openModal(
    `<div class="modal-head"><h3>${esc(labels[action] || action)}</h3>
      <button class="icon-btn" data-close aria-label="Закрыть">✕</button></div>
     <form class="stack">
       <label class="field"><span>Комментарий${action === 'request_info' ? ' (обязательно)' : ' (необязательно)'}</span>
         <textarea class="input" name="note" rows="3" placeholder="Что уточнить или почему такое решение"></textarea></label>
       <div class="modal-actions">
         <button class="btn btn-ghost" type="button" data-close>Отмена</button>
         <button class="btn ${action === 'reject' ? 'btn-danger' : 'btn-primary'}" type="submit">Подтвердить</button>
       </div>
     </form>`
  );
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const note = overlay.querySelector('[name="note"]').value.trim();
    if (action === 'request_info' && note.length < 5) {
      toast('Опишите, что нужно уточнить.', 'error');
      return;
    }
    try {
      const data = await api(`/admin/applications/${id}/decision`, {
        method: 'POST',
        body: { action, note },
      });
      closeModal();
      toast(data.message || 'Готово.');
      reload();
      window.dispatchEvent(new CustomEvent('killi:refresh'));
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/* -------------------------------- members ------------------------------- */

async function tabMembers(content) {
  const filters = { q: '', spec: 'all' };

  const draw = async () => {
    const params = new URLSearchParams({ q: filters.q, spec: filters.spec });
    const data = await api(`/admin/members?${params.toString()}`);
    const stats = data.stats || {};
    content.innerHTML = `
      <div class="admin-section-head"><h2>Участники и аккаунты</h2></div>
      <div class="admin-stats">
        ${statCard('Всего участников', stats.total || 0)}
        ${statCard('Модераторы', stats.moderators || 0)}
        ${statCard('Ограничены', stats.restricted || 0)}
        ${statCard('Combat', stats.combat || 0)}
        ${statCard('Builder', stats.builder || 0)}
        ${statCard('Farmer', stats.farmer || 0)}
        ${statCard('Electric', stats.electric || 0)}
        ${statCard('Other', stats.other || 0)}
      </div>
      <form class="admin-filters" data-filters>
        <label class="field"><span>Поиск</span><input class="input" name="q" value="${esc(filters.q)}" placeholder="Никнейм или Steam ID" /></label>
        <label class="field"><span>Специализация</span>
          <select class="input" name="spec">
            <option value="all">Все</option>
            ${Object.entries(SPECS)
              .map(([key, meta]) => `<option value="${key}"${filters.spec === key ? ' selected' : ''}>${meta.label}</option>`)
              .join('')}
          </select>
        </label>
        <button class="btn btn-primary" type="submit">Найти</button>
      </form>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Игрок</th><th>Роль</th><th>Статус</th><th>Steam / Discord</th><th>В клане с</th><th></th></tr></thead>
          <tbody>
            ${
              data.members.length
                ? data.members
                    .map(
                      (m) => `<tr>
                        <td><div class="admin-person">${avatarHtml(m)}<div><b>${esc(m.nickname)}</b>
                          <span class="muted tiny">${esc(specMeta(m.specialization).label)}${
                        (m.extra_roles || []).length ? ` +${m.extra_roles.length}` : ''
                      }</span></div></div></td>
                        <td><span class="chip">${esc(
                          m.role === 'moderator' ? 'Модератор' : m.role === 'member' ? 'Участник' : 'Гость'
                        )}</span></td>
                        <td><span class="status-pill ${m.clan_status === 'restricted' ? 'warn' : m.role === 'user' ? 'muted' : 'ok'}">${esc(
                          m.clan_status === 'restricted' ? 'Ограничен' : m.clan_status === 'excluded' ? 'Исключён' : 'Активен'
                        )}</span></td>
                        <td class="muted tiny">${m.steam && m.steam.id ? `Steam ${esc(m.steam.id)}` : 'Steam —'}<br />${
                        m.discord && m.discord.id ? `Discord ${esc(m.discord.name || m.discord.id)}` : 'Discord —'
                      }</td>
                        <td class="muted tiny">${esc(fmtDate(m.member_since))}</td>
                        <td class="admin-row-actions">
                          <button class="btn btn-ghost btn-sm" data-edit="${m.id}">Изменить</button>
                          <button class="btn btn-danger btn-sm" data-kick="${m.id}" data-name="${esc(m.nickname)}">Исключить</button>
                        </td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="6" class="muted center">Никого не найдено.</td></tr>'
            }
          </tbody>
        </table>
      </div>`;

    content.querySelector('[data-filters]').addEventListener('submit', (event) => {
      event.preventDefault();
      const values = formToObject(event.target);
      filters.q = values.q || '';
      filters.spec = values.spec || 'all';
      draw();
    });
    content.querySelectorAll('[data-edit]').forEach((btn) => {
      const member = data.members.find((m) => String(m.id) === btn.dataset.edit);
      btn.addEventListener('click', () => memberModal(member, draw));
    });
    content.querySelectorAll('[data-kick]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(`Исключить ${btn.dataset.name} из клана? Доступ к чату и файлам закроется.`, 'Исключить');
        if (!ok) return;
        try {
          const res = await api(`/admin/members/${btn.dataset.kick}/kick`, { method: 'POST' });
          toast(res.message || 'Участник исключён.');
          draw();
          window.dispatchEvent(new CustomEvent('killi:refresh'));
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  };

  await draw();
}

function memberModal(member, reload) {
  if (!member) return;
  const extras = member.extra_roles || [];
  const overlay = openModal(
    `<div class="modal-head"><h3>${esc(member.nickname)}</h3>
      <button class="icon-btn" data-close aria-label="Закрыть">✕</button></div>
     <form class="stack">
       <div class="grid-2">
         <label class="field"><span>Никнейм</span><input class="input" name="nickname" value="${esc(member.nickname)}" /></label>
         <label class="field"><span>Ник в Rust</span><input class="input" name="rust_nick" value="${esc(member.rust_nick || '')}" /></label>
         <label class="field"><span>Основная специализация</span>
           <select class="input" name="specialization">
             <option value="">—</option>
             ${Object.entries(SPECS)
               .map(([k, m]) => `<option value="${k}"${member.specialization === k ? ' selected' : ''}>${m.label}</option>`)
               .join('')}
           </select></label>
         <label class="field"><span>Часы</span>
           <select class="input" name="rust_hours">
             <option value="">—</option>
             ${Object.entries(HOURS)
               .map(([k, l]) => `<option value="${k}"${member.rust_hours === k ? ' selected' : ''}>${l}</option>`)
               .join('')}
           </select></label>
         <label class="field"><span>Роль аккаунта</span>
           <select class="input" name="role">
             ${[
               ['user', 'Гость'],
               ['member', 'Участник'],
               ['moderator', 'Модератор'],
             ]
               .map(([v, l]) => `<option value="${v}"${member.role === v ? ' selected' : ''}>${l}</option>`)
               .join('')}
           </select></label>
         <label class="field"><span>Статус в клане</span>
           <select class="input" name="clan_status">
             ${[
               ['active', 'Активен'],
               ['restricted', 'Ограничен'],
               ['excluded', 'Исключён'],
             ]
               .map(([v, l]) => `<option value="${v}"${member.clan_status === v ? ' selected' : ''}>${l}</option>`)
               .join('')}
           </select></label>
         <label class="field"><span>Ручной статус</span>
           <select class="input" name="manual_status">
             ${[
               ['offline', 'Offline'],
               ['online', 'Online'],
               ['afk', 'AFK'],
               ['ingame', 'In Game (вручную)'],
             ]
               .map(([v, l]) => `<option value="${v}"${member.manual_status === v ? ' selected' : ''}>${l}</option>`)
               .join('')}
           </select></label>
         <label class="field"><span>Блок чата (минут, 0 = снять)</span>
           <input class="input" type="number" min="0" max="43200" name="chat_block_minutes" value="0" /></label>
       </div>
       <fieldset class="field"><legend>Дополнительные роли</legend>
         <div class="chips">
           ${Object.entries(SPECS)
             .map(
               ([k, m]) => `<label class="chip-check"><input type="checkbox" name="extra_roles" value="${k}"${
                 extras.includes(k) ? ' checked' : ''
               } /><span>${m.label}</span></label>`
             )
             .join('')}
         </div>
       </fieldset>
       <label class="field"><span>Заметка о игроке</span>
         <textarea class="input" name="bio" rows="3">${esc(member.bio || '')}</textarea></label>
       <div class="modal-actions">
         <button class="btn btn-ghost" type="button" data-close>Отмена</button>
         <button class="btn btn-primary" type="submit">Сохранить</button>
       </div>
     </form>`,
    { wide: true }
  );
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const extra_roles = [...form.querySelectorAll('input[name="extra_roles"]:checked')].map((i) => i.value);
    const payload = {
      nickname: form.nickname.value,
      rust_nick: form.rust_nick.value,
      specialization: form.specialization.value,
      rust_hours: form.rust_hours.value || undefined,
      role: form.role.value,
      clan_status: form.clan_status.value,
      manual_status: form.manual_status.value,
      chat_block_minutes: Number(form.chat_block_minutes.value) || 0,
      bio: form.bio.value,
      extra_roles,
    };
    try {
      await api(`/admin/members/${member.id}`, { method: 'PATCH', body: payload });
      closeModal();
      toast('Данные участника обновлены.');
      reload();
      window.dispatchEvent(new CustomEvent('killi:refresh'));
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/* --------------------------------- chat --------------------------------- */

async function tabChat(content) {
  const data = await api('/admin/chat');
  content.innerHTML = `
    <div class="admin-section-head">
      <h2>Модерация чата</h2>
      <span class="chip">${data.enabled ? 'Чат включён' : 'Чат отключён в настройках'}</span>
    </div>
    <h3 class="admin-sub">Жалобы участников</h3>
    <div class="admin-list">
      ${
        data.reports.length
          ? data.reports
              .map(
                (r) => `<article class="admin-card report-card${r.status === 'open' ? ' is-open' : ''}">
                  <header class="admin-card-head">
                    <div><h4>Жалоба #${r.id}</h4>
                      <p class="muted small">На сообщение ${esc(r.author)} · от ${esc(r.reporter)} · ${esc(fmtDate(r.created_at, true))}</p></div>
                    <span class="status-pill ${r.status === 'open' ? 'warn' : 'ok'}">${r.status === 'open' ? 'Открыта' : 'Решена'}</span>
                  </header>
                  <p class="report-body">«${esc(r.message_body || 'сообщение удалено')}»</p>
                  ${r.reason ? `<p class="muted small">Причина: ${esc(r.reason)}</p>` : ''}
                  <div class="admin-card-actions">
                    <button class="btn btn-primary btn-sm" data-resolve="${r.id}"${r.status !== 'open' ? ' disabled' : ''}>Отметить решённой</button>
                    <button class="btn btn-danger btn-sm" data-delmsg="${r.message_id}">Удалить сообщение</button>
                  </div>
                </article>`
              )
              .join('')
          : '<div class="panel center"><p class="muted">Жалоб нет.</p></div>'
      }
    </div>
    <h3 class="admin-sub">Последние сообщения</h3>
    <div class="admin-list admin-messages">
      ${
        data.messages.length
          ? data.messages
              .map(
                (m) => `<div class="admin-message${m.deleted ? ' is-deleted' : ''}">
                  <div class="admin-message-head"><b>${esc(m.author.nickname)}</b>
                    <span class="muted tiny">${esc(fmtDate(m.created_at, true))}</span>
                    ${m.deleted ? '<span class="badge badge-warn">удалено</span>' : ''}</div>
                  <p>${m.deleted ? '<i class="muted">сообщение удалено</i>' : esc(m.body)}</p>
                  ${m.deleted ? '' : `<button class="btn btn-ghost btn-sm" data-delmsg="${m.id}">Удалить</button>`}
                </div>`
              )
              .join('')
          : '<p class="muted">Сообщений пока нет.</p>'
      }
    </div>`;

  content.querySelectorAll('[data-delmsg]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('Удалить это сообщение?', 'Удалить');
      if (!ok) return;
      try {
        await api(`/admin/chat/${btn.dataset.delmsg}/delete`, { method: 'POST', body: { reason: 'moderation' } });
        toast('Сообщение удалено.');
        loadTab(content, 'chat');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
  content.querySelectorAll('[data-resolve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/admin/reports/${btn.dataset.resolve}/resolve`, { method: 'POST' });
        toast('Жалоба закрыта.');
        loadTab(content, 'chat');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
}

/* ------------------------------- downloads ------------------------------ */

function uploadForm(id, fieldsHtml, accept) {
  return `<form class="stack" data-upload="${id}" enctype="multipart/form-data">
    ${fieldsHtml}
    <label class="field"><span>Файл (${esc(accept) })</span><input class="input" type="file" name="file" /></label>
    <button class="btn btn-primary" type="submit">Загрузить</button>
  </form>`;
}

async function tabDownloads(content) {
  const data = await api('/admin/downloads');
  content.innerHTML = `
    <div class="admin-section-head"><h2>Файлы клана</h2><span class="chip">${data.downloads.length} всего</span></div>
    <div class="panel">
      <h3>Новый файл</h3>
      ${uploadForm(
        'downloads',
        `<div class="grid-2">
          <label class="field"><span>Название</span><input class="input" name="title" required /></label>
          <label class="field"><span>Версия</span><input class="input" name="version" value="1.0" /></label>
          <label class="field"><span>Категория</span><input class="input" name="category" value="clan" /></label>
          <label class="field"><span>Иконка (эмодзи)</span><input class="input" name="icon" value="📦" maxlength="4" /></label>
        </div>
        <label class="field"><span>Описание</span><textarea class="input" name="description" rows="2"></textarea></label>
        <label class="field"><span>Статус</span>
          <select class="input" name="status"><option value="draft">Черновик</option><option value="published">Опубликовать</option></select></label>`,
        'ZIP, EXE, PDF, PNG, JPG'
      )}
    </div>
    <div class="admin-list">
      ${
        data.downloads.length
          ? data.downloads
              .map(
                (d) => `<article class="admin-card">
                  <header class="admin-card-head">
                    <div class="admin-card-person"><span class="file-icon">${esc(d.icon || '📦')}</span>
                      <div><h3>${esc(d.title)} <span class="chip">v${esc(d.version)}</span></h3>
                        <p class="muted small">${esc(d.category)} · ${esc(d.size_label)} · ${esc(d.file_name || 'без файла')}</p></div></div>
                    <span class="status-pill ${d.status === 'published' ? 'ok' : 'warn'}">${d.status === 'published' ? 'Опубликован' : 'Черновик'}</span>
                  </header>
                  ${d.description ? `<p class="muted small">${esc(d.description)}</p>` : ''}
                  <div class="admin-card-actions">
                    <button class="btn btn-ghost btn-sm" data-toggle="${d.id}" data-status="${
                  d.status === 'published' ? 'draft' : 'published'
                }">${d.status === 'published' ? 'Снять с публикации' : 'Опубликовать'}</button>
                    <label class="btn btn-ghost btn-sm file-btn">Заменить файл
                      <input type="file" hidden data-replace="${d.id}" /></label>
                    <button class="btn btn-ghost btn-sm" data-edit="${d.id}">Изменить</button>
                    <button class="btn btn-danger btn-sm" data-delete="${d.id}" data-title="${esc(d.title)}">Удалить</button>
                    <span class="muted tiny">${esc(fmtDate(d.created_at, true))}</span>
                  </div>
                </article>`
              )
              .join('')
          : '<div class="panel center"><p class="muted">Файлов пока нет.</p></div>'
      }
    </div>`;

  const form = content.querySelector('[data-upload="downloads"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData();
    for (const key of ['title', 'version', 'category', 'icon', 'description', 'status']) {
      fd.append(key, form[key].value);
    }
    const file = form.file.files[0];
    if (file) fd.append('file', file);
    try {
      await api('/admin/downloads', { method: 'POST', form: fd });
      toast('Файл добавлен.');
      loadTab(content, 'downloads');
      window.dispatchEvent(new CustomEvent('killi:refresh'));
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  content.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/admin/downloads/${btn.dataset.toggle}`, { method: 'PATCH', body: { status: btn.dataset.status } });
        toast('Статус обновлён.');
        loadTab(content, 'downloads');
        window.dispatchEvent(new CustomEvent('killi:refresh'));
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
  content.querySelectorAll('[data-replace]').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        await api(`/admin/downloads/${input.dataset.replace}/file`, { method: 'POST', form: fd });
        toast('Файл заменён.');
        loadTab(content, 'downloads');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
  content.querySelectorAll('[data-edit]').forEach((btn) => {
    const item = data.downloads.find((d) => String(d.id) === btn.dataset.edit);
    btn.addEventListener('click', () => downloadEditModal(item, content));
  });
  content.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog(`Удалить «${btn.dataset.title}» и его файл?`, 'Удалить');
      if (!ok) return;
      try {
        await api(`/admin/downloads/${btn.dataset.delete}`, { method: 'DELETE' });
        toast('Файл удалён.');
        loadTab(content, 'downloads');
        window.dispatchEvent(new CustomEvent('killi:refresh'));
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
}

function downloadEditModal(item, content) {
  if (!item) return;
  const overlay = openModal(
    `<div class="modal-head"><h3>${esc(item.title)}</h3><button class="icon-btn" data-close aria-label="Закрыть">✕</button></div>
     <form class="stack">
       <div class="grid-2">
         <label class="field"><span>Название</span><input class="input" name="title" value="${esc(item.title)}" /></label>
         <label class="field"><span>Версия</span><input class="input" name="version" value="${esc(item.version)}" /></label>
         <label class="field"><span>Категория</span><input class="input" name="category" value="${esc(item.category)}" /></label>
         <label class="field"><span>Иконка</span><input class="input" name="icon" value="${esc(item.icon || '📦')}" maxlength="4" /></label>
       </div>
       <label class="field"><span>Описание</span><textarea class="input" name="description" rows="3">${esc(item.description || '')}</textarea></label>
       <div class="modal-actions">
         <button class="btn btn-ghost" type="button" data-close>Отмена</button>
         <button class="btn btn-primary" type="submit">Сохранить</button>
       </div>
     </form>`);
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formToObject(event.target);
    try {
      await api(`/admin/downloads/${item.id}`, { method: 'PATCH', body: values });
      closeModal();
      toast('Файл обновлён.');
      loadTab(content, 'downloads');
      window.dispatchEvent(new CustomEvent('killi:refresh'));
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/* ----------------------------- app releases ---------------------------- */

async function tabApp(content) {
  const data = await api('/admin/app-releases');
  content.innerHTML = `
    <div class="admin-section-head"><h2>KILLI ULTIMATE APP — версии</h2><span class="chip">${
      data.releases.length
    } версий</span></div>
    <div class="panel">
      <h3>Новая версия</h3>
      ${uploadForm(
        'app',
        `<div class="grid-2">
          <label class="field"><span>Версия</span><input class="input" name="version" placeholder="1.4.0" required /></label>
          <label class="field"><span>Статус</span>
            <select class="input" name="status"><option value="draft">Черновик</option><option value="published">Опубликовать</option></select></label>
        </div>
        <label class="field"><span>Changelog</span><textarea class="input" name="changelog" rows="4" placeholder="Что нового в этой версии"></textarea></label>`,
        'EXE, ZIP'
      )}
    </div>
    <div class="admin-list">
      ${
        data.releases.length
          ? data.releases
              .map(
                (r) => `<article class="admin-card">
                  <header class="admin-card-head">
                    <div><h3>v${esc(r.version)}</h3>
                      <p class="muted small">${esc(r.size_label)} · ${esc(r.file_name || 'без файла')} · ${esc(
                  fmtDate(r.created_at, true)
                )}</p></div>
                    <span class="status-pill ${r.status === 'published' ? 'ok' : 'warn'}">${
                  r.status === 'published' ? 'Опубликована' : 'Черновик'
                }</span>
                  </header>
                  ${r.changelog ? `<p class="muted small pre-line">${esc(r.changelog)}</p>` : ''}
                  <div class="admin-card-actions">
                    <button class="btn btn-ghost btn-sm" data-publish="${r.id}"${
                  r.status === 'published' ? ' disabled' : ''
                }>Опубликовать как актуальную</button>
                    <button class="btn btn-danger btn-sm" data-delete="${r.id}" data-version="${esc(r.version)}">Удалить</button>
                  </div>
                </article>`
              )
              .join('')
          : '<div class="panel center"><p class="muted">Версий пока нет. Загрузите первую сборку приложения.</p></div>'
      }
    </div>`;

  const form = content.querySelector('[data-upload="app"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData();
    fd.append('version', form.version.value);
    fd.append('status', form.status.value);
    fd.append('changelog', form.changelog.value);
    const file = form.file.files[0];
    if (file) fd.append('file', file);
    try {
      await api('/admin/app-releases', { method: 'POST', form: fd });
      toast('Версия загружена.');
      loadTab(content, 'app');
      window.dispatchEvent(new CustomEvent('killi:refresh'));
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  content.querySelectorAll('[data-publish]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/admin/app-releases/${btn.dataset.publish}/publish`, { method: 'POST' });
        toast('Версия опубликована.');
        loadTab(content, 'app');
        window.dispatchEvent(new CustomEvent('killi:refresh'));
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
  content.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog(`Удалить версию v${btn.dataset.version}?`, 'Удалить');
      if (!ok) return;
      try {
        await api(`/admin/app-releases/${btn.dataset.delete}`, { method: 'DELETE' });
        toast('Версия удалена.');
        loadTab(content, 'app');
        window.dispatchEvent(new CustomEvent('killi:refresh'));
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
}

/* -------------------------------- discord ------------------------------- */

async function saveSettings(payload, message = 'Настройки сохранены.') {
  const data = await api('/admin/settings', { method: 'PATCH', body: payload });
  if (data.settings && state.site) state.site.settings = data.settings;
  toast(message);
  window.dispatchEvent(new CustomEvent('killi:refresh'));
  return data;
}

async function tabDiscord(content) {
  const data = await api('/admin/settings');
  const s = data.settings;
  content.innerHTML = `
    <div class="admin-section-head"><h2>Discord клана</h2></div>
    <form class="panel stack" data-discord>
      <p class="muted small">Ссылки применяются на всём сайте сразу после сохранения: главная, раздел Discord, личный кабинет участника и страница исключений.</p>
      <div class="grid-2">
        <label class="field"><span>Название сервера</span><input class="input" name="discord_name" value="${esc(
          s.discord_name
        )}" /></label>
        <label class="field"><span>Текст о доступе</span><input class="input" name="discord_members_text" value="${esc(
          s.discord_members_text
        )}" /></label>
      </div>
      <label class="field"><span>Основная ссылка Discord</span>
        <input class="input" name="discord_invite" value="${esc(s.discord_invite)}" placeholder="https://discord.gg/..." /></label>
      <label class="field"><span>Ссылка для исключений / рассмотрения</span>
        <input class="input" name="discord_exception_invite" value="${esc(
          s.discord_exception_invite
        )}" placeholder="https://discord.gg/..." /></label>
      <label class="field"><span>Описание сервера</span>
        <textarea class="input" name="discord_description" rows="3">${esc(s.discord_description)}</textarea></label>
      <button class="btn btn-primary" type="submit">Сохранить Discord</button>
    </form>`;

  content.querySelector('[data-discord]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formToObject(event.target);
    try {
      await saveSettings(values, 'Discord обновлён на всём сайте.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/* --------------------------------- news --------------------------------- */

async function tabNews(content) {
  const data = await api('/admin/news');
  content.innerHTML = `
    <div class="admin-section-head"><h2>Новости клана</h2><span class="chip">${data.news.length}</span></div>
    <form class="panel stack" data-news-create>
      <div class="grid-2">
        <label class="field"><span>Заголовок</span><input class="input" name="title" required minlength="3" /></label>
        <label class="field"><span>Тег</span><input class="input" name="tag" value="clan" /></label>
      </div>
      <label class="field"><span>Текст</span><textarea class="input" name="body" rows="3" required minlength="3"></textarea></label>
      <label class="chip-check"><input type="checkbox" name="pinned" value="1" /><span>Закрепить</span></label>
      <button class="btn btn-primary" type="submit">Опубликовать новость</button>
    </form>
    <div class="admin-list">
      ${
        data.news.length
          ? data.news
              .map(
                (n) => `<article class="admin-card">
                  <header class="admin-card-head">
                    <div><h3>${esc(n.title)}</h3>
                      <p class="muted small">${esc(n.tag)} · ${esc(fmtDate(n.created_at, true))}${
                  n.pinned ? ' · закреплено' : ''
                }</p></div>
                    <div class="admin-card-meta">
                      <button class="btn btn-ghost btn-sm" data-pin="${n.id}" data-pinned="${
                  n.pinned ? '0' : '1'
                }">${n.pinned ? 'Открепить' : 'Закрепить'}</button>
                      <button class="btn btn-danger btn-sm" data-del="${n.id}">Удалить</button>
                    </div>
                  </header>
                  <p class="muted small pre-line">${esc(n.body)}</p>
                </article>`
              )
              .join('')
          : '<div class="panel center"><p class="muted">Новостей пока нет.</p></div>'
      }
    </div>`;

  content.querySelector('[data-news-create]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formToObject(event.target);
    try {
      await api('/admin/news', {
        method: 'POST',
        body: { title: values.title, body: values.body, tag: values.tag || 'clan', pinned: Boolean(values.pinned) },
      });
      toast('Новость опубликована.');
      loadTab(content, 'news');
      window.dispatchEvent(new CustomEvent('killi:refresh'));
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  content.querySelectorAll('[data-pin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/admin/news/${btn.dataset.pin}`, { method: 'PATCH', body: { pinned: btn.dataset.pinned === '1' } });
        loadTab(content, 'news');
        window.dispatchEvent(new CustomEvent('killi:refresh'));
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
  content.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('Удалить новость?', 'Удалить');
      if (!ok) return;
      try {
        await api(`/admin/news/${btn.dataset.del}`, { method: 'DELETE' });
        loadTab(content, 'news');
        window.dispatchEvent(new CustomEvent('killi:refresh'));
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
}

/* --------------------------------- stats -------------------------------- */

async function tabStats(content) {
  const data = await api('/admin/overview');
  const s = data.stats;
  const totalMembers = s.members || 0;
  content.innerHTML = `
    <div class="admin-section-head"><h2>Статистика клана</h2></div>
    <div class="admin-stats">
      ${statCard('Пользователи', s.users)}
      ${statCard('Участники', s.members)}
      ${statCard('Онлайн', s.online, 'за 5 минут')}
      ${statCard('Модераторы', s.moderators)}
      ${statCard('Ограничены', s.restricted)}
      ${statCard('Заявки в ожидании', s.pending)}
      ${statCard('Исключения', s.exceptions)}
      ${statCard('Принято всего', s.accepted)}
      ${statCard('Загрузки', s.downloads, `${s.publishedDownloads} опубликовано`)}
      ${statCard('Сообщения', s.messages)}
      ${statCard('Жалобы', s.reports, 'открытых')}
      ${statCard('Версии приложения', s.releases)}
    </div>
    <div class="grid-2 admin-stats-grid">
      <div class="panel">
        <h3>Специализации состава</h3>
        ${Object.entries(data.specializations)
          .map(([key, value]) => bar(specMeta(key).label, value, totalMembers))
          .join('')}
      </div>
      <div class="panel">
        <h3>Последние заявки</h3>
        ${
          data.recentApplications.length
            ? data.recentApplications
                .map(
                  (a) => `<div class="admin-row"><div><b>${esc(a.nickname)}</b>
                    <span class="muted tiny">${esc(specMeta(a.specialization).label)} · ${esc(
                    HOURS[a.hours_range] || a.hours_range
                  )}${a.is_exception ? ' · исключение' : ''}</span></div>
                    <span class="status-pill ${statusMeta(a.status).cls}">${esc(statusMeta(a.status).label)}</span></div>`
                )
                .join('')
            : '<p class="muted">Заявок нет.</p>'
        }
      </div>
    </div>
    <div class="grid-2 admin-stats-grid">
      <div class="panel">
        <h3>Журнал безопасности</h3>
        ${
          data.recentAudit.length
            ? data.recentAudit
                .map(
                  (a) => `<div class="admin-row"><div><b>${esc(a.kind)}</b>
                    <span class="muted tiny">${esc(a.detail || '')} · ${esc(a.ip || '—')}</span></div>
                    <span class="status-pill ${a.ok ? 'ok' : 'bad'}">${a.ok ? 'успех' : 'отказ'}</span></div>`
                )
                .join('')
            : '<p class="muted">Записей нет.</p>'
        }
      </div>
      <div class="panel">
        <h3>Открытые жалобы</h3>
        ${
          data.pendingReports.length
            ? data.pendingReports
                .map(
                  (r) => `<div class="admin-row"><div><b>${esc(r.author)}</b>
                    <span class="muted tiny">«${esc(String(r.message_body || '').slice(0, 90))}»</span></div>
                    <span class="muted tiny">${esc(fmtDate(r.created_at, true))}</span></div>`
                )
                .join('')
            : '<p class="muted">Жалоб нет.</p>'
        }
      </div>
    </div>`;
}

/* ------------------------------- security ------------------------------- */

async function tabSecurity(content) {
  const data = await api('/owner/security/audit');
  const creds = data.credentials || {};
  content.innerHTML = `
    <div class="admin-section-head"><h2>Безопасность доступа</h2>
      <div class="chips">
        <span class="chip">2FA: ${creds.totp_enabled ? 'включена' : 'выключена'}</span>
        <span class="chip">Смена стартовых паролей: ${creds.must_change ? 'требуется' : 'выполнена'}</span>
        <span class="chip">Последний вход: ${creds.last_login ? esc(fmtDate(creds.last_login, true)) : '—'}</span>
      </div>
    </div>
    ${
      creds.must_change
        ? `<form class="panel stack" data-bootstrap>
            <h3>Замените стартовые пароли</h3>
            <p class="muted small">Пока пароли не заменены, панель требует это сделать при каждом входе.</p>
            <div class="grid-2">
              <label class="field"><span>Новый первый пароль</span><input class="input" type="password" name="pass1" minlength="10" required /></label>
              <label class="field"><span>Новый второй пароль</span><input class="input" type="password" name="pass2" minlength="10" required /></label>
            </div>
            <button class="btn btn-primary" type="submit">Обновить пароли</button>
          </form>`
        : ''
    }
    <div class="grid-2 admin-stats-grid">
      <form class="panel stack" data-password="first">
        <h3>Первый пароль</h3>
        <label class="field"><span>Текущий первый пароль</span><input class="input" type="password" name="current" required /></label>
        <label class="field"><span>Новый пароль (мин. 10 символов)</span><input class="input" type="password" name="value" minlength="10" required /></label>
        ${creds.totp_enabled ? '<label class="field"><span>Код 2FA</span><input class="input" name="code" maxlength="6" required /></label>' : ''}
        <button class="btn btn-primary" type="submit">Сменить первый пароль</button>
      </form>
      <form class="panel stack" data-password="second">
        <h3>Второй пароль</h3>
        <label class="field"><span>Текущий первый пароль (подтверждение)</span><input class="input" type="password" name="current" required /></label>
        <label class="field"><span>Новый второй пароль (мин. 10 символов)</span><input class="input" type="password" name="value" minlength="10" required /></label>
        ${creds.totp_enabled ? '<label class="field"><span>Код 2FA</span><input class="input" name="code" maxlength="6" required /></label>' : ''}
        <button class="btn btn-primary" type="submit">Сменить второй пароль</button>
      </form>
    </div>
    <div class="grid-2 admin-stats-grid">
      <div class="panel stack">
        <h3>Двухфакторная аутентификация</h3>
        ${
          creds.totp_enabled
            ? `<p class="muted small">2FA включена. Для отключения подтвердите первый пароль.</p>
               <label class="field"><span>Первый пароль</span><input class="input" type="password" name="password" data-totp-off /></label>
               <button class="btn btn-danger" data-disable-totp>Отключить 2FA</button>`
            : `<p class="muted small">Подключите TOTP-приложение (Google Authenticator, Aegis, 1Password) и подтвердите код.</p>
               <button class="btn btn-primary" data-setup-totp>Создать секрет и QR</button>
               <div data-totp-box></div>`
        }
      </div>
      <div class="panel stack">
        <h3>Сессии владельца</h3>
        <p class="muted small">Завершение всех сессий потребует повторного входа через «BY FREAK».</p>
        <button class="btn btn-danger" data-revoke>Завершить все сессии</button>
        <h3>Журнал входов</h3>
        <div class="admin-audit">
          ${
            data.audit.length
              ? data.audit
                  .map(
                    (a) => `<div class="admin-row"><div><b>${esc(a.kind)}</b>
                      <span class="muted tiny">${esc(a.detail || '')} · ${esc(a.ip || '—')}</span></div>
                      <span class="status-pill ${a.ok ? 'ok' : 'bad'}">${a.ok ? 'успех' : 'отказ'}</span></div>`
                  )
                  .join('')
              : '<p class="muted">Записей нет.</p>'
          }
        </div>
      </div>
    </div>`;

  const boot = content.querySelector('[data-bootstrap]');
  if (boot) {
    boot.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/owner/security/bootstrap', {
          method: 'POST',
          body: { pass1: boot.pass1.value, pass2: boot.pass2.value },
        });
        toast('Пароли обновлены.');
        loadTab(content, 'security');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  content.querySelectorAll('[data-password]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = formToObject(form);
      try {
        const res = await api('/owner/security/password', {
          method: 'POST',
          body: { which: form.dataset.password, current: values.current, value: values.value, code: values.code || '' },
        });
        toast(res.message || 'Пароль обновлён.');
        loadTab(content, 'security');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });

  const setupBtn = content.querySelector('[data-setup-totp]');
  if (setupBtn) {
    setupBtn.addEventListener('click', async () => {
      try {
        const res = await api('/owner/security/totp/setup', { method: 'POST' });
        const box = content.querySelector('[data-totp-box]');
        box.innerHTML = `
          <div class="totp-setup">
            ${res.qr ? `<img class="totp-qr" src="${esc(res.qr)}" alt="QR для 2FA" />` : ''}
            <p class="muted small">Секрет: <code>${esc(res.secret)}</code></p>
            <label class="field"><span>Код из приложения</span><input class="input" name="code" maxlength="6" /></label>
            <button class="btn btn-primary" data-enable-totp>Включить 2FA</button>
          </div>`;
        box.querySelector('[data-enable-totp]').addEventListener('click', async () => {
          try {
            await api('/owner/security/totp/enable', {
              method: 'POST',
              body: { code: box.querySelector('[name="code"]').value },
            });
            toast('2FA включена.');
            loadTab(content, 'security');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  const offBtn = content.querySelector('[data-disable-totp]');
  if (offBtn) {
    offBtn.addEventListener('click', async () => {
      try {
        await api('/owner/security/totp/disable', {
          method: 'POST',
          body: { password: content.querySelector('[data-totp-off]').value },
        });
        toast('2FA отключена.');
        loadTab(content, 'security');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  content.querySelector('[data-revoke]').addEventListener('click', async () => {
    const ok = await confirmDialog('Завершить все сессии владельца?', 'Завершить');
    if (!ok) return;
    try {
      await api('/owner/security/revoke-sessions', { method: 'POST' });
      state.owner = false;
      toast('Все сессии завершены.', 'warn');
      location.hash = '#/';
      window.dispatchEvent(new CustomEvent('killi:refresh'));
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/* --------------------------------- design ------------------------------- */

async function tabDesign(content) {
  const data = await api('/admin/settings');
  const s = data.settings;
  content.innerHTML = `
    <div class="admin-section-head"><h2>Дизайн и бренд</h2><span class="chip">Стиль фона: ${esc(s.bg_style)}</span></div>
    <form class="panel stack" data-design>
      <div class="grid-2">
        <label class="field"><span>Название сайта</span><input class="input" name="site_name" value="${esc(s.site_name)}" /></label>
        <label class="field"><span>Подзаголовок</span><input class="input" name="site_tagline" value="${esc(s.site_tagline)}" /></label>
        <label class="field"><span>Буква логотипа</span><input class="input" name="logo_letter" value="${esc(
          s.logo_letter
        )}" maxlength="2" /></label>
        <label class="field"><span>Стиль фона</span>
          <select class="input" name="bg_style">
            ${[
              ['tech', 'Tech lines (по умолчанию)'],
              ['grid', 'Neon grid'],
              ['aurora', 'Aurora'],
              ['minimal', 'Minimal graphite'],
            ]
              .map(([v, l]) => `<option value="${v}"${s.bg_style === v ? ' selected' : ''}>${l}</option>`)
              .join('')}
          </select></label>
        <label class="field"><span>Основной акцент</span><input class="input" type="color" name="accent" value="${esc(
          s.accent
        )}" /></label>
        <label class="field"><span>Мягкий акцент</span><input class="input" type="color" name="accent_soft" value="${esc(
          s.accent_soft
        )}" /></label>
      </div>
      <label class="field"><span>Краткое описание клана</span><textarea class="input" name="clan_description" rows="3">${esc(
        s.clan_description
      )}</textarea></label>
      <label class="field"><span>Полный текст «О клане»</span><textarea class="input" name="clan_about" rows="6">${esc(
        s.clan_about
      )}</textarea></label>
      <label class="field"><span>Подпись в подвале</span><input class="input" name="footer_note" value="${esc(
        s.footer_note
      )}" /></label>
      <label class="field"><span>Техническое сообщение на главной</span><input class="input" name="maintenance_note" value="${esc(
        s.maintenance_note
      )}" /></label>
      <button class="btn btn-primary" type="submit">Сохранить дизайн</button>
    </form>
    <div class="grid-2 admin-stats-grid">
      <div class="panel stack">
        <h3>Логотип</h3>
        ${s.logo_image ? `<img class="admin-logo-preview" src="${esc(s.logo_image)}" alt="Логотип" />` : '<p class="muted small">Логотип не загружен — используется буква.</p>'}
        <label class="btn btn-ghost file-btn">Загрузить логотип<input type="file" hidden data-upload-media="logo" accept="image/*" /></label>
        ${s.logo_image ? '<button class="btn btn-danger btn-sm" data-remove-media="logo">Удалить логотип</button>' : ''}
      </div>
      <div class="panel stack">
        <h3>Фоновое изображение</h3>
        <p class="muted small">По умолчанию используется процедурный техно-фон. Своя картинка накладывается поверх с затемнением.</p>
        ${
          s.bg_image
            ? `<img class="admin-logo-preview wide" src="${esc(s.bg_image)}" alt="Фон" />`
            : '<p class="muted small">Пользовательский фон не загружен.</p>'
        }
        <label class="btn btn-ghost file-btn">Загрузить фон<input type="file" hidden data-upload-media="background" accept="image/*" /></label>
        ${s.bg_image ? '<button class="btn btn-danger btn-sm" data-remove-media="background">Удалить фон</button>' : ''}
      </div>
    </div>
    <div class="panel stack">
      <h3>Регистрация и публикация файлов</h3>
      <form class="stack" data-flags>
        <div class="grid-2">
          <label class="chip-check"><input type="checkbox" name="registration_open"${
            s.registration_open === '1' ? ' checked' : ''
          } /><span>Регистрация открыта</span></label>
          <label class="chip-check"><input type="checkbox" name="allow_exceptions"${
            s.allow_exceptions === '1' ? ' checked' : ''
          } /><span>Заявки-исключения (меньше 700 часов)</span></label>
          <label class="chip-check"><input type="checkbox" name="chat_enabled"${
            s.chat_enabled === '1' ? ' checked' : ''
          } /><span>Чат включён</span></label>
          <label class="chip-check"><input type="checkbox" name="members_public"${
            s.members_public === '1' ? ' checked' : ''
          } /><span>Состав виден гостям</span></label>
          <label class="field"><span>Мин. часы</span><input class="input" type="number" name="min_hours" min="0" value="${esc(
            s.min_hours
          )}" /></label>
          <label class="field"><span>Макс. размер файла, МБ</span><input class="input" type="number" name="upload_max_mb" min="1" value="${esc(
            s.upload_max_mb
          )}" /></label>
        </div>
        <label class="field"><span>Разрешённые расширения</span><input class="input" name="upload_ext" value="${esc(
          s.upload_ext
        )}" /></label>
        <label class="field"><span>Базовый URL сайта (для OAuth)</span><input class="input" name="base_url" value="${esc(
          s.base_url || ''
        )}" placeholder="https://example.com" /></label>
        <button class="btn btn-primary" type="submit">Сохранить параметры</button>
      </form>
    </div>`;

  content.querySelector('[data-design]').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveSettings(formToObject(event.target), 'Дизайн применён.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  content.querySelector('[data-flags]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const zoom = Object.fromEntries(new FormData(form).entries());
    try {
      await saveSettings({
        registration_open: zoom.registration_open ? '1' : '0',
        allow_exceptions: zoom.allow_exceptions ? '1' : '0',
        chat_enabled: zoom.chat_enabled ? '1' : '0',
        members_public: zoom.members_public ? '1' : '0',
        min_hours: zoom.min_hours,
        upload_max_mb: zoom.upload_max_mb,
        upload_ext: zoom.upload_ext,
        base_url: zoom.base_url,
      });
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  content.querySelectorAll('[data-upload-media]').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('image', file);
      fd.append('target', input.dataset.uploadMedia === 'background' ? 'background' : 'logo');
      try {
        await api('/admin/design/upload', { method: 'POST', form: fd });
        toast('Изображение загружено.');
        loadTab(content, 'design');
        window.dispatchEvent(new CustomEvent('killi:refresh'));
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
  content.querySelectorAll('[data-remove-media]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/admin/design/upload?target=${encodeURIComponent(btn.dataset.removeMedia)}`, { method: 'DELETE' });
        toast('Изображение удалено.');
        loadTab(content, 'design');
        window.dispatchEvent(new CustomEvent('killi:refresh'));
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
}
