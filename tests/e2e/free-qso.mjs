// 模擬交信（自由に打つ）
//
// 台本なしで、相手局がこちらの打った内容に反応すること。
// ・CQ を出す側・応答する側の両方で、呼び出しから 73 まで通ること
// ・模範解答が毎回出て、そのとおりでなくても流れに合わせて返ること
// ・レポートを落とせば聞き返され、QRS なら遅くなり、早めの 73 でも締められること
// ・パイルアップで複数局が呼び、部分一致なら訂正されること
// ・相談で状況と次の一手が出ること
// ・Claude は既定で使わず、使うときも要点を検査し、失敗しても交信が止まらないこと
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// 外へ出る要求は全部見張る。Claude を使わない設定なら 1 件も無いこと
const outbound = [];
page.on('request', (r) => { if (/api\.anthropic\.com/.test(r.url())) outbound.push(r.url()); });

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(600);

// ── 相手局（エンジン）だけを、音を鳴らさずに通す ────────
const engine = await page.evaluate(() => {
  const { MockQso } = window.__cw;
  const me = { callsign: 'JA1ABC', name: 'TARO', qth: 'TOKYO', rig: 'IC-7300', pwr: '50W', ant: 'DP' };
  const out = {};

  // CQ を出す側: 型どおり
  let q = new MockQso({ me, mode: 'cq', pileup: 'none', reaction: 'normal', dxWpm: 18 });
  q.start();
  const e0 = q.expected();
  let r = q.receive('cq cq cq de ja1abc ja1abc k');           // 小文字で
  out.cqCallers = r.dx.map((d) => d.kind);
  const call = q.callers[0].callsign;
  out.pickupExpected = q.expected().text;                      // 相手のコールは伏せる
  r = q.receive(`${call} DE JA1ABC UR RST 599 599 NAME TARO QTH TOKYO HW? K`);
  out.afterEx1 = { phase: q.phase, got: r.feedback.got, dxKinds: r.dx.map((d) => d.kind), dxText: r.dx[0]?.text };
  r = q.receive(q.expected().text);
  out.afterEx2 = { phase: q.phase, dxKinds: r.dx.map((d) => d.kind) };
  r = q.receive(q.expected().text);
  out.end = { phase: q.phase, done: q.done, dxKinds: r.dx.map((d) => d.kind), log: q.toLogFields() };
  out.e0 = e0;

  // レポートを落とす → 聞き返し → 名前だけ返す（既に受け取った分は覚えている）
  q = new MockQso({ me, mode: 'cq', pileup: 'none', reaction: 'nameQuery' });
  q.start(); q.receive('CQ CQ DE JA1ABC JA1ABC K');
  const c2 = q.callers[0].callsign;
  r = q.receive(`${c2} DE JA1ABC UR RST 599 599 QTH TOKYO K`);   // 名前なし
  out.missingName = { missing: r.feedback.missing, kind: r.dx[0]?.kind, phase: q.phase };
  r = q.receive('NAME TARO TARO K');
  out.afterName = { phase: q.phase, kind: r.dx[0]?.kind, heard: { ...q.heard } };

  // 応答する側: QRS → 遅くなる、早めの 73 → 締め
  q = new MockQso({ me, mode: 'answer', pileup: 'none', reaction: 'normal', dxWpm: 20 });
  const first = q.start();
  out.answerFirst = first.map((d) => d.kind);
  r = q.receive(`${q.dxCall} DE JA1ABC JA1ABC K`);
  out.answerCalled = { phase: q.phase, kind: r.dx[0]?.kind };
  r = q.receive('QRS PSE QRS');
  out.qrs = { wpm: q.dxWpm, repeated: r.dx.map((d) => d.kind) };
  r = q.receive(`${q.dxCall} DE JA1ABC R R TNX 73 <SK>`);
  out.early73 = { phase: q.phase, kind: r.dx[0]?.kind, sk: /<SK>/.test(r.dx[0]?.text || '') };
  r = q.receive(`${q.dxCall} DE JA1ABC 73 <SK>`);
  out.early73Done = q.done;

  // パイルアップ: 4 局が呼ぶ。取り違えたら訂正、正しく取れば交信相手になる
  q = new MockQso({ me, mode: 'cq', pileup: 'big', reaction: 'normal' });
  q.start();
  r = q.receive('CQ CQ CQ DE JA1ABC JA1ABC K');
  out.pileup = { callers: r.dx.length, together: r.dx.every((d) => d.together), distinctPitch: new Set(r.dx.map((d) => d.station.offset)).size };
  const target = q.callers[2].callsign;
  // 末尾を必ず違う文字にする（元が X で終わっていると同じコールになってしまう）
  const wrongTail = target.endsWith('X') ? 'Y' : 'X';
  r = q.receive(`${target.slice(0, -1)}${wrongTail} DE JA1ABC K`);
  out.partial = { kind: r.dx[0]?.kind, from: r.dx[0]?.station.callsign === target, dxSet: !!q.dxCall };
  r = q.receive(`${target} DE JA1ABC UR RST 579 579 NAME TARO QTH TOKYO K`);
  out.picked = { dx: q.dxCall === target, phase: q.phase };

  // 応答する側のパイルアップ: 最初は一部しか取ってもらえない
  q = new MockQso({ me, mode: 'answer', pileup: 'small', reaction: 'normal' });
  q.start();
  r = q.receive(`${q.dxCall} DE JA1ABC JA1ABC K`);
  out.answerPileup = { kind: r.dx[0]?.kind, text: r.dx[0]?.text };
  r = q.receive(`${q.dxCall} DE JA1ABC JA1ABC K`);
  out.answerPileup2 = { kind: r.dx[0]?.kind };

  // 相談
  q = new MockQso({ me, mode: 'cq', pileup: 'none', reaction: 'normal' });
  q.start();
  out.advice = q.advise('名前が聞き取れなかった');

  // 仕様の突き合わせで見つかった不具合の再発防止
  // HW? で終わる送信を「もう一度」と取り違えない
  q = new MockQso({ me, mode: 'cq', pileup: 'none', reaction: 'nameQuery' });
  q.start(); q.receive('CQ CQ DE JA1ABC JA1ABC K');
  const ch = q.callers[0].callsign;
  q.receive(`${ch} DE JA1ABC UR RST 599 599 QTH TOKYO K`);              // 名前なし → 聞き返し
  r = q.receive('NAME TARO TARO HW?');
  out.hwq = { phase: q.phase, kind: r.dx[0]?.kind, got: r.feedback.got };
  // 応答する側の第 2 交換: 模範解答どおりで RST・名前・QTH が伝わり、締めへ
  q = new MockQso({ me, mode: 'answer', pileup: 'none', reaction: 'normal' });
  q.start(); q.receive(`${q.dxCall} DE JA1ABC JA1ABC K`);
  const ex2exp = q.expected().text;
  r = q.receive(ex2exp);
  out.answerEx2 = { hasNameQth: /NAME TARO TARO/.test(ex2exp) && /QTH TOKYO TOKYO/.test(ex2exp), phase: q.phase, kind: r.dx[0]?.kind,
    heard: { ...q.heard }, missing: r.feedback.missing, early: r.feedback.notes.some((n) => /早め|73 を送ったので/.test(n)) };
  // 応答する側で RST を落として 73 → 聞き返される。中身の無い 73 <SK> → 締め
  q = new MockQso({ me, mode: 'answer', pileup: 'none', reaction: 'normal' });
  q.start(); q.receive(`${q.dxCall} DE JA1ABC JA1ABC K`);
  r = q.receive('R R FB RIG IC-7300 ANT DP TNX 73 K');
  out.answerNoRst = { kind: r.dx[0]?.kind, phase: q.phase };
  r = q.receive(`${q.dxCall} DE JA1ABC SRI QRL 73 <SK>`);
  out.bare73 = { kind: r.dx[0]?.kind, phase: q.phase };

  // 「GUD CPI AGN」の AGN は繰り返しの頼みではない（公開版の検証で見つかった）
  q = new MockQso({ me, mode: 'cq', pileup: 'none', reaction: 'normal' });
  q.start(); q.receive('CQ CQ DE JA1ABC JA1ABC K');
  const ca = q.callers[0].callsign;
  q.receive(`${ca} DE JA1ABC UR RST 599 599 NAME TARO QTH TOKYO HW? K`);
  r = q.receive(`${ca} DE JA1ABC = R R FB GUD CPI AGN = RIG HR IC-7300 ES PWR 50W = ANT DP = TNX FER QSO ES 73 = ${ca} DE JA1ABC K`);
  out.gudCpiAgn = { phase: q.phase, kind: r.dx[0]?.kind };
  r = new MockQso({ me, mode: 'cq' });
  out.pseAgn = { agn: window.__cw.parseSend('SRI QRM PSE AGN K').agn, bare: window.__cw.parseSend('GUD CPI AGN K').agn, q: window.__cw.parseSend('NAME AGN?').agn };

  // BK: こちらが BK で締めれば相手も BK 調。3 往復に 1 回は識別。K で戻る。締めは <SK>
  q = new MockQso({ me, mode: 'cq', pileup: 'none', reaction: 'nameQuery' });
  q.start(); q.receive('CQ CQ DE JA1ABC JA1ABC K');
  const cb = q.callers[0].callsign;
  r = q.receive(`${cb} DE JA1ABC UR RST 599 599 BK`);                 // RST だけ・BK → 名前を聞き返される
  const bk1 = r.dx[0];
  const bkExp = q.expected();
  r = q.receive('NAME TARO TARO BK');                                  // → 第 2 交換（BK 調）
  const bk2 = r.dx[0];
  r = q.receive('PSE AGN BK');                                         // → 繰り返し（3 往復目、識別付き）
  const bk3 = r.dx[0];
  const bkAdvice = q.advise();
  r = q.receive(`R R FB RIG IC-7300 ANT DP 73 ${cb} DE JA1ABC K`);    // K で戻す
  const back = r.dx[0];
  out.bk = {
    first: bk1.text, firstKind: bk1.kind, firstNoPrefix: !bk1.text.startsWith('JA1ABC DE'), firstEndsBk: / BK$/.test(bk1.text),
    exp: bkExp.text, expEndsBk: / BK$/.test(bkExp.text), expNoPrefix: !bkExp.text.startsWith(cb),
    second: bk2.text, secondNoPrefix: !bk2.text.startsWith('JA1ABC DE'),
    third: bk3.text, thirdIdentifies: bk3.text.startsWith(`JA1ABC DE ${cb}`) && / BK$/.test(bk3.text),
    advice: bkAdvice.some((l) => /BK/.test(l)),
    back: back.text, backKind: back.kind, backSk: /<SK>$/.test(back.text), bkOff: q.bkMode === false,
  };
  return out;
});
console.log('エンジン:', JSON.stringify(engine).slice(0, 400));
ok('CQ を出すと相手が呼んでくる', engine.cqCallers.join() === 'call', engine.cqCallers.join());
ok('模範解答は CQ の型', /^CQ CQ CQ DE JA1ABC JA1ABC JA1ABC PSE K$/.test(engine.e0.text), engine.e0.text);
ok('呼んできた局のコールは模範解答で伏せる', /？？？ DE JA1ABC/.test(engine.pickupExpected), engine.pickupExpected.slice(0, 40));
ok('レポートを送ると相手から第 2 交換が来る', engine.afterEx1.phase === 'ex2' && engine.afterEx1.dxKinds.join() === 'ex2'
  && /UR RST (\d{3}|5NN)/.test(engine.afterEx1.dxText) && /NAME [A-Z]+ [A-Z]+/.test(engine.afterEx1.dxText), JSON.stringify(engine.afterEx1));
