// 画面上のパドルを表示するかしないかを選べること
//
// ・既定は表示。PC では右の欄が見え、「隠す」で消えて本文が全幅になる
// ・設定・記録の「画面上のパドルを表示する」で戻せる。設定は読み直しても残る
// ・消していてもキーボード（Z / X）で打てる
// ・スマートフォンでは、消していると「パドル」ボタンが出ず、打鍵タブでも引き出しが開かない
const { chromium, devices } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// ── PC ──
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(500);
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(200);

const look = () => page.evaluate(() => ({
  rail: getComputedStyle(document.querySelector('#paddle-widget')).display !== 'none',
  hideBtn: getComputedStyle(document.querySelector('#pw-hide')).display !== 'none',
  mainWidth: Math.round(document.querySelector('main').getBoundingClientRect().width),
  off: document.body.classList.contains('is-paddle-off'),
  checked: document.querySelector('#set-paddle-show').checked,
  setting: window.__cw.settings.showPaddle,
}));
const before = await look();
console.log('既定:', JSON.stringify(before));
ok('既定では右の欄が出る', before.rail && before.checked && before.setting !== false, JSON.stringify(before));
ok('PC の欄に「隠す」がある', before.hideBtn);

await page.click('#pw-hide');
await page.waitForTimeout(300);
const hidden = await look();
console.log('隠す:', JSON.stringify(hidden));
ok('「隠す」で欄が消える', !hidden.rail && hidden.off && hidden.setting === false, JSON.stringify(hidden));
ok('本文が全幅に広がる', hidden.mainWidth > before.mainWidth + 200, `${before.mainWidth} → ${hidden.mainWidth}`);
ok('設定のチェックも外れる', hidden.checked === false);
await page.screenshot({ path: `${DIR}/paddle-off-pc.png` });

// 消していてもキーボードで打てる（パドル送信タブ）
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
await page.evaluate(() => window.__cw.keyer.reset());
await page.keyboard.down('z');
await page.waitForTimeout(40);
await page.keyboard.up('z');
await page.waitForTimeout(700);
const keyed = await page.evaluate(() => window.__cw.keyer.text + window.__cw.keyer.buffer);
ok('消していてもキーボードで打てる', keyed.trim().length > 0, JSON.stringify(keyed));
await page.evaluate(() => window.__cw.keyer.reset());

// 読み直しても残り、設定から戻せる
await page.reload();
await page.waitForTimeout(500);
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(200);
const kept = await look();
ok('読み直しても消えたまま', !kept.rail && kept.setting === false, JSON.stringify(kept));
await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(200);
await page.locator('#set-paddle-show').scrollIntoViewIfNeeded();
await page.click('#set-paddle-show');
await page.waitForTimeout(300);
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(200);
const back = await look();
ok('設定のチェックで欄が戻る', back.rail && !back.off && back.setting === true, JSON.stringify(back));
await page.close();

// ── スマートフォン ──
const m = await browser.newPage({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
m.on('pageerror', (e) => errors.push('pageerror(mobile): ' + e.message));
await m.goto(`${BASE}/index.html`);
await m.evaluate(() => localStorage.clear());
await m.reload();
await m.waitForTimeout(500);
const fabShown = () => m.evaluate(() => getComputedStyle(document.querySelector('#btn-paddle-sheet')).display !== 'none');
ok('スマートフォンでは既定で「パドル」ボタンが出る', await fabShown());
await m.evaluate(() => window.__cw.setPaddleShown(false));
await m.waitForTimeout(300);
ok('消すとボタンも出ない', !(await fabShown()));
await m.click('.tab[data-panel="keyer"]');
await m.waitForTimeout(600);
const sheetOpen = await m.evaluate(() => document.querySelector('#paddle-widget').classList.contains('is-open'));
ok('消していると打鍵タブでも引き出しが開かない', !sheetOpen);
await m.screenshot({ path: `${DIR}/paddle-off-mobile.png` });
await m.evaluate(() => window.__cw.setPaddleShown(true));
await m.waitForTimeout(300);
ok('戻せばボタンが出る', await fabShown());
await m.close();

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();
process.exit(errors.length + fails.length ? 1 : 0);
