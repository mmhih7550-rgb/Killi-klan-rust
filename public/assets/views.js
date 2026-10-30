'use strict';

import {
  api,
  esc,
  fmtDate,
  timeAgo,
  splitLines,
  toast,
  state,
  SETTINGS,
  SPECS,
  HOURS,
  specMeta,
  statusDot,
  avatarHtml,
} from './core.js';

/* ------------------------------- fragments ------------------------------ */

export function sectionHead(kicker, title, text, actions = '') {
  return `<div class="page-head">
    <div>
      <span class="kicker">${esc(kicker)}</span>
      <h1>${esc(title)}</h1>
      ${text ? `<p class="lede">${esc(text)}</p>` : ''}
    </div>
    ${actions ? `<div class="page-head-actions">${actions}</div>` : ''}
  </div>`;
}

export function specCard(key, extra = '') {
  const meta = specMeta(key);
  return `<article class="spec-card ${extra}">
    <span class="spec-icon">${esc(meta.icon)}</span>
    <span class="spec-label">${esc(meta.label)}</span>
    <h4>${esc(meta.title)}</h4>
    <p class="muted">${esc(meta.text)}</p>
  </article>`;
}

function statsStrip(stats) {
  const items = [
    { value: stats.members, label: 'участников клана' },
    { value: stats.online, label: 'сейчас онлайн' },
    { value: stats.downloads, label: 'опубликованных файлов' },
    { value: stats.users, label: 'зарегистрированных аккаунтов' },
  ];
  return `<div class="stat-strip">
    ${items
      .map(
        (item) => `<div class="stat">
          <span class="stat-value">${esc(item.value)}</span>
          <span class="stat-label">${esc(item.label)}</span>
        </div>`
      )
      .join('')}
  </div>`;
}

function newsCard(item) {
  return `<article class="news-card">
    <div class="news-top">
      <span class="tag">${esc(item.tag || 'news')}</span>
      ${item.pinned ? '<span class="tag tag-accent">закреплено</span>' : ''}
      <span class="muted small">${esc(timeAgo(item.created_at))}</span>
    </div>
    <h3>${esc(item.title)}</h3>
    <p class="muted">${esc(item.body)}</p>
  </article>`;
}

