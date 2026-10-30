'use strict';

/*
 * CLAN KILLI — real browser verification.
 *
 * Starts the app on a throwaway database, then drives Chromium (desktop + phone)
 * through every route and asserts: expected content, no console/page errors,
 * no failed same-origin assets, working mobile drawer, and the 5-click owner gate.
 *
 * Usage: node scripts/browser-check.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.CHECK_PORT || 3111);
const BASE = `http://127.0.0.1:${PORT}`;

const PW_PATHS = [
  process.env.PLAYWRIGHT_PATH,
  '/opt/appjet/browser/node_modules/playwright',
  'playwright',
].filter(Boolean);

const BINARIES = [
  process.env.CHROMIUM_PATH,
  '/opt/appjet/browser-binaries/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  '/opt/appjet/browser-binaries/chromium-1234/chrome-linux64/chrome',
  '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
].filter(Boolean);

const failures = [];
const notes = [];

function pass(message) {
  notes.push(message);
  console.log(`  ok  ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`  XX  ${message}`);
}

function expect(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

/* Rendered text is CSS-transformed (the hero tagline is uppercased), so compare normalised. */
function normalize(text) {
  return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

function loadPlaywright() {
  for (const candidate of PW_PATHS) {
    try {
      return require(candidate);
    } catch {
      /* try next */
    }
  }
  throw new Error('playwright is not available');
}

function pickBinary() {
  for (const candidate of BINARIES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect(PORT, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const ROUTES = [
  { hash: '#/', name: 'home', texts: ['CLAN KILLI', 'Единство. Контроль. Сообщество.'] },
  { hash: '#/about', name: 'about', texts: ['CLAN KILLI'] },
  { hash: '#/members', name: 'members', texts: ['Участники'] },
  { hash: '#/downloads', name: 'downloads', texts: ['Загрузки'] },
  { hash: '#/app', name: 'app', texts: ['KILLI ULTIMATE APP'] },
  { hash: '#/discord', name: 'discord', texts: ['Discord'] },
  { hash: '#/account', name: 'account', texts: ['Steam'] },
  { hash: '#/apply', name: 'apply', texts: ['Rust'] },
  { hash: '#/admin', name: 'admin', texts: [] },
];

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'killi-browser-'));
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (chunk) => {
    serverLog += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk;
  });

  let browser;
  try {
    if (!(await waitForServer())) {
      throw new Error(`server did not start on port ${PORT}\n${serverLog}`);
    }
    pass('server started');

    const { chromium } = loadPlaywright();
    browser = await chromium.launch({
      executablePath: pickBinary(),
      timeout: 30000,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    pass('chromium launched');

    /* ------------------------------ desktop ------------------------------ */
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!/favicon|ERR_INTERNET_DISCONNECTED|Failed to connect to the bus/i.test(text)) consoleErrors.push(text);
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (req) => {
      if (req.url().startsWith(BASE)) failedRequests.push(`${req.url()} ${req.failure()?.errorText || ''}`);
    });
    page.on('response', (res) => {
      if (res.url().startsWith(BASE) && res.status() >= 400) failedRequests.push(`${res.url()} → ${res.status()}`);
    });

    for (const route of ROUTES) {
      consoleErrors.length = 0;
      failedRequests.length = 0;
      const response = await page.goto(`${BASE}/${route.hash}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(250);

      // Hash navigations are same-document: Chromium reports no response for them.
      expect(!response || response.status() === 200, `${route.name}: document returns 200`);

      const appText = (await page.locator('#app').innerText().catch(() => '')).trim();
      expect(appText.length > 40, `${route.name}: view rendered (${appText.length} chars)`);

      const bodyText = normalize(await page.locator('body').innerText());
      for (const expected of route.texts) {
        expect(bodyText.includes(normalize(expected)), `${route.name}: shows "${expected}"`);
      }

      expect(consoleErrors.length === 0, `${route.name}: no console errors${consoleErrors.length ? ` → ${consoleErrors[0]}` : ''}`);
      expect(failedRequests.length === 0, `${route.name}: no failed requests${failedRequests.length ? ` → ${failedRequests[0]}` : ''}`);

      const cssLoaded = await page.evaluate(() => {
        const sheet = [...document.styleSheets].find((s) => (s.href || '').includes('styles.css'));
        return Boolean(sheet);
      });
      expect(cssLoaded, `${route.name}: styles.css stylesheet applied`);

      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const parts = bg.match(/\d+/g)?.map(Number) || [255, 255, 255];
      const isDark = parts[0] + parts[1] + parts[2] < 200;
      expect(isDark, `${route.name}: dark graphite background (${bg})`);
    }

    /* ------------------------------- shell ------------------------------- */
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    expect((await page.locator('#nav a').count()) === 8, 'desktop nav has 8 items');
    expect((await page.locator('#mobileNav a, #mobileNav button').count()) >= 5, 'mobile nav has 5+ items');
    expect(await page.locator('footer #byFreak').isVisible(), 'footer shows BY FREAK');
    expect(
      (await page.locator('.hero a[href="#/apply"], .hero a[href="#/account"]').count()) >= 1,
      'hero has a join CTA'
    );
    expect((await page.locator('.hero').innerText()).includes('Discord'), 'hero has a Discord CTA');
    expect((await page.locator('.hero').innerText()).toLowerCase().includes('приложен'), 'hero has an app CTA');

    const activeNav = await page.locator('#nav a.is-active').count();
    expect(activeNav === 1, `exactly one nav item marked active (${activeNav})`);

    const bgImage = await page.evaluate(() => getComputedStyle(document.getElementById('bgImage')).backgroundImage);
    expect(!/marble/i.test(bgImage), 'background layer has no marble image');
    expect(
      await page.evaluate(() => document.body.dataset.bg === 'tech'),
      'body uses the tech background variant'
    );

    /* ---------------------------- owner 5 clicks -------------------------- */
    for (let i = 0; i < 5; i += 1) await page.locator('#byFreak').click();
    await page.waitForTimeout(600);
    const modalText = await page.locator('#modalRoot').innerText().catch(() => '');
    expect(modalText.length > 10, 'five BY FREAK clicks open the owner login modal');
    const passwordFields = await page.locator('#modalRoot input[type="password"]').count();
    expect(passwordFields >= 1, 'owner modal asks for a password (server-side check)');
    const htmlLeak = await page.content();
    expect(!htmlLeak.includes('Moti3003') && !htmlLeak.includes('Kili clan 26'), 'no initial passwords in page source');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);

    /* ------------------------------- mobile ------------------------------ */
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const mpage = await phone.newPage();
    const mobileErrors = [];
    mpage.on('pageerror', (error) => mobileErrors.push(error.message));
    mpage.on('console', (msg) => {
      if (msg.type() === 'error' && !/favicon/i.test(msg.text())) mobileErrors.push(msg.text());
    });

    for (const route of ROUTES) {
      await mpage.goto(`${BASE}/${route.hash}`, { waitUntil: 'networkidle', timeout: 30000 });
      await mpage.waitForTimeout(200);
      const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow <= 2, `mobile ${route.name}: no horizontal overflow (${overflow}px)`);
    }

    await mpage.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
    await mpage.waitForTimeout(250);

    expect(await mpage.locator('#mobileNav').isVisible(), 'mobile: bottom navigation is visible');
    expect(!(await mpage.locator('#nav').isVisible()), 'mobile: desktop nav is hidden');

    await mpage.locator('#navToggle').click();
    await mpage.waitForTimeout(450);
    expect(await mpage.locator('#navDrawer').isVisible(), 'mobile: hamburger opens the drawer');
    const drawerOpen = await mpage.evaluate(() => document.body.classList.contains('drawer-open'));
    expect(drawerOpen, 'mobile: drawer-open state applied to body');
    await mpage.keyboard.press('Escape');
    await mpage.waitForTimeout(350);
    expect(!(await mpage.evaluate(() => document.body.classList.contains('drawer-open'))), 'mobile: Escape closes the drawer');

    expect(mobileErrors.length === 0, `mobile: no runtime errors${mobileErrors.length ? ` → ${mobileErrors[0]}` : ''}`);

    /* ------------------------------- API --------------------------------- */
    const apiChecks = [
      ['/healthz', 200],
      ['/api/site', 200],
      ['/api/news', 200],
      ['/api/downloads', 200],
      ['/api/app', 200],
      ['/api/roles', 200],
      ['/api/owner/status', 200],
    ];
    for (const [endpoint, status] of apiChecks) {
      const res = await page.request.get(`${BASE}${endpoint}`);
      expect(res.status() === status, `GET ${endpoint} → ${res.status()}`);
    }

    // The roster is clan-internal: guests must not read it.
    const roster = await page.request.get(`${BASE}/api/members`);
    expect(roster.status() === 401 || roster.status() === 403, `GET /api/members is members-only (${roster.status()})`);

    await page.goto(`${BASE}/#/members`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const guestRoster = normalize(await page.locator('#app').innerText());
    expect(guestRoster.includes('принят'), 'guest sees the members-only explanation on #/members');

    const guarded = await page.request.get(`${BASE}/api/applications/me`);
    expect(guarded.status() === 401 || guarded.status() === 403, `GET /api/applications/me is guarded (${guarded.status()})`);

    const badLogin = await page.request.post(`${BASE}/api/owner/login`, { data: { password: 'wrong-password' } });
    expect(badLogin.status() === 401 || badLogin.status() === 400 || badLogin.status() === 429, `owner login rejects a wrong password (${badLogin.status()})`);

    await context.close();
    await phone.close();
  } catch (error) {
    fail(`fatal: ${error.message.split('\n')[0]}`);
    if (error.message.includes('server did not start')) console.error(serverLog);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log('');
  if (failures.length) {
    console.error(`✗ browser check failed: ${failures.length} failing, ${notes.length} passing`);
    process.exit(1);
  }
  console.log(`✓ browser check passed — ${notes.length} assertions across desktop + mobile routes`);
  process.exit(0);
})();
