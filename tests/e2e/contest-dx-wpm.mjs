// コンテスト運用の「相手局の速度」
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.click('.tab[data-panel="contest"]');
await page.waitForTimeout(300);

const setRange = async (sel, v) => {
  await page.evaluate(([s, val]) => {
    const el = document.querySelector(s);
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [sel, v]);
  await page.waitForTimeout(150);
};

// つまみがあり、自局速度とは別物であること
ok('相手局の速度のつまみがある', await page.locator('#contest-dx-wpm').count() === 1);
ok('ばらつきのつまみがある', await page.locator('#contest-dx-spread').count() === 1);
ok('自局速度とは別の設定', await page.evaluate(() =>
  window.__cw.settings.contestDxWpm !== undefined && window.__cw.settings.charWpm !== undefined));
await page.screenshot({ path: `${DIR}/d1-contest-setup.png` });

// ばらつき 0 で速度をそろえ、指定どおりの速度で呼んでくるか
await setRange('#contest-dx-wpm', 34);
await setRange('#contest-dx-spread', 0);
ok('表示が 34 WPM', (await page.textContent('#contest-dx-wpm-out')).includes('34'));
ok('ばらつき 0 は「そろえる」', (await page.textContent('#contest-dx-spread-out')).includes('そろえる'));
ok('説明が範囲を示す', (await page.textContent('#contest-dx-wpm-help')).includes('34'));

await page.selectOption('#contest-minutes', '3');
await page.click('#btn-contest-start');
await page.waitForTimeout(2500);
const even = await page.evaluate(() => window.__cw.contest.stations.map((s) => s.wpm));
console.log('ばらつき 0 の局:', JSON.stringify(even));
ok('局が湧いている', even.length > 0);
ok('全局が 34 WPM でそろう', even.every((w) => w === 34), even.join(','));
ok('自局速度は別のまま', await page.evaluate(() => window.__cw.contest.opts.myWpm) !== 34);
await page.evaluate(() => window.__cw.contest.stopSession());
await page.waitForTimeout(300);

// ばらつきを付けると散る
await setRange('#contest-dx-wpm', 30);
await setRange('#contest-dx-spread', 8);
await page.click('#btn-contest-start');
await page.waitForTimeout(3500);
const spread = await page.evaluate(() => window.__cw.contest.stations.map((s) => s.wpm));
console.log('ばらつき ±8 の局:', JSON.stringify(spread));
ok('範囲内に収まる', spread.every((w) => w >= 22 && w <= 38), spread.join(','));
ok('少なくとも 1 局は 30 以外', spread.length < 2 || new Set(spread).size > 1, spread.join(','));

// 運用中に変えると、そのあと現れる局に効く
const before = await page.evaluate(() => window.__cw.contest.stations.map((s) => s.wpm));
await setRange('#contest-dx-wpm', 14);
await setRange('#contest-dx-spread', 0);
ok('運用中の変更が engine に届く', await page.evaluate(() => window.__cw.contest.opts.dxWpm) === 14);
ok('呼んでいる最中の局は変わらない', await page.evaluate((b) =>
  window.__cw.contest.stations.slice(0, b.length).every((s, i) => s.wpm === b[i]), before));

// 次に CQ を出すと、そこから現れる局が新しい速度になる
await page.click('#contest-call');
await page.keyboard.press('F1');
let slow = [];
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(400);
  slow = await page.evaluate(() => window.__cw.contest.stations.map((s) => s.wpm));
  if (slow.length) break;
}
console.log('CQ を出し直したあとの局:', JSON.stringify(slow));
ok('あとから来る局は 14 WPM', slow.length > 0 && slow.every((w) => w === 14), slow.join(','));
await page.screenshot({ path: `${DIR}/d2-contest-running.png` });
await page.evaluate(() => window.__cw.contest.stopSession());
await page.waitForTimeout(300);

// HST 競技では規定でそろう
await page.selectOption('#contest-mode', 'hst');
await page.waitForTimeout(250);
ok('HST ではばらつきを触れない', await page.isDisabled('#contest-dx-spread'));
ok('HST の説明に切り替わる', (await page.textContent('#contest-dx-wpm-help')).includes('そろいます'));
await setRange('#contest-dx-wpm', 28);
await page.click('#btn-contest-start');
await page.waitForTimeout(2000);
const hst = await page.evaluate(() => window.__cw.contest.stations.map((s) => s.wpm));
console.log('HST の局:', JSON.stringify(hst));
ok('HST でも指定速度が効く', hst.length > 0 && hst.every((w) => w === 28), hst.join(','));
await page.evaluate(() => window.__cw.contest.stopSession());

// 設定が残る
await page.reload();
await page.waitForTimeout(600);
ok('相手局の速度が保存される', await page.evaluate(() => window.__cw.settings.contestDxWpm) === 28);

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
