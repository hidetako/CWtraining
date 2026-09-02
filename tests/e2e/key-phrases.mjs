// 交信の定型文（話題別）
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

// ═══════════════ 定型文そのもの ═══════════════
const data = await page.evaluate(() => {
  const { KEY_PHRASE_TOPICS, ALL_KEY_PHRASES } = window.__cw;
  return {
    keys: Object.keys(KEY_PHRASE_TOPICS),
    labels: Object.fromEntries(Object.entries(KEY_PHRASE_TOPICS).map(([k, v]) => [k, v.label])),
    counts: Object.fromEntries(Object.entries(KEY_PHRASE_TOPICS).map(([k, v]) => [k, v.phrases.length])),
    total: ALL_KEY_PHRASES.length,
    phrases: Object.fromEntries(Object.entries(KEY_PHRASE_TOPICS).map(([k, v]) => [k, v.phrases])),
  };
});
console.log('話題:', JSON.stringify(data.counts), '合計', data.total);

// 依頼された話題がそろっていること
for (const [key, want] of [['wx', '天気'], ['time', '時刻'], ['qth', '場所'],
  ['condx', '電波'], ['qsb', 'フェージング'], ['greet', 'あいさつ']]) {
  ok(`話題「${want}」がある`, data.keys.includes(key) && data.labels[key].includes(want),
    data.labels[key] ?? '(無し)');
}
ok('以前より増えている', data.total > 10, `${data.total} 文`);
ok('どの話題にも複数の文がある', Object.values(data.counts).every((n) => n >= 5),
  JSON.stringify(data.counts));

// 話題の中身が話題どおりであること
const onTopic = {
  wx: /\bWX\b|TEMP|RAIN|SNOW|SUNNY|CLDY|CLOUDY|FOGGY|WINDY|HOT|HUMID|SUN\b/,
  time: /QTR|TIME|\b\d{4}\b/,
  qth: /QTH|JCC|KM|ASL|AREA/,
  // どのくらい取れているかも「電波の状況」の話題。SOLID CPI などが入る
  condx: /SIG|CONDX|BAND|QRN|QRM|RST|DB|CPI|SOLID|COPY/,
  qsb: /QSB|FADING/,
  // 気持ちや間合いを伝える語が入っていること
  greet: /GLD|PSED|DR OM|BTW|\bSA\b|\bWL\b|WUD|UFB|VFB|MOM|BTU|QRU|SRI|CFM|C BK|CL$/,
};
for (const [key, re] of Object.entries(onTopic)) {
  const off = data.phrases[key].filter((ph) => !re.test(ph));
  ok(`「${data.labels[key]}」の文が話題に沿う`, off.length === 0, JSON.stringify(off));
}

// すべての文が実際に打てること（符号を持たない文字が混ざっていないか）
const unkeyable = await page.evaluate(() => {
  const { ALL_KEY_PHRASES } = window.__cw;
  const bad = [];
  for (const ph of ALL_KEY_PHRASES) {
    // 差し替え記号とプロサインを外した残りを調べる
    const body = ph.replace(/\{[A-Z]+\}/g, 'X').replace(/<[A-Z]+>/g, '');
    for (const ch of body) {
      if (ch === ' ') continue;
      if (!window.__cw.termCode(ch)) bad.push({ ph, ch });
    }
  }
  return bad;
});
ok('すべての文が符号にできる', unkeyable.length === 0, JSON.stringify(unkeyable.slice(0, 5)));

// 差し替え記号が実在するものだけであること
const badPlaceholders = await page.evaluate(() => {
  const known = ['{ME}', '{DX}', '{NAME}', '{QTH}', '{RIG}', '{PWR}', '{ANT}'];
  return window.__cw.ALL_KEY_PHRASES
    .flatMap((ph) => ph.match(/\{[A-Z]+\}/g) ?? [])
    .filter((m) => !known.includes(m));
});
ok('知らない差し替え記号が無い', badPlaceholders.length === 0, JSON.stringify(badPlaceholders));

// ═══════════════ 話題を選ぶ ═══════════════
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
ok('定型文以外では話題欄を出さない', await page.isHidden('#keyer-topic-field'));

await page.selectOption('#keyer-task-type', 'phrase');
await page.waitForTimeout(300);
ok('定型文では話題欄が出る', await page.isVisible('#keyer-topic-field'));
ok('既定はおまかせ', await page.inputValue('#keyer-topic') === '',
  await page.inputValue('#keyer-topic'));
ok('話題は おまかせ + 全話題', await page.locator('#keyer-topic option').count() === data.keys.length + 1,
  String(await page.locator('#keyer-topic option').count()));

/** 課題を n 回引いて、出た本文を返す。 */
const draw = async (n) => {
  const seen = [];
  for (let i = 0; i < n; i++) {
    seen.push(await page.evaluate(() => window.__cw.keyerTask));
    await page.click('#btn-keyer-task');
    await page.waitForTimeout(70);
  }
  return seen;
};

