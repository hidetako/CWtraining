// Esc が焦点の置き場所で変わらないこと
//
// 報告: パドル入力時、Esc を押しても入力が消えるときと消えないときがある。
// 原因は「入力欄の上では効かせない」という除外で、tagName が INPUT かどうかで
// 見ていたこと。パドル欄の速度つまみ自体が <input type="range"> なので、
// 自分の速度を変えただけで Esc が死んでいた。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

const pad = await page.locator('#pw-pad').boundingBox();

/** 打面を叩いて符号を残す。 */
const keyOnce = async () => {
  await page.mouse.move(pad.x + pad.width * 0.25, pad.y + pad.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
  await page.waitForTimeout(200);
};

const keyed = () => page.evaluate(() => window.__cw.keyer.text + window.__cw.keyer.buffer);
const focusName = () => page.evaluate(() => {
  const el = document.activeElement;
  return el.tagName + (el.id ? `#${el.id}` : '');
});

/** どこに焦点があっても、打った符号が Esc で消えること。 */
const escClears = async (label, focusFn) => {
  await page.evaluate(() => window.__cw.keyer.reset());
  await page.waitForTimeout(120);
  await keyOnce();
  await keyOnce();
  await page.waitForTimeout(900);

  const before = await keyed();
  if (focusFn) await focusFn();
  const where = await focusName();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const after = await keyed();

  console.log(`  ${label}: 焦点=${where} "${before}" → "${after}"`);
  ok(`打った符号が残っている（${label}）`, before.length > 0, before);
  ok(`Esc で消える（${label}）`, after === '', `焦点=${where} 残り="${after}"`);
  return where;
};

await escClears('打面を触っただけ', null);
// 本題。速度つまみはパドル欄の中にある <input type="range">
const sliderFocus = await escClears('速度つまみを触った後', () => page.click('#pw-wpm'));
ok('速度つまみは input である', sliderFocus === 'INPUT#pw-wpm', sliderFocus);
await escClears('「打ち直す」を押した後', () => page.click('#pw-clear'));

// 文字を打ち込む欄に焦点があっても、打鍵は消せること
await page.click('.tab[data-panel="drill"]');
const fieldFocus = await escClears('書き取り欄に焦点', () => page.click('#drill-answer'));
ok('書き取り欄は文字入力である', fieldFocus === 'INPUT#drill-answer', fieldFocus);
await page.screenshot({ path: `${DIR}/ec1-esc.png`, fullPage: true });

// ── 文字を打ち込んでいる最中に練習を終わらせないこと ──
// 打った符号が無いときの Esc は「終了」。取り消せないので、
// 書き取りの途中で誤って終わらせては困る
await page.evaluate(() => window.__cw.keyer.reset());
await page.click('#btn-drill-new');
await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === true,
  null, { timeout: 15000 });
await page.click('#drill-answer');
await page.keyboard.type('ABC');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ok('書き取り中の Esc で練習が終わらない',
  await page.evaluate(() => !!window.__cw.drillProblem));
ok('書き取り中の Esc で書いた内容も消えない',
  await page.inputValue('#drill-answer') === 'ABC', await page.inputValue('#drill-answer'));

// 打ち込む場所でなければ、今までどおり Esc で終了できること
await page.evaluate(() => document.querySelector('#pw-clear').focus());
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ok('打鍵が無ければ Esc で練習を終われる',
  await page.evaluate(() => !window.__cw.drillProblem));

// ── つまみに焦点があってもキーボードで打てること ──
// 同じ取り違えで Z / X も死んでいた。
// キーボード（Z / X）はパドル送信タブにいるときだけ受け付ける作りなので、
// そのタブで確かめる
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
await page.evaluate(() => window.__cw.keyer.reset());
await page.click('#pw-wpm');
ok('つまみに焦点がある', await focusName() === 'INPUT#pw-wpm', await focusName());
await page.keyboard.down('KeyZ');
await page.waitForTimeout(80);
await page.keyboard.up('KeyZ');
await page.waitForTimeout(900);
ok('つまみに焦点があっても Z で打てる', (await keyed()).length > 0, await keyed());

// 打った符号は、つまみに焦点があっても Esc で消えること
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ok('つまみ焦点のまま Esc で消える', (await keyed()) === '', await keyed());

// 文字を打ち込む欄では、打鍵ではなく文字入力になること
await page.click('.tab[data-panel="drill"]');
await page.evaluate(() => window.__cw.keyer.reset());
await page.click('#btn-drill-new');
await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === true,
  null, { timeout: 15000 });
await page.click('#drill-answer');
await page.fill('#drill-answer', '');
await page.keyboard.press('KeyZ');
await page.waitForTimeout(600);
ok('書き取り欄では Z が文字として入る',
  await page.inputValue('#drill-answer') === 'z', await page.inputValue('#drill-answer'));
ok('書き取り欄では Z で打鍵しない', (await keyed()) === '', await keyed());

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
