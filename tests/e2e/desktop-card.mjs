// 設定・記録タブの「Windows 版（デスクトップ）」の欄
//
// ・ブラウザ（window.cwDesktop が無い）では出ない
// ・exe 側の橋（window.cwDesktop）があれば出て、版・種類・Web 版の commit が見える
// ・「最新版に更新する」で橋の checkForUpdates が呼ばれ、届いた状態が文で出る。
//   ダウンロードが済めば「再起動して適用する」が出て、押すと installUpdate が呼ばれる
// ・「起動時に更新を確認する」の切り替えと「ダウンロードページ」も橋に渡る
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// ── ブラウザでは出ない ──
const plain = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
plain.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await plain.goto(`${BASE}/index.html`);
await plain.waitForTimeout(400);
ok('ブラウザでは欄が出ない', await plain.evaluate(() => document.querySelector('#desktop-card').hidden === true));
await plain.close();

// ── exe 側の橋を模して開く ──
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => {
  window.__calls = [];
  window.cwDesktop = {
    version: '9.9.9',
    portable: false,
    getInfo: async () => ({ version: '9.9.9', portable: false, webCommit: 'abcdef0123456789', webDate: '2026-11-02', checkOnStartup: true }),
    onUpdateStatus: (cb) => { window.__status = cb; },
    checkForUpdates: async () => {
      window.__calls.push('check');
      setTimeout(() => window.__status({ state: 'available', version: '10.0.0' }), 250);
      setTimeout(() => window.__status({ state: 'downloading', version: '10.0.0', percent: 42 }), 350);
      setTimeout(() => window.__status({ state: 'downloaded', version: '10.0.0' }), 450);
    },
    installUpdate: () => { window.__calls.push('install'); },
    setCheckOnStartup: (v) => { window.__calls.push('startup:' + v); },
    openReleases: () => { window.__calls.push('releases'); },
  };
});
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(500);
await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(300);

const card = await page.evaluate(() => ({
  hidden: document.querySelector('#desktop-card').hidden,
  version: document.querySelector('#desktop-version').textContent,
  startup: document.querySelector('#desktop-check-startup').checked,
  installHidden: document.querySelector('#btn-desktop-install').hidden,
}));
console.log('欄:', JSON.stringify(card));
ok('exe では欄が出る', card.hidden === false);
ok('版・種類・Web 版の commit が見える', /版 9\.9\.9/.test(card.version) && /インストーラー版/.test(card.version) && /abcdef0/.test(card.version) && /2026-11-02/.test(card.version), card.version);
ok('起動時の確認の印が設定どおり', card.startup === true);
ok('最初は「再起動して適用する」は出ない', card.installHidden === true);

await page.locator('#desktop-card').scrollIntoViewIfNeeded();
await page.click('#btn-desktop-update');
ok('押した直後は確認中', /確認しています/.test(await page.textContent('#desktop-update-status')), await page.textContent('#desktop-update-status'));
await page.waitForFunction(() => /準備ができました/.test(document.querySelector('#desktop-update-status').textContent), null, { timeout: 5000 });
const after = await page.evaluate(() => ({
  status: document.querySelector('#desktop-update-status').textContent,
  installHidden: document.querySelector('#btn-desktop-install').hidden,
  updateDisabled: document.querySelector('#btn-desktop-update').disabled,
  calls: window.__calls.slice(),
}));
console.log('更新後:', JSON.stringify(after));
ok('橋の checkForUpdates が呼ばれる', after.calls.includes('check'));
ok('ダウンロードが済むと「再起動して適用する」が出る', after.installHidden === false && /10\.0\.0/.test(after.status), after.status);
ok('済んだあとは更新ボタンが戻る', after.updateDisabled === false);
await page.screenshot({ path: `${DIR}/desktop-card.png`, fullPage: true });

await page.click('#btn-desktop-install');
await page.click('#btn-desktop-releases');
await page.click('#desktop-check-startup');
await page.waitForTimeout(100);
const calls = await page.evaluate(() => window.__calls.slice());
ok('適用・ダウンロードページ・起動時の切り替えが橋に渡る', calls.includes('install') && calls.includes('releases') && calls.includes('startup:false'), JSON.stringify(calls));

// 失敗の状態も文で出る
await page.evaluate(() => window.__status({ state: 'error', message: 'GitHub API 503' }));
ok('失敗は理由つきで出る', /失敗.*503/.test(await page.textContent('#desktop-update-status')), await page.textContent('#desktop-update-status'));
await page.evaluate(() => window.__status({ state: 'portable-available', version: '10.0.0' }));
ok('Portable 版の案内も出る', /Portable 版/.test(await page.textContent('#desktop-update-status')));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();
process.exit(errors.length + fails.length ? 1 : 0);