function releaseCard(release, { showChangelog = true } = {}) {
  const lines = splitLines(release.changelog);
  return `<article class="release-card">
    <div class="release-top">
      <span class="version-pill">v${esc(release.version)}</span>
      ${release.published_at ? `<span class="muted small">${esc(fmtDate(release.published_at, true))}</span>` : ''}
      ${release.size_label ? `<span class="muted small">${esc(release.size_label)}</span>` : ''}
    </div>
    ${
      showChangelog && lines.length
        ? `<ul class="changelog">${lines.map((line) => `<li>${esc(line.replace(/^[-•]\s*/, ''))}</li>`).join('')}</ul>`
        : ''
    }
    ${
      release.can_download || release.downloadable
        ? `<a class="btn btn-ghost btn-sm" href="/api/app/download${
            release.version ? `?version=${encodeURIComponent(release.version)}` : ''
          }">Скачать</a>`
        : ''
    }
  </article>`;
}

/* --------------------------------- home --------------------------------- */

export async function home() {
  const [{ settings, stats, app }, { news }] = await Promise.all([api('/site'), api('/news?limit=4')]);
  const features = [
    { icon: '🛡', title: 'Закрытый состав', text: 'Каждый участник проходит проверку часов и навыков.' },
    { icon: '💬', title: 'Живой чат', text: 'Общение клана в реальном времени с модерацией.' },
    { icon: '📦', title: 'Файлы и сборки', text: 'Закрытые материалы, конфиги и приложения клана.' },
    { icon: '🎯', title: 'Роли и специализации', text: 'Combat, Builder, Farmer, Electric и другие.' },
    { icon: '🧩', title: 'KILLI ULTIMATE APP', text: 'Проверка компьютера на подозрительные индикаторы.' },
    { icon: '⚡', title: 'Актуальность', text: 'Новости, обновления и объявления от владельца.' },
  ];
  const memberCount = stats.members;
  return {
    html: `
    <section class="hero">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="hero-content">
        <span class="chip"><i class="dot-live"></i> ${esc(settings.clan_description || 'Игровое сообщество Rust')}</span>
        <h1 class="hero-title">${esc(settings.site_name || 'CLAN KILLI')}</h1>
        <p class="hero-sub">${esc(settings.site_tagline || 'Единство. Контроль. Сообщество.')}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/apply">Вступить в клан</a>
          <a class="btn btn-ghost" href="${esc(settings.discord_invite || '#/discord')}" target="_blank" rel="noopener">Открыть Discord</a>
          <a class="btn btn-quiet" href="#/app">Подробнее о приложении</a>
        </div>
        ${statsStrip(stats)}
      </div>
      <div class="hero-panel">
        <div class="panel-head">
          <span class="kicker">live status</span>
          <span class="pill-ok">онлайн ${esc(stats.online)}</span>
        </div>
        <div class="panel-body">
          <div class="panel-row"><span>Состав клана</span><strong>${esc(memberCount)}</strong></div>
          <div class="panel-row"><span>Заявки в очереди</span><strong>${esc(stats.pending)}</strong></div>
          <div class="panel-row"><span>Файлов доступно</span><strong>${esc(stats.downloads)}</strong></div>
          <div class="panel-row"><span>Приём заявок</span><strong>${
            settings.registration_open === '1' ? 'открыт' : 'закрыт'
          }</strong></div>
          <div class="panel-row"><span>Минимум часов</span><strong>${esc(settings.min_hours || 700)}+</strong></div>
        </div>
        <a class="panel-link" href="#/account">Личный кабинет →</a>
      </div>
    </section>

    <section class="block">
      <div class="block-head">
        <div>
          <span class="kicker">о клане</span>
          <h2>${esc(settings.site_name || 'CLAN KILLI')} — это структура</h2>
        </div>
        <a class="link-arrow" href="#/about">Читать подробнее →</a>
      </div>
      <div class="grid grid-2">
        <div class="card card-tall">
          <p class="big-text">${esc(settings.clan_description || '')}</p>
          <p class="muted">${esc(splitLines(settings.clan_about).slice(0, 2).join(' '))}</p>
          <div class="chip-row">
            ${Object.keys(SPECS)
              .map((key) => `<span class="tag">${esc(specMeta(key).label)}</span>`)
              .join('')}
          </div>
        </div>
        <div class="grid grid-2 tight">
          ${features
            .slice(0, 4)
            .map(
              (f) => `<article class="feature-card">
                <span class="feature-icon">${esc(f.icon)}</span>
                <h4>${esc(f.title)}</h4>
                <p class="muted small">${esc(f.text)}</p>
              </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="block">
      <div class="block-head">
        <div>
          <span class="kicker">преимущества</span>
          <h2>Что получает участник</h2>
        </div>
      </div>
      <div class="grid grid-3">
        ${features
          .map(
            (f) => `<article class="feature-card">
              <span class="feature-icon">${esc(f.icon)}</span>
              <h4>${esc(f.title)}</h4>
              <p class="muted small">${esc(f.text)}</p>
            </article>`
          )
          .join('')}
      </div>
    </section>

    <section class="block">
      <div class="block-head">
        <div>
          <span class="kicker">новости</span>
          <h2>Последние объявления</h2>
        </div>
        <a class="link-arrow" href="#/about">Все разделы →</a>
      </div>
      <div class="grid grid-2">
        ${news.length ? news.map(newsCard).join('') : '<p class="muted">Пока нет опубликованных новостей.</p>'}
      </div>
    </section>

    <section class="block">
      <div class="block-head">
        <div>
          <span class="kicker">killi ultimate app</span>
          <h2>Обновления приложения</h2>
        </div>
        <a class="link-arrow" href="#/app">Страница приложения →</a>
      </div>
      <div class="card card-split">
        <div>
          <h3>${esc(settings.app_name || 'KILLI ULTIMATE APP')}</h3>
          <p class="muted">${esc(settings.app_tagline || '')}</p>
          <p class="muted small">${esc(settings.app_disclaimer || '')}</p>
          <a class="btn btn-ghost" href="#/app">Подробнее</a>
        </div>
        <div class="app-latest">
          ${
            app
              ? `<span class="version-pill">последняя версия v${esc(app.version)}</span>
                 <p class="muted small">${esc(fmtDate(app.published_at, true))} · ${esc(app.size_label)}</p>`
              : '<p class="muted">Сборка ещё не опубликована.</p>'
          }
        </div>
      </div>
    </section>

    <section class="cta-band">
      <div>
        <span class="kicker">набор открыт</span>
        <h2>Готов войти в CLAN KILLI?</h2>
        <p class="muted">Заполни анкету «Кто ты в Rust?» и дождись решения владельца клана.</p>
      </div>
      <div class="cta-actions">
        <a class="btn btn-primary" href="#/apply">Подать заявку</a>
        <a class="btn btn-ghost" href="#/members">Состав клана</a>
      </div>
    </section>`,
  };
}

