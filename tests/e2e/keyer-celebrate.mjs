// 100点＋ を出したときの祝い（10 種類）
//
// 間隔までそろうのは狙って出せるものではないので、出たときは別格だと
// 分かるようにしてある。祝い方は設定で 10 種類から選べる。
// 動きを減らす設定の人には、飾りを出さずに色と音だけで祝う。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

/** 祝いの音は数えるだけにして鳴らさない（実際に鳴らすと待ち時間が要る）。 */
async function open(context) {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`${BASE}/index.html`);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__fanfares = [];
    const real = window.__cw.player.fanfare.bind(window.__cw.player);
    window.__realFanfare = real;
    window.__cw.player.fanfare = (pattern) => {
      window.__fanfares.push(pattern === undefined ? '(既定)' : (pattern?.notes?.length ?? 0));
      return Promise.resolve();
    };
  });
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
const page = await open(ctx);

// ── 10 種類そろっているか ─────────────────────────
const styles = await page.evaluate(() => window.__cw.CELEBRATIONS.map((c) => ({
  id: c.id, name: c.name, note: c.note, ms: c.ms,
  notes: c.sound?.notes?.length ?? 0,
})));
console.log('祝い方:', styles.map((s) => s.name).join(' / '));
ok('10 種類ある', styles.length === 10, `${styles.length} 種類`);
ok('id が重複しない', new Set(styles.map((s) => s.id)).size === 10);
ok('名前が重複しない', new Set(styles.map((s) => s.name)).size === 10);
ok('すべてに説明が付く', styles.every((s) => s.note && s.note.length > 8));
ok('すべてに片付けの時間がある', styles.every((s) => s.ms >= 1000 && s.ms <= 5000));

// ── 種類ごとにファンファーレが違う ────────────────
// 同じ音では「10 種類」とは言えない。既定（1 つめ）以外は音符を持つ
ok('1 つめは既定のファンファーレ', styles[0].notes === 0, String(styles[0].notes));
ok('残りは種類ごとの音を持つ',
  styles.slice(1).every((s) => s.notes >= 2),
  styles.slice(1).map((s) => s.notes).join(','));
const shapes = await page.evaluate(() => window.__cw.CELEBRATIONS
  .map((c) => JSON.stringify(c.sound?.notes ?? 'default')));
ok('音の並びが種類ごとに違う', new Set(shapes).size === 10, `${new Set(shapes).size} 通り`);

// ── 設定で選べる ──────────────────────────────────
await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(300);
const opts = await page.$$eval('#set-plus-style option', (els) => els.map((e) => e.value));
ok('設定に 10 種類が並ぶ', opts.length === 10, `${opts.length} 個`);
ok('並びは定義と同じ', opts.join() === styles.map((s) => s.id).join());

// 選ぶと保存され、次に開いたときもその祝い方になる
await page.selectOption('#set-plus-style', 'medal');
await page.waitForTimeout(300);
ok('選ぶと保存される', await page.evaluate(() => window.__cw.settings.plusStyle) === 'medal');
ok('選ぶと説明が変わる',
  (await page.textContent('#plus-style-note')).includes('メダル'),
  await page.textContent('#plus-style-note'));

// ── 見本がその場で動く ────────────────────────────
// 見本が無いと、選ぶために毎回 100点＋ を出さねばならない
ok('選ぶとすぐ見本が動く',
  await page.locator('#plus-preview .celebrate-stage .medal').count() === 1);
await page.waitForTimeout(2600);
ok('見本も片付く', await page.locator('#plus-preview .celebrate-stage').count() === 0);
ok('見本の札は残る', await page.locator('#plus-preview .big.is-plus').count() === 1);

const before = await page.evaluate(() => window.__fanfares.length);
await page.click('#btn-plus-preview');
await page.waitForTimeout(300);
ok('「見本を見る」で出し直せる',
  await page.locator('#plus-preview .celebrate-stage').count() === 1);
ok('「見本を見る」で音も鳴る',
  await page.evaluate(() => window.__fanfares.length) === before + 1);

