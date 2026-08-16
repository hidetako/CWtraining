// ログ帳（本番の交信記録）
//
// 登録・交信歴の補完・編集・削除・絞り込み・JCC/JCG 検索・
// ADIF / CSV の往復・集計・保存の永続まで、台帳の一連の機能を通しで見る。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('dialog', (d) => d.accept());

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.evaluate(() => localStorage.removeItem('cwtraining.logbook.v1'));
await page.reload();
await page.waitForTimeout(600);
await page.click('.tab[data-panel="logbook"]');

// ── JCC / JCG 検索（同梱データ） ──────────────────
const jcc = (q) => page.evaluate((x) => window.__cw.jccSearch(x), q);

const sapporo = await jcc('0101');
ok('番号 0101 で札幌が引ける', sapporo[0]?.name === '札幌' && sapporo[0]?.kind === 'JCC',
  JSON.stringify(sapporo[0]));
const byName = await jcc('札幌');
ok('名前「札幌」で 0101 が引ける', byName.some((h) => h.code === '0101'), JSON.stringify(byName.slice(0, 2)));
const byRoman = await jcc('sapporo');
ok('ローマ字でも引ける', byRoman.some((h) => h.code === '0101'), JSON.stringify(byRoman.slice(0, 2)));
const pref = await jcc('北海道');
ok('都道府県番号も引ける', pref.some((h) => h.code === '01' && h.kind === '都道府県'),
  JSON.stringify(pref.slice(0, 2)));
const ku = await jcc('010101');
ok('区番号も引ける', /札幌市中央区/.test(ku[0]?.name || '') && ku[0]?.kind === '区',
  JSON.stringify(ku[0]));
const jcg = await jcc('01001');
ok('JCG（郡）も引ける', jcg[0]?.code === '01001' && jcg[0]?.kind === 'JCG', JSON.stringify(jcg[0]));

// ── バンドの自動判定 ──────────────────────────────
const band = (f) => page.evaluate((x) => window.__cw.bandFromFreq(x), f);
ok('7.010 → 7MHz', await band('7.010') === '7MHz');
ok('14.05 → 14MHz', await band('14.05') === '14MHz');
ok('430.1 → 430MHz', await band('430.1') === '430MHz');
ok('範囲外は空', await band('99.9') === '');

// ── 登録 ──────────────────────────────────────────
await page.fill('#log-call', 'JA1TEST');
await page.fill('#log-freq', '7.010');
await page.fill('#log-rsts', '599');
await page.fill('#log-rstr', '579');
await page.fill('#log-name', 'TARO');
await page.fill('#log-qth', 'SAPPORO');
await page.fill('#log-jcc', '0101');
await page.click('#btn-log-add');
await page.waitForTimeout(200);

ok('周波数からバンドが出る', (await page.textContent('#log-band-out')).includes('7MHz'));
ok('一覧に 1 件出る', await page.locator('#log-rows tr').count() === 1);
ok('行にコールが出る', (await page.textContent('#log-rows')).includes('JA1TEST'));
ok('登録後はコール欄が空に戻る', await page.inputValue('#log-call') === '');
ok('周波数は残る（連続登録のため）', await page.inputValue('#log-freq') === '7.010');

// ── 交信歴と補完 ──────────────────────────────────
await page.fill('#log-call', 'JA1TEST');
await page.dispatchEvent('#log-call', 'change');
await page.waitForTimeout(150);
const hist = await page.textContent('#log-history');
console.log('交信歴:', hist.trim());
ok('交信歴が出る', /1 回交信/.test(hist), hist.trim());
ok('名前が前回の値で埋まる', await page.inputValue('#log-name') === 'TARO');
ok('QTH も埋まる', await page.inputValue('#log-qth') === 'SAPPORO');
ok('JCC も埋まる', await page.inputValue('#log-jcc') === '0101');
await page.screenshot({ path: `${DIR}/lb1-history.png`, fullPage: true });

// 2 件目を登録（別バンド）
await page.fill('#log-freq', '14.020');
await page.click('#btn-log-add');
await page.waitForTimeout(200);
ok('2 件になる', await page.locator('#log-rows tr').count() === 2);

// ── JCC 検索の画面 ────────────────────────────────
await page.fill('#jcc-query', '札幌');
await page.waitForTimeout(200);
ok('検索結果が出る', await page.locator('#jcc-results .jcc-hit').count() >= 1);
await page.fill('#log-jcc', '');
await page.fill('#log-qth', '');
await page.locator('#jcc-results .jcc-hit', { hasText: 'JCC' }).first().click();
ok('選ぶと JCC 欄に入る', await page.inputValue('#log-jcc') === '0101',
  await page.inputValue('#log-jcc'));