/* -------------------------------- about --------------------------------- */

export async function about() {
  const { settings, stats } = await api('/site');
  const rules = splitLines(settings.rules);
  const aboutLines = splitLines(settings.clan_about);
  return {
    html: `
    ${sectionHead('о клане', settings.site_name || 'CLAN KILLI', settings.site_tagline || 'Единство. Контроль. Сообщество.')}
    <div class="grid grid-2">
      <article class="card">
        <h3>Философия клана</h3>
        ${aboutLines.map((line) => `<p class="muted">${esc(line)}</p>`).join('') || `<p class="muted">${esc(settings.clan_description || '')}</p>`}
        <div class="stat-inline">
          <span><strong>${esc(stats.members)}</strong> участников</span>
          <span><strong>${esc(stats.online)}</strong> онлайн</span>
        </div>
      </article>
      <article class="card">
        <h3>Правила состава</h3>
        ${
          rules.length
            ? `<ol class="rules">${rules.map((line) => `<li>${esc(line.replace(/^[-•\d.)\s]+/, ''))}</li>`).join('')}</ol>`
            : '<p class="muted">Правила будут опубликованы владельцем клана.</p>'
        }
      </article>
    </div>

    <section class="block">
      <div class="block-head"><div><span class="kicker">роли</span><h2>Специализации клана</h2></div></div>
      <div class="grid grid-5">${Object.keys(SPECS).map((key) => specCard(key)).join('')}</div>
    </section>

    <section class="block">
      <div class="block-head"><div><span class="kicker">требования</span><h2>Кого мы принимаем</h2></div></div>
      <div class="grid grid-3">
        <article class="card"><h4>${esc(settings.min_hours || 700)}+ часов в Rust</h4><p class="muted small">Основное требование к опыту. Указывается в анкете, проверяется вручную по Steam-профилю.</p></article>
        <article class="card"><h4>Активность и микрофон</h4><p class="muted small">Участие в жизни клана, координация и связь в Discord.</p></article>
        <article class="card"><h4>Исключения</h4><p class="muted small">Меньше ${esc(settings.min_hours || 700)} часов? Заявка с пометкой «Исключение» рассматривается владельцем отдельно.</p></article>
      </div>
    </section>

    <section class="cta-band">
      <div><span class="kicker">заявка</span><h2>Анкета «Кто ты в Rust?»</h2><p class="muted">Одна основная роль, несколько дополнительных и диапазон часов.</p></div>
      <div class="cta-actions"><a class="btn btn-primary" href="#/apply">Заполнить анкету</a></div>
    </section>`,
  };
}

/* ------------------------------- members -------------------------------- */