ok('了解と設備を送ると相手が締めに入る', engine.afterEx2.phase === 'close' && engine.afterEx2.dxKinds.join() === 'close', JSON.stringify(engine.afterEx2));
ok('73 と <SK> で交信が終わる', engine.end.done && engine.end.dxKinds.join() === 'bye', JSON.stringify(engine.end));
ok('ログ帳へ渡せる形になる', engine.end.log.call && engine.end.log.rstS === '599' && engine.end.log.transcript.length >= 6, JSON.stringify(engine.end.log).slice(0, 120));
ok('名前を落とすと名前だけ聞き返される', engine.missingName.missing.includes('NAME') && engine.missingName.kind === 'nameQuery', JSON.stringify(engine.missingName));
ok('名前だけ返せば先へ進む（RST は覚えている）', engine.afterName.phase === 'ex2' && engine.afterName.kind === 'ex2' && engine.afterName.heard.rst === '599', JSON.stringify(engine.afterName));
ok('応答する側は相手の CQ から始まる', engine.answerFirst.join() === 'cq');
ok('呼ぶと相手からレポートが来る', engine.answerCalled.kind === 'ex1' && engine.answerCalled.phase === 'ex2', JSON.stringify(engine.answerCalled));
ok('QRS で相手が遅くなり、繰り返す', engine.qrs.wpm === 16 && engine.qrs.repeated.join() === 'ex1', JSON.stringify(engine.qrs));
ok('早めの 73 でも相手は締めに合わせる', engine.early73.kind === 'close' && engine.early73.sk && engine.early73Done, JSON.stringify(engine.early73));
ok('パイルアップは複数局が同時に呼ぶ', engine.pileup.callers === 4 && engine.pileup.together && engine.pileup.distinctPitch >= 3, JSON.stringify(engine.pileup));
ok('取り違えたコールはその局が訂正する', engine.partial.kind === 'correct' && engine.partial.from && !engine.partial.dxSet, JSON.stringify(engine.partial));
ok('正しく取れば交信相手になる', engine.picked.dx && engine.picked.phase === 'ex2', JSON.stringify(engine.picked));
ok('応答側のパイルアップでは最初は一部しか取ってもらえない', engine.answerPileup.kind === 'partial' && /JA1\?/.test(engine.answerPileup.text) && engine.answerPileup2.kind === 'ex1', JSON.stringify(engine.answerPileup));
ok('HW? で終わっても「もう一度」とは取らず、名前を受け取る', engine.hwq.phase === 'ex2' && engine.hwq.kind === 'ex2' && engine.hwq.got.includes('NAME TARO'), JSON.stringify(engine.hwq));
ok('応答側の第 2 交換の模範解答に RST・名前・QTH が入る', engine.answerEx2.hasNameQth);
ok('模範解答どおりなら全部伝わって締めへ（早めの 73 扱いにしない）', engine.answerEx2.phase === 'close' && engine.answerEx2.kind === 'close'
  && engine.answerEx2.heard.rst && engine.answerEx2.heard.name === 'TARO' && engine.answerEx2.heard.qth === 'TOKYO' && !engine.answerEx2.early && engine.answerEx2.missing.length === 0, JSON.stringify(engine.answerEx2));
