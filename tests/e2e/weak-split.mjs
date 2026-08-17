// 苦手な文字を「聞き取り」と「パドル入力」に分けて記録・表示すること
//
// 耳で取れない文字と手で打てない文字は別物。混ぜると
// 「聞き取れるのに苦手扱い」（その逆も）になってしまう。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.evaluate(() => localStorage.removeItem('cwtraining.stats.v1'));
await page.reload();
await page.waitForTimeout(600);

// ── 数え方そのもの ────────────────────────────────
const counting = await page.evaluate(() => {
  const stats = { perChar: {} };
  window.__cw.recordKeyPerChar(stats, [
    { type: 'ok', char: 'A' },
    { type: 'missing', char: 'B' },
    { type: 'ok', char: 'B' },
    { type: 'extra', char: 'X' },     // 余分は手本の文字ではないので数えない
    { type: 'space', char: ' ' },     // 語間も数えない
  ]);
  return stats.keyPerChar;
});
console.log('数え方:', JSON.stringify(counting));
ok('手本側の文字だけ数える', counting.A?.sent === 1 && counting.B?.sent === 2 && !counting.X,
  JSON.stringify(counting));
ok('取れた文字は correct に入る', counting.A?.correct === 1 && counting.B?.correct === 1,
  JSON.stringify(counting));

// ── 聞き取り側: ドリルを 1 回解くと聞き取り欄に載る ──
await page.click('.tab[data-panel="drill"]');
await page.selectOption('#drill-type', 'koch');
await page.evaluate(() => { window.__cw.settings.kochLevel = 2; });   // K と M だけ
await page.click('#btn-drill-new');
await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === true,
  null, { timeout: 15000 });
await page.waitForTimeout(200);
const answer = await page.evaluate(() => window.__cw.drillProblem.answer);
await page.fill('#drill-answer', answer);
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(400);
await page.evaluate(() => window.__cw.player.stop());

// ── 打鍵側: 同じ課題を 5 回採点して打鍵欄に載せる ──
// （苦手一覧は 5 回以上打った文字だけを出すため）
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
const task = await page.evaluate(() => window.__cw.keyerTask);
console.log('課題:', task);
ok('課題が出ている', !!task, String(task));

for (let i = 0; i < 5; i++) {
  await page.evaluate((t) => { window.__cw.keyer.text = t; }, task);
  await page.click('#btn-keyer-grade');
  await page.waitForTimeout(150);
  await page.click('#btn-keyer-clear');
  await page.waitForTimeout(150);
}

// ── 表示: 2 つの欄に分かれていること ──────────────
await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(300);

const heads = await page.$$eval('#panel-settings h4', (els) => els.map((e) => e.textContent));
ok('聞き取りの欄がある', heads.some((h) => h.includes('苦手な文字（聞き取り）')), JSON.stringify(heads));
ok('パドル入力の欄がある', heads.some((h) => h.includes('苦手な文字（パドル入力）')), JSON.stringify(heads));

const drillChars = await page.$$eval('#weak-chars .weak-char .ch', (els) => els.map((e) => e.textContent));
const keyChars = await page.$$eval('#weak-chars-keying .weak-char .ch', (els) => els.map((e) => e.textContent));
console.log('聞き取り:', JSON.stringify(drillChars), '/ 打鍵:', JSON.stringify(keyChars));

ok('聞き取り欄にドリルの文字が載る', drillChars.includes('K') || drillChars.includes('M'),
  JSON.stringify(drillChars));
ok('打鍵欄に課題の文字が載る', keyChars.length > 0, JSON.stringify(keyChars));

// 打鍵欄の文字はすべて課題に含まれる文字であること（聞き取りが混ざらない）
const taskChars = new Set(task.replace(/\s/g, '').split(''));
ok('打鍵欄は課題の文字だけ', keyChars.every((c) => taskChars.has(c) || c.startsWith('<')),
  `${JSON.stringify(keyChars)} ⊆ ${JSON.stringify([...taskChars])}`);

// 聞き取り欄は K / M だけ（打鍵の課題文字が混ざらない）
ok('聞き取り欄はドリルの文字だけ', drillChars.every((c) => c === 'K' || c === 'M'),
  JSON.stringify(drillChars));
await page.screenshot({ path: `${DIR}/ws1-split.png`, fullPage: true });

// ── 保存されること ────────────────────────────────
await page.reload();
await page.waitForTimeout(600);
await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(300);
const persisted = await page.$$eval('#weak-chars-keying .weak-char .ch', (els) => els.map((e) => e.textContent));
ok('打鍵側も再読み込み後に残る', persisted.length > 0, JSON.stringify(persisted));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