export async function members() {
  const { settings } = state.site || {};
  const isMember = Boolean(state.user && state.user.permissions && state.user.permissions.member);
  if (!isMember && (!settings || settings.members_public !== '1')) {
    return {
      html: `${sectionHead('состав', 'Участники клана', 'Список состава доступен принятым участникам CLAN KILLI.')}
      <div class="card empty-state">
        <p>Войди и подай заявку — после принятия раздел откроется автоматически.</p>
        <div class="hero-actions"><a class="btn btn-primary" href="#/apply">Подать заявку</a><a class="btn btn-ghost" href="#/account">Личный кабинет</a></div>
      </div>`,
    };
  }
  let data;
  try {
    data = await api('/members');
  } catch (error) {
    return { html: `${sectionHead('состав', 'Участники клана')}<div class="card empty-state"><p>${esc(error.message)}</p></div>` };
  }
  const filterKeys = ['all', ...Object.keys(SPECS)];
  return {
    html: `${sectionHead('состав', 'Участники клана', `${data.total} игроков в составе CLAN KILLI`)}
    <div class="toolbar">
      <input class="input" type="search" id="memberSearch" placeholder="Поиск по никнейму" autocomplete="off" />
      <div class="chip-row" id="memberFilters">
        ${filterKeys
          .map(
            (key) =>
              `<button class="chip-btn${key === 'all' ? ' is-active' : ''}" data-spec="${esc(key)}">${
                key === 'all' ? 'Все' : esc(specMeta(key).label)
              }${key === 'all' ? '' : ` · ${esc(data.counts[key] || 0)}`}</button>`
          )
          .join('')}
      </div>
    </div>
    <div class="grid grid-3" id="memberGrid">${data.members.map(memberCard).join('') || '<p class="muted">Состав пока пуст.</p>'}</div>`,
    mount(root) {
      const grid = root.querySelector('#memberGrid');
      const input = root.querySelector('#memberSearch');
      const chips = Array.from(root.querySelectorAll('#memberFilters .chip-btn'));
      let spec = 'all';
      const render = () => {
        const q = (input.value || '').trim().toLowerCase();
        const list = data.members.filter((m) => {
          const matchQ = !q || m.nickname.toLowerCase().includes(q) || (m.steam && (m.steam.name || '').toLowerCase().includes(q));
          const matchS = spec === 'all' || m.specialization === spec || (m.extra_roles || []).includes(spec);
          return matchQ && matchS;
        });
        grid.innerHTML = list.length ? list.map(memberCard).join('') : '<p class="muted">Никого не нашли.</p>';
      };
      input.addEventListener('input', render);
      chips.forEach((chip) =>
        chip.addEventListener('click', () => {
          chips.forEach((c) => c.classList.remove('is-active'));
          chip.classList.add('is-active');
          spec = chip.dataset.spec;
          render();
        })
      );
    },
  };
}

function memberCard(member) {
  const main = specMeta(member.specialization);
  const extra = (member.extra_roles || []).map((key) => `<span class="tag tag-dim">${esc(specMeta(key).label)}</span>`).join('');
  return `<article class="member-card">
    <div class="member-top">
      ${avatarHtml(member, 'avatar-lg')}
      <div class="member-id">
        <h4>${esc(member.nickname)}</h4>
        <span class="muted small">${esc(main.title)} · ${esc(HOURS[member.rust_hours] || '—')}</span>
        ${statusDot(member.status)}
      </div>
    </div>
    <div class="chip-row">${extra || '<span class="muted small">Только основная роль</span>'}</div>
    <div class="member-links">
      ${member.steam ? `<a class="mini-link" href="${esc(member.steam.url || '#')}" target="_blank" rel="noopener">Steam</a>` : ''}
      ${member.discord ? `<a class="mini-link" href="${esc(member.discord.url || '#')}" target="_blank" rel="noopener">Discord</a>` : ''}
      <span class="muted small">с ${esc(fmtDate(member.member_since))}</span>
    </div>
  </article>`;
}

/* ------------------------------- downloads ------------------------------- */

export async function downloads() {
  const data = await api('/downloads');
  return {
    html: `${sectionHead(
      'файлы',
      'Загрузки клана',
      data.member ? 'Закрытые материалы доступны участникам клана.' : 'Скачивание доступно только принятым участникам.'
    )}
    ${
      data.downloads.length
        ? `<div class="grid grid-2">${data.downloads.map(downloadCard).join('')}</div>`
        : '<div class="card empty-state"><p>Опубликованных файлов пока нет.</p></div>'
    }`,
  };
}

function downloadCard(item) {
  return `<article class="download-card">
    <div class="download-icon">${esc(item.icon || '📦')}</div>
    <div class="download-body">
      <div class="download-head">
        <h3>${esc(item.title)}</h3>
        ${item.version ? `<span class="version-pill">v${esc(item.version)}</span>` : ''}
      </div>
      <p class="muted small">${esc(item.description || '')}</p>
      <div class="meta-row">
        <span>${esc(item.size_label || '—')}</span>
        <span>${esc(fmtDate(item.published_at || item.created_at))}</span>
        <span>${esc(item.category || 'file')}</span>
        <span>${esc(item.download_count || 0)} скачиваний</span>
      </div>
    </div>
    <div class="download-action">
      ${
        item.can_download
          ? `<a class="btn btn-primary btn-sm" href="/api/downloads/${esc(item.id)}/file">Скачать</a>`
          : `<button class="btn btn-quiet btn-sm" data-locked>Только участникам</button>`
      }
    </div>
  </article>`;
}