ok('QTH が空なら市名も入る', await page.inputValue('#log-qth') === '札幌',
  await page.inputValue('#log-qth'));

// ── 絞り込み ──────────────────────────────────────
await page.selectOption('#log-filter-band', '7MHz');
await page.waitForTimeout(150);
ok('バンドで絞れる', await page.locator('#log-rows tr').count() === 1);
await page.selectOption('#log-filter-band', '');
await page.fill('#log-search', 'TARO');
await page.waitForTimeout(150);
ok('名前でも探せる', await page.locator('#log-rows tr').count() === 2);
await page.fill('#log-search', '');
await page.waitForTimeout(150);

// ── 編集 ──────────────────────────────────────────
await page.locator('#log-rows tr').first().locator('button[data-act="edit"]').click();
await page.waitForTimeout(150);
ok('編集でフォームに入る', await page.inputValue('#log-call') === 'JA1TEST');
ok('ボタンが「更新する」になる', (await page.textContent('#btn-log-add')).includes('更新'));
await page.fill('#log-rstr', '559');
await page.click('#btn-log-add');
await page.waitForTimeout(200);
ok('更新が一覧に反映される', (await page.textContent('#log-rows')).includes('599/559'));

// ── 時刻表示の切り替え ────────────────────────────
await page.evaluate(() => window.__cw.addLogEntry({
  ts: '2026-01-01T00:00:00.000Z', call: 'JA9TZTEST', freq: '7.010', rstS: '599', rstR: '599',
}));
await page.waitForTimeout(150);
let rowText = await page.locator('#log-rows tr', { hasText: 'JA9TZTEST' }).textContent();
ok('既定は JST（UTC+9）で表示', rowText.includes('2026-01-01 09:00'), rowText.slice(0, 24));
await page.click('#btn-log-tz');
await page.waitForTimeout(150);
rowText = await page.locator('#log-rows tr', { hasText: 'JA9TZTEST' }).textContent();
ok('切り替えると UTC 表示', rowText.includes('2026-01-01 00:00'), rowText.slice(0, 24));
await page.click('#btn-log-tz');

// ── ADIF 往復 ─────────────────────────────────────
const adifCheck = await page.evaluate(() => {
  const cw = window.__cw;
  const text = cw.toAdif(cw.logEntries);
  const back = cw.fromAdif(text);
  const src = cw.logEntries[0];
  const dst = back[0];
  return {
    text: text.slice(0, 400),
    count: back.length === cw.logEntries.length,
    // ADIF の時刻は秒まで。ミリ秒が落ちるのは形式どおりなので秒精度で比べる
    fields: dst.call === src.call && dst.band === src.band && dst.rstR === src.rstR
      && dst.jcc === src.jcc && dst.ts.slice(0, 19) === src.ts.slice(0, 19),
    hasEoh: /<EOH>/.test(text) && /<EOR>/.test(text),
    bandEnum: /<BAND:3>40m/.test(text),
  };
});
console.log('ADIF 冒頭:', adifCheck.text.split('\n').slice(0, 4).join(' | '));
ok('ADIF に EOH / EOR がある', adifCheck.hasEoh);
ok('ADIF のバンドは 40m 表記', adifCheck.bandEnum);
ok('ADIF 往復で件数が保たれる', adifCheck.count);
ok('ADIF 往復で内容が保たれる', adifCheck.fields);

// ── CSV 往復（交信記録つき） ──────────────────────
const csvCheck = await page.evaluate(() => {
  const cw = window.__cw;
  cw.addLogEntry({
    call: 'JR5CSV', freq: '7.026', rstS: '599', rstR: '599', notes: '備考,カンマ入り',
    transcript: [{ at: '12:00:01', dir: 'rx', text: 'CQ CQ DE JR5CSV' },
                 { at: '12:00:20', dir: 'tx', text: 'JR5CSV DE JA1AAA K' }],
  });
  const text = cw.toCsv(cw.logEntries);
  const back = cw.fromCsv(text);
  const src = cw.logEntries.find((e) => e.call === 'JR5CSV');
  const dst = back.find((e) => e.call === 'JR5CSV');
  return {
    count: back.length === cw.logEntries.length,
    notes: dst?.notes === src.notes,
    transcript: JSON.stringify(dst?.transcript) === JSON.stringify(src.transcript),
  };
});
ok('CSV 往復で件数が保たれる', csvCheck.count);
ok('カンマ入りの備考も往復できる', csvCheck.notes);
ok('交信記録も往復できる', csvCheck.transcript);

