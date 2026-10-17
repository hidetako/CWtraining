// 聞き取りドリル: 間違えやすい文字を抽出して復習できること
//
// ・採点で「何を何と取り違えたか」（S→H など）が分かり、記録に集まる
// ・採点結果の「間違えた文字を復習する」で、間違えた文字と取り違えた相手を
//   混ぜた問題がすぐに出る（苦手集中の字母を差し替える）
// ・記録タブに取り違えの一覧が出て、苦手集中の説明にも取り違えが載る
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
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(500);

// ── 取り違えの組の数え方（採点の関数そのもの） ──
const graded = await page.evaluate(() => {
  const g = (answer, input) => window.__cw.gradeProblem({ answer }, input);
  return {
    sub: g('SHSH', 'HHSH').substitutions,          // 先頭の S を H と書いた
    two: g('KUV', 'RVV').substitutions,            // K→R、U→V
    miss: g('ABC', 'AC').substitutions,            // 取り漏らしは組にしない
    perfect: g('ABC', 'ABC').substitutions,
  };
});
console.log('取り違え:', JSON.stringify(graded));
ok('S を H と書けば S→H の組になる', JSON.stringify(graded.sub) === JSON.stringify([{ expected: 'S', actual: 'H' }]), JSON.stringify(graded.sub));
ok('2 か所の取り違えは 2 組', JSON.stringify(graded.two) === JSON.stringify([{ expected: 'K', actual: 'R' }, { expected: 'U', actual: 'V' }]), JSON.stringify(graded.two));
ok('取り漏らしだけなら組は無い', graded.miss.length === 0 && graded.perfect.length === 0, JSON.stringify(graded.miss));

// ── 実際にドリルを解いて、わざと S を H と書く ──
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(200);
await page.selectOption('#drill-type', 'koch');
// S と H が入る水準まで上げる（コッホ順の 10 文字: K M R S U A P T L O … S は入る。H は後ろ）
await page.evaluate(() => { const el = document.querySelector('#drill-level'); el.value = String(el.max); el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(150);

/** 1 問出して、答えの S を H に、U を V に書き換えて採点する。S も U も無ければ先頭を変える。 */
const solveWrong = async () => {
  await page.click('#btn-drill-new');
  await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === true, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  const answer = await page.evaluate(() => window.__cw.drillProblem.answer);
  let typed = answer.replace(/S/g, 'H').replace(/U/g, 'V');
  if (typed === answer) typed = (answer[0] === 'H' ? 'S' : 'H') + answer.slice(1);
  await page.evaluate(() => window.__cw.player.stop());
  await page.fill('#drill-answer', typed);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  return { answer, typed };
};

let last;
for (let i = 0; i < 3; i++) last = await solveWrong();
console.log('最後の問題:', JSON.stringify(last));
const after = await page.evaluate(() => ({
  confusions: window.__cw.stats.confusions,
  mistakes: document.querySelector('#drill-result .drill-mistakes')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
  reviewBtn: document.querySelector('#btn-drill-review')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
}));
console.log('記録:', JSON.stringify(after));
ok('取り違えが記録に集まる', Object.keys(after.confusions).length > 0 && Object.values(after.confusions).reduce((a, b) => a + b, 0) >= 3, JSON.stringify(after.confusions));
ok('採点結果に間違えた文字が出る', /間違えた文字/.test(after.mistakes) && /→/.test(after.mistakes), after.mistakes);
ok('「間違えた文字を復習する」が出る', /復習する/.test(after.reviewBtn), after.reviewBtn);
await page.screenshot({ path: `${DIR}/dr1-mistakes.png`, fullPage: true });

// ── 復習を始める: 間違えた文字と相手だけで出題される ──
await page.click('#btn-drill-review');
await page.waitForTimeout(400);
const review = await page.evaluate(() => ({
  type: document.querySelector('#drill-type').value,
  review: window.__cw.drillReview,
  alphabetText: document.querySelector('#drill-alphabet').textContent,
  problem: window.__cw.drillProblem?.text ?? '',
}));
console.log('復習:', JSON.stringify(review));
ok('種類が苦手集中に切り替わる', review.type === 'weak', review.type);
ok('復習の字母が決まり、説明に出る', review.review && review.review.alphabet.length >= 2 && /復習:/.test(review.alphabetText), review.alphabetText);
const onlyReview = review.problem.replace(/\s/g, '').split('').every((c) => review.review.alphabet.includes(c));
ok('出た問題は復習の字母だけでできている', review.problem.length > 0 && onlyReview, JSON.stringify(review.problem));
ok('間違えた文字と相手が両方入っている', last.answer.split('').some((c) => review.review.alphabet.includes(c)) && last.typed.split('').some((c) => review.review.alphabet.includes(c)), JSON.stringify(review.review.alphabet));
await page.evaluate(() => { window.__cw.player.stop(); });
await page.screenshot({ path: `${DIR}/dr2-review.png`, fullPage: true });

// 種類を変えれば復習は解ける
await page.selectOption('#drill-type', 'koch');
await page.waitForTimeout(150);
ok('種類を変えると復習の字母は解ける', (await page.evaluate(() => window.__cw.drillReview)) === null);

// 苦手集中の説明に取り違えが載る（2 回以上のもの）
await page.selectOption('#drill-type', 'weak');
await page.waitForTimeout(150);
const weakText = await page.textContent('#drill-alphabet');
console.log('苦手集中の説明:', weakText);
const pairs = await page.evaluate(() => window.__cw.confusionPairs(window.__cw.stats));
ok('取り違えの集計が取れる', pairs.length > 0 && pairs[0].count >= 2, JSON.stringify(pairs));
ok('苦手集中の説明に取り違えが載る', /取り違え:/.test(weakText), weakText);

// ── 記録タブに一覧 ──
await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(300);
const listed = await page.evaluate(() => [...document.querySelectorAll('#confusion-list .weak-char')].map((e) => e.textContent.replace(/\s+/g, '')));
console.log('記録タブ:', JSON.stringify(listed));
ok('記録タブに取り違えの一覧が出る', listed.length > 0 && listed.every((t) => /→/.test(t)), JSON.stringify(listed));
await page.screenshot({ path: `${DIR}/dr3-records.png`, fullPage: true });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
