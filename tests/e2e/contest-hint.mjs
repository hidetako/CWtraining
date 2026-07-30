// コンテスト運用の難易度（受信ヘルプ）3 段階
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

// 相手局が実際に送った本文と、いま生きている局のコールサインを集める
const install = () => page.evaluate(() => {
  window.__sent = [];
  window.__cw.contest.addEventListener('rx', (e) => {
    window.__sent.push({ text: e.detail.text, qrm: !!e.detail.qrm });
  });
});
const board = () => page.evaluate(() => ({
  hidden: document.querySelector('#contest-hint-board').hidden,
  text: document.querySelector('#contest-hint-lines').textContent,
  lines: [...document.querySelectorAll('.hint-line')].map((el) => el.textContent),
}));
const calls = () => page.evaluate(() =>
  window.__cw.contest.stations.concat(window.__cw.contest.qrmStations).map((s) => s.callsign));

// ═══════════════ 伏せ方の単体確認 ═══════════════
const masked = await page.evaluate(() => {
  const { hintMask, HINT_MASK } = window.__cw;
  const show = (text, myCall = 'JA1ABC') => {
    const chars = text.split('').map((c) => ({ text: c }));
    const m = hintMask(chars, { myCall });
    let out = '', mw = -1;
    chars.forEach((c, i) => {
      const { hidden, word } = m[i];
      if (!hidden) { out += c.text; mw = -1; } else if (word !== mw) { out += HINT_MASK; mw = word; }
    });
    return out;
  };
  return {
    cq: show('CQ TEST DE JH1XYZ JH1XYZ TEST'),
    rnr: show('R 599 001'),
    call: show('JH1XYZ'),
    full: show('DE JH1XYZ JH1XYZ 599 13H'),
    b4: show('JA1ABC QSO B4'),
    jarl: show('5NN 13H'),
    mask: HINT_MASK,
  };
});
console.log('伏せ方:', JSON.stringify(masked, null, 0));
ok('CQ の型は見えてコールは伏せる', masked.cq === `CQ TEST DE ${masked.mask} ${masked.mask} TEST`, masked.cq);
ok('RST とナンバーは見える', masked.rnr === 'R 599 001', masked.rnr);
ok('コールだけの送信は印ひとつ', masked.call === masked.mask, masked.call);
ok('コールの文字数も伏せる', !masked.call.includes('X') && masked.call.length === 1, masked.call);
ok('交換一式も型が見える', masked.full === `DE ${masked.mask} ${masked.mask} 599 13H`, masked.full);
ok('自局のコールは見える', masked.b4 === 'JA1ABC QSO B4', masked.b4);
ok('JARL ナンバーも見える', masked.jarl === '5NN 13H', masked.jarl);

// ═══════════════ 既定は上級（表示なし）═══════════════
ok('既定は上級', await page.inputValue('#contest-hint') === 'none',
  await page.inputValue('#contest-hint'));
ok('段階は 3 つ', await page.locator('#contest-hint option').count() === 3);
ok('段階の説明が出る', (await page.textContent('#contest-hint-help')).trim().length > 0);

await page.click('.tab[data-panel="contest"]');
await page.selectOption('#contest-minutes', '3');
await page.selectOption('#contest-mode', 'single');   // 1 局ずつで読みやすくする
await page.click('#btn-contest-start');
await page.waitForTimeout(300);
await install();
await page.waitForTimeout(2500);
let b = await board();
ok('上級では枠が出ない', b.hidden === true, JSON.stringify(b));
ok('上級では何も表示しない', b.text.trim() === '', JSON.stringify(b.text));

// ═══════════════ 運用中に初級へ切り替える ═══════════════
await page.selectOption('#contest-hint', 'seq');
await page.waitForTimeout(200);
b = await board();
ok('切り替えで枠が出る', b.hidden === false, JSON.stringify(b));
ok('凡例に印の説明が出る',
  (await page.textContent('#contest-hint-legend')).includes(masked.mask),
  await page.textContent('#contest-hint-legend'));

// 呼んでくる局の送信を待つ。自局の送信が終わってからになるので、
// 決め打ちの待ち時間ではなく実際に出るまで待つ
const waitBoard = (re, label) => page.waitForFunction(
  (src) => new RegExp(src).test(document.querySelector('#contest-hint-lines').textContent),
  re.source, { timeout: 40000 },
).catch(() => { throw new Error(`${label} が出ませんでした`); });

await page.click('#contest-fkeys .fkey[data-fn="cq"]');
await waitBoard(/\S/, '呼んでくる局の表示');
b = await board();
const live = await calls();
console.log('初級の表示:', JSON.stringify(b.lines), '/ 局:', JSON.stringify(live));
ok('初級で何か表示される', b.text.trim().length > 0, JSON.stringify(b.text));
ok('コールサインは出さない', live.every((c) => !b.text.includes(c)),
  `${JSON.stringify(b.text)} vs ${JSON.stringify(live)}`);
ok('伏せた印が出ている', b.text.includes(masked.mask), JSON.stringify(b.text));
await page.screenshot({ path: `${DIR}/h1-seq.png` });

// ナンバーを送らせて、交換の型が読めることを確かめる
await page.fill('#contest-call', (await calls())[0] ?? 'JA1ABC');
await page.click('#contest-fkeys .fkey[data-fn="exchange"]');
await waitBoard(/[0-9]/, '交換（RST・ナンバー）の表示');
await page.waitForTimeout(1200);   // 続きも出そろうまで少し置く
b = await board();
const sent = await page.evaluate(() => window.__sent.filter((s) => !s.qrm).map((s) => s.text));
console.log('初級の表示:', JSON.stringify(b.lines));
console.log('相手が送った本文:', JSON.stringify(sent));
const exchangeSeen = /\d/.test(b.text) || b.text.includes('R');
ok('交換の中身（RST・ナンバー）が読める', exchangeSeen, JSON.stringify(b.text));
ok('この間もコールは出さない', (await calls()).every((c) => !b.text.includes(c)),
  JSON.stringify(b.text));

