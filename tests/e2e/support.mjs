// CW 交信サポート
//
// デコード済みの文字列から相手の情報を拾うこと、段階に合った返答の
// 候補が出ること、ログ帳へ交信記録つきで登録できること、
// シリアルキーイングの時系列が正しいこと。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.evaluate(() => localStorage.removeItem('cwtraining.logbook.v1'));
await page.reload();
await page.waitForTimeout(600);
await page.click('.tab[data-panel="support"]');
await page.waitForTimeout(200);

const myCall = await page.evaluate(() => window.__cw.settings.callsign);
console.log('自局:', myCall);

// ── CQ を聞いた ───────────────────────────────────
await page.evaluate(() => window.__cw.supportSession.feedRx('CQ CQ CQ DE JR3XYZ JR3XYZ PSE K'));
await page.waitForTimeout(150);

ok('相手のコールが埋まる', await page.inputValue('#sup-dxcall') === 'JR3XYZ',
  await page.inputValue('#sup-dxcall'));
let sugs = await page.$$eval('#sup-suggestions .sug .txt', (els) => els.map((e) => e.textContent));
console.log('候補:', JSON.stringify(sugs));
ok('CQ への応答が最初の候補', sugs[0] === `JR3XYZ DE ${myCall} ${myCall} K`, sugs[0]);

// 候補を選ぶと送信欄に入る
await page.locator('#sup-suggestions .sug').first().click();
ok('候補が送信欄に入る', (await page.inputValue('#sup-tx-text')).includes('JR3XYZ DE'));

// ── 相手が自分を呼び返してきた ────────────────────
await page.evaluate((me) => window.__cw.supportSession.feedRx(
  `${me} DE JR3XYZ GM UR RST 599 599 = NAME HR MIKE MIKE QTH OSAKA OSAKA = HW? ${me} DE JR3XYZ K`), myCall);
await page.waitForTimeout(150);

ok('もらった RST が埋まる', await page.inputValue('#sup-rstr') === '599');
ok('名前が埋まる', await page.inputValue('#sup-name') === 'MIKE');
ok('QTH が埋まる', await page.inputValue('#sup-qth') === 'OSAKA');

sugs = await page.$$eval('#sup-suggestions .sug .lbl', (els) => els.map((e) => e.textContent));
ok('レポートを返す候補が出る', sugs.some((s) => s.includes('レポート')), JSON.stringify(sugs));
await page.screenshot({ path: `${DIR}/su1-fields.png`, fullPage: true });

// ── 5NN は 599 に直して拾う ───────────────────────
const nn = await page.evaluate(() => {
  const s = new window.__cw.SupportSession({ myCall: 'JA1AAA' });
  s.feedRx('JA1AAA DE JH1TST UR 5NN 5NN BK');
  return s.fields.rstR;
});
ok('5NN → 599 に直る', nn === '599', nn);

// ── 送った内容も記録され、送った RST を拾う ────────
await page.evaluate(() => {
  window.__cw.supportSession.noteTx('JR3XYZ DE JA1ABC = R TNX UR RST 579 579 = HW? K');
});
await page.waitForTimeout(150);
const transcript = await page.textContent('#sup-transcript');
ok('受けた内容が記録される', transcript.includes('受: CQ CQ CQ DE JR3XYZ'));
ok('送った内容も記録される', transcript.includes('送: JR3XYZ DE'));

// ── ログ帳へ登録（交信記録つき） ──────────────────
await page.fill('#sup-freq', '7.010');
await page.click('#btn-sup-log');
await page.waitForTimeout(250);
const note = await page.textContent('#sup-log-note');
console.log('登録:', note.trim());
ok('登録の知らせが出る', note.includes('JR3XYZ を登録しました'), note.trim());

