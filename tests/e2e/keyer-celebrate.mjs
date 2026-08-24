// 100点＋ を出したときの祝い
//
// 間隔までそろうのは狙って出せるものではないので、出たときは別格だと
// 分かるようにしてある。音・跳ねる表示・紙吹雪・自己ベストの札。
// 動きを減らす設定の人には、紙吹雪と跳ねを出さずに色と音だけ残す。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

/** 課題を出したパドル送信タブを開く。祝いの音は数えるだけにして鳴らさない。 */
async function openKeyer(context) {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`${BASE}/index.html`);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    // 実際に鳴らすと待ち時間が要るので、呼ばれた回数だけ控える。
    // 元の関数が例外を投げないことは別に確かめる
    window.__fanfares = 0;
    const real = window.__cw.player.fanfare.bind(window.__cw.player);
    window.__realFanfare = real;
    window.__cw.player.fanfare = () => { window.__fanfares++; return Promise.resolve(); };
  });
  await page.click('.tab[data-panel="keyer"]');
  await page.waitForTimeout(300);
  return page;
}

/**
 * 解読結果を直接与えて採点する。
 * seconds を渡すと、その秒数かけて打てたことにして計測を細工する。
 */
async function gradeAs(page, text, seconds) {
  await page.evaluate(([t, s]) => {
    window.__cw.keyer.text = t;
    if (s != null) window.__cw.paddleState.startedAt = performance.now() - s * 1000;
  }, [text, seconds]);
  await page.click('#btn-keyer-grade');
  await page.waitForTimeout(200);
}

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
const page = await openKeyer(ctx);
const task = await page.evaluate(() => window.__cw.keyerTask);
console.log('課題:', task);

// ── 出したときに祝う ──────────────────────────────
await gradeAs(page, task, 2.0);
ok('採点欄が祝いの状態になる',
  await page.locator('#keyer-result.is-celebrating').count() === 1);
ok('祝いの音を鳴らす', await page.evaluate(() => window.__fanfares) === 1);

const bits = await page.locator('#keyer-result .score-line .confetti i').count();
ok('紙吹雪が出る', bits === 18, `${bits} 粒`);
// 粒ごとに違う向きへ飛ばないと、束になって見えて紙吹雪にならない
const dirs = await page.$$eval('#keyer-result .confetti i',
  (els) => new Set(els.map((e) => e.style.getPropertyValue('--dx'))).size);
ok('粒ごとに向きが違う', dirs > 10, `${dirs} 通り`);
// 無いときに getAttribute で待たせない。落ちるなら待たずに落ちてほしい
ok('紙吹雪は読み上げ対象にしない', await page.$eval('#keyer-result .confetti',
  (e) => e.getAttribute('aria-hidden') === 'true').catch(() => false));
await page.screenshot({ path: `${DIR}/kc1-celebrate.png`, fullPage: true });

// 1 回目は比べる相手がいないので自己ベストとは言わない
ok('1 回目に自己ベストの札は出ない',
  await page.locator('.score-line .plus-best').count() === 0);
ok('入ったばかりの行が分かる',
  await page.locator('#keyer-plus tr.just-in').count() === 1);

// 落ちきったら片付く。残すと次の採点でごみが積もる
await page.waitForTimeout(1800);
ok('紙吹雪は片付く', await page.locator('#keyer-result .confetti').count() === 0);

// ── 前より速ければ自己ベスト ──────────────────────
await page.click('#btn-keyer-clear');
await page.waitForTimeout(150);
ok('打ち直すと祝いの状態が解ける',
  await page.locator('#keyer-result.is-celebrating').count() === 0);

await gradeAs(page, task, 0.5);
ok('速くなれば自己ベストの札が出る',
  await page.locator('.score-line .plus-best').count() === 1);
ok('2 回目も祝う', await page.evaluate(() => window.__fanfares) === 2);
await page.screenshot({ path: `${DIR}/kc2-best.png`, fullPage: true });

// ── 遅ければ札は出ない ────────────────────────────
await page.click('#btn-keyer-clear');
await page.waitForTimeout(150);
await gradeAs(page, task, 3.0);
ok('遅ければ自己ベストの札は出ない',
  await page.locator('.score-line .plus-best').count() === 0);
ok('遅くても祝いはする',
  await page.locator('#keyer-result.is-celebrating').count() === 1);

// 続けて出したときにアニメーションがやり直されているか。
// クラスを外して付け直していないと 2 回目から効かなくなる
const started = await page.evaluate(() =>
  document.getAnimations()
    .filter((a) => a.animationName === 'plus-flash' || a.animationName === 'plus-pop').length);
ok('続けて出しても動きがやり直される', started >= 1, `${started} 個`);

// ── 100点＋ でなければ祝わない ────────────────────
await page.click('#btn-keyer-clear');
await page.waitForTimeout(150);
await gradeAs(page, task[0] + ' ' + task.slice(1), 1.0);   // 語間だけ違う = 100% どまり
ok('100点＋ でなければ祝わない',
  await page.locator('#keyer-result.is-celebrating').count() === 0);
ok('100点＋ でなければ音も鳴らさない', await page.evaluate(() => window.__fanfares) === 3);
ok('100点＋ でなければ紙吹雪も出ない',
  await page.locator('#keyer-result .confetti').count() === 0);

// ── 次の課題へ進むと祝いは消える ──────────────────
await gradeAs(page, task, 1.0);
await page.click('#btn-keyer-next');
await page.waitForTimeout(250);
ok('次の課題では祝いが残らない',
  await page.locator('#keyer-result.is-celebrating').count() === 0);

// ── 音そのものが例外を投げないこと ────────────────
// 上では数えるだけに差し替えていたので、本物を 1 度だけ動かして確かめる
const fanfareErr = await page.evaluate(async () => {
  try { await window.__realFanfare(); return ''; } catch (e) { return String(e.message || e); }
});
ok('祝いの音が例外を投げない', fanfareErr === '', fanfareErr);
await page.waitForTimeout(700);

// ── 動きを減らす設定 ──────────────────────────────
const calm = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
const page2 = await openKeyer(calm);
const task2 = await page2.evaluate(() => window.__cw.keyerTask);
await gradeAs(page2, task2, 1.2);
ok('動きを減らす設定でも祝いの状態にはする',
  await page2.locator('#keyer-result.is-celebrating').count() === 1);
ok('動きを減らす設定では紙吹雪を作らない',
  await page2.locator('#keyer-result .confetti').count() === 0);
ok('動きを減らす設定でも音は鳴らす', await page2.evaluate(() => window.__fanfares) === 1);
// 色（別格の緑）は残す。祝いが伝わらなくなっては意味がない
ok('動きを減らす設定でも別格の色は残る',
  await page2.locator('#keyer-result .big.is-plus').count() === 1);
const anims = await page2.evaluate(() =>
  document.getAnimations().filter((a) => String(a.animationName || '').startsWith('plus-')).length);
ok('動きを減らす設定では動かさない', anims === 0, `${anims} 個`);
await page2.screenshot({ path: `${DIR}/kc3-reduced.png`, fullPage: true });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