// ── 交信記録の表示 ────────────────────────────────
await page.waitForTimeout(150);
const csvRow = page.locator('#log-rows tr', { hasText: 'JR5CSV' });
await csvRow.locator('button[data-act="transcript"]').click();
await page.waitForTimeout(150);
const transcript = await page.textContent('#log-transcript');
ok('交信記録が開ける', transcript.includes('CQ CQ DE JR5CSV'), transcript.slice(0, 60));
ok('送受が区別される', await page.locator('#log-transcript .tx').count() === 1);
await page.screenshot({ path: `${DIR}/lb2-transcript.png`, fullPage: true });

// ── 集計 ──────────────────────────────────────────
const stats = await page.textContent('#log-stats');
console.log('集計:', stats.replace(/\s+/g, ' ').trim().slice(0, 120));
ok('交信数が出る', /4/.test(await page.locator('#log-stats .stat .n').first().textContent()));
ok('JCC ワークドが数えられる', await page.evaluate(() => {
  const s = window.__cw.logStats(window.__cw.logEntries);
  return s.jcc === 1 && s.calls === 3;   // JA1TEST は 2 交信で 1 局
}));

// ── 永続 ──────────────────────────────────────────
await page.reload();
await page.waitForTimeout(600);
await page.click('.tab[data-panel="logbook"]');
await page.waitForTimeout(150);
ok('再読み込みしても残っている', await page.locator('#log-rows tr').count() === 4);

// ── 削除 ──────────────────────────────────────────
await page.locator('#log-rows tr', { hasText: 'JA9TZTEST' }).locator('button[data-act="delete"]').click();
await page.waitForTimeout(250);
ok('削除できる', await page.locator('#log-rows tr').count() === 3);
ok('削除も保存される', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('cwtraining.logbook.v1')).entries.length === 3));

// ── 現在地から JCC を探す ─────────────────────────
// 位置情報を大阪駅に固定して、近い順の候補と区の選択を確かめる
const geoCtx = await browser.newContext({
  viewport: { width: 1500, height: 1100 },
  geolocation: { latitude: 34.702, longitude: 135.496 },
  permissions: ['geolocation'],
});
const gp = await geoCtx.newPage();
gp.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await gp.goto(`${BASE}/index.html`);
await gp.waitForTimeout(600);
await gp.click('.tab[data-panel="logbook"]');

const near = await gp.evaluate(() => window.__cw.nearestJcc(34.702, 135.496, 4));
console.log('大阪駅の近傍:', JSON.stringify(near.map((h) => `${h.code} ${h.name} ${h.km}km`)));
ok('現在地の最寄りが大阪市（2501）', near[0]?.code === '2501', JSON.stringify(near[0]));
ok('距離が付く', typeof near[0]?.km === 'number' && near[0].km < 5, `${near[0]?.km}km`);
ok('政令市には区の候補が付く', (near[0]?.wards?.length ?? 0) >= 20, `${near[0]?.wards?.length} 区`);

const nearSap = await gp.evaluate(() => window.__cw.nearestJcc(43.062, 141.354, 1));
ok('札幌なら 0101', nearSap[0]?.code === '0101', JSON.stringify(nearSap[0]));
const shinjuku = await gp.evaluate(() => window.__cw.nearestJcc(35.690, 139.700, 1));
ok('新宿なら東京特別区の区番号', shinjuku[0]?.code === '100104', JSON.stringify(shinjuku[0]));
const ashoro = await gp.evaluate(() => window.__cw.nearestJcc(43.25, 143.55, 1));
ok('郡部なら JCG（足寄郡 01002）', ashoro[0]?.code === '01002', JSON.stringify(ashoro[0]));

await gp.click('#btn-jcc-here');
await gp.waitForFunction(() => document.querySelectorAll('#jcc-results .jcc-hit').length > 0,
  null, { timeout: 8000 });
const noteText = await gp.textContent('#jcc-here-note');
ok('候補の但し書きが出る', noteText.includes('近い順'), noteText.slice(0, 40));
const firstHit = await gp.locator('#jcc-results .jcc-hit').first().textContent();
ok('画面の先頭候補も大阪市', firstHit.includes('2501') && firstHit.includes('大阪'), firstHit.trim().slice(0, 40));

// 区の行を選ぶと区番号が入る
await gp.locator('#jcc-results .jcc-ward', { hasText: '北区' }).first().click();
ok('区を選ぶと区番号が入る', await gp.inputValue('#log-jcc') === '250101',
  await gp.inputValue('#log-jcc'));
await gp.screenshot({ path: `${DIR}/lb3-geolocation.png`, fullPage: true });
await geoCtx.close();

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