/* --------------------------------- app ---------------------------------- */

export async function appPage() {
  const { settings, app } = await api('/site');
  const data = await api('/app');
  const info = data.app;
  const features = splitLines(info.features);
  return {
    html: `${sectionHead('приложение', info.name || 'KILLI ULTIMATE APP', info.tagline || '')}
    <div class="grid grid-app">
      <article class="card card-feature">
        <h3>Возможности</h3>
        ${
          features.length
            ? `<ul class="feature-list">${features.map((line) => `<li>${esc(line.replace(/^[-•]\s*/, ''))}</li>`).join('')}</ul>`
            : `<p class="muted">${esc(info.description || '')}</p>`
        }
        <div class="disclaimer">
          <strong>Важно.</strong> ${esc(
            info.disclaimer || 'Приложение помогает найти подозрительные файлы и индикаторы, но не гарантирует полную защиту.'
          )}
        </div>
      </article>
      <article class="card card-download">
        <span class="kicker">актуальная версия</span>
        ${
          info.latest
            ? `<h2 class="app-version">v${esc(info.latest.version)}</h2>
               <p class="muted small">${esc(fmtDate(info.latest.published_at, true))} · ${esc(info.latest.size_label)}</p>
               ${
                 info.latest.can_download
                   ? `<a class="btn btn-primary btn-block" href="/api/app/download">Скачать сборку</a>`
                   : `<a class="btn btn-ghost btn-block" href="#/account">Войти как участник</a>`
               }`
            : '<p class="muted">Сборка ещё не опубликована. Следите за обновлениями.</p>'
        }
        <p class="muted small">Проверка выполняется локально. Решение о допуске принимает владелец клана.</p>
      </article>
    </div>
    <section class="block">
      <div class="block-head"><div><span class="kicker">история</span><h2>История версий</h2></div></div>
      <div class="timeline">
        ${
          info.releases.length
            ? info.releases
                .map((release) => `<div class="timeline-item">${releaseCard({ ...release, downloadable: true })}</div>`)
                .join('')
            : '<p class="muted">Обновлений пока не было.</p>'
        }
      </div>
    </section>
    <p class="muted small">${esc(settings.app_disclaimer || '')}</p>`,
  };
}

/* -------------------------------- discord -------------------------------- */

export async function discordPage() {
  const { settings, stats } = await api('/site');
  const mainInvite = settings.discord_invite || '';
  const exceptionInvite = settings.discord_exception_invite || '';
  return {
    html: `${sectionHead('discord', settings.discord_name || 'CLAN KILLI', settings.discord_description || '')}
    <div class="grid grid-2">
      <article class="discord-card">
        <div class="discord-logo">${esc(settings.logo_letter || 'K')}</div>
        <h2>${esc(settings.discord_name || 'CLAN KILLI')}</h2>
        <p class="muted">${esc(settings.discord_description || 'Официальный сервер клана.')}</p>
        <div class="meta-row">
          <span>${esc(stats.members)} участников клана</span>
          <span>${esc(stats.online)} онлайн</span>
        </div>
        ${
          mainInvite
            ? `<a class="btn btn-primary btn-block" href="${esc(mainInvite)}" target="_blank" rel="noopener">Войти на сервер</a>`
            : '<p class="muted small">Ссылка пока не настроена владельцем.</p>'
        }
      </article>
      <article class="card">
        <span class="kicker">исключения</span>
        <h3>Заявки-исключения</h3>
        <p class="muted">Для игроков с опытом меньше ${esc(settings.min_hours || 700)} часов — отдельный канал рассмотрения и
        обсуждение условий вступления.</p>
        ${
          exceptionInvite
            ? `<a class="btn btn-ghost" href="${esc(exceptionInvite)}" target="_blank" rel="noopener">Открыть канал исключений</a>`
            : '<p class="muted small">Ссылка для исключений пока не настроена.</p>'
        }
        <hr class="divider" />
        <h4>Как проходит вступление</h4>
        <ol class="rules">
          <li>Авторизация через Steam или Discord.</li>
          <li>Анкета «Кто ты в Rust?» и диапазон часов.</li>
          <li>Проверка владельцем клана.</li>
          <li>Статус участника и доступ к закрытым разделам.</li>
        </ol>
      </article>
    </div>`,
  };
}

export { releaseCard, memberCard, downloadCard };