ok('応答側で RST を落とせば 73 があっても聞き返される', engine.answerNoRst.kind === 'rstQuery' && engine.answerNoRst.phase === 'ex2', JSON.stringify(engine.answerNoRst));
ok('中身の無い 73 <SK> は締めとして受ける', engine.bare73.kind === 'close', JSON.stringify(engine.bare73));
ok('GUD CPI AGN の AGN では繰り返さず、締めに入る', engine.gudCpiAgn.phase === 'close' && engine.gudCpiAgn.kind === 'close', JSON.stringify(engine.gudCpiAgn));
ok('PSE AGN と AGN? は頼み、AGN 単独は頼みではない', engine.pseAgn.agn && engine.pseAgn.q && !engine.pseAgn.bare, JSON.stringify(engine.pseAgn));
console.log('BK:', JSON.stringify(engine.bk).slice(0, 400));
ok('BK で締めると相手は前置きなしで BK 締め', engine.bk.firstNoPrefix && engine.bk.firstEndsBk && engine.bk.firstKind === 'nameQuery', engine.bk.first);
ok('模範解答も BK 調になる', engine.bk.expEndsBk && engine.bk.expNoPrefix, engine.bk.exp);
ok('2 往復目も BK 調', engine.bk.secondNoPrefix && / BK$/.test(engine.bk.second), engine.bk.second);
ok('3 往復目は識別を頭に付ける', engine.bk.thirdIdentifies, engine.bk.third);
ok('相談に BK の説明が出る', engine.bk.advice);
ok('K で締め直せば通常の型に戻り、締めは <SK>', engine.bk.backKind === 'close' && engine.bk.backSk && engine.bk.bkOff, engine.bk.back);
ok('相談で状況・模範解答・コツが出る', engine.advice.some((l) => /段階/.test(l)) && engine.advice.some((l) => /次に送る例/.test(l)) && engine.advice.some((l) => /AGN\?/.test(l)), JSON.stringify(engine.advice).slice(0, 160));

