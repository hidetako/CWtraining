// 採点結果が読めること
//
// 打ち漏らしに取り消し線を引くと、線が字画と一体に見えて別の字に読める。
// 7 は ｱ、3 は ヨ、J は チ になり、打った覚えのない文字が採点結果に
// 混ざっているように見えてしまう（「採点が変」として 2 回報告された）。
// 字の上には線を引かないこと、そして点数の内訳が画面から読み取れることを見る。
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

// ── 報告された実例をそのまま画面に出す ────────────
// 手本 GB OM ES GL = 73 73 <SK> に対し、73 を 1 回しか打たなかった例。
// 点数 12/14 = 86% 自体は正しく、読めなくしていたのは取り消し線だった
const TARGET = 'GB OM ES GL = 73 73 <SK>';
const SENT = 'GBOMESGL<BT>73<SK>';

const shown = await page.evaluate(([t, s]) => {
  const box = document.createElement('div');
  box.id = 'diff-probe';
  box.innerHTML = window.__cw.sendingDiffHtml(t, s);
  document.body.appendChild(box);
  // 凡例の中にも .diff .missing があるので、結果欄の分だけを見る
  const missing = [...box.querySelectorAll(':scope > .diff .missing')];
  const style = missing[0] && getComputedStyle(missing[0]);
  return {
    pct: box.querySelector('.big').textContent.trim(),
    note: box.querySelector('.score-line .hint').textContent.replace(/\s+/g, ' ').trim(),
    missingChars: missing.map((el) => el.textContent).join(''),
    decoration: style ? style.textDecorationLine : '(なし)',
    outline: style ? style.outlineStyle : '(なし)',
  };
}, [TARGET, SENT]);

console.log('画面:', JSON.stringify(shown));

ok('報告例は 86% のまま', shown.pct === '86%', shown.pct);
ok('打ち漏らしが 73 と示される', shown.missingChars === '73', shown.missingChars);

// 本題。字の上に線が乗ると別の字に化ける
ok('打ち漏らしに取り消し線を引かない',
  !shown.decoration.includes('line-through'), shown.decoration);
ok('打ち漏らしは囲みで示す', shown.outline === 'dashed', shown.outline);

// 内訳が言葉でも出ること。12 / 14 だけでは残り 2 文字が何か分からない
ok('抜けた文字数が言葉でも出る', /抜け\s*2\s*文字/.test(shown.note), shown.note);

// ── ドリル側の採点結果も同じであること ──────────
const drill = await page.evaluate(() => {
  const r = window.__cw.gradeProblem({ answer: 'JR5OE' }, '1R5OE');
  const box = document.createElement('div');
  box.id = 'marks-probe';
  box.innerHTML = '<div class="marks">' + r.marks
    .map((m) => `<span class="${m.type}">${m.type === 'extra' ? m.actual : m.expected}</span>`)
    .join('') + '</div>';
  document.body.appendChild(box);
  const el = box.querySelector('.marks .missing');
  const style = el && getComputedStyle(el);
  return {
    missing: el ? el.textContent : '(なし)',
    decoration: style ? style.textDecorationLine : '(なし)',
    outline: style ? style.outlineStyle : '(なし)',
  };
});

console.log('ドリル:', JSON.stringify(drill));
ok('ドリルでも取り消し線を引かない',
  !drill.decoration.includes('line-through'), drill.decoration);
ok('ドリルでも囲みで示す', drill.outline === 'dashed', drill.outline);

// ── 凡例の色見本には囲みを付けない ────────────────
// 凡例は色だけを示す欄なので、■ に囲みが付くと見本として読みにくい
const legend = await page.evaluate(() => {
  const el = document.querySelector('#diff-probe .diff-legend .missing');
  const style = el && getComputedStyle(el);
  return style ? { outline: style.outlineStyle, decoration: style.textDecorationLine } : null;
});
console.log('凡例:', JSON.stringify(legend));
ok('凡例の見本は色だけ',
  legend && legend.outline === 'none' && !legend.decoration.includes('line-through'),
  JSON.stringify(legend));

// ── 書き間違いを抜けと二重に数えないこと ──────────
// 書き間違いは「打ち漏らし + 余分」に分かれて出てくる。両方を数えると
// 1 回の誤りが 2 件あるように読めてしまう
const note = await page.evaluate(() => {
  const box = document.createElement('div');
  box.innerHTML = window.__cw.sendingDiffHtml('JR5OE', '1R5OE');
  return box.querySelector('.score-line .hint').textContent.replace(/\s+/g, ' ').trim();
});
console.log('書き間違いの内訳:', note);
ok('書き間違いを抜けと二重に数えない', !note.includes('抜け'), note);
ok('書き間違いとして 1 件出る', /書き間違い\s*1\s*文字/.test(note), note);

await page.screenshot({ path: `${DIR}/dl1-diff.png`, fullPage: true });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
