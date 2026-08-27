// パドル送信の自動採点
//
// 手本どおりに打ち切った時点で、「採点する」を押さずに採点する。
// 時間は「打ち終わった瞬間」で止める。解読が確定するのは文字間の
// 待ち時間を過ぎてからなので、そこで計ると待ち時間まで入ってしまう。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(400);

/**
 * 実際にパドルを叩く。
 * マウスは押した要素ではなくボタンで側が決まる（右手用の既定で
 * 左ボタン = 短点、右ボタン = 長点）。
 */
const press = async (button = 'left', holdMs = 30) => {
  const box = await page.locator('#pw-pad').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button });
  await page.waitForTimeout(holdMs);
  await page.mouse.up({ button });
};

/** 計測の起点。採点すると 0 に戻るので、打つ前に控えておく。 */
const startedAt = () => page.evaluate(() => window.__cw.paddleState.startedAt);

/** 課題を置いて、打つ前の状態に戻す。E は短点ひとつなので狙って打てる。 */
const setTask = async (text) => {
  await page.evaluate((t) => {
    window.__cw.paddleState.task = t;
    document.querySelector('#keyer-task-text').textContent = t;
    window.__cw.keyer.reset();
    window.__cw.paddleState.autoGraded = false;
    window.__cw.paddleState.startedAt = performance.now();
    document.querySelector('#keyer-result').innerHTML = '';
  }, text);
  await page.waitForTimeout(120);
};

const state = () => page.evaluate(() => ({
  text: window.__cw.keyer.text,
  big: document.querySelector('#keyer-result .big')?.textContent?.trim() ?? '',
  plus: document.querySelectorAll('#keyer-result .big.is-plus').length,
  rows: document.querySelectorAll('#keyer-plus tbody tr').length,
  runs: window.__cw.paddleState.runs.map((r) => r.seconds),
  startedAt: window.__cw.paddleState.startedAt,
  lastMarkAt: window.__cw.keyer.lastMarkAt,
  now: performance.now(),
}));

// ── 既定で入っている ──────────────────────────────
ok('既定で自動採点が入っている',
  await page.evaluate(() => window.__cw.settings.keyerAutoGrade) === true);
ok('チェックも入っている', await page.isChecked('#keyer-autograde'));

// ── 押さずに採点される ────────────────────────────
await page.evaluate(() => { window.__cw.paddleState.runs = []; });
await setTask('E');
const began = await startedAt();
await press('left');
await page.waitForTimeout(1200);   // 「採点する」は押さない
const s1 = await state();
console.log('解読:', JSON.stringify(s1.text), '判定:', s1.big, '記録:', s1.runs);
ok('打ち切ったら押さずに採点される', s1.big === '100点＋', `${s1.big} / ${JSON.stringify(s1.text)}`);
ok('別格の色が付く', s1.plus === 1);
ok('記録が 1 行入る', s1.rows === 1, `${s1.rows} 行`);
await page.screenshot({ path: `${DIR}/ag1-auto.png`, fullPage: true });

// ── 時間は「打ち終わった瞬間」で止まる ────────────
// 文字間の待ち（2.4 短点）を過ぎないと解読は確定しない。そこで計ると
// 待ち時間まで打鍵時間に入ってしまう
const stopped = began + s1.runs[0] * 1000;
console.log('打鍵時間:', s1.runs[0].toFixed(3), '秒 / 観測までの余り:',
  Math.round(s1.now - stopped), 'ms');
ok('打鍵時間だけを計る', s1.runs[0] > 0 && s1.runs[0] < 0.6, `${s1.runs[0]} 秒`);
// 観測は採点の 1.2 秒あと。そこまで含めていたら 1 秒を超えるはず
ok('待ち時間・観測の遅れを含めない', s1.now - stopped > 500,
  `${Math.round(s1.now - stopped)} ms`);
ok('打ち終わりの時刻を控えている', s1.lastMarkAt > began,
  `${Math.round(s1.lastMarkAt)} vs ${Math.round(began)}`);
// 採点したら計測は止まる。打ち直すまで次は数えない
ok('採点したら計測が止まる', s1.startedAt === 0, String(s1.startedAt));

// ── 1 回の打鍵で 1 度だけ ─────────────────────────
// 語間の確定でも update が飛ぶので、二重に記録されないこと
await page.waitForTimeout(900);
ok('二重に記録しない', (await state()).rows === 1);

// ── 外したときは自動で採点しない ──────────────────
// 手本と符号が違えば一致しないので、途中で誤って走ることはない
await page.click('#btn-keyer-clear');
await setTask('E');
await press('right');              // 長点 = T。手本の E とは違う
await page.waitForTimeout(1200);
const s2 = await state();
console.log('外したとき:', JSON.stringify(s2.text), '判定:', s2.big || '(採点なし)');
ok('外したら自動で採点しない', s2.big === '', s2.big);
ok('外したら記録も増えない', s2.rows === 1, `${s2.rows} 行`);
// 押せばこれまでどおり採点される
await page.click('#btn-keyer-grade');
await page.waitForTimeout(300);
const s3 = await state();
ok('外しても押せば採点される', s3.big !== '' && s3.plus === 0, s3.big);

// ── 切れば自動では採点しない ──────────────────────
await page.uncheck('#keyer-autograde');
await page.waitForTimeout(150);
ok('切ると設定に残る',
  await page.evaluate(() => window.__cw.settings.keyerAutoGrade) === false);

await page.click('#btn-keyer-clear');
await setTask('E');
const began2 = await startedAt();
await press('left');
await page.waitForTimeout(1200);
const s4 = await state();
ok('切れば打ち切っても採点しない', s4.big === '', s4.big);
ok('切れば記録も増えない', s4.rows === 1, `${s4.rows} 行`);

// 押せば採点される。手押しでも時計は同じ（記録表で見比べられなくなるため）
await page.click('#btn-keyer-grade');
await page.waitForTimeout(300);
const s5 = await state();
ok('切っても押せば 100点＋', s5.big === '100点＋', s5.big);
ok('手押しでも記録が入る', s5.rows === 2, `${s5.rows} 行`);
const manual = s5.runs.at(-1);
console.log('手押しの打鍵時間:', manual.toFixed(3), '秒');
// 押したのは打ち終わりの 1.2 秒あと。押した時刻で止めていたら 1 秒を超える
ok('手押しでも打ち終わりで止める', manual < 0.6, `${manual} 秒`);
ok('手押しの起点も同じ', began2 > 0 && manual * 1000 < s5.now - began2,
  `${manual} 秒 / 観測まで ${Math.round(s5.now - began2)} ms`);

await page.check('#keyer-autograde');
await page.waitForTimeout(150);
ok('入れ直せば設定に戻る',
  await page.evaluate(() => window.__cw.settings.keyerAutoGrade) === true);

// ── 課題が無いときは走らせない ────────────────────
await page.evaluate(() => {
  window.__cw.paddleState.task = null;
  window.__cw.paddleState.autoGraded = false;
  document.querySelector('#keyer-result').innerHTML = '';
  window.__cw.maybeAutoGrade();
});
ok('自由練習では自動採点しない',
  (await page.textContent('#keyer-result')).trim() === '');

// ── 他のタブでは走らせない ────────────────────────
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(200);
const before = (await state()).rows;
await page.evaluate(() => {
  window.__cw.paddleState.task = 'E';
  window.__cw.paddleState.autoGraded = false;
  window.__cw.keyer.text = 'E';
  window.__cw.maybeAutoGrade();
});
await page.waitForTimeout(200);
ok('他のタブでは自動採点しない', (await state()).rows === before, `${before} → ${(await state()).rows}`);

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