// ── 画面から通しで（CQ を出す側） ──────────────────
await page.click('.tab[data-panel="qso"]');
await page.locator('.style-option[data-style="free"]').click();
await page.selectOption('#qso-mode', 'cq');
await page.selectOption('#free-pileup', 'none');
await page.selectOption('#free-reaction', 'normal');
await page.locator('#free-dxwpm').evaluate((el) => { el.value = '22'; el.dispatchEvent(new Event('input', { bubbles: true })); });
ok('自由に打つでは速度とパイルアップの設定が出る', await page.locator('#free-setup-row').isVisible() && await page.locator('#qso-length').isHidden());
ok('Claude は既定で使わない', (await page.textContent('#free-claude-note')).includes('使わない'));
await page.click('#btn-qso-start');
await page.waitForTimeout(400);
const state = () => page.evaluate(() => {
  const f = window.__cw.freeState;
  return { phase: f.qso?.phase, busy: f.busy, dxWpm: f.qso?.dxWpm, state: document.querySelector('#free-rx-state')?.textContent };
});
let s = await state();
ok('CQ を出す側は自分の番から始まる', s.phase === 'myCq' && !s.busy && s.dxWpm === 22, JSON.stringify(s));
ok('模範解答が出ている', /CQ CQ CQ DE/.test(await page.textContent('#free-expected')));
ok('打つ欄がある（キーボード Z/X も効く欄）', await page.locator('#qso-keyed').count() === 1);

