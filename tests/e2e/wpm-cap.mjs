// 送信速度の上限（28 WPM）
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';
const CAP = 28;

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

// ── つまみの上限 ────────────────────────────────
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
ok('つまみの max が 28', await page.getAttribute('#keyer-wpm', 'max') === String(CAP));

// つまみを目一杯まで動かしても 28 を超えない
await page.evaluate((cap) => {
  const el = document.querySelector('#keyer-wpm');
  el.value = String(cap + 20);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, CAP);
await page.waitForTimeout(200);
const slid = await page.evaluate(() => Number(document.querySelector('#keyer-wpm').value));
ok('つまみが 28 で頭打ち', slid === CAP, String(slid));
ok('設定にも 28 が入る', await page.evaluate(() => window.__cw.settings.keyerWpm) === CAP);
ok('キーヤー本体も 28', await page.evaluate(() => window.__cw.keyer.wpm) === CAP);
ok('表示も 28 WPM', (await page.textContent('#keyer-wpm-out')).includes(String(CAP)));
await page.screenshot({ path: `${DIR}/w1-keyer-cap.png`, fullPage: true });

// ── API を直に叩いても超えない ──────────────────
ok('setParams で 60 を渡しても 28', await page.evaluate(() => {
  window.__cw.keyer.setParams({ wpm: 60 });
  return window.__cw.keyer.wpm;
}) === CAP);
ok('setParams で 3 を渡しても 5 まで', await page.evaluate(() => {
  window.__cw.keyer.setParams({ wpm: 3 });
  return window.__cw.keyer.wpm;
}) === 5);

// 実際に鳴る音の長さも上限どおりか（28 WPM の短点 = 1.2/28 秒）
await page.evaluate(() => { window.__cw.keyer.setParams({ wpm: 28 }); });
const dit = await page.evaluate(() => window.__cw.keyer.dit);
ok('28 WPM の短点は約 42.9 ms', Math.abs(dit - 1.2 / CAP) < 1e-9, `${(dit * 1000).toFixed(1)} ms`);

// ── 保存値が範囲外でも読み込み時に丸める ────────
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('cwtraining.settings.v1') || '{}');
  s.keyerWpm = 40;                      // 上限を下げる前の設定を模す
  localStorage.setItem('cwtraining.settings.v1', JSON.stringify(s));
});
await page.reload();
await page.waitForTimeout(600);
ok('保存された 40 が 28 に丸まる', await page.evaluate(() => window.__cw.settings.keyerWpm) === CAP);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(250);
ok('つまみも 28 を指す', await page.evaluate(() => Number(document.querySelector('#keyer-wpm').value)) === CAP);

// ── コンテストの自局速度も同じ上限 ──────────────
await page.click('.tab[data-panel="contest"]');
await page.selectOption('#contest-minutes', '3');
await page.click('#btn-contest-start');
await page.waitForTimeout(800);

const start = await page.evaluate(() => window.__cw.contest.opts.myWpm);
console.log('開始時の自局速度:', start);
ok('開始時から 28 以下', start <= CAP, String(start));

for (let i = 0; i < 12; i++) {
  await page.keyboard.press('PageUp');
  await page.waitForTimeout(60);
}
const top = await page.evaluate(() => window.__cw.contest.opts.myWpm);
console.log('PgUp を 12 回押した後:', top);
ok('PgUp を連打しても 28 で止まる', top === CAP, String(top));
ok('画面表示も 28 WPM', (await page.textContent('#contest-wpm-out')).includes(String(CAP)));
await page.screenshot({ path: `${DIR}/w2-contest-cap.png`, fullPage: true });

for (let i = 0; i < 15; i++) {
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(60);
}
const bottom = await page.evaluate(() => window.__cw.contest.opts.myWpm);
ok('PgDn の下限は 10 のまま', bottom === 10, String(bottom));
await page.evaluate(() => window.__cw.contest.stopSession());

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