const logged = await page.evaluate(() => window.__cw.logEntries.find((e) => e.call === 'JR3XYZ'));
console.log('ログ:', JSON.stringify({ ...logged, transcript: logged?.transcript?.length }));
ok('ログにコールが入る', logged?.call === 'JR3XYZ');
ok('ログに RST が入る', logged?.rstR === '599' && logged?.rstS === '579', `${logged?.rstS}/${logged?.rstR}`);
ok('ログに名前・QTH が入る', logged?.name === 'MIKE' && logged?.qth === 'OSAKA');
ok('周波数からバンドが決まる', logged?.band === '7MHz', logged?.band);
// 続けて届いた受信は 1 行にまとまるので、受（連結済み）+ 送 の 2 行
ok('交信記録が一緒に保存される', (logged?.transcript?.length ?? 0) >= 2, `${logged?.transcript?.length} 行`);

// ログ帳側で「記録」ボタンが出て読めること
await page.click('.tab[data-panel="logbook"]');
await page.waitForTimeout(200);
const row = page.locator('#log-rows tr', { hasText: 'JR3XYZ' });
await row.locator('button[data-act="transcript"]').click();
await page.waitForTimeout(150);
ok('ログ帳から交信記録が読める',
  (await page.textContent('#log-transcript')).includes('CQ CQ CQ DE JR3XYZ'));
await page.screenshot({ path: `${DIR}/su2-logged.png`, fullPage: true });

// ── 次の交信へ（クリア） ──────────────────────────
await page.click('.tab[data-panel="support"]');
await page.click('#btn-sup-reset');
await page.waitForTimeout(150);
ok('情報がクリアされる', await page.inputValue('#sup-dxcall') === '');
ok('記録もクリアされる', (await page.textContent('#sup-transcript')).includes('まだ記録がありません'));

// ── 手直しした情報が登録に使われること ────────────
await page.evaluate(() => window.__cw.supportSession.feedRx('CQ DE JF7ABC JF7ABC K'));
await page.waitForTimeout(150);
await page.fill('#sup-name', 'HANAKO');
await page.dispatchEvent('#sup-name', 'change');
await page.fill('#sup-freq', '14.020');
await page.click('#btn-sup-log');
await page.waitForTimeout(200);
const edited = await page.evaluate(() => window.__cw.logEntries.find((e) => e.call === 'JF7ABC'));
ok('手直しした名前で登録される', edited?.name === 'HANAKO', edited?.name);

// ── 自動応答（実験的・既定はオフ） ────────────────
ok('自動応答の既定はオフ', !(await page.isChecked('#sup-auto')));
await page.click('#btn-sup-reset');
await page.check('#sup-auto');
await page.evaluate((me) => window.__cw.supportSession.feedRx(`${me} DE JQ2AUTO UR 599 599 K`), myCall);
await page.waitForTimeout(300);
const preNote = await page.textContent('#sup-auto-note');
ok('自動応答の予告が出る', preNote.includes('自動応答'), preNote.trim().slice(0, 40));
await page.waitForTimeout(2300);
const autoSent = await page.textContent('#sup-transcript');
ok('自動で返答が送られる', /送: JQ2AUTO DE/.test(autoSent),
  autoSent.split('\n').slice(-2).join(' | '));
await page.evaluate(() => window.__cw.player.stop());
await page.uncheck('#sup-auto');

// ── デコーダーから画面への配線 ────────────────────
// 解読された文字が受信欄へ流れ、語が切れたところで解析へ渡ること
await page.click('#btn-sup-reset');
await page.evaluate(() => {
  for (const ch of 'CQ DE JI1WIRE') {
    if (ch === ' ') window.__cw.supportWordBreak();
    else window.__cw.supportChar(ch);
  }
  window.__cw.supportWordBreak();
});
await page.waitForTimeout(150);
ok('文字が受信欄に流れる', (await page.textContent('#sup-decoded')).includes('CQ DE JI1WIRE'));
ok('語の切れ目で解析に渡る', await page.inputValue('#sup-dxcall') === 'JI1WIRE',
  await page.inputValue('#sup-dxcall'));