await page.evaluate(() => { window.__cw.sendFree('CQ CQ CQ DE JA1ABC JA1ABC K'); });
await page.waitForTimeout(300);
s = await state();
ok('送ると相手が呼んでくる（受信中）', s.phase === 'pickup' && s.busy && s.state === '受信中…', JSON.stringify(s));
ok('受信中は送信ボタンが押せない', await page.locator('#btn-free-send').isDisabled());
ok('受信内容は既定で伏せる', await page.locator('#free-rx-text').isHidden() && (await page.textContent('#qso-log')).includes('（受信）'));
await page.screenshot({ path: `${DIR}/free-pickup.png`, fullPage: true });
await page.waitForFunction(() => !window.__cw.freeState.busy, null, { timeout: 60000 });
ok('鳴り終わると自分の番になる', (await state()).state === 'あなたの番です');
await page.click('#btn-free-reveal');
const revealed = await page.textContent('#free-rx-text');
ok('内容を見るで相手の送信が読める', /JA1ABC DE [A-Z0-9]+/.test(revealed), revealed.slice(0, 40));

// 聞き直しは同じ送信を鳴らすだけで、ログには足さない
const rowsBefore = await page.locator('#qso-log .log-entry').count();
await page.click('#btn-free-relisten');
await page.waitForTimeout(300);
ok('聞き直しでログが増えない', (await page.locator('#qso-log .log-entry').count()) === rowsBefore);
await page.waitForFunction(() => !window.__cw.freeState.busy, null, { timeout: 60000 });

// 打ち終わりの自動送信: K で締めて手を止めれば、押さなくても相手が返事をする。
// キーヤーの解読結果を直接置いて、打ち終わった状態を作る
const call0 = await page.evaluate(() => window.__cw.freeState.qso.callers[0].callsign);
await page.evaluate((c) => {
  const k = window.__cw.keyer;
  k.text = `${c} DE JA1ABC UR RST 599 599 NAME TARO QTH TOKYO HW?`;   // まだ締めていない
  k.dispatchEvent(new CustomEvent('update'));
}, call0);
await page.waitForTimeout(2200);
let phaseNow = await page.evaluate(() => window.__cw.freeState.qso.phase);
ok('締めの符号が無ければ勝手に送らない', phaseNow === 'pickup' && !(await page.evaluate(() => window.__cw.freeState.busy)), phaseNow);
await page.evaluate(() => {
  const k = window.__cw.keyer;
  k.text += ' K';                                                   // K で締めた
  k.dispatchEvent(new CustomEvent('update'));
});
await page.waitForTimeout(300);
ok('締めを受けたことを知らせる', await page.locator('#free-send-note').isVisible() && /送信します/.test(await page.textContent('#free-send-note')));
await page.waitForTimeout(2000);
phaseNow = await page.evaluate(() => window.__cw.freeState.qso.phase);
ok('K で締めて手を止めると自動で送信される', phaseNow === 'ex2' && (await page.evaluate(() => window.__cw.freeState.busy)), phaseNow);
await page.waitForFunction(() => !window.__cw.freeState.busy, null, { timeout: 90000 });

