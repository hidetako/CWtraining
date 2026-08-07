// 聞き取りドリルの見比べ欄
//
// 間違えたときは、自分の答えと正解を上下 2 段に並べて見比べられること。
// 桁がずれると比較にならないので、1 文字 = 1 列で上下が対応することを見る。
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

/** 出題の数え（3 秒）が終わるのを待つ。終わる前に答えても採点されない。 */
const waitDrillReady = async () => {
  await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === false,
    null, { timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === true,
    null, { timeout: 15000 });
};

// ── 列の組み立て ──────────────────────────────────
// 書き間違いは内部では「取り漏らし + 余分」の 2 件に分かれて出てくる。
// そのまま並べると同じ 1 文字が 2 列に散り、上下で見比べられない
const cols = (answer, typed) => page.evaluate(([a, t]) => {
  const r = window.__cw.gradeProblem({ answer: a }, t);
  return window.__cw.comparisonColumns(r.marks);
}, [answer, typed]);

// 報告された例: ZL2MR を ZL2TR と書いた
const sub = await cols('ZL2MR', 'ZL2TR');
console.log('ZL2MR / ZL2TR:', JSON.stringify(sub));
ok('列数が出題の文字数と同じ', sub.length === 5, `${sub.length} 列`);
ok('自分の答えが上の段にそろう', sub.map((c) => c.mine).join('') === 'ZL2TR',
  sub.map((c) => c.mine).join(''));
ok('正解が下の段にそろう', sub.map((c) => c.want).join('') === 'ZL2MR',
  sub.map((c) => c.want).join(''));
ok('書き間違いは 1 列にまとまる',
  sub.filter((c) => c.state === 'wrong').length === 1
  && sub[3].mine === 'T' && sub[3].want === 'M', JSON.stringify(sub[3]));

// 打ち漏らし: 正解だけがあって自分の側は空
const dropped = await cols('ABCDE', 'ABDE');
console.log('ABCDE / ABDE:', JSON.stringify(dropped));
ok('打ち漏らしでも列がそろう', dropped.length === 5, `${dropped.length} 列`);
ok('打ち漏らしの自分側は空', dropped[2].mine === '' && dropped[2].want === 'C',
  JSON.stringify(dropped[2]));
ok('打ち漏らし以降がずれない', dropped.slice(3).every((c) => c.state === 'ok'),
  JSON.stringify(dropped.slice(3)));

// 余分: 自分の側だけがあって正解は空
const padded = await cols('ABC', 'ABXC');
console.log('ABC / ABXC:', JSON.stringify(padded));
ok('余分の正解側は空', padded.some((c) => c.state === 'extra' && c.mine === 'X' && c.want === ''),
  JSON.stringify(padded));

// プロサインは 1 列。<SK> は幅が違うので、桁は文字送りでは揃えられない
const pro = await cols('TU <SK>', 'TU <AR>');
console.log('TU <SK> / TU <AR>:', JSON.stringify(pro));
ok('プロサインは 1 列', pro.length === 3, `${pro.length} 列`);
ok('プロサインの取り違えも 1 列', pro[2].mine === '<AR>' && pro[2].want === '<SK>',
  JSON.stringify(pro[2]));

// ── 画面で確かめる ────────────────────────────────
await page.click('.tab[data-panel="drill"]');
await page.click('#btn-drill-new');
await waitDrillReady();

// わざと 1 文字だけ書き間違える
const answer = (await page.evaluate(() => window.__cw.drillProblem.answer)).replace(/\s/g, '');
const wrongText = answer.slice(0, -1) + (answer.at(-1) === 'X' ? 'Y' : 'X');
await page.fill('#drill-answer', wrongText);
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(400);

ok('間違えたら見比べ欄が出る', await page.locator('#drill-result .compare').count() === 1);
// 凡例の色見本も span.marks なので、結果欄の直下だけを見る
ok('1 段だけの表示は出ない', await page.locator('#drill-result > div.marks').count() === 0);

const labels = await page.$$eval('#drill-result .compare .cmp-label', (els) => els.map((e) => e.textContent));
console.log('見出し:', JSON.stringify(labels));
ok('上が「あなた」、下が「正解」', labels[0] === 'あなた' && labels[1] === '正解', JSON.stringify(labels));

// 上下の桁が本当にそろっているか、画面上の位置で確かめる
const aligned = await page.evaluate(() => {
  const box = document.querySelector('#drill-result .compare');
  const mine = [...box.querySelectorAll('.mine')].map((e) => e.getBoundingClientRect());
  const want = [...box.querySelectorAll('.want')].map((e) => e.getBoundingClientRect());
  return {
    pairs: mine.length,
    same: mine.length === want.length,
    // 同じ列の上下は左端がそろい、上の段が上にあること
    offBy: mine.map((m, i) => Math.abs(m.left - want[i].left)),
    stacked: mine.every((m, i) => m.bottom <= want[i].top + 1),
  };
});
console.log('桁ぞろえ:', JSON.stringify(aligned));
ok('上下の段の数が同じ', aligned.same, `${aligned.pairs} 列`);
ok('同じ列の左端がそろう', aligned.offBy.every((d) => d < 1), aligned.offBy.join(','));
ok('自分の答えが上、正解が下', aligned.stacked);

await page.screenshot({ path: `${DIR}/dc1-compare.png`, fullPage: true });

// ── 全問正解なら 1 段のまま ────────────────────────
await page.click('#btn-drill-next');
await waitDrillReady();
const right = await page.evaluate(() => window.__cw.drillProblem.answer);
await page.fill('#drill-answer', right);
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(400);

const pct = await page.textContent('#drill-result .big');
ok('全問正解になっている', String(pct).trim() === '100%', String(pct));
ok('正解なら見比べ欄は出ない', await page.locator('#drill-result .compare').count() === 0);
ok('正解は 1 段で出る', await page.locator('#drill-result > div.marks').count() === 1);
await page.screenshot({ path: `${DIR}/dc2-perfect.png`, fullPage: true });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
