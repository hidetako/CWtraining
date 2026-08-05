// 説明に添える符号（・－ 表記）と、= / <BT> の採点
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

// ═══════════════ 符号の表記 ═══════════════
const codes = await page.evaluate(() => {
  const { termCode, termTitle } = window.__cw;
  return {
    fer: termCode('FER'),
    de: termCode('DE'),
    bt: termCode('='),
    sk: termCode('<SK>'),
    qrz: termCode('QRZ?'),
    title: termTitle({ term: 'FER', ja: '～のために（for）' }),
  };
});
console.log('符号:', JSON.stringify(codes, null, 0));
ok('FER の符号', codes.fer === '・・－・　・　・－・', codes.fer);
ok('DE の符号', codes.de === '－・・　・', codes.de);
ok('= は BT の符号', codes.bt === '－・・・－', codes.bt);
ok('プロサインは 1 文字分', codes.sk === '・・・－・－', codes.sk);
ok('記号付きも引ける', codes.qrz.split('　').length === 4, codes.qrz);
ok('説明に符号が添う', codes.title.includes('～のために') && codes.title.includes('・・－・'),
  codes.title);

// ═══════════════ = と <BT> を同じものとして採点する ═══════════════
const graded = await page.evaluate(() => {
  const { compareSending } = window.__cw;
  const pct = (t, s) => {
    const r = compareSending(t, s);
    return { pct: Math.round(r.accuracy * 100), correct: r.correct, total: r.total,
      extra: r.extra, wrong: r.wrong };
  };
  return {
    btForEq: pct('= NAME TARO', '<BT> NAME TARO'),
    eqForBt: pct('<BT> NAME TARO', '= NAME TARO'),
    inLine: pct('TNX FER QSO = 73 <SK>', 'TNX FER QSO <BT> 73 <SK>'),
    same: pct('CQ CQ DE JA1ABC', 'CQ CQ DE JA1ABC'),
    // 符号が違うものは今までどおり間違いとして数える
    nn: pct('R 599', 'R 5NN'),
    drop: pct('JA1ABC', 'JABC'),
  };
});
console.log('採点:', JSON.stringify(graded));
ok('= を <BT> と打っても満点', graded.btForEq.pct === 100, JSON.stringify(graded.btForEq));
ok('<BT> を = と打っても満点', graded.eqForBt.pct === 100, JSON.stringify(graded.eqForBt));
ok('文中の = も通る', graded.inLine.pct === 100, JSON.stringify(graded.inLine));
ok('<BT> を余分と数えない', graded.btForEq.extra === 0, String(graded.btForEq.extra));
ok('そのままの一致はこれまでどおり', graded.same.pct === 100, JSON.stringify(graded.same));
// 599 を 5NN と打つのは 2 文字の打ち間違い。1 回の誤りを二重に数えず、
// 「打ち漏らし＋余分」ではなく打ち間違い 2 として数える
ok('符号が違えば間違いのまま',
  graded.nn.pct < 100 && graded.nn.wrong === 2 && graded.nn.extra === 0,
  JSON.stringify(graded.nn));
ok('打ち漏らしも従来どおり', graded.drop.correct === 4 && graded.drop.total === 6,
  JSON.stringify(graded.drop));

// 実際に打鍵として通す（採点の入口から出口まで）
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
const endToEnd = await page.evaluate(async () => {
  const { keyer } = window.__cw;
  // 課題を = を含む定型文に固定して、<BT> と解読された符号で採点させる
  document.querySelector('#keyer-task-type').value = 'phrase';
  document.querySelector('#keyer-task-type').dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 300));
  // 定型文は無作為に選ばれるので、= を含むものが出るまで引き直す
  let task = window.__cw.keyerTask;
  for (let i = 0; i < 40 && !String(task).includes('='); i++) {
    document.querySelector('#btn-keyer-task').click();
    await new Promise((r) => setTimeout(r, 60));
    task = window.__cw.keyerTask;
  }
  if (!task) return { skipped: true };
  keyer.text = task.replace(/=/g, '<BT>');
  document.querySelector('#btn-keyer-grade').click();
  await new Promise((r) => setTimeout(r, 300));
  return { task, shown: document.querySelector('#keyer-result .big')?.textContent ?? '' };
});
console.log('通しの採点:', JSON.stringify(endToEnd));
if (endToEnd.task?.includes('=')) {
  ok('画面の採点でも = ↔ <BT> が通る', endToEnd.shown.trim() === '100%', endToEnd.shown);
} else {
  ok('= を含む課題が出た', false, `課題: ${endToEnd.task}`);
}