/** 差し替え記号を含む手本と、実際に出た本文が同じ型か。 */
const matches = (template, actual) => {
  const re = new RegExp('^' + template
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{[A-Z]+\\\}/g, '[A-Z0-9/-]+') + '$');
  return re.test(actual);
};

for (const key of ['wx', 'time', 'qth', 'condx', 'qsb']) {
  await page.selectOption('#keyer-topic', key);
  await page.waitForTimeout(200);
  const drawn = await draw(14);
  const off = drawn.filter((t) => !data.phrases[key].some((ph) => matches(ph, t)));
  ok(`「${data.labels[key]}」だけが出る`, off.length === 0, JSON.stringify(off.slice(0, 2)));
  if (key === 'wx') console.log('天気の課題:', JSON.stringify([...new Set(drawn)].slice(0, 4)));
}

// おまかせは話題をまたいで出る
await page.selectOption('#keyer-topic', '');
await page.waitForTimeout(200);
const mixed = await draw(30);
const topicsSeen = new Set();
for (const t of mixed) {
  for (const [key, list] of Object.entries(data.phrases)) {
    if (list.some((ph) => matches(ph, t))) topicsSeen.add(key);
  }
}
console.log('おまかせで出た話題:', JSON.stringify([...topicsSeen]));
ok('おまかせは話題をまたぐ', topicsSeen.size >= 3, JSON.stringify([...topicsSeen]));

// ═══════════════ 差し替えと表示 ═══════════════
await page.selectOption('#keyer-topic', 'basic');
await page.waitForTimeout(200);
const basic = await draw(12);
ok('差し替え記号が残らない', basic.every((t) => !t.includes('{')), JSON.stringify(basic.slice(0, 2)));
const withRig = basic.find((t) => data.phrases.basic.some((ph) => ph.includes('{RIG}') && matches(ph, t)));
if (withRig) {
  ok('自局のリグに差し替わる', withRig.includes('IC-7300'), withRig);
} else {
  console.log('（今回はリグの文が出ませんでした）');
}

await page.selectOption('#keyer-topic', 'wx');
await page.waitForTimeout(300);
const shown = await page.evaluate(() => ({
  task: window.__cw.keyerTask,
  text: document.querySelector('#keyer-task-text').textContent.trim(),
  terms: [...document.querySelectorAll('.task-term')].map((el) => ({
    code: el.querySelector('.code')?.textContent ?? '',
    morse: el.querySelector('.morse')?.textContent ?? '',
  })),
}));
console.log('表示:', JSON.stringify(shown));
ok('本文が画面に出る', shown.text.length > 0 && shown.text === shown.task, shown.text);
ok('新しい語にも意味と符号が付く',
  shown.terms.length > 0 && shown.terms.every((t) => /[・－]/.test(t.morse)),
  JSON.stringify(shown.terms));
await page.screenshot({ path: `${DIR}/p1-phrases.png` });

// 新しく足した略語が引けること
const newTerms = await page.evaluate(() => {
  const { lookupTerm } = window.__cw;
  const want = ['CONDX', 'SIGS', 'CLDY', 'CPY', 'RPT', 'JCC', 'JST', 'ASL', 'HVY', 'STN'];
  return Object.fromEntries(want.map((w) => [w, lookupTerm(w)?.ja ?? null]));
});
console.log('足した略語:', JSON.stringify(newTerms));
ok('新しい略語すべてに意味がある', Object.values(newTerms).every(Boolean),
  JSON.stringify(Object.entries(newTerms).filter(([, v]) => !v)));

// ═══════════════ 保存される ═══════════════
await page.selectOption('#keyer-topic', 'qsb');
await page.waitForTimeout(200);
await page.reload();
await page.waitForTimeout(600);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
ok('話題が保存される', await page.inputValue('#keyer-topic') === 'qsb',
  await page.inputValue('#keyer-topic'));
ok('保存された話題で出題される',
  (await draw(6)).every((t) => data.phrases.qsb.some((ph) => matches(ph, t))));

// 知らない話題名が入っていたら、おまかせに戻す
await page.evaluate(() => {
  const key = 'cwtraining.settings.v1';
  const s = JSON.parse(localStorage.getItem(key));
  s.keyerTopic = 'nosuchtopic';
  localStorage.setItem(key, JSON.stringify(s));
});
await page.reload();
await page.waitForTimeout(600);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
ok('知らない話題はおまかせ扱い', await page.inputValue('#keyer-topic') === '',
  await page.inputValue('#keyer-topic'));
const anyTopic = await draw(8);
ok('知らない話題でも出題は止まらない', anyTopic.every((t) => t && !t.includes('{')),
  JSON.stringify(anyTopic.slice(0, 2)));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