// Enter でも送れる
await page.evaluate(() => {
  const k = window.__cw.keyer;
  k.text = 'R R FB TNX = RIG IC-7300 = 73 K';
  k.dispatchEvent(new CustomEvent('update'));
});
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
phaseNow = await page.evaluate(() => window.__cw.freeState.qso.phase);
ok('Enter でも送信できる', phaseNow === 'close', phaseNow);
await page.waitForFunction(() => !window.__cw.freeState.busy, null, { timeout: 90000 });
await page.evaluate(() => { const k = window.__cw.keyer; k.text = 'TU 73 <SK>'; k.dispatchEvent(new CustomEvent('update')); });
await page.waitForTimeout(2200);
ok('<SK> で締めても自動で送信され、交信が終わる', await page.evaluate(() => window.__cw.freeState.qso?.done === true));
await page.waitForFunction(() => !window.__cw.freeState.busy, null, { timeout: 60000 });
await page.waitForTimeout(300);
ok('自動送信で終えてもまとめが出る', /交信終了/.test(await page.textContent('#qso-turn')));

// もう一局、こんどはボタンで進める流れ（相談・伏せ字・ログ帳）
await page.click('#btn-free-again');
await page.waitForTimeout(300);
await page.evaluate(() => { window.__cw.sendFree('CQ CQ CQ DE JA1ABC JA1ABC K'); });
await page.waitForFunction(() => !window.__cw.freeState.busy, null, { timeout: 60000 });

// 相談
await page.click('#btn-free-advise');
await page.waitForTimeout(200);
const advice = (await page.textContent('#free-advice')).replace(/\s+/g, ' ');
ok('相談すると状況と次の一手が出る', /段階/.test(advice) && /次に送る例/.test(advice) && /規則で答えています/.test(advice), advice.slice(0, 80));

// 模範解答と違う内容で送っても、流れに合わせて返す
const call = await page.evaluate(() => window.__cw.freeState.qso.callers[0].callsign);
const perCharBefore = await page.evaluate(() => JSON.stringify(window.__cw.stats.keyPerChar || {}));
await page.evaluate((c) => { window.__cw.sendFree(`${c} DE JA1ABC GA OM UR RST 559 559 QTH TOKYO K`); }, call);   // 名前なし・順不同（ボタン相当）
await page.waitForTimeout(300);
const fb = (await page.textContent('#free-feedback')).replace(/\s+/g, ' ');
ok('相手が受け取った内容と抜けが出る', /✓ RST 559/.test(fb) && /抜け: NAME/.test(fb), fb.slice(0, 120));
ok('模範解答と違う送り方を苦手文字に数えない', (await page.evaluate(() => JSON.stringify(window.__cw.stats.keyPerChar || {}))) === perCharBefore);
s = await state();
ok('名前を落としても交信は続く（聞き返しか次へ）', ['ex1', 'ex2'].includes(s.phase) && s.busy, JSON.stringify(s));
await page.screenshot({ path: `${DIR}/free-feedback.png`, fullPage: true });
await page.waitForFunction(() => !window.__cw.freeState.busy, null, { timeout: 90000 });

// 残りは模範解答どおりに打って終わらせる
for (let i = 0; i < 4; i++) {
  const done = await page.evaluate(() => window.__cw.freeState.qso?.done);
  if (done) break;
  await page.evaluate(() => window.__cw.sendFree(window.__cw.freeState.qso.expected().text));
  await page.waitForFunction(() => !window.__cw.freeState.busy, null, { timeout: 90000 });
  await page.waitForTimeout(200);
}
const summary = (await page.textContent('#qso-turn')).replace(/\s+/g, ' ');
ok('交信終了のまとめが出る', /交信終了/.test(summary) && /回の送信/.test(summary), summary.slice(0, 80));
ok('終わるとログの受信内容が読める', !(await page.textContent('#qso-log')).includes('（受信）'));
await page.click('#btn-free-log');
await page.waitForTimeout(200);
const logged = await page.evaluate(() => window.__cw.logEntries.at(-1));
ok('ログ帳へ登録できる', logged && logged.call === call && logged.source === 'mockqso', JSON.stringify(logged).slice(0, 100));
await page.screenshot({ path: `${DIR}/free-summary.png`, fullPage: true });
ok('Claude を使わない設定では外へ出ない', outbound.length === 0, outbound.join(','));

