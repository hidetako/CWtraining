// ガイド付き模擬交信の「パドルで打ってみる」欄
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

// ガイド付きで開始し、自分が送信するターンまで進める
await page.locator('.style-option[data-style="guided"]').click();
await page.waitForTimeout(150);
await page.click('#btn-qso-start');
await page.waitForTimeout(400);

// CQ を出す側なら最初のターンが自分。相手の CQ に応答する設定なら 1 つ聞いてから
for (let i = 0; i < 6 && !(await page.locator('.choice').count()); i++) {
  if (await page.locator('#btn-guide-reveal').count()) {
    await page.click('#btn-guide-reveal'); await page.waitForTimeout(200);
    await page.click('#btn-guide-next'); await page.waitForTimeout(300);
  } else break;
}
ok('選択肢が出ている', await page.locator('.choice').count() > 0);

// 正解の選択肢を選ぶ（どれでも欄は出るが、手本と一致させたいので正解を選ぶ）
const correctIndex = await page.evaluate(() => window.__cw.qsoOptions.findIndex((o) => o.correct));
await page.locator('.choice').nth(correctIndex).click();
await page.waitForTimeout(300);

const target = await page.evaluate(() => window.__cw.qsoOptions.find((o) => o.correct).text);
console.log('手本:', JSON.stringify(target));

ok('打鍵欄が出る', await page.locator('#qso-keyed').count() === 1);
ok('照合ボタンが出る', await page.locator('#btn-guide-check').count() === 1);
ok('送信ボタンは残っている', await page.locator('#btn-guide-send').count() === 1);
await page.screenshot({ path: `${DIR}/k1-try-keying.png`, fullPage: true });

// 空のうちは案内文
ok('最初は案内文', (await page.textContent('#qso-keyed')).includes('パドルで打ち始めて'));

// キーボード Z/X で打てるか（速く打てるよう WPM を上げる）
await page.evaluate(() => { window.__cw.keyer.setParams({ wpm: 30 }); });
const key = async (k, ms) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
};
// "A" = ・－
await key('z', 30); await page.waitForTimeout(60);
await key('x', 90);
await page.waitForTimeout(700);

const keyed = (await page.textContent('#qso-keyed')).trim();
console.log('Z/X で打った結果:', JSON.stringify(keyed));
ok('Z/X の打鍵が欄に出る', keyed.length > 0 && !keyed.includes('打ち始めて'), keyed);
ok('A と解読される', keyed.replace(/\s/g, '') === 'A', keyed);

// 照合すると差分が出る（わざと間違えているので 100% ではない）
await page.click('#btn-guide-check');
await page.waitForTimeout(200);
const pct = await page.textContent('#qso-guide-keyed-result .big');
console.log('照合結果:', pct);
ok('照合の一致率が出る', /%$/.test((pct || '').trim()));
ok('差分の色分けが出る', await page.locator('#qso-guide-keyed-result .diff span').count() > 0);
await page.screenshot({ path: `${DIR}/k2-checked.png`, fullPage: true });

// 打ち直すと消える
await page.click('#btn-guide-clear');
await page.waitForTimeout(200);
ok('打ち直しで欄が空に', (await page.textContent('#qso-keyed')).includes('パドルで打ち始めて'));
ok('打ち直しで結果も消える', (await page.textContent('#qso-guide-keyed-result')).trim() === '');

// 打たずに次へ進める（任意であること）
await page.click('#btn-guide-skip');
await page.waitForTimeout(500);
ok('打たずに次へ進める', await page.locator('#qso-keyed, .choice, #btn-guide-reveal, #btn-qso-again').count() > 0);

// 次の自局ターンでも、前のターンの符号が残っていないこと
for (let i = 0; i < 8; i++) {
  if (await page.locator('.choice').count()) break;
  if (await page.locator('#btn-guide-reveal').count()) {
    await page.click('#btn-guide-reveal'); await page.waitForTimeout(200);
    await page.click('#btn-guide-next'); await page.waitForTimeout(300);
  } else if (await page.locator('#btn-turn-next').count()) {
    await page.click('#btn-turn-next'); await page.waitForTimeout(300);
  } else break;
}
if (await page.locator('.choice').count()) {
  const ci = await page.evaluate(() => window.__cw.qsoOptions.findIndex((o) => o.correct));
  await page.locator('.choice').nth(ci).click();
  await page.waitForTimeout(300);
  ok('次のターンでは打鍵が持ち越されない',
    (await page.textContent('#qso-keyed')).includes('パドルで打ち始めて'));
}

// パドルウィジェットのクリックでも打てること
const left = page.locator('#pw-left');
if (await left.count()) {
  const b = await left.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(30); await page.mouse.up();
  await page.waitForTimeout(700);
  const w = (await page.textContent('#qso-keyed')).trim();
  console.log('ウィジェット左をクリック:', JSON.stringify(w));
  ok('ウィジェットからも打てる', w.length > 0 && !w.includes('打ち始めて'), w);
}
await page.screenshot({ path: `${DIR}/k3-widget.png`, fullPage: true });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
