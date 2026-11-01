'use strict';

import {
  api,
  esc,
  fmtDate,
  timeAgo,
  clockTime,
  splitLines,
  toast,
  openModal,
  closeModal,
  confirmDialog,
  state,
  SETTINGS,
  SPECS,
  HOURS,
  specMeta,
  statusMeta,
  avatarHtml,
  statusDot,
  formToObject,
  chatHub,
} from './core.js';

const MODES = [
  'Ванильный Rust (official)',
  '2x',
  '3x',
  '5x',
  '10x+',
  'Modded',
  'PVE',
  'Roleplay',
];

/* ------------------------------ login block ------------------------------ */

export function loginCards(features = {}) {
  return `<div class="grid grid-2 login-grid">
    <a class="login-card login-steam" href="/auth/steam">
      <span class="login-icon">◉</span>
      <h3>Войти через Steam</h3>
      <p class="muted small">Steam OpenID. Подтверждение происходит на стороне Steam — пароль не передаётся сайту.</p>
      <span class="btn btn-primary btn-block">Steam OpenID</span>
    </a>
    <a class="login-card login-discord${features.discord ? '' : ' is-dim'}" href="/auth/discord">
      <span class="login-icon">◈</span>
      <h3>Войти через Discord</h3>
      <p class="muted small">${
        features.discord
          ? 'Discord OAuth2. После входа профиль можно связать со Steam в личном кабинете.'
          : 'Требуется настройка DISCORD_CLIENT_ID и DISCORD_CLIENT_SECRET владельцем.'
      }</p>
      <span class="btn btn-ghost btn-block">Discord OAuth2</span>
    </a>
  </div>
  <p class="muted small center">Один аккаунт CLAN KILLI может быть связан и со Steam, и с Discord — прогресс и заявка сохраняются.</p>`;
}

/* -------------------------------- account -------------------------------- */

