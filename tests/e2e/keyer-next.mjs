// パドル送信の「次に進む」（採点しなくても次の課題へ行けること）
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
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(400);

const task = () => page.evaluate(() => window.__cw.keyerTask);
const keyed = () => page.evaluate(() => window.__cw.keyer.text);

// ═══════════════ 採点する・打ち直すと同じ段にある ═══════════════
const row = await page.evaluate(() => {
  const grade = document.querySelector('#btn-keyer-grade');
  const clear = document.querySelector('#btn-keyer-clear');
  const next = document.querySelector('#btn-keyer-next');
  const top = (el) => Math.round(el.getBoundingClientRect().top);
  return {
    labels: [...grade.parentElement.querySelectorAll('.btn')].map((b) => b.textContent.trim()),
    sameParent: next.parentElement === grade.parentElement
      && next.parentElement === clear.parentElement,
    tops: { grade: top(grade), clear: top(clear), next: top(next) },
    afterClear: clear.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
  };
});
console.log('同じ段:', JSON.stringify(row));
ok('採点する・打ち直すと同じ段にある', row.sameParent, JSON.stringify(row.labels));
ok('同じ高さに並ぶ', row.tops.grade === row.tops.next && row.tops.clear === row.tops.next,
  JSON.stringify(row.tops));
ok('打ち直すの右にある', !!row.afterClear);
ok('3 つのボタンが並ぶ',
  JSON.stringify(row.labels) === JSON.stringify(['採点する', '打ち直す', '次に進む']),
  JSON.stringify(row.labels));

// ═══════════════ 採点しなくても次へ行ける ═══════════════
await page.selectOption('#keyer-task-type', 'callsign');
await page.waitForTimeout(300);
ok('最初から押せる', await page.isEnabled('#btn-keyer-next'));
ok('採点結果はまだ無い', (await page.textContent('#keyer-result')).trim() === '');

const seen = [await task()];
for (let i = 0; i < 3; i++) {
  await page.click('#btn-keyer-next');
  await page.waitForTimeout(250);
  seen.push(await task());
}
console.log('課題の移り変わり:', JSON.stringify(seen));
ok('押すたびに課題が変わる', seen.every((t, i) => i === 0 || t !== seen[i - 1]), JSON.stringify(seen));
ok('一度も採点していない', (await page.textContent('#keyer-result')).trim() === '');
ok('課題は空でない', seen.every((t) => t && t.length > 0));

// 打ちかけでも次へ行ける（打った符号は片付く）
await page.evaluate(() => { window.__cw.keyer.text = 'ABC'; });
ok('打鍵が入っている', (await keyed()) === 'ABC', await keyed());
const before = await task();
await page.click('#btn-keyer-next');
await page.waitForTimeout(300);
ok('打ちかけでも次へ行ける', (await task()) !== before, `${before} → ${await task()}`);
ok('打った符号は片付く', (await keyed()) === '', JSON.stringify(await keyed()));

// ═══════════════ 採点したあとも同じボタンで進む ═══════════════
await page.evaluate(() => { window.__cw.keyer.text = window.__cw.keyerTask; });
await page.click('#btn-keyer-grade');
await page.waitForTimeout(400);
// 手本をそのまま与えているので、語の切れ目までそろって 100点＋ になる
ok('採点結果が出る', (await page.textContent('#keyer-result .big')).trim() === '100点＋',
  await page.textContent('#keyer-result .big'));
ok('採点結果に同じ操作のボタンを重ねない',
  await page.evaluate(() => document.querySelectorAll('#keyer-result .btn').length) === 0,
  String(await page.evaluate(() => document.querySelectorAll('#keyer-result .btn').length)));

const graded = await task();
await page.click('#btn-keyer-next');
await page.waitForTimeout(300);
ok('採点後も次へ進める', (await task()) !== graded, `${graded} → ${await task()}`);
ok('採点結果も片付く', (await page.textContent('#keyer-result')).trim() === '');
await page.screenshot({ path: `${DIR}/k1-next.png` });

// ═══════════════ 自由練習には次の課題が無い ═══════════════
await page.selectOption('#keyer-task-type', 'free');
await page.waitForTimeout(300);
ok('自由練習では押せない', await page.isDisabled('#btn-keyer-next'));
ok('自由練習では手本も無い', await page.isDisabled('#btn-keyer-listen'));

await page.selectOption('#keyer-task-type', 'abbrev');
await page.waitForTimeout(300);
ok('課題を選べば押せる', await page.isEnabled('#btn-keyer-next'));
const abbrev = await task();
await page.click('#btn-keyer-next');
await page.waitForTimeout(300);
ok('種類を変えても効く', (await task()) !== abbrev || (await task()).length > 0,
  `${abbrev} → ${await task()}`);

// ═══════════════ ほかの導線も従来どおり ═══════════════
ok('「新しい課題」も残っている', await page.isVisible('#btn-keyer-task'));
const beforeTask = await task();
await page.click('#btn-keyer-task');
await page.waitForTimeout(300);
ok('「新しい課題」も効く', (await task()) !== beforeTask || (await task()).length > 0);

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
