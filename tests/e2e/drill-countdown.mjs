// 聞き取りドリルの出題までの数え（3 秒）
const { chromium } = await import(process.env.PW ?? 'playwright');

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

const state = () => page.evaluate(() => {
  const el = document.querySelector('#drill-countdown');
  return { hidden: el.hidden, text: el.textContent.trim(), playing: window.__cw.player.isPlaying };
});

/** 押してから鳴り始めるまでを追う。数字の移り変わりと所要時間を返す。 */
const watch = async (act, limitMs = 8000) => {
  const t0 = Date.now();
  await act();
  const seen = [];
  let startedAt = null;
  while (Date.now() - t0 < limitMs) {
    const s = await state();
    if (!s.hidden && s.text && seen.at(-1) !== s.text) seen.push(s.text);
    if (s.playing) { startedAt = Date.now() - t0; break; }
    await page.waitForTimeout(80);
  }
  return { seen, startedAt };
};

// ═══════════════ 押してから 3 秒数える ═══════════════
const before = await state();
ok('押す前は出ていない', before.hidden === true, JSON.stringify(before));

const first = await watch(() => page.click('#btn-drill-new'));
console.log('数え:', JSON.stringify(first.seen), '/ 鳴り始め:', first.startedAt, 'ms');
ok('3・2・1 と数える', JSON.stringify(first.seen) === JSON.stringify(['3', '2', '1']),
  JSON.stringify(first.seen));
ok('数え終わってから鳴る', first.startedAt >= 2800, `${first.startedAt}ms`);
ok('待たせすぎない', first.startedAt <= 4500, `${first.startedAt}ms`);

const after = await state();
ok('鳴り始めたら数えは消える', after.hidden === true, JSON.stringify(after));
ok('実際に音が出せている',
  await page.evaluate(() => window.__cw.player.ctx?.state) === 'running',
  await page.evaluate(() => window.__cw.player.ctx?.state ?? '(なし)'));
await page.evaluate(() => window.__cw.player.stop());

// 数えているあいだは鳴っていないこと
await page.click('#btn-drill-new');
await page.waitForTimeout(1200);
const mid = await state();
console.log('数えの途中:', JSON.stringify(mid));
ok('数えている間は鳴らない', mid.playing === false && mid.hidden === false, JSON.stringify(mid));
ok('残りの数が出ている', ['3', '2', '1'].includes(mid.text), mid.text);
await page.screenshot({ path: `${DIR}/c1-countdown.png` });
await page.waitForTimeout(2500);
await page.evaluate(() => window.__cw.player.stop());

// ═══════════════ 聞き直しは待たせない ═══════════════
// もう一度聞く・ゆっくり再生は、すでに構えているので即座に鳴らす
const replay = await watch(() => page.click('#btn-drill-replay'), 3000);
console.log('もう一度聞く:', replay.startedAt, 'ms /', JSON.stringify(replay.seen));
ok('「もう一度聞く」は数えない', replay.seen.length === 0, JSON.stringify(replay.seen));
ok('「もう一度聞く」はすぐ鳴る', replay.startedAt !== null && replay.startedAt < 1500,
  `${replay.startedAt}ms`);
await page.evaluate(() => window.__cw.player.stop());

const slow = await watch(() => page.click('#btn-drill-slow'), 3000);
ok('「ゆっくり再生」も数えない', slow.seen.length === 0 && slow.startedAt < 1500,
  `${slow.startedAt}ms / ${JSON.stringify(slow.seen)}`);
await page.evaluate(() => window.__cw.player.stop());

// ═══════════════ 途中で押し直しても二重にならない ═══════════════
await page.click('#btn-drill-new');
await page.waitForTimeout(900);
const restart = await watch(() => page.click('#btn-drill-new'));
console.log('押し直し:', JSON.stringify(restart.seen), '/', restart.startedAt, 'ms');
ok('押し直すと数え直す', restart.seen[0] === '3', JSON.stringify(restart.seen));
ok('押し直しても 3 秒待つ', restart.startedAt >= 2800, `${restart.startedAt}ms`);

// 前の数えが生き残っていれば、ここで二重に鳴り始める
await page.evaluate(() => window.__cw.player.stop());
await page.waitForTimeout(1500);
ok('前の数えは残らない', (await state()).playing === false, JSON.stringify(await state()));