// 打った順に増える表示であること
const grow = await page.evaluate(async () => {
  const box = document.querySelector('#contest-hint-lines');
  document.querySelector('#contest-fkeys .fkey[data-fn="again"]').click();  // NR? で送り返させる
  const seen = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 30000) {
    seen.push(box.textContent.trim().length);
    if (seen.at(-1) > seen[0] + 2) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  return seen;
});
const rising = grow.some((v, i) => i > 0 && v > grow[i - 1]);
ok('文字が順に増えていく', rising, `長さの推移: ${grow.slice(-14).join(',')}`);

// 初級は打ち終わっても残ること（読んでログに打ち込むため）
await page.waitForTimeout(3000);
const stayed = (await board()).text.trim();
ok('初級は打ち終わっても残る', stayed.length > 0, JSON.stringify(stayed));

// ═══════════════ 中級は 1 文字だけ ═══════════════
await page.selectOption('#contest-hint', 'char');
await page.waitForTimeout(400);
ok('中級に切り替えると前の行は消える', (await board()).text.trim() === '',
  JSON.stringify((await board()).text));

await page.click('#contest-fkeys .fkey[data-fn="again"]');
await waitBoard(/\S/, '中級の表示');
const sampled = await page.evaluate(async () => {
  const widths = [], seen = new Set();
  const t0 = performance.now();
  while (performance.now() - t0 < 7000) {
    const ls = [...document.querySelectorAll('.hint-line')].map((el) => el.textContent);
    ls.forEach((t) => { widths.push(t.length); if (t) seen.add(t); });
    await new Promise((r) => setTimeout(r, 90));
  }
  return { widths, chars: [...seen] };
});
console.log('中級の行の長さ:', JSON.stringify([...new Set(sampled.widths)].sort()));
console.log('中級で見えた文字:', JSON.stringify(sampled.chars));
ok('中級はどの行も 1 文字まで', sampled.widths.every((n) => n <= 1),
  JSON.stringify([...new Set(sampled.widths)]));
ok('中級でも文字は出ている', sampled.widths.some((n) => n === 1));
ok('中級は文字が入れ替わる', sampled.chars.length > 1, JSON.stringify(sampled.chars));
ok('中級でもコールは伏せる', (await calls()).every((c) => !sampled.chars.join('').includes(c)),
  JSON.stringify(sampled.chars));
await page.screenshot({ path: `${DIR}/h2-char.png` });

// 中級は打ち終われば消えること
await page.waitForTimeout(3500);
ok('中級は打ち終わると消える', (await board()).text.trim() === '',
  JSON.stringify((await board()).text));

// ═══════════════ 上級に戻すと消える ═══════════════
await page.selectOption('#contest-hint', 'none');
await page.waitForTimeout(300);
b = await board();
ok('上級に戻すと枠が消える', b.hidden === true, JSON.stringify(b));
ok('上級に戻すと表示も消える', b.text.trim() === '', JSON.stringify(b.text));

// ═══════════════ 混信局は表示しない ═══════════════
await page.evaluate(() => window.__cw.contest.stopSession());
await page.waitForTimeout(300);
await page.selectOption('#contest-hint', 'seq');
await page.selectOption('#contest-mode', 'pileup');
await page.click('#cond-qrm');   // QRM を確実に入れる
const qrmOn = await page.isChecked('#cond-qrm');
if (!qrmOn) await page.click('#cond-qrm');
ok('QRM を有効にした', await page.isChecked('#cond-qrm'));
await page.click('#btn-contest-start');
await page.waitForTimeout(300);
await install();
await page.waitForTimeout(7000);
const qrmSent = await page.evaluate(() => window.__sent.filter((s) => s.qrm).map((s) => s.text));
const qrmCalls = await page.evaluate(() => window.__cw.contest.qrmStations.map((s) => s.callsign));
b = await board();
console.log('混信局の送信:', JSON.stringify(qrmSent.slice(0, 3)), '/ 表示:', JSON.stringify(b.text));
ok('混信局が実際に送っている', qrmSent.length > 0, `${qrmSent.length} 回`);
ok('混信局は表示しない', qrmCalls.every((c) => !b.text.includes(c)),
  `${JSON.stringify(b.text)} vs ${JSON.stringify(qrmCalls)}`);
ok('混信局の CQ を並べない',
  await page.evaluate(() => window.__cw.hintLines.every((l) => !l.qrm)));

// ═══════════════ 終了で片付く・設定が残る ═══════════════
await page.evaluate(() => window.__cw.contest.stopSession());
await page.waitForTimeout(400);
b = await board();
ok('終了で枠が消える', b.hidden === true, JSON.stringify(b));
ok('終了で表示も消える', b.text.trim() === '', JSON.stringify(b.text));
ok('描画も止まる', await page.evaluate(() => window.__cw.hintLines.length) === 0);

await page.reload();
await page.waitForTimeout(600);
ok('段階が保存される', await page.inputValue('#contest-hint') === 'seq',
  await page.inputValue('#contest-hint'));

// 知らない段階名が入っていたら上級に寄せる
await page.evaluate(() => {
  const key = 'cwtraining.settings.v1';
  const s = JSON.parse(localStorage.getItem(key));
  s.contestHint = 'ultra';
  localStorage.setItem(key, JSON.stringify(s));
});
await page.reload();
await page.waitForTimeout(600);
ok('知らない段階は上級に寄せる', await page.inputValue('#contest-hint') === 'none',
  await page.inputValue('#contest-hint'));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
