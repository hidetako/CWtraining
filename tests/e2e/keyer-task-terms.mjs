// パドル送信の課題に、Q 符号・略語の意味が添えられているか
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
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);

const newTask = async (type) => {
  await page.selectOption('#keyer-task-type', type);
  await page.click('#btn-keyer-task');
  await page.waitForTimeout(250);
  return {
    task: (await page.textContent('#keyer-task-text')).trim(),
    terms: await page.locator('#keyer-task-terms .task-term').evaluateAll(
      (els) => els.map((e) => ({
        code: e.querySelector('.code')?.textContent.trim(),
        ja: e.textContent.replace(e.querySelector('.code')?.textContent ?? '', '').trim(),
        title: e.getAttribute('title'),
      }))),
  };
};

// ── 略語・Q 符号 ──────────────────────────────────
// 出題は毎回変わるので、何度か引いて必ず意味が付くことを確かめる
let abbrevOk = 0;
for (let i = 0; i < 6; i++) {
  const r = await newTask('abbrev');
  const hit = r.terms.some((t) => t.code === r.task && t.ja.length > 0);
  if (hit) abbrevOk += 1; else console.log('  意味が付かなかった:', JSON.stringify(r));
}
ok('略語・Q 符号には必ず意味が付く', abbrevOk === 6, `${abbrevOk}/6`);

const one = await newTask('abbrev');
console.log('略語の例:', one.task, '→', JSON.stringify(one.terms));
ok('課題の語が色分けされる', await page.locator('#keyer-task-text .term').count() >= 1);
ok('意味が全文ホバーで出る', (one.terms[0]?.title ?? '').length > 0, one.terms[0]?.title);

// ── 定型文は語ごとに並ぶ ──────────────────────────
let phrase = null;
for (let i = 0; i < 8; i++) {
  phrase = await newTask('phrase');
  if (phrase.terms.length >= 2) break;
}
console.log('定型文の例:', phrase.task, '→', phrase.terms.map((t) => `${t.code}=${t.ja}`).join(' / '));
ok('定型文では複数の語に意味が付く', phrase.terms.length >= 2, String(phrase.terms.length));
ok('重複した語は 1 回だけ', new Set(phrase.terms.map((t) => t.code)).size === phrase.terms.length);
await page.screenshot({ path: `${DIR}/k1-task-terms.png`, fullPage: true });

// ── コールサインには余計な説明を付けない ──────────
const call = await newTask('callsign');
console.log('コールサインの例:', call.task, '→', JSON.stringify(call.terms));
ok('コールサインに説明は付かない', call.terms.length === 0, JSON.stringify(call.terms));

// ── 自由練習では課題も意味も出ない ────────────────
const free = await newTask('free');
ok('自由練習では意味欄が空', free.terms.length === 0);
ok('自由練習の案内が出る', free.task.includes('自由練習'));
ok('自由練習では手本を聞けない', await page.isDisabled('#btn-keyer-listen'));

// ── 疑問符付きの語も拾えること ────────────────────
// QRZ? や HW? は「?」を付けて送るのが普通なので、
// 記号ごと引いて見つからない、では意味が付かない
const punct = await page.evaluate(() => {
  const t = (w) => {
    const e = window.__cw.lookupTerm(w);
    return e ? { term: e.term, ja: e.ja } : null;
  };
  return { qrz: t('QRZ?'), hw: t('HW?'), qrl: t('QRL?'), q: t('?') };
});
console.log('疑問符付き:', JSON.stringify(punct));
ok('QRZ? に意味が付く', punct.qrz?.ja?.includes('呼び'), JSON.stringify(punct.qrz));
ok('HW? に意味が付く', !!punct.hw?.ja, JSON.stringify(punct.hw));
ok('QRZ? の見出しは記号込みのまま', punct.qrz?.term === 'QRZ?', punct.qrz?.term);
ok('? だけの語は従来どおり', punct.q?.ja?.includes('もう一度'), JSON.stringify(punct.q));

// ── 意味が長すぎないこと（簡単に添えるのが趣旨）────
// 出題は無作為なので、1 回引いて確かめるだけでは運で通ってしまう。
// 語彙と定型文をすべて通して、収まらないものが 1 つも無いことを見る
const tooLong = await page.evaluate(() => {
  const { taskTermsHtml, ABBREVIATIONS, SYMBOL_ORDER, ALL_KEY_PHRASES } = window.__cw;
  const box = document.createElement('div');
  const lengths = (text) => {
    box.innerHTML = taskTermsHtml(text);
    return [...box.querySelectorAll('.task-term')]
      .map((el) => ({ text: el.textContent.replace(/\s+/g, ' ').trim() }));
  };

  const targets = [
    // 語そのもの、疑問符を付けて送る形、そして実際の定型文
    ...ABBREVIATIONS.map((a) => a.code),
    ...ABBREVIATIONS.map((a) => `${a.code}?`),
    ...SYMBOL_ORDER,
    ...ALL_KEY_PHRASES.map((ph) => ph.replace(/\{[A-Z]+\}/g, 'TOKYO')),
  ];

  const over = [];
  for (const t of targets) {
    for (const item of lengths(t)) {
      if (item.text.length > 40) over.push({ from: t, text: item.text, len: item.text.length });
    }
  }
  return { checked: targets.length, over };
});
console.log('長さを見た対象:', tooLong.checked, '件 / 超過:', tooLong.over.length);
ok('意味はどれも短く収まる', tooLong.over.length === 0,
  JSON.stringify(tooLong.over.slice(0, 3)));

// 画面に出したものも同じであること
await newTask('phrase');
const lens = await page.locator('#keyer-task-terms .task-term').evaluateAll(
  (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim().length));
console.log('意味の長さ:', JSON.stringify(lens));
ok('画面の表示も収まる', lens.every((n) => n <= 40), lens.join(','));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