// ═══════════════ 画面に符号が出る ═══════════════
// パドル送信の課題に添える用語
const taskTerms = await page.evaluate(() =>
  [...document.querySelectorAll('.task-term')].map((el) => ({
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    morse: el.querySelector('.morse')?.textContent ?? '',
    title: el.getAttribute('title') ?? '',
  })));
console.log('課題の用語:', JSON.stringify(taskTerms.slice(0, 3)));
ok('課題の用語が出ている', taskTerms.length > 0, String(taskTerms.length));
ok('用語すべてに符号が付く', taskTerms.every((t) => /[・－]/.test(t.morse)),
  JSON.stringify(taskTerms.map((t) => t.morse)));
ok('マウスを載せた説明にも符号が付く', taskTerms.every((t) => /[・－]/.test(t.title)),
  JSON.stringify(taskTerms.map((t) => t.title).slice(0, 2)));
await page.screenshot({ path: `${DIR}/t1-task-terms.png` });

// ガイド付き交信の用語一覧
await page.click('.tab[data-panel="qso"]');
await page.locator('.style-option[data-style="guided"]').click();
await page.waitForTimeout(200);
await page.click('#btn-qso-start');
await page.waitForTimeout(1200);

// 最初のターンが自局の送信（選択肢）なら、答えてから相手のターンへ進む
if (await page.locator('#qso-choices .choice').count()) {
  await page.click('#qso-choices .choice');
  await page.waitForTimeout(400);
  await page.click('#btn-guide-skip');
  await page.waitForTimeout(800);
}
await page.waitForSelector('#btn-guide-reveal', { timeout: 30000 });
await page.click('#btn-guide-reveal');
await page.waitForTimeout(700);
const cards = await page.evaluate(() =>
  [...document.querySelectorAll('.explain-card')].map((el) => ({
    code: el.querySelector('.code')?.textContent ?? '',
    desc: el.querySelector('.desc')?.textContent ?? '',
    morse: el.querySelector('.morse')?.textContent ?? '',
  })));
console.log('用語一覧:', JSON.stringify(cards.slice(0, 3)));
ok('用語一覧が出ている', cards.length > 0, String(cards.length));
ok('一覧すべてに符号が付く', cards.every((c) => /[・－]/.test(c.morse)),
  JSON.stringify(cards.map((c) => `${c.code}=${c.morse}`).slice(0, 3)));
ok('意味と符号が別々に出る', cards.every((c) => c.desc && c.morse && c.desc !== c.morse));
await page.screenshot({ path: `${DIR}/t2-term-list.png` });

// 本文の語にマウスを載せたときの説明
const titles = await page.evaluate(() =>
  [...document.querySelectorAll('.annotated .term[title]')].map((el) => el.getAttribute('title')));
console.log('本文の説明:', JSON.stringify(titles.slice(0, 3)));
ok('本文の説明にも符号が付く', titles.length > 0 && titles.every((t) => /[・－]/.test(t)),
  JSON.stringify(titles.slice(0, 2)));

// 初心者モードの実況解説
await page.evaluate(() => window.__cw.player.stop());
await page.click('.tab[data-panel="qso"]');
await page.waitForTimeout(300);
if (!(await page.isChecked('#panel-qso .js-beginner'))) {
  await page.click('#panel-qso .js-beginner');
  await page.waitForTimeout(200);
}
ok('初心者モードにした', await page.isChecked('#panel-qso .js-beginner'));

await page.click('#btn-qso-start');
await page.waitForTimeout(1200);
// 実況解説は相手のターンを再生している間に出るので、そこまで進める
if (await page.locator('#qso-choices .choice').count()) {
  await page.click('#qso-choices .choice');
  await page.waitForTimeout(400);
  await page.click('#btn-guide-skip');
}
await page.waitForFunction(() => document.querySelectorAll('#qso-explain .explain-card').length > 0,
  null, { timeout: 40000 });
const liveCards = await page.evaluate(() =>
  [...document.querySelectorAll('#qso-explain .explain-card')].map((el) => ({
    code: el.querySelector('.code')?.textContent ?? '',
    morse: el.querySelector('.morse')?.textContent ?? '',
  })));
console.log('実況解説:', JSON.stringify(liveCards.slice(0, 3)));
ok('実況解説にも符号が付く', liveCards.every((c) => /[・－]/.test(c.morse)),
  JSON.stringify(liveCards.map((c) => `${c.code}=${c.morse}`).slice(0, 3)));
await page.screenshot({ path: `${DIR}/t3-live-explain.png` });
await page.evaluate(() => window.__cw.player.stop());

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
