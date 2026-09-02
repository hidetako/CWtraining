// 全角で打ち込んでも採点できること
//
// 日本語入力を全角英数のまま打つと「ＯＪＪＷＷ」のように入る。見た目は
// ほぼ同じでも符号としては別の文字なので、そろえずに比べると正しく
// 書けていても 1 文字も一致しない（0 点になる）。
// 入力モードを気にせず練習できることを、採点する場所すべてで見る。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

// ── 聞き取りドリルの採点 ──────────────────────────
const drill = await page.evaluate(() => {
  const g = (answer, input) => {
    const r = window.__cw.gradeProblem({ answer }, input);
    return { pct: Math.round(r.accuracy * 100), correct: r.correct, total: r.total, wrong: r.wrong };
  };
  return {
    // 報告のあった実例。0JJWW を全角で ＯＪＪＷＷ と書いた
    reported: g('0JJWW', 'ＯＪＪＷＷ'),
    perfect: g('0JJWW', '０ＪＪＷＷ'),
    halfWidth: g('0JJWW', '0JJWW'),
    spaces: g('CQ TEST', 'ＣＱ　ＴＥＳＴ'),
    mixed: g('JA1ABC', 'ＪＡ1ＡＢＣ'),
  };
});
console.log('ドリル:', JSON.stringify(drill));
// 全角で正しく書けていれば満点。ここが 0 点になるのが今回の不具合だった
ok('全角で書いても満点になる', drill.perfect.pct === 100, JSON.stringify(drill.perfect));
ok('半角と同じ点になる', drill.halfWidth.pct === drill.perfect.pct);
// O（英字）と 0（数字）の取り違えは 1 文字の誤り。5 文字全部の誤りではない
ok('1 文字違いは 1 文字ぶんの減点', drill.reported.pct === 80 && drill.reported.wrong === 1,
  JSON.stringify(drill.reported));
ok('全角スペースも空白として扱う', drill.spaces.pct === 100, JSON.stringify(drill.spaces));
ok('全角と半角が混ざっても通る', drill.mixed.pct === 100, JSON.stringify(drill.mixed));

// ── 聞き取り練習（ログシート）の採点 ──────────────
const fields = await page.evaluate(() => ({
  qth: window.__cw.gradeField('TOKYO', 'ＴＯＫＹＯ').correct,
  rst: window.__cw.gradeField('599', '５９９').correct,
  call: window.__cw.gradeField('JA1ABC', 'ＪＡ１ＡＢＣ').correct,
  wrong: window.__cw.gradeField('TOKYO', 'ＯＳＡＫＡ').correct,
}));
console.log('ログシート:', JSON.stringify(fields));
ok('QTH を全角で書いても正解', fields.qth);
ok('RST を全角で書いても正解', fields.rst);
ok('コールを全角で書いても正解', fields.call);
ok('違う答えはやはり不正解', fields.wrong === false);

// ── コンテストのログ ──────────────────────────────
const contest = await page.evaluate(() => {
  const log = new window.__cw.ContestLog();
  const q = log.add({
    call: 'ＪＡ１ＡＢＣ', rst: '５９９', nr: '００１',
    trueCall: 'JA1ABC', trueRst: '599', trueNr: '001',
  });
  const bad = new window.__cw.ContestLog().add({
    call: 'ＪＡ１ＸＹＺ', rst: '599', nr: '001',
    trueCall: 'JA1ABC', trueRst: '599', trueNr: '001',
  });
  return {
    call: q.call, rst: q.rst, nr: q.nr, err: q.err,
    badErr: bad.err,
    cut: window.__cw.normalizeNumber('５ＮＮ'),
  };
});
console.log('コンテスト:', JSON.stringify(contest));
ok('全角のコールが有効交信になる', contest.err === '', JSON.stringify(contest));
ok('全角のコールが半角で残る', contest.call === 'JA1ABC', contest.call);
ok('全角の RST・ナンバーも読める', contest.rst === '599' && contest.nr === '001',
  `${contest.rst} / ${contest.nr}`);
ok('全角のカットナンバーも読める', contest.cut === '599', contest.cut);
// そろえたせいで誤りを見逃さないこと
ok('コールが違えば誤りのまま', contest.badErr === 'CALL', contest.badErr);

// ── 画面から通しで ────────────────────────────────
// 実際に全角で打ち込んで採点されるところまで見る
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(300);
await page.selectOption('#drill-type', 'callsign');
await page.waitForTimeout(200);
await page.click('#btn-drill-new');
await page.waitForTimeout(4500);   // 3-2-1 のカウントダウンと再生を待つ
const answer = await page.evaluate(() => window.__cw.drillProblem?.answer ?? '');
console.log('出題:', answer);
ok('問題が出ている', !!answer, answer);

// 半角の答えを全角に置き換えて打ち込む
const toFull = (t) => [...t].map((c) => (/[A-Z0-9]/.test(c)
  ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join('');
const typed = toFull(answer);
console.log('全角で入力:', typed);
await page.fill('#drill-answer', typed);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
const shown = (await page.textContent('#drill-result')).replace(/\s+/g, ' ').trim();
console.log('採点:', shown.slice(0, 70));
ok('画面でも全角入力が満点になる', shown.startsWith('100%'), shown.slice(0, 40));
await page.screenshot({ path: `${DIR}/fw-drill.png`, fullPage: true });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