// ═══════════════ 終了すれば数えも止まる ═══════════════
await page.click('#btn-drill-new');
await page.waitForTimeout(800);
ok('数えが始まっている', (await state()).hidden === false, JSON.stringify(await state()));
await page.click('#btn-stop-all');
await page.waitForTimeout(300);
const stopped = await state();
ok('終了で数えが消える', stopped.hidden === true, JSON.stringify(stopped));
ok('終了で出題も取り消される', await page.evaluate(() => window.__cw.drillProblem) === null);

await page.waitForTimeout(3200);
const afterStop = await state();
console.log('終了して 3 秒後:', JSON.stringify(afterStop));
ok('終了後に鳴り出さない', afterStop.playing === false && afterStop.hidden === true,
  JSON.stringify(afterStop));

// ═══════════════ 数えている途中に離れる・答える ═══════════════
// 数えは 3 秒あとに鳴らす予約なので、その間に何をされても
// 「あとから勝手に鳴る」「聞く前に採点される」が起きてはいけない

// 別のタブへ移ったら、その画面で鳴り出さないこと
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(300);
await page.click('#btn-drill-new');
await page.waitForTimeout(900);
await page.click('.tab[data-panel="glossary"]');
await page.waitForTimeout(3200);
const strayed = await page.evaluate(() => ({
  playing: window.__cw.player.isPlaying,
  panel: document.querySelector('.panel.is-active').id,
}));
console.log('別タブへ移ったあと:', JSON.stringify(strayed));
ok('タブを移ったら鳴り出さない', strayed.playing === false, JSON.stringify(strayed));
await page.evaluate(() => window.__cw.player.stop());

// 聞く前に Enter を押しても、採点も記録もしないこと
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(300);
const attemptsBefore = await page.evaluate(() => window.__cw.stats.drills.attempts);
await page.click('#btn-drill-new');
await page.waitForTimeout(900);
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(400);
const early = await page.evaluate((b) => ({
  shown: !document.querySelector('#drill-result').hidden,
  added: window.__cw.stats.drills.attempts - b,
  revealed: (document.querySelector('#drill-result').textContent || '').includes('正解'),
}), attemptsBefore);
console.log('聞く前の Enter:', JSON.stringify(early));
ok('聞く前は採点しない', early.shown === false, JSON.stringify(early));
ok('聞く前の記録を残さない', early.added === 0, String(early.added));
ok('聞く前に答えを見せない', early.revealed === false);

// そのあと普通に鳴ること（採点を止めたせいで出題が消えては困る）
const stillPlays = await watch(async () => {}, 6000);
ok('そのあと普通に鳴る', stillPlays.startedAt !== null, `${stillPlays.startedAt}ms`);
await page.evaluate(() => window.__cw.player.stop());

// 「もう一度聞く」を押したら、残りを待たずに鳴ること
await page.click('#btn-drill-new');
await page.waitForTimeout(700);
const skipped = await watch(() => page.click('#btn-drill-replay'), 2500);
console.log('数えている途中の「もう一度聞く」:', skipped.startedAt, 'ms');
ok('聞き直しで待ちを飛ばせる', skipped.startedAt !== null && skipped.startedAt < 1200,
  `${skipped.startedAt}ms`);
ok('飛ばしたら数えも消える', (await state()).hidden === true, JSON.stringify(await state()));

// 飛ばしたあとに、もう一度勝手に鳴り出さないこと
await page.waitForTimeout(2600);
await page.evaluate(() => window.__cw.player.stop());
await page.waitForTimeout(900);
ok('飛ばしたあと二重に鳴らない', (await state()).playing === false, JSON.stringify(await state()));

// ═══════════════ 連続出題でも毎回数える ═══════════════
await page.selectOption('#drill-count', '5');
await page.waitForTimeout(200);
const session = await watch(() => page.click('#btn-drill-new'));
ok('連続出題の 1 問目も数える', session.seen[0] === '3', JSON.stringify(session.seen));
await page.evaluate(() => window.__cw.player.stop());

const answer = await page.evaluate(() => window.__cw.drillProblem?.answer ?? '');
await page.fill('#drill-answer', answer);
await page.press('#drill-answer', 'Enter');          // 採点
// 採点の直後の Enter は取らない作りなので、人が読む分だけ間を置く
await page.waitForTimeout(900);
const next = await watch(() => page.press('#drill-answer', 'Enter'));  // 次の問題
console.log('次の問題:', JSON.stringify(next.seen), '/', next.startedAt, 'ms');
ok('次の問題でも数える', next.seen[0] === '3', JSON.stringify(next.seen));
ok('次の問題でも 3 秒待つ', next.startedAt >= 2800, `${next.startedAt}ms`);
await page.evaluate(() => window.__cw.player.stop());
await page.click('#btn-stop-all');

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