// ── Claude を使う設定: 要点の検査と、失敗しても止まらないこと ──
const claude = await page.evaluate(async () => {
  const { ClaudeAssist, keepsEssentials } = window.__cw;
  const me = { callsign: 'JA1ABC' };
  const dx = { callsign: 'W1AW', name: 'BOB', qth: 'BOSTON', rig: 'K3', pwr: '100W', ant: 'DP', wx: 'FINE' };
  const base = 'JA1ABC DE W1AW = R R FB TARO = UR RST 579 579 = NAME BOB BOB = QTH BOSTON BOSTON = HW? JA1ABC DE W1AW K';
  const mk = (reply) => new ClaudeAssist({
    apiKey: 'sk-test', model: 'claude-opus-5',
    fetch: async (url, init) => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: reply }], _url: url, _init: init }) }),
  });
  const good = await mk('JA1ABC DE W1AW = R R VFB TARO ES TNX = UR RST 579 579 = NAME BOB BOB = QTH BOSTON BOSTON = HW? JA1ABC DE W1AW K')
    .dxReply({ baseText: base, transcript: [], dx, me, phase: 'ex2' });
  const bad = await mk('JA1ABC DE W1AW = R R = UR RST 599 599 = NAME BOB = QTH BOSTON = 73 <SK>')   // RST が変わり、勝手に終える
    .dxReply({ baseText: base, transcript: [], dx, me, phase: 'ex2' });
  const failing = new ClaudeAssist({ apiKey: 'sk-test', fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) }) });
  const err = await failing.dxReply({ baseText: base, transcript: [], dx, me, phase: 'ex2' });
  const adv = await failing.advise({ question: 'q', situation: ['状況'], expected: 'X', transcript: [] });
  let sentInit = null;
  const spy = new ClaudeAssist({ apiKey: 'sk-test', fetch: async (url, init) => { sentInit = { url, init }; return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: base }] }) }; } });
  await spy.dxReply({ baseText: base, transcript: [], dx, me, phase: 'ex2' });
  const body = JSON.parse(sentInit.init.body);
  return {
    good: good.source, goodText: good.text, bad: bad.source, badErr: bad.error, err: err.source, errMsg: err.error,
    advFallback: adv.source, advText: adv.text,
    off: new ClaudeAssist({}).configured,
    req: { url: sentInit.url, model: body.model, effort: body.output_config?.effort, browser: sentInit.init.headers['anthropic-dangerous-direct-browser-access'], version: sentInit.init.headers['anthropic-version'], key: sentInit.init.headers['x-api-key'] },
    keeps: keepsEssentials(base, base.replace('W1AW = R R', 'W1AW = R R VFB'), { myCall: 'JA1ABC', dxCall: 'W1AW' }),
  };
});
console.log('Claude:', JSON.stringify(claude).slice(0, 300));
ok('要点を保った言い換えは採用される', claude.good === 'claude' && /VFB/.test(claude.goodText), claude.goodText);
ok('要点を崩した返事は規則の文に戻す', claude.bad === 'rule' && /要点/.test(claude.badErr), claude.badErr);
ok('通信に失敗しても規則の文で続く', claude.err === 'rule' && /401/.test(claude.errMsg), claude.errMsg);
ok('相談も失敗すれば規則の答えに戻る', claude.advFallback === 'rule' && claude.advText === '状況');
ok('キーが無ければ使わない', claude.off === false);
ok('要求は Anthropic へ直接・標準モデル・低い effort', /api\.anthropic\.com\/v1\/messages$/.test(claude.req.url) && claude.req.model === 'claude-opus-5'
  && claude.req.effort === 'low' && claude.req.browser === 'true' && claude.req.version === '2023-06-01' && claude.req.key === 'sk-test', JSON.stringify(claude.req));
ok('検査の関数そのものも通る', claude.keeps === true);

// 設定画面: キーは設定の書き出しに含まれない
await page.click('.tab[data-panel="settings"]');
await page.fill('#set-claude-key', 'sk-ant-secret');
await page.locator('#set-claude-key').dispatchEvent('change');
await page.check('#set-claude-enabled');
await page.waitForTimeout(100);
const keyStore = await page.evaluate(() => ({
  stored: localStorage.getItem('cwtraining.claude.key'),
  inSettings: JSON.stringify(localStorage.getItem('cwtraining.settings.v1')).includes('sk-ant-secret'),
  enabled: window.__cw.settings.claudeEnabled,
}));
ok('API キーはこの端末にだけ保存され、設定の書き出しに混ざらない', keyStore.stored === 'sk-ant-secret' && !keyStore.inSettings && keyStore.enabled, JSON.stringify(keyStore));
await page.click('.tab[data-panel="qso"]');
ok('使う設定にすると条件欄に出る', /使う（claude-opus-5）/.test(await page.textContent('#free-claude-note')), await page.textContent('#free-claude-note'));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
