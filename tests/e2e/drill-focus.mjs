// 聞き取りドリル: 再生を押したら書き取り欄でそのまま打てること
const { chromium, devices } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(300);

const focused = () => page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName);
const value = () => page.inputValue('#drill-answer');
const waitPlaying = () => page.waitForFunction(
  () => document.querySelector('#drill-countdown').hidden, null, { timeout: 15000 });

// ═══════════════ 出題するとそのまま打てる ═══════════════
await page.click('#btn-drill-new');
await page.waitForTimeout(250);
ok('出題した直後は書き取り欄', await focused() === 'drill-answer', await focused());

// 欄をクリックせずにキーボードから打てること（焦点があるだけでは足りない）
await page.keyboard.type('KM');
ok('そのまま打ち込める', await value() === 'KM', await value());

// 数え終わって鳴り始めても、焦点は書き取り欄のまま
await waitPlaying();
await page.waitForTimeout(250);
ok('鳴り始めても焦点は書き取り欄', await focused() === 'drill-answer', await focused());

// ═══════════════ 聞き直しても欄に戻る ═══════════════
// ボタンに焦点が残っていると、いちいち欄をクリックしないと続きを打てない
await page.click('#btn-drill-replay');
await page.waitForTimeout(250);
ok('「もう一度聞く」で書き取り欄に戻る', await focused() === 'drill-answer', await focused());
await page.keyboard.type('RS');
ok('聞き直しても書いたものが消えない', (await value()).startsWith('KM'), await value());
ok('続きから打てる', await value() === 'KMRS', await value());

await page.click('#btn-drill-slow');
await page.waitForTimeout(250);
ok('「ゆっくり再生」でも書き取り欄に戻る', await focused() === 'drill-answer', await focused());
await page.keyboard.type('U');
ok('ゆっくり再生でも続きから打てる', await value() === 'KMRSU', await value());

// カーソルは末尾（先頭に差し込まれたり、全選択で消えたりしない）
const caret = await page.evaluate(() => {
  const el = document.querySelector('#drill-answer');
  return { start: el.selectionStart, end: el.selectionEnd, len: el.value.length };
});
console.log('カーソル:', JSON.stringify(caret));
ok('カーソルは末尾にある', caret.start === caret.len && caret.end === caret.len,
  JSON.stringify(caret));

// そのまま Enter で採点まで進めること
await page.evaluate(() => window.__cw.player.stop());
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
ok('そのまま Enter で採点できる',
  (await page.textContent('#drill-result .big') || '').includes('%'),
  await page.textContent('#drill-result .big'));
await page.evaluate(() => window.__cw.player.stop());
await page.screenshot({ path: `${DIR}/f1-focus.png` });

// ═══════════════ 連続出題の次の問題でも同じ ═══════════════
await page.selectOption('#drill-count', '5');
await page.waitForTimeout(200);
await page.click('#btn-drill-new');
await waitPlaying();
await page.evaluate(() => window.__cw.player.stop());
const ans = await page.evaluate(() => window.__cw.drillProblem?.answer ?? '');
await page.fill('#drill-answer', ans);
await page.press('#drill-answer', 'Enter');      // 採点
// 採点の直後の Enter は取らない作りなので、人が読む分だけ間を置く
await page.waitForTimeout(900);
await page.press('#drill-answer', 'Enter');      // 次の問題
await page.waitForTimeout(300);
ok('次の問題でも書き取り欄に焦点', await focused() === 'drill-answer', await focused());
await page.keyboard.type('E');
ok('次の問題でもそのまま打てる', await value() === 'E', await value());
await page.click('#btn-stop-all');
await page.waitForTimeout(200);

// ═══════════════ スマホでも同じ ═══════════════
// 焦点が入らないと、画面のキーボードが出てこない
const phone = await browser.newPage({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
await phone.goto(`${BASE}/index.html`);
await phone.waitForTimeout(700);
await phone.click('.tab[data-panel="drill"]');
await phone.waitForTimeout(300);
await phone.click('#btn-drill-new');
await phone.waitForTimeout(250);
const mobFocus = await phone.evaluate(() => document.activeElement?.id);
ok('スマホでも出題で書き取り欄に焦点', mobFocus === 'drill-answer', mobFocus);

await phone.waitForFunction(() => document.querySelector('#drill-countdown').hidden,
  null, { timeout: 15000 });
await phone.click('#btn-drill-replay');
await phone.waitForTimeout(250);
const mobReplay = await phone.evaluate(() => document.activeElement?.id);
ok('スマホでも聞き直しで書き取り欄に焦点', mobReplay === 'drill-answer', mobReplay);
await phone.evaluate(() => window.__cw.player.stop());
await phone.close();

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