export async function accountPage() {
  if (!state.user) {
    const { settings, features } = state.site || {};
    return {
      html: `<div class="page-head"><div><span class="kicker">личный кабинет</span><h1>Вход в CLAN KILLI</h1>
        <p class="lede">Авторизация только через официальные Steam OpenID и Discord OAuth2.</p></div></div>
        ${loginCards(features || {})}
        <div class="card">
          <h3>Что внутри кабинета</h3>
          <div class="grid grid-3">
            <div><h4>Профиль</h4><p class="muted small">Никнейм, аватар, Steam и Discord, дата регистрации, статус участника.</p></div>
            <div><h4>Заявка</h4><p class="muted small">Статус рассмотрения, комментарий владельца, анкета «Кто ты в Rust?».</p></div>
            <div><h4>Доступ</h4><p class="muted small">После принятия открываются чат, состав, загрузки и приложение.</p></div>
          </div>
          <p class="muted small">Приём заявок: ${settings && settings.registration_open === '1' ? 'открыт' : 'закрыт'}.</p>
        </div>`,
    };
  }

  const user = state.user;
  const perms = user.permissions || {};
  const isMember = Boolean(perms.member);
  const result = await Promise.allSettled([
    api('/applications/me'),
    api('/news?limit=3'),
    api('/downloads'),
    isMember ? api('/chat/messages') : Promise.resolve({ messages: [] }),
  ]);
  const application = result[0].status === 'fulfilled' ? result[0].value.application : null;
  const news = result[1].status === 'fulfilled' ? result[1].value.news : [];
  const downloads = result[2].status === 'fulfilled' ? result[2].value.downloads : [];
  const chat = result[3].status === 'fulfilled' ? result[3].value : { messages: [] };
  const app = (state.site && state.site.app) || null;
  const settings = SETTINGS();

  const status = application ? statusMeta(application.status) : null;

  return {
    html: `
    ${memberNav(isMember, 'dashboard')}
    <div class="account-hero card">
      <div class="account-identity">
        ${avatarHtml(user, 'avatar-xl')}
        <div>
          <span class="kicker">${isMember ? 'участник клана' : 'зарегистрированный игрок'}</span>
          <h1>${esc(user.nickname)}</h1>
          <div class="chip-row">
            ${
              isMember
                ? `<span class="tag tag-accent">${esc(specMeta(user.specialization).label)}</span>
                   <span class="tag">${esc(HOURS[user.rust_hours] || 'часы не указаны')}</span>
                   <span class="tag ${user.role === 'moderator' ? 'tag-accent' : ''}">${esc(
                     user.role === 'moderator' ? 'MODERATOR' : 'MEMBER'
                   )}</span>`
                : `<span class="tag">${status ? esc(status.label) : 'заявка не подана'}</span>`
            }
          </div>
        </div>
      </div>
      <div class="account-meta">
        <div><span class="muted small">Регистрация</span><strong>${esc(fmtDate(user.created_at))}</strong></div>
        <div><span class="muted small">Steam</span><strong>${user.steam ? esc(user.steam.name || user.steam.id) : 'не привязан'}</strong></div>
        <div><span class="muted small">Discord</span><strong>${user.discord ? esc(user.discord.name || user.discord.id) : 'не привязан'}</strong></div>
        <div><span class="muted small">Статус</span><strong>${esc(
          user.clan_status === 'active' ? 'активен' : user.clan_status === 'restricted' ? 'ограничен' : user.clan_status || '—'
        )}</strong></div>
      </div>
    </div>

    ${
      isMember
        ? `<section class="grid grid-2 big-cards">
            <a class="big-card" href="${esc(settings.discord_invite || '#/discord')}" target="_blank" rel="noopener">
              <span class="kicker">сообщество</span>
              <h2>DISCORD CLAN KILLI</h2>
              <p class="muted">Координация, сборы, объявления и голосовые каналы клана.</p>
              <span class="btn btn-primary">Перейти в Discord</span>
            </a>
            <a class="big-card" href="#/app">
              <span class="kicker">${app ? `версия v${esc(app.version)}` : 'сборка готовится'}</span>
              <h2>KILLI ULTIMATE APP</h2>
              <p class="muted">Проверка компьютера на подозрительные файлы и индикаторы читов.</p>
              <span class="btn btn-ghost">${app ? 'Скачать актуальную версию' : 'Подробнее'}</span>
            </a>
          </section>

          <section class="grid grid-3">
            <article class="card">
              <h3>Последние сообщения</h3>
              <ul class="mini-list">
                ${
                  (chat.messages || [])
                    .slice(-4)
                    .reverse()
                    .map(
                      (m) => `<li><strong>${esc(m.author.nickname)}</strong> <span class="muted small">${esc(
                        timeAgo(m.created_at)
                      )}</span><div class="muted small">${esc(m.deleted ? 'сообщение удалено' : m.body)}</div></li>`
                    )
                    .join('') || '<li class="muted small">Сообщений пока нет.</li>'
                }
              </ul>
              <a class="link-arrow" href="#/chat">Открыть чат →</a>
            </article>
            <article class="card">
              <h3>Новости клана</h3>
              <ul class="mini-list">
                ${
                  news
                    .map(
                      (n) => `<li><strong>${esc(n.title)}</strong><div class="muted small">${esc(n.body)}</div></li>`
                    )
                    .join('') || '<li class="muted small">Новостей пока нет.</li>'
                }
              </ul>
            </article>
            <article class="card">
              <h3>Новые файлы</h3>
              <ul class="mini-list">
                ${
                  downloads
                    .slice(0, 4)
                    .map(
                      (d) =>
                        `<li><a href="/api/downloads/${esc(d.id)}/file">${esc(d.title)}</a> <span class="muted small">${
                          d.version ? `v${esc(d.version)} · ` : ''
                        }${esc(d.size_label)}</span></li>`
                    )
                    .join('') || '<li class="muted small">Файлов пока нет.</li>'
                }
              </ul>
              <a class="link-arrow" href="#/downloads">Все загрузки →</a>
            </article>
          </section>

          <section class="grid grid-2">
            <article class="card">
              <h3>Быстрый доступ</h3>
              <div class="quick-grid">
                <a href="#/chat">Клан-чат</a>
                <a href="#/members">Участники</a>
                <a href="#/members">Роли</a>
                <a href="#/downloads">Загрузки</a>
                <a href="#/app">KILLI APP</a>
                <a href="#/discord">Discord</a>
              </div>
            </article>
            <article class="card">
              <h3>Мой статус</h3>
              <form id="statusForm" class="form">
                <div class="form-row">
                  <label>Отображаемый статус
                    <select name="manual_status">
                      ${['online', 'ingame', 'afk', 'offline']
                        .map(
                          (key) =>
                            `<option value="${key}" ${user.manual_status === key ? 'selected' : ''}>${
                              { online: 'Online', ingame: 'In Game', afk: 'AFK', offline: 'Offline' }[key]
                            }</option>`
                        )
                        .join('')}
                    </select>
                  </label>
                </div>
                <p class="muted small">In Game — ручной статус участника, сайт не считывает его из игры автоматически.</p>
                <button class="btn btn-primary btn-sm" type="submit">Сохранить</button>
              </form>
            </article>
          </section>`
        : applicationBlock(application, status)
    }

    <section class="grid grid-2" id="profileSection">
      <article class="card">
        <h3>Настройки профиля</h3>
        <form id="profileForm" class="form">
          <div class="form-row"><label>Никнейм<input name="nickname" value="${esc(user.nickname || '')}" maxlength="32" required /></label></div>
          <div class="form-row"><label>Ник в Rust<input name="rust_nick" value="${esc(user.rust_nick || '')}" maxlength="40" /></label></div>
          <div class="form-row">
            <label>Часы в Rust
              <select name="rust_hours">
                ${Object.keys(HOURS)
                  .map((key) => `<option value="${key}" ${user.rust_hours === key ? 'selected' : ''}>${esc(HOURS[key])}</option>`)
                  .join('')}
              </select>
            </label>
          </div>
          <div class="form-row">
            <label>Основная специализация
              <select name="specialization">
                ${Object.keys(SPECS)
                  .map(
                    (key) =>
                      `<option value="${key}" ${user.specialization === key ? 'selected' : ''}>${esc(specMeta(key).label)}</option>`
                  )
                  .join('')}
              </select>
            </label>
          </div>
          <div class="form-row"><label>Часовой пояс<input name="timezone" value="${esc(user.timezone || '')}" maxlength="40" placeholder="UTC+3" /></label></div>
          <div class="form-row"><label>О себе<textarea name="bio" rows="3" maxlength="600">${esc(user.bio || '')}</textarea></label></div>
          <div class="form-row form-inline">
            <label class="check"><input type="checkbox" name="show_steam" ${user.show_steam ? 'checked' : ''} /> Показывать Steam в профиле</label>
            <label class="check"><input type="checkbox" name="show_discord" ${user.show_discord ? 'checked' : ''} /> Показывать Discord</label>
          </div>
          <button class="btn btn-primary" type="submit">Сохранить профиль</button>
        </form>
      </article>
      <article class="card">
        <h3>Привязанные платформы</h3>
        <div class="link-list">
          <div class="link-row">
            <span class="muted">Steam</span>
            ${
              user.steam
                ? `<strong>${esc(user.steam.name || user.steam.id)}</strong><a class="mini-link" href="${esc(
                    user.steam.url || '#'
                  )}" target="_blank" rel="noopener">профиль</a>`
                : '<a class="btn btn-ghost btn-sm" href="/auth/steam?link=1">Привязать Steam</a>'
            }
          </div>
          <div class="link-row">
            <span class="muted">Discord</span>
            ${
              user.discord
                ? `<strong>${esc(user.discord.name || user.discord.id)}</strong><a class="mini-link" href="${esc(
                    user.discord.url || '#'
                  )}" target="_blank" rel="noopener">профиль</a>`
                : '<a class="btn btn-ghost btn-sm" href="/auth/discord?link=1">Привязать Discord</a>'
            }
          </div>
        </div>
        <hr class="divider" />
        <h4>Сессия</h4>
        <p class="muted small">Вход выполнен через защищённую сессию. Выход завершает её на сервере.</p>
        <button class="btn btn-quiet" id="logoutBtn">Выйти из аккаунта</button>
        ${
          isMember
            ? ''
            : `<hr class="divider" /><h4>Заявка</h4><p class="muted small">Подай анкету «Кто ты в Rust?», чтобы владелец рассмотрел вступление.</p><a class="btn btn-primary" href="#/apply">Подать заявку</a>`
        }
      </article>
    </section>`,
    mount(root) {
      const statusForm = root.querySelector('#statusForm');
      if (statusForm) {
        statusForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const select = statusForm.querySelector('[name="manual_status"]');
          try {
            const res = await api('/me', { method: 'PATCH', body: { manual_status: select.value } });
            state.user = res.user;
            toast('Статус обновлён');
            window.dispatchEvent(new CustomEvent('killi:refresh'));
          } catch (error) {
            toast(error.message, 'bad');
          }
        });
      }
      root.querySelectorAll('#profileForm').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = formToObject(form);
          data.show_steam = form.querySelector('[name="show_steam"]').checked;
          data.show_discord = form.querySelector('[name="show_discord"]').checked;
          try {
            const res = await api('/me', { method: 'PATCH', body: data });
            state.user = res.user;
            toast('Профиль сохранён');
            window.dispatchEvent(new CustomEvent('killi:refresh'));
          } catch (error) {
            toast(error.message, 'bad');
          }
        });
      });
      const logout = root.querySelector('#logoutBtn');
      if (logout) {
        logout.addEventListener('click', async () => {
          await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
          location.hash = '#/';
          location.reload();
        });
      }
    },
  };
}

function memberNav(isMember, active) {
  if (!isMember) return '';
  const items = [
    ['dashboard', 'DASHBOARD', '#/account'],
    ['chat', 'CLAN CHAT', '#/chat'],
    ['members', 'MEMBERS', '#/members'],
    ['roles', 'ROLES', '#/account'],
    ['discord', 'DISCORD', '#/discord'],
    ['downloads', 'DOWNLOADS', '#/downloads'],
    ['app', 'KILLI ULTIMATE APP', '#/app'],
    ['profile', 'PROFILE', '#/account'],
  ];
  return `<nav class="subnav">${items
    .map(
      ([key, label, href]) =>
        `<a class="subnav-item${key === active ? ' is-active' : ''}" href="${href}">${esc(label)}</a>`
    )
    .join('')}</nav>`;
}

function applicationBlock(application, status) {
  if (!application) {
    return `<section class="card empty-state">
      <h3>Заявка ещё не подана</h3>
      <p class="muted">Заполни анкету «Кто ты в Rust?» — владелец клана рассмотрит её вручную.</p>
      <a class="btn btn-primary" href="#/apply">Заполнить анкету</a>
    </section>`;
  }
  return `<section class="card">
    <div class="card-head">
      <h3>Статус заявки</h3>
      <span class="tag tag-${esc(status.cls)}">${esc(status.label)}</span>
    </div>
    <div class="grid grid-3 meta-grid">
      <div><span class="muted small">Подана</span><strong>${esc(fmtDate(application.created_at, true))}</strong></div>
      <div><span class="muted small">Специализация</span><strong>${esc(specMeta(application.specialization).label)}</strong></div>
      <div><span class="muted small">Часы</span><strong>${esc(HOURS[application.hours_range] || '—')}</strong></div>
      <div><span class="muted small">Рассмотрена</span><strong>${esc(application.reviewed_at ? fmtDate(application.reviewed_at, true) : '—')}</strong></div>
      <div><span class="muted small">Пометка</span><strong>${application.is_exception ? 'Исключение' : 'Стандартная'}</strong></div>
      <div><span class="muted small">Доп. роли</span><strong>${esc(
        (application.extra_roles || []).map((r) => specMeta(r).label).join(', ') || '—'
      )}</strong></div>
    </div>
    ${
      application.admin_note
        ? `<div class="notice">Сообщение владельца: ${esc(application.admin_note)}</div>`
        : ''
    }
    <details class="details">
      <summary>Мои ответы</summary>
      <dl class="answers">
        <dt>Ник в Rust</dt><dd>${esc(application.rust_nick || '—')}</dd>
        <dt>Время игры</dt><dd>${esc(application.play_time || '—')}</dd>
        <dt>Режимы</dt><dd>${esc((application.game_modes || []).join(', ') || '—')}</dd>
        <dt>Опыт в кланах</dt><dd>${esc(application.clan_experience || '—')}</dd>
        <dt>Микрофон</dt><dd>${esc(application.has_mic || '—')}</dd>
        <dt>Часовой пояс</dt><dd>${esc(application.timezone || '—')}</dd>
        <dt>Навыки</dt><dd>${esc(application.extra_skills || '—')}</dd>
        <dt>Почему в клан</dt><dd>${esc(application.why_join || '—')}</dd>
        ${application.extra_info ? `<dt>Дополнительно</dt><dd>${esc(application.extra_info)}</dd>` : ''}
        ${
          application.exception
            ? `<dt>Исключение: почему</dt><dd>${esc(application.exception.why || '—')}</dd>
               <dt>Исключение: навыки</dt><dd>${esc(application.exception.skills || '—')}</dd>
               <dt>Исключение: опыт</dt><dd>${esc(application.exception.clan_experience || '—')}</dd>
               <dt>Исключение: польза</dt><dd>${esc(application.exception.useful || '—')}</dd>`
            : ''
        }
      </dl>
    </details>
    ${
      application.status === 'info_requested' && application.admin_note
        ? '<p class="muted small">Владелец запросил уточнения — ответь в Discord или обнови анкету после отказа.</p>'
        : ''
    }
  </section>`;
}

/* --------------------------------- apply --------------------------------- */

export async function applyPage() {
  if (!state.user) {
    return {
      html: `<div class="page-head"><div><span class="kicker">заявка</span><h1>Сначала войди</h1>
      <p class="lede">Для подачи заявки нужна авторизация через Steam или Discord.</p></div></div>
      ${loginCards((state.site && state.site.features) || {})}`,
    };
  }
  const { application } = await api('/applications/me');
  if (state.user.permissions && state.user.permissions.member) {
    return {
      html: `<div class="card empty-state"><h2>Ты уже в клане</h2><p class="muted">Доступ к чату, составу и загрузкам открыт.</p>
      <a class="btn btn-primary" href="#/account">Личный кабинет</a></div>`,
    };
  }
  if (application && ['pending', 'info_requested'].includes(application.status)) {
    const status = statusMeta(application.status);
    return {
      html: `${memberPageHead()}
      <div class="card empty-state">
        <span class="tag tag-${esc(status.cls)}">${esc(status.label)}</span>
        <h2>Заявка уже на рассмотрении</h2>
        <p class="muted">Подана ${esc(fmtDate(application.created_at, true))}. Решение принимает владелец клана.</p>
        ${application.admin_note ? `<div class="notice">${esc(application.admin_note)}</div>` : ''}
        <a class="btn btn-ghost" href="#/account">Смотреть статус</a>
      </div>`,
    };
  }
  const settings = SETTINGS();
  if (settings.registration_open !== '1') {
    return { html: `<div class="card empty-state"><h2>Приём заявок закрыт</h2><p class="muted">Следи за новостями клана.</p></div>` };
  }
  const rejected = application && application.status === 'rejected';
  return {
    html: `${memberPageHead()}
    ${rejected ? '<div class="notice">Предыдущая заявка отклонена. Можно отправить новую с учётом комментария владельца.</div>' : ''}
    ${
      settings.allow_exceptions !== '1'
        ? '<div class="notice">Заявки-исключения (до 700 часов) сейчас не принимаются.</div>'
        : ''
    }
    <form id="applyForm" class="card form apply-form" novalidate>
      <section class="form-section">
        <span class="kicker">шаг 1</span>
        <h2>Кто ты в Rust?</h2>
        <p class="muted small">Выбери одну основную специализацию и до трёх дополнительных.</p>
        <div class="spec-grid" id="mainSpecs">
          ${Object.keys(SPECS)
            .map(
              (key) => `<button type="button" class="spec-choice" data-spec="${key}">
                <span class="spec-icon">${esc(specMeta(key).icon)}</span>
                <strong>${esc(specMeta(key).label)}</strong>
                <span class="muted small">${esc(specMeta(key).text)}</span>
              </button>`
            )
            .join('')}
        </div>
        <input type="hidden" name="specialization" id="specValue" value="${esc(application ? application.specialization : '')}" />
        <h4>Дополнительные роли</h4>
        <div class="chip-row" id="extraSpecs">
          ${Object.keys(SPECS)
            .map(
              (key) =>
                `<button type="button" class="chip-btn" data-extra="${key}">${esc(specMeta(key).label)}</button>`
            )
            .join('')}
        </div>
      </section>

      <section class="form-section">
        <span class="kicker">шаг 2</span>
        <h2>Игровой опыт</h2>
        <p class="muted small">Минимальное требование — ${esc(settings.min_hours || 700)} часов в Rust.</p>
        <div class="hours-grid" id="hoursGrid">
          ${Object.keys(HOURS)
            .map(
              (key) => `<label class="hours-choice${key === 'under700' ? ' is-exception' : ''}">
                <input type="radio" name="hours_range" value="${key}" ${key === 'under700' ? '' : ''} />
                <span>${esc(HOURS[key])}</span>
              </label>`
            )
            .join('')}
        </div>
      </section>

      <section class="form-section" id="exceptionBlock" hidden>
        <span class="kicker">исключение</span>
        <h2>Заявка-исключение</h2>
        <p class="muted small">Меньше ${esc(settings.min_hours || 700)} часов. Решение принимает только владелец клана.</p>
        <div class="form-row"><label>Почему тебя стоит принять *<textarea name="exception_why" rows="3" maxlength="1200"></textarea></label></div>
        <div class="form-row"><label>Какие у тебя навыки *<textarea name="exception_skills" rows="2" maxlength="1200"></textarea></label></div>
        <div class="form-row"><label>Опыт игры в клане<textarea name="exception_clan_experience" rows="2" maxlength="600"></textarea></label></div>
        <div class="form-row"><label>Чем будешь полезен команде *<textarea name="exception_useful" rows="2" maxlength="1200"></textarea></label></div>
      </section>

      <section class="form-section">
        <span class="kicker">шаг 3</span>
        <h2>Анкета</h2>
        <div class="form-grid">
          <div class="form-row"><label>Никнейм *<input name="nickname" value="${esc(state.user.nickname || '')}" maxlength="40" required /></label></div>
          <div class="form-row"><label>Ник в Rust *<input name="rust_nick" value="${esc(state.user.rust_nick || '')}" maxlength="40" required /></label></div>
          <div class="form-row"><label>Steam-профиль<input name="steam_link" value="${esc(
            (state.user.steam && state.user.steam.url) || ''
          )}" maxlength="200" placeholder="https://steamcommunity.com/id/..." /></label></div>
          <div class="form-row"><label>Discord<input name="discord_link" value="${esc(
            (state.user.discord && state.user.discord.url) || ''
          )}" maxlength="200" placeholder="username#0000 или ссылка" /></label></div>
          <div class="form-row"><label>Сколько времени обычно играешь?<input name="play_time" maxlength="60" placeholder="вечера, выходные" /></label></div>
          <div class="form-row"><label>Часовой пояс<input name="timezone" value="${esc(state.user.timezone || '')}" maxlength="60" placeholder="UTC+3" /></label></div>
        </div>
        <div class="form-row"><span class="label-text">В каких режимах предпочитаешь играть?</span>
          <div class="chip-row" id="modeChips">
            ${MODES.map((mode) => `<button type="button" class="chip-btn" data-mode="${esc(mode)}">${esc(mode)}</button>`).join('')}
          </div>
        </div>
        <div class="form-row"><label>Есть ли опыт игры в других кланах?<textarea name="clan_experience" rows="2" maxlength="1200"></textarea></label></div>
        <div class="form-row"><label>Есть ли микрофон?
          <select name="has_mic">
            <option value="Да">Да</option>
            <option value="Нет">Нет</option>
            <option value="Иногда">Иногда</option>
          </select>
        </label></div>
        <div class="form-row"><label>Какие дополнительные навыки у тебя есть?<textarea name="extra_skills" rows="2" maxlength="1500"></textarea></label></div>
        <div class="form-row"><label>Почему хочешь вступить в CLAN KILLI? * (минимум 20 символов)<textarea name="why_join" rows="3" maxlength="2000" required></textarea></label></div>
        <div class="form-row"><label>Дополнительная информация (необязательно)<textarea name="extra_info" rows="2" maxlength="1500"></textarea></label></div>
      </section>

      <label class="check"><input type="checkbox" id="agree" /> Я подтверждаю, что данные указаны верно, и принимаю правила клана.</label>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">Отправить заявку</button>
        <a class="btn btn-quiet" href="#/account">Отмена</a>
      </div>
    </form>`,
    mount(root) {
      const form = root.querySelector('#applyForm');
      const specValue = root.querySelector('#specValue');
      const specButtons = Array.from(root.querySelectorAll('.spec-choice'));
      const extraButtons = Array.from(root.querySelectorAll('[data-extra]'));
      const extras = new Set(application ? application.extra_roles || [] : []);
      const modes = new Set();
      const exceptionBlock = root.querySelector('#exceptionBlock');

      const syncExtras = () => {
        extraButtons.forEach((btn) => {
          const key = btn.dataset.extra;
          btn.classList.toggle('is-active', extras.has(key));
          btn.disabled = key === specValue.value;
        });
      };

      specButtons.forEach((btn) =>
        btn.addEventListener('click', () => {
          specButtons.forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          specValue.value = btn.dataset.spec;
          extras.delete(btn.dataset.spec);
          syncExtras();
        })
      );
      if (specValue.value) {
        const current = specButtons.find((b) => b.dataset.spec === specValue.value);
        if (current) current.classList.add('is-active');
      }
      extraButtons.forEach((btn) =>
        btn.addEventListener('click', () => {
          const key = btn.dataset.extra;
          if (extras.has(key)) extras.delete(key);
          else if (extras.size < 3) extras.add(key);
          else toast('Можно выбрать не более трёх дополнительных ролей', 'bad');
          syncExtras();
        })
      );
      syncExtras();

      root.querySelectorAll('input[name="hours_range"]').forEach((radio) =>
        radio.addEventListener('change', () => {
          exceptionBlock.hidden = radio.value !== 'under700';
        })
      );

      root.querySelectorAll('[data-mode]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mode;
          if (modes.has(mode)) modes.delete(mode);
          else modes.add(mode);
          btn.classList.toggle('is-active', modes.has(mode));
        })
      );

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!root.querySelector('#agree').checked) {
          toast('Подтвердите правила клана', 'bad');
          return;
        }
        if (!specValue.value) {
          toast('Выберите основную специализацию', 'bad');
          return;
        }
        const hours = form.querySelector('input[name="hours_range"]:checked');
        if (!hours) {
          toast('Укажите часы в Rust', 'bad');
          return;
        }
        const payload = formToObject(form);
        payload.extra_roles = Array.from(extras);
        payload.game_modes = Array.from(modes);
        delete payload.agree;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = 'Отправляем…';
        try {
          await api('/applications', { method: 'POST', body: payload });
          toast('Заявка отправлена владельцу клана');
          location.hash = '#/account';
          window.dispatchEvent(new CustomEvent('killi:refresh'));
        } catch (error) {
          toast(error.message, 'bad');
        } finally {
          button.disabled = false;
          button.textContent = 'Отправить заявку';
        }
      });
    },
  };
}

function memberPageHead() {
  return `<div class="page-head"><div><span class="kicker">вступление</span><h1>Анкета «Кто ты в Rust?»</h1>
  <p class="lede">Заявка сохраняется в базе клана и появляется в закрытой админ-панели владельца.</p></div></div>`;
}

/* ---------------------------------- chat --------------------------------- */

export async function chatPage() {
  if (!state.user) {
    return { html: `<div class="card empty-state"><h2>Чат клана</h2><p class="muted">Доступен только участникам.</p><a class="btn btn-primary" href="#/account">Войти</a></div>` };
  }
  if (!(state.user.permissions && state.user.permissions.member)) {
    return {
      html: `<div class="card empty-state"><h2>Чат клана</h2>
      <p class="muted">Общий чат доступен принятым участникам CLAN KILLI.</p>
      <a class="btn btn-primary" href="#/apply">Подать заявку</a></div>`,
    };
  }
  let data;
  try {
    data = await api('/chat/messages');
  } catch (error) {
    return { html: `<div class="card empty-state"><h2>Чат недоступен</h2><p class="muted">${esc(error.message)}</p></div>` };
  }
  const blockedUntil = data.blocked_until;
  return {
    html: `<div class="page-head">
      <div><span class="kicker">clan chat</span><h1>Общий чат</h1>
      <p class="lede">Онлайн: ${esc(data.online)} из ${esc(data.total_members)} участников · сообщения обновляются в реальном времени.</p></div>
      ${data.moderator ? '<span class="tag tag-accent">режим модератора</span>' : ''}
    </div>
    <div class="chat-shell">
      <div class="chat-head">
        <span class="status status-online"><i></i>живой канал #general</span>
        <span class="muted small" id="chatOnline">${esc(data.online)} онлайн</span>
      </div>
      <div class="chat-body" id="chatBody">
        ${(data.messages || []).map((m) => chatMessage(m, data.moderator)).join('') || '<p class="muted chat-empty">Сообщений пока нет. Напиши первым.</p>'}
      </div>
      <form class="chat-composer" id="chatForm">
        <textarea id="chatInput" name="body" rows="2" maxlength="800" placeholder="Сообщение клану…" ${
          data.can_post ? '' : 'disabled'
        }></textarea>
        <button class="btn btn-primary" type="submit" ${data.can_post ? '' : 'disabled'}>Отправить</button>
      </form>
      ${
        data.can_post
          ? ''
          : `<p class="muted small chat-notice">${
              blockedUntil
                ? `Отправка ограничена до ${esc(fmtDate(blockedUntil, true))}.`
                : 'Отправка сообщений сейчас недоступна (чат отключён владельцем).'
            }</p>`
      }
    </div>`
      .replace('<!-- -->', ''),
    mount(root) {
      const body = root.querySelector('#chatBody');
      const form = root.querySelector('#chatForm');
      const input = root.querySelector('#chatInput');
      const onlineLabel = root.querySelector('#chatOnline');
      const moderator = data.moderator;

      const atBottom = () => body.scrollHeight - body.scrollTop - body.clientHeight < 80;
      const scrollDown = () => {
        body.scrollTop = body.scrollHeight;
      };
      scrollDown();

      const append = (message) => {
        const empty = body.querySelector('.chat-empty');
        if (empty) empty.remove();
        const stick = atBottom();
        body.insertAdjacentHTML('beforeend', chatMessage(message, moderator));
        if (stick) scrollDown();
        bindMessage(body.lastElementChild);
      };

      const bindMessage = (node) => {
        if (!node) return;
        const del = node.querySelector('[data-delete]');
        if (del) {
          del.addEventListener('click', async () => {
            if (!(await confirmDialog('Удалить это сообщение?', 'Удалить'))) return;
            try {
              await api(`/chat/messages/${del.dataset.delete}`, { method: 'DELETE', body: { reason: 'moderation' } });
              toast('Сообщение удалено');
            } catch (error) {
              toast(error.message, 'bad');
            }
          });
        }
        const report = node.querySelector('[data-report]');
        if (report) {
          report.addEventListener('click', () => {
            openModal(
              `<div class="modal-head"><h3>Жалоба на сообщение</h3><button class="icon-btn" data-close aria-label="Закрыть">✕</button></div>
               <form id="reportForm" class="form">
                 <div class="form-row"><label>Причина<textarea name="reason" rows="3" maxlength="300" placeholder="Опишите нарушение"></textarea></label></div>
                 <div class="modal-actions"><button class="btn btn-primary" type="submit">Отправить жалобу</button></div>
               </form>`,
              {
                onMount(overlay) {
                  overlay.querySelector('#reportForm').addEventListener('submit', async (event) => {
                    event.preventDefault();
                    try {
                      await api(`/chat/messages/${report.dataset.report}/report`, {
                        method: 'POST',
                        body: formToObject(event.target),
                      });
                      closeModal();
                      toast('Жалоба отправлена владельцу');
                    } catch (error) {
                      toast(error.message, 'bad');
                    }
                  });
                },
              }
            );
          });
        }
      };
      body.querySelectorAll('.chat-msg').forEach(bindMessage);

      if (form) {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const value = (input.value || '').trim();
          if (!value) return;
          const button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          try {
            await api('/chat/messages', { method: 'POST', body: { body: value } });
            input.value = '';
            input.focus();
          } catch (error) {
            toast(error.message, 'bad');
          } finally {
            button.disabled = false;
          }
        });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
          }
        });
      }

      const offChat = chatHub.subscribe((name, payload) => {
        if (name === 'message') {
          if (payload) append(payload);
          return;
        }
        if (name === 'message_deleted') {
          if (!payload) return;
          const node = body.querySelector(`[data-msg="${payload.id}"]`);
          if (node) {
            node.classList.add('chat-msg-deleted');
            const content = node.querySelector('.chat-text');
            if (content) content.textContent = 'Сообщение удалено модератором';
          }
          return;
        }
        if (name === 'ready') {
          if (onlineLabel && payload && typeof payload.online === 'number') {
            onlineLabel.textContent = `${payload.online} онлайн`;
          }
          return;
        }
        if (name === 'error' && onlineLabel) onlineLabel.textContent = 'переподключение…';
      });
      state.chat = { close: offChat };
    },
  };
}

function chatMessage(message, moderator) {
  const mine = state.user && message.author.id === state.user.id;
  const canDelete = !message.deleted && (mine || moderator);
  return `<div class="chat-msg${message.deleted ? ' chat-msg-deleted' : ''}${mine ? ' is-mine' : ''}" data-msg="${esc(
    message.id
  )}">
    ${avatarHtml({ nickname: message.author.nickname, avatar: message.author.avatar }, 'avatar-sm')}
    <div class="chat-content">
      <div class="chat-meta">
        <strong>${esc(message.author.nickname)}</strong>
        ${message.author.role === 'moderator' ? '<span class="tag tag-accent tiny">MOD</span>' : ''}
        ${message.author.online ? '<span class="dot-live tiny"></span>' : ''}
        <span class="muted small">${esc(clockTime(message.created_at))}</span>
      </div>
      <div class="chat-text">${esc(message.deleted ? 'Сообщение удалено модератором' : message.body)}</div>
    </div>
    <div class="chat-actions">
      ${canDelete ? `<button class="icon-btn" data-delete="${esc(message.id)}" title="Удалить">🗑</button>` : ''}
      ${!message.deleted && !mine ? `<button class="icon-btn" data-report="${esc(message.id)}" title="Пожаловаться">⚑</button>` : ''}
    </div>
  </div>`;
}