// ── 自分のパドルで打つ ────────────────────────────
// 候補を手本として出し、パドルで打った内容を照合して記録に残す
await page.click('#btn-sup-reset');
await page.fill('#sup-tx-text', 'E E');
await page.click('#btn-sup-manual');
await page.waitForTimeout(150);
ok('打つ枠が開く', !(await page.evaluate(() => document.querySelector('#sup-manual').hidden)));
ok('手本が出る', (await page.textContent('#sup-manual-target')) === 'E E');
ok('手本のモールスも出る', (await page.textContent('#sup-manual-morse')).includes('.'));

// 右の打面で E を 2 回打つ（語間を置いて）
const pad = await page.locator('#pw-pad').boundingBox();
const keyOnce = async () => {
  await page.mouse.move(pad.x + pad.width * 0.25, pad.y + pad.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
};
await keyOnce();
await page.waitForTimeout(700);        // 語間
await keyOnce();
await page.waitForTimeout(900);        // 解読の確定を待つ

await page.click('#btn-sup-manual-done');
await page.waitForTimeout(200);
const manualResult = await page.textContent('#sup-manual-result');
console.log('照合:', manualResult.replace(/\s+/g, ' ').trim().slice(0, 60));
ok('照合結果が出る', /100%/.test(manualResult), manualResult.slice(0, 40));
const manualLog = await page.textContent('#sup-transcript');
ok('打った内容が記録に残る', /送: E ?E/.test(manualLog),
  manualLog.split('\n').slice(-1)[0]);

// キーボード（Z）でもサポートタブで打てること
await page.keyboard.down('KeyZ');
await page.waitForTimeout(80);
await page.keyboard.up('KeyZ');
await page.waitForTimeout(900);
ok('サポートタブでも Z で打てる',
  (await page.evaluate(() => window.__cw.keyer.text + window.__cw.keyer.buffer)).trim().length > 0);
await page.evaluate(() => window.__cw.keyer.reset());
await page.click('#btn-sup-manual-close');
ok('閉じられる', await page.evaluate(() => document.querySelector('#sup-manual').hidden));

// ── シリアルキーイングの時系列 ────────────────────
// 実機は無いので、擬似ポートに setSignals の記録を取らせて
// 「E T」= 短点 1・長点 1 の on/off が正しい長さで並ぶことを見る
const serial = await page.evaluate(async () => {
  const { tokenize, computeTiming } = await import('./js/morse.js');
  const cw = window.__cw;
  const sk = new cw.SerialKeyer();
  const log = [];
  sk.port = {
    setSignals: async (sig) => log.push({ t: performance.now(), on: !!(sig.dataTerminalReady ?? sig.requestToSend) }),
    close: async () => {},
  };
  const timeline = cw.keyTimeline(tokenize('E T'), computeTiming(20, 20));
  await sk.playTimeline(timeline);
  // 変化のあった点だけ取り出す
  const edges = log.filter((e, i) => i === 0 || e.on !== log[i - 1].on);
  return { timeline, edges: edges.map((e, i) => ({ on: e.on, dt: i ? e.t - edges[i - 1].t : 0 })) };
});
console.log('シリアル:', JSON.stringify(serial.edges.map((e) => ({ on: e.on, dt: Math.round(e.dt) }))));
ok('時系列は on→off→on→off', serial.edges.map((e) => e.on).join(',') === 'true,false,true,false',
  serial.edges.map((e) => e.on).join(','));
const ditMs = serial.edges[1]?.dt ?? 0;
const dahMs = serial.edges[3]?.dt ?? 0;
ok('短点はおよそ 60ms', Math.abs(ditMs - 60) < 25, `${Math.round(ditMs)}ms`);
ok('長点はおよそ 180ms', Math.abs(dahMs - 180) < 35, `${Math.round(dahMs)}ms`);
ok('Web Serial の対応可否を答えられる', typeof (await page.evaluate(() => window.__cw.SerialKeyer.supported)) === 'boolean');

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
