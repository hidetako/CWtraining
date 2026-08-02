// 採点の妥当性（打ち漏らしで以降がずれないこと、余分を見逃さないこと）
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
/** 出題の数え（3 秒）が終わるのを待つ。終わる前に答えても採点されない。 */
const waitDrillReady = async () => {
  const cd = () => page.waitForFunction(
    (want) => document.querySelector('#drill-countdown').hidden === want,
    null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === false,
    null, { timeout: 4000 }).catch(() => {});   // 数えが出る前に終わっていることもある
  await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === true,
    null, { timeout: 15000 });
};

await page.waitForTimeout(600);

// ── 採点ロジックを直接確かめる ────────────────────
const grade = (answer, input) => page.evaluate(
  ([a, i]) => {
    const r = window.__cw.gradeProblem({ answer: a }, i);
    return { pct: Math.round(r.accuracy * 100), correct: r.correct, total: r.total, extra: r.extra };
  }, [answer, input]);

const perfect = await grade('ABCDE', 'ABCDE');
ok('完全一致は 100%', perfect.pct === 100, JSON.stringify(perfect));

// 本題: 1 文字落としても、以降がずれて全滅しないこと
const dropped = await grade('ABCDEFGHIJ', 'BCDEFGHIJ');
console.log('先頭を 1 文字落とした:', JSON.stringify(dropped));
ok('1 文字落としで 9/10 になる', dropped.correct === 9 && dropped.total === 10, JSON.stringify(dropped));
ok('90% 前後になる（0% 近くにならない）', dropped.pct >= 85, `${dropped.pct}%`);

// 画面から報告された実際の例
const real = await grade('LLRLA KTRAU LUAKR RAKSM URLMK', 'lrlaktuluakrraksnurlmm');
console.log('報告された例:', JSON.stringify(real));
ok('報告例が 20/25 と数えられる', real.correct === 20 && real.total === 25, JSON.stringify(real));
ok('報告例が 4% ではなくなった', real.pct > 60, `${real.pct}%`);

// 途中で 1 文字落としても、そこから先は一致として数える
const mid = await grade('ABCDEFGHIJ', 'ABCDEGHIJ');
ok('途中の脱落でも 9/10', mid.correct === 9, JSON.stringify(mid));

// 取り違えは 1 文字ぶんの誤り（打ち漏らし + 余分）
const sub = await grade('ABCDE', 'ABXDE');
console.log('1 文字取り違え:', JSON.stringify(sub));
ok('取り違えは 4 文字一致', sub.correct === 4, JSON.stringify(sub));
ok('取り違えで余分 1', sub.extra === 1, JSON.stringify(sub));

// 余分に打っても得をしないこと（当てずっぽう対策）
const padded = await grade('ABCDE', 'AXBXCXDXE');
console.log('余分だらけ:', JSON.stringify(padded));
ok('余分だらけは 100% にならない', padded.pct < 70, `${padded.pct}%`);
ok('余分が数えられている', padded.extra === 4, JSON.stringify(padded));

const junk = await grade('ABCDE', 'ZZZZZ');
ok('全部違えば 0%', junk.pct === 0, JSON.stringify(junk));
const blank = await grade('ABCDE', '');
ok('無回答は 0%', blank.pct === 0, JSON.stringify(blank));

// 空白の入れ方は問わない
const spaced = await grade('ABC DE', 'AB CDE');
ok('空白の位置は問わない', spaced.pct === 100, JSON.stringify(spaced));

// ── 画面でも確かめる ──────────────────────────────
await page.click('.tab[data-panel="drill"]');
await page.click('#btn-drill-new');
await waitDrillReady();

// 出題の先頭 1 文字を落として答える
const answer = await page.evaluate(() => window.__cw.drillProblem.answer);
const dropFirst = answer.replace(/\s/g, '').slice(1);
await page.fill('#drill-answer', dropFirst);
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(400);

const shown = await page.textContent('#drill-result .big');
const detail = (await page.textContent('#drill-result .score-line')).replace(/\s+/g, ' ').trim();
console.log('画面の採点:', shown, '|', detail);
ok('画面でも高い正答率が出る', Number(String(shown).replace('%', '')) >= 85, String(shown));
ok('取り漏らしが色分けされる', await page.locator('#drill-result .marks .missing').count() >= 1);
ok('凡例が出る', (await page.textContent('#drill-result .diff-legend')).includes('取り漏らし'));
await page.screenshot({ path: `${DIR}/g1-drill-graded.png`, fullPage: true });

