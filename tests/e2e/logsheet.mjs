// 聞き取り練習の書き取り欄（案内・目立ち方・操作しやすさ）
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.locator('.style-option[data-style="copy"]').click();
await page.waitForTimeout(150);
await page.click('#btn-qso-start');
await page.waitForTimeout(900);

// 書き取り欄のあるターンまで進める
for (let i = 0; i < 8; i++) {
  if (await page.locator('.logsheet').count()) break;
  if (await page.locator('#btn-turn-skip').count()) await page.click('#btn-turn-skip');
  else if (await page.locator('#btn-turn-next').count()) await page.click('#btn-turn-next');
  else break;
  await page.waitForTimeout(300);
}
ok('書き取り欄が出ている', await page.locator('.logsheet').count() === 1);

// ── 何を入れるのかが分かること ────────────────────
const ph = await page.locator('.logsheet input').evaluateAll(
  (els) => els.map((e) => ({ key: e.dataset.key, ph: e.getAttribute('placeholder') })));
console.log('案内:', JSON.stringify(ph));
ok('全欄に案内が付く', ph.length > 0 && ph.every((f) => (f.ph ?? '').length > 0), JSON.stringify(ph));
const call = ph.find((f) => f.key === 'callsign');
ok('コールサイン欄の案内', call?.ph === '聞き取ったコールサインを入力', call?.ph);
ok('項目ごとに案内が違う', new Set(ph.map((f) => f.ph)).size === ph.length);

// ── 目立つこと ────────────────────────────────────
const style = await page.evaluate(() => {
  const sheet = document.querySelector('.logsheet');
  const input = sheet.querySelector('input');
  const card = document.querySelector('.qso-turn-card');
  const cs = getComputedStyle(input);
  const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  return {
    fontPx: parseFloat(cs.fontSize),
    heightPx: input.getBoundingClientRect().height,
    sheetLum: lum(getComputedStyle(sheet).backgroundColor),
    cardLum: lum(getComputedStyle(card).backgroundColor),
    mono: cs.fontFamily.toLowerCase(),
  };
});
console.log('見た目:', JSON.stringify(style));
ok('文字が大きい（17px 以上）', style.fontPx >= 17, `${style.fontPx}px`);
ok('欄の高さが十分（38px 以上）', style.heightPx >= 38, `${style.heightPx.toFixed(0)}px`);
ok('周りより明るい', style.sheetLum > style.cardLum, `${style.sheetLum.toFixed(1)} vs ${style.cardLum.toFixed(1)}`);
ok('等幅で並ぶ', /mono/.test(style.mono), style.mono.slice(0, 30));

// 焦点を当てると強調される
await page.locator('.logsheet input').first().focus();
await page.waitForTimeout(150);
const focused = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.logsheet input'));
  return { outline: cs.outlineWidth, border: cs.borderColor };
});
ok('入力中は枠が強調される', parseFloat(focused.outline) > 0, JSON.stringify(focused));

// ── 開始ボタンから遠すぎないこと ──────────────────
const geom = await page.evaluate(() => {
  const s = document.querySelector('#btn-qso-start').getBoundingClientRect();
  const l = document.querySelector('.logsheet').getBoundingClientRect();
  return { startY: s.y, sheetY: l.y, gap: l.y - s.bottom, vh: innerHeight };
});
console.log('位置:', JSON.stringify(geom));
ok('開始ボタンと書き取り欄が同じ画面に入る',
  geom.startY > 0 && geom.sheetY < geom.vh, JSON.stringify(geom));
ok('間隔が広すぎない（400px 未満）', geom.gap < 400, `${geom.gap.toFixed(0)}px`);

// 交信ログは書き取り欄より後ろ（参照用なので邪魔しない）
ok('交信ログは書き取り欄より下', await page.evaluate(() => {
  const log = document.querySelector('.qso-log-card').getBoundingClientRect();
  const sheet = document.querySelector('.logsheet').getBoundingClientRect();
  return log.y > sheet.y;
}));

// 表示しない設定では、空の表示欄で押し下げられない
ok('受信中の表示欄は出ていない', await page.locator('#qso-playing').count() === 0);
await page.screenshot({ path: `${DIR}/s1-logsheet.png`, fullPage: false });

// ── 実際に書き取って採点まで通ること ──────────────
const answers = await page.evaluate(() => window.__cw.qsoTurn.fields.map((f) => [f.key, f.value]));
for (const [key, value] of answers) await page.fill(`.logsheet input[data-key="${key}"]`, value);
await page.click('#btn-turn-grade');
await page.waitForTimeout(400);
const graded = (await page.textContent('#qso-turn')).replace(/\s+/g, ' ');
console.log('採点:', graded.slice(0, 60));
ok('正しく書き取れば ○ になる', graded.includes('○') && !graded.includes('×'), graded.slice(0, 80));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
