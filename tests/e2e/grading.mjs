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
await page.waitForTimeout(400);

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

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