// ── 10 種類それぞれが、実際に違うものを出す ────────
await page.waitForTimeout(2600);
// 種類ごとに、その祝い方でしか出ない目印
const marks = {
  confetti: '.celebrate-stage i',
  fireworks: '.celebrate-stage .shell',
  stamp: '.celebrate-stage .stamp',
  medal: '.celebrate-stage .medal',
  marquee: '.big.is-plus .lit',
  morse: '.celebrate-stage .morse-strip .dah',
  smeter: '.celebrate-stage .smeter .needle',
  sakura: '.celebrate-stage .seal',
  arcade: '.celebrate-stage .arcade-word',
  quiet: '.celebrate-stage .ripple',
};
for (const s of styles) {
  await page.selectOption('#set-plus-style', s.id);
  await page.waitForTimeout(260);
  const marked = await page.locator(`#plus-preview ${marks[s.id]}`).count();
  const tagged = await page.getAttribute('#plus-preview', 'data-celebrate');
  const moving = await page.evaluate(() => document.getAnimations()
    .filter((a) => document.querySelector('#plus-preview')?.contains(a.effect?.target)).length);
  ok(`${s.name}: 目印が出る`, marked >= 1, `${marked} 個`);
  ok(`${s.name}: 印が付く`, tagged === s.id, String(tagged));
  ok(`${s.name}: 実際に動く`, moving >= 1, `${moving} 本`);
  await page.screenshot({
    path: `${DIR}/kc-${s.id}.png`,
    clip: await page.evaluate(() => {
      const r = document.querySelector('#plus-preview').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  });
  await page.waitForTimeout(Math.max(0, s.ms - 200));
}

// ── 採点欄でも選んだ祝い方で祝う ──────────────────
await page.selectOption('#set-plus-style', 'arcade');
await page.waitForTimeout(2200);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
const task = await page.evaluate(() => window.__cw.keyerTask);
console.log('課題:', task);

const fanCount = await page.evaluate(() => window.__fanfares.length);
await gradeAs(page, task, 2.0);
ok('採点欄が祝いの状態になる',
  await page.locator('#keyer-result.is-celebrating').count() === 1);
ok('選んだ祝い方で祝う',
  await page.getAttribute('#keyer-result', 'data-celebrate') === 'arcade');
ok('採点でも音が鳴る',
  await page.evaluate(() => window.__fanfares.length) === fanCount + 1);
ok('1 回目に自己ベストの札は出ない',
  await page.locator('#keyer-result .plus-best').count() === 0);
ok('入ったばかりの行が分かる',
  await page.locator('#keyer-plus tr.just-in').count() === 1);
await page.screenshot({ path: `${DIR}/kc-result.png`, fullPage: true });

await page.waitForTimeout(2000);
ok('飾りは片付く', await page.locator('#keyer-result .celebrate-stage').count() === 0);

// ── 前より速ければ自己ベスト ──────────────────────
await page.click('#btn-keyer-clear');
await page.waitForTimeout(150);
ok('打ち直すと祝いの状態が解ける',
  await page.locator('#keyer-result.is-celebrating').count() === 0);
ok('打ち直すと印も消える',
  await page.getAttribute('#keyer-result', 'data-celebrate') === null);

await gradeAs(page, task, 0.5);
ok('速くなれば自己ベストの札が出る',
  await page.locator('#keyer-result .plus-best').count() === 1);

await page.click('#btn-keyer-clear');
await page.waitForTimeout(150);
await gradeAs(page, task, 3.0);
ok('遅ければ自己ベストの札は出ない',
  await page.locator('#keyer-result .plus-best').count() === 0);
ok('遅くても祝いはする',
  await page.locator('#keyer-result.is-celebrating').count() === 1);

// 続けて出したときにアニメーションがやり直されているか。
// クラスを外して付け直していないと 2 回目から効かなくなる
const restarted = await page.evaluate(() => document.getAnimations()
  .filter((a) => document.querySelector('#keyer-result')?.contains(a.effect?.target)).length);
ok('続けて出しても動きがやり直される', restarted >= 1, `${restarted} 本`);

// ── 100点＋ でなければ祝わない ────────────────────
await page.click('#btn-keyer-clear');
await page.waitForTimeout(150);
const quiet = await page.evaluate(() => window.__fanfares.length);
await gradeAs(page, task[0] + ' ' + task.slice(1), 1.0);   // 語間だけ違う = 100% どまり
ok('100点＋ でなければ祝わない',
  await page.locator('#keyer-result.is-celebrating').count() === 0);
ok('100点＋ でなければ音も鳴らさない',
  await page.evaluate(() => window.__fanfares.length) === quiet);
ok('100点＋ でなければ飾りも出ない',
  await page.locator('#keyer-result .celebrate-stage').count() === 0);

// ── 次の課題へ進むと祝いは消える ──────────────────
await gradeAs(page, task, 1.0);
await page.click('#btn-keyer-next');
await page.waitForTimeout(250);
ok('次の課題では祝いが残らない',
  await page.locator('#keyer-result.is-celebrating').count() === 0);

// ── 音そのものが例外を投げないこと ────────────────
// 上では数えるだけに差し替えていたので、本物を全種類 1 度ずつ動かす
const soundErr = await page.evaluate(async () => {
  for (const c of window.__cw.CELEBRATIONS) {
    try { await window.__realFanfare(c.sound); } catch (e) { return `${c.id}: ${e.message || e}`; }
  }
  return '';
});
ok('どの祝い方の音も例外を投げない', soundErr === '', soundErr);
await page.waitForTimeout(600);

// ── 動きを減らす設定 ──────────────────────────────
const calm = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
const page2 = await open(calm);
await page2.click('.tab[data-panel="keyer"]');
await page2.waitForTimeout(300);
const task2 = await page2.evaluate(() => window.__cw.keyerTask);
await gradeAs(page2, task2, 1.2);
ok('動きを減らす設定でも祝いの状態にはする',
  await page2.locator('#keyer-result.is-celebrating').count() === 1);
ok('動きを減らす設定では飾りを作らない',
  await page2.locator('#keyer-result .celebrate-stage').count() === 0);
ok('動きを減らす設定でも音は鳴らす',
  await page2.evaluate(() => window.__fanfares.length) === 1);
// 色（別格の緑）は残す。祝いが伝わらなくなっては意味がない
ok('動きを減らす設定でも別格の色は残る',
  await page2.locator('#keyer-result .big.is-plus').count() === 1);
const anims = await page2.evaluate(() => document.getAnimations()
  .filter((a) => document.querySelector('#keyer-result')?.contains(a.effect?.target)).length);
ok('動きを減らす設定では動かさない', anims === 0, `${anims} 本`);
await page2.screenshot({ path: `${DIR}/kc-reduced.png`, fullPage: true });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