// ── 余分の減点が「記録」にも届くこと ──────────────
// 画面だけ減点して通算集計が満点のままだと、余分を打つ癖が記録に残らない
await page.evaluate(() => {
  localStorage.removeItem('cwtraining.stats.v1');
});
await page.reload();
await page.waitForTimeout(600);
await page.click('.tab[data-panel="drill"]');
await page.click('#btn-drill-new');
await waitDrillReady();

// 出題の全文字を含みつつ、間に余分を挟んで答える
const ans = (await page.evaluate(() => window.__cw.drillProblem.answer)).replace(/\s/g, '');
await page.fill('#drill-answer', ans.split('').join('X'));
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(500);

const shownPct = Number(String(await page.textContent('#drill-result .big')).replace('%', ''));
const saved = await page.evaluate(() => {
  const d = window.__cw.stats.drills;
  const h = window.__cw.stats.history.find((e) => e.kind === 'drill');
  return { chars: d.chars, correct: d.correct, pct: Math.round((d.correct / d.chars) * 100), hist: Math.round((h?.accuracy ?? 0) * 100) };
});
console.log('画面:', shownPct + '%', '| 記録:', JSON.stringify(saved));
ok('画面が減点されている', shownPct < 70, `${shownPct}%`);
ok('通算集計にも減点が届く', saved.pct === shownPct, `画面 ${shownPct}% / 通算 ${saved.pct}%`);
ok('履歴にも減点が届く', saved.hist === shownPct, `画面 ${shownPct}% / 履歴 ${saved.hist}%`);

// ── 打鍵の照合は空白に引きずられないこと ──────────
// 打鍵の解読では手が止まっただけで語間が入る。空白まで照合すると、
// 同じ語が繰り返される手本で、打った 1 文字が離れた繰り返しに
// 対応づけられて読めない差分になっていた
const sp = (target, sent) => page.evaluate(([t, s]) => {
  const r = window.__cw.compareSending(t, s);
  return {
    pct: Math.round(r.accuracy * 100), correct: r.correct, total: r.total, extra: r.extra,
    diff: r.marks.map((m) => (m.type === 'space' ? ' '
      : (m.type === 'ok' ? '' : m.type === 'missing' ? '-' : '+') + m.char)).join(''),
  };
}, [target, sent]);

const CQ = 'CQ CQ CQ DE JA1ABC JA1ABC JA1ABC PSE K';

// 報告された例: JA1ABC を JABC と打ち、途中で手が止まって語間が入った
const reported = await sp(CQ, 'C Q CQ CQ D E J A B C');
console.log('報告例:', JSON.stringify(reported));
ok('空白は分母に数えない', reported.total === 30, `total=${reported.total}`);
ok('前半はすべて一致する', reported.diff.startsWith('CQ CQ CQ DE JA'), reported.diff.slice(0, 20));
ok('打っていない文字が余分にならない', reported.extra === 0, `余分 ${reported.extra}`);
ok('離れた繰り返しに飛ばない', !/\+/.test(reported.diff), reported.diff);

// 空白の入れ方だけが違っても満点
const spacing = await sp('CQ DE JA1ABC', 'CQDE JA1 ABC');
console.log('空白の位置違い:', JSON.stringify(spacing));
ok('空白の位置は問わない（打鍵）', spacing.pct === 100, JSON.stringify(spacing));

// 語の中の脱落は、その文字だけの減点
const inner = await sp('JA1ABC', 'JABC');
console.log('JA1ABC を JABC:', JSON.stringify(inner));
ok('JABC は 4/6', inner.correct === 4 && inner.total === 6, JSON.stringify(inner));
ok('脱落は 1A の 2 文字だけ', inner.diff === 'JA-1-ABC', inner.diff);

// 表示には語の切れ目が残る
ok('差分に語の切れ目が出る', reported.diff.includes(' '), reported.diff.slice(0, 20));

// 打鍵側も同じこと（採点関数の戻り値を recordKeying に通して確かめる）
const keying = await page.evaluate(() => {
  const r = window.__cw.compareSending('ABCDE', 'AXBXCXDXE');
  return { pct: Math.round(r.accuracy * 100), correct: r.correct, total: r.total, extra: r.extra };
});
console.log('打鍵の採点:', JSON.stringify(keying));
ok('打鍵も余分を数える', keying.extra === 4 && keying.pct < 70, JSON.stringify(keying));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
