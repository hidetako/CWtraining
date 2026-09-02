// 画面の組み立てとイベント配線

import { CWPlayer } from './audio.js';
import { MORSE_TABLE, computeTiming, toMorseString, estimateDuration, tokenize } from './morse.js';
import {
  ABBREVIATIONS, WX_WORDS, WX_PHRASES, FREQUENCY_ORDER, KOCH_ORDER, SYMBOL_ORDER,
  KEY_PHRASE_TOPICS, ALL_KEY_PHRASES,
} from './data.js';
import { annotateHtml, createTracker, explainText, lookupTerm, termCode, termTitle } from './explain.js';
import {
  loadLogbook, saveLogbook, newEntry, bandFromFreq, BAND_LABELS,
  jccSearch, jccQth, nearestJcc, searchLog, history as logHistory, logStats,
  toAdif, fromAdif, toCsv, fromCsv,
} from './logbook.js';
import { CWDecoder } from './decoder.js';
import { SupportSession, SerialKeyer, keyTimeline } from './support.js';
import { DRILL_TYPES, gradeProblem, makeProblem, shouldLevelUp } from './drills.js';
import {
  LocalResponder, gradeField, buildScript, makeStation, REACTION_LABELS, FIELD_HINTS,
} from './qso.js';
import { PHASES, PATTERN_SHEET, makeReplyOptions, readDxTurn } from './qsoguide.js';
import {
  ElectronicKeyer, KEYER_MODES, attachPaddleInput, compareSending, isTextEntry,
  sameSpacing, spacingUnits, spacingDiff,
} from './keyer.js';
import {
  ContestRunner, EXCHANGE_TYPES, RUN_MODES,
  HINT_LEVELS, HINT_MASK, clampHint, hintMask,
} from './contest.js';
import {
  QSO_ERROR, QSO_ERROR_LABEL, loadHighScores, saveHighScore,
} from './contestlog.js';
import {
  CELEBRATIONS, RANDOM_ID, celebrationById, runCelebration, clearCelebration,
} from './celebrate.js';
import { Tutorial, TUTORIAL_STEPS } from './tutorial.js';
import {
  loadSettings, saveSettings, loadStats, saveStats, resetStats,
  recordDrill, recordQso, recordKeying, recordKeyPerChar, recordContest, weakChars,
  paddleAssignment,
} from './stats.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const player = new CWPlayer();
const responder = new LocalResponder();
const keyer = new ElectronicKeyer(player);
const contest = new ContestRunner(player);
const tutorial = new Tutorial();
let settings = loadSettings();
let stats = loadStats();

// ═══════════════════════════════════════════ 起動

function init() {
  applyAudioSettings();
  initTabs();
  initHeaderControls();
  initQso();
  initDrill();
  initContest();
  initKeyer();
  initLogbook();
  initSupport();
  initTools();
  initGlossary();
  initSettings();
  initBeginnerToggles();
  initPaddleWidget();
  renderStats();
}

// ═══════════════════════════════════════════ 常時表示のパドルウィジェット
//
// パドル入力を受け付ける範囲を常に画面に示し、どのタブでもこの枠内なら
// 打てるようにする。キーボード(Z/X)はパドル送信タブ側の接続が担当するので
// ここでは繋がない（二重発火防止）。

function initPaddleWidget() {
  const padBody = $('#pw-pad');

  // 最初の操作で側音ラインを開く（AudioContext はユーザー操作が必要）
  const ensureLine = () => { player.openKeyLine(); };
  padBody.addEventListener('mousedown', ensureLine, { capture: true });
  padBody.addEventListener('touchstart', ensureLine, { capture: true, passive: true });

  attachPaddleInput(keyer, padBody, {
    keyboard: false,
    onState: (state) => {
      $('#pw-left').classList.toggle('on', state.left);
      $('#pw-right').classList.toggle('on', state.right);
    },
  });

  // 送信速度のつまみは initKeyer() 側で配線する（syncKeyer と一緒に扱うため）

  // 打った符号を常時表示する。どのタブにいても自分の打鍵を確認できる
  const decoded = $('#pw-decoded');
  const showDecoded = () => {
    const pending = keyer.buffer;
    decoded.innerHTML = (!keyer.text && !pending)
      ? '<span class="empty">パドルを操作すると、ここに解読結果が出ます。</span>'
      : escapeHtml(keyer.text) + (pending ? `<span class="pending">${escapeHtml(pending)}</span>` : '');
  };
  keyer.addEventListener('update', showDecoded);
  keyer.addEventListener('element', showDecoded);
  keyer.addEventListener('char', showDecoded);

  // レバーが押されたままになって鳴り続けたのを、キーヤー側が止めたとき。
  // 黙って止めると、なぜ余計な符号が並んだのか分からないままになる
  const note = $('#pw-note');
  keyer.addEventListener('stuck', () => {
    note.textContent = 'レバーが戻らないまま鳴り続けたので止めました。'
      + '余分に入った符号は「打ち直す」（Esc）で消せます。';
    note.hidden = false;
    clearTimeout(note._timer);
    note._timer = setTimeout(() => { note.hidden = true; }, 12000);
  });
  keyer.addEventListener('update', () => { note.hidden = true; });
  $('#pw-clear').addEventListener('click', redoKeying);
  showDecoded();

  initPaddleSheet();
  syncPaddleWidget();
}

// ───────── スマホ用の引き出し ─────────
//
// 狭い画面では横に 2 列を並べられないので、パドルは下から出し入れする。
// 画面が広いときは常に見えているため、この開け閉めは効かない（CSS 側で
// 引き出しの見た目自体を狭い画面にだけ適用している）。

/** 引き出しが使われる画面かどうか。 */
function isNarrowScreen() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function setPaddleSheet(open) {
  const widget = $('#paddle-widget');
  const fab = $('#btn-paddle-sheet');
  if (!widget || !fab) return;
  widget.classList.toggle('is-open', open);
  fab.setAttribute('aria-expanded', String(open));
  // 引き出しが本文の下半分を覆うので、その分だけ余白を足して
  // 隠れた部分までスクロールできるようにする
  document.body.classList.toggle('is-sheet-open', open);

  // 打つ対象（手本や打った符号）が引き出しの上に来るように寄せる。
  // 打面だけ見えても、何を打つのかが隠れていては使えない。
  // 引き出しは本文の上に重なっているだけなので、scrollIntoView では
  // その下に隠れたままになる。見えている帯に入るよう自分で寄せる
  if (!open) return;
  const target = $('#qso-keyed') || $('#keyer-task-text');
  const main = $('.app-main');
  if (!target || !main) return;

  requestAnimationFrame(() => {
    const top = $('.tabs').getBoundingClientRect().bottom;
    // 引き出しはまだ滑って来る途中なので、今の位置ではなく
    // 着いたときの位置（画面の下端から高さのぶん）で考える
    const bottom = window.innerHeight - widget.offsetHeight;
    const rect = target.getBoundingClientRect();
    const margin = 12;

    if (rect.bottom > bottom - margin) main.scrollTop += rect.bottom - (bottom - margin);
    else if (rect.top < top + margin) main.scrollTop -= (top + margin) - rect.top;
  });
}

/** 打鍵が必要な場面になったら開く。狭い画面でだけ意味がある。 */
function openPaddleSheet() {
  if (isNarrowScreen()) setPaddleSheet(true);
}

function initPaddleSheet() {
  $('#btn-paddle-sheet').addEventListener('click', () => setPaddleSheet(true));
  $('#pw-close').addEventListener('click', () => setPaddleSheet(false));

  // 画面が広がったら、開閉の状態は意味を持たないので戻しておく
  window.matchMedia('(max-width: 760px)').addEventListener('change', (e) => {
    if (!e.matches) setPaddleSheet(false);
  });
}

/** パドル欄の表示（割り当て・速度・入力範囲の説明）を現在の設定に合わせる。 */
function syncPaddleWidget() {
  const widget = $('#paddle-widget');
  if (!widget) return;
  const map = paddleAssignment(settings);
  const label = (el) => (el === 'dit' ? '・ 短点' : '－ 長点');

  $('#pw-left').textContent = label(map.left);
  $('#pw-right').textContent = label(map.right);
  $('#pw-mini').textContent = `${KEYER_MODES[settings.keyerMode]?.label.replace(/（.*/, '') ?? ''}`.trim();
  $('#pw-wpm').value = settings.keyerWpm;
  $('#pw-wpm-out').textContent = `${settings.keyerWpm} WPM`;

  const onKeyerTab = $('#panel-keyer')?.classList.contains('is-active');
  syncRedoLabel();

  // パドル送信タブを開いている間は画面全体で受け付ける。
  // 打面の上までマウスを運ばないと打てないのでは、練習にならない
  $('#pw-scope').textContent = onKeyerTab
    ? '画面全体でパドル入力を受け付けています（ボタンや入力欄の上を除く）。'
    : 'この枠内はいつでもパドル入力を受け付けます（左半分＝左ボタン扱い）。';
}

/** 各タブに置いた初心者モードのスイッチを、設定と同期させる。 */
function initBeginnerToggles() {
  $$('.js-beginner').forEach((el) => {
    el.addEventListener('change', () => {
      settings.beginnerMode = el.checked;
      persist();
      syncBeginnerToggles();
    });
  });
  syncBeginnerToggles();
}

function syncBeginnerToggles() {
  $$('.js-beginner').forEach((el) => { el.checked = settings.beginnerMode; });
  const master = $('#set-beginner');
  if (master) master.checked = settings.beginnerMode;
}

function applyAudioSettings() {
  player.setSettings({
    charWpm: settings.charWpm,
    effWpm: Math.min(settings.effWpm, settings.charWpm),
    freq: settings.freq,
    volume: settings.volume,
    qrn: settings.qrn / 100,
    qsb: settings.qsb / 100,
    qrm: settings.qrm / 100,
    bandwidth: settings.bandwidth,
    qsk: settings.qsk,
    rit: settings.rit ?? 0,
    keyerFreq: settings.keyerFreq ?? 700,
    wave: settings.toneWave ?? 'sine',
    ramp: (settings.toneRamp ?? 5) / 1000,
  });
}

function persist() {
  saveSettings(settings);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ═══════════════════════════════════════════ タブ

function initTabs() {
  const tabs = $$('.tab');

  const syncA11y = () => {
    tabs.forEach((t) => {
      const active = t.classList.contains('is-active');
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;   // ロービングタブインデックス
    });
  };

  tabs.forEach((tab) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `panel-${tab.dataset.panel}`);
    tab.addEventListener('click', () => {
      player.stop();
      // 数えている途中で離れたら、そのまま止める。
      // 放っておくと数え終わった時点で、別の画面の上で鳴り出す
      cancelCountdown();
      tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.panel').forEach((p) => {
        p.classList.toggle('is-active', p.id === `panel-${tab.dataset.panel}`);
      });
      // パドル入力は開いているタブでだけ有効にする
      // 交信サポートでも Z / X で打てるようにする（候補を見ながら
      // 自分の電鍵で送るため）。打面のマウス・タッチは常時有効
      setPaddleActive(tab.dataset.panel === 'keyer' || tab.dataset.panel === 'support');
      // 打つためのタブに来たら、狭い画面では引き出しを開けておく
      if (tab.dataset.panel === 'keyer') openPaddleSheet();
      else setPaddleSheet(false);
      syncPaddleWidget();
      syncA11y();
    });
  });

  // 矢印キーでタブ間を移動できるようにする
  $('.tabs').addEventListener('keydown', (e) => {
    const current = tabs.findIndex((t) => t.classList.contains('is-active'));
    let next = -1;
    if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tabs[next].click();
    tabs[next].focus();
  });

  syncA11y();
}

// ═══════════════════════════════════════════ ヘッダーの速度・音量

function initHeaderControls() {
  const charWpm = $('#qa-charwpm');
  const effWpm = $('#qa-effwpm');
  const volume = $('#qa-volume');

  const sync = () => {
    charWpm.value = settings.charWpm;
    effWpm.value = settings.effWpm;
    volume.value = Math.round(settings.volume * 100);
    $('#qa-charwpm-out').textContent = `${settings.charWpm} WPM`;
    $('#qa-effwpm-out').textContent = `${settings.effWpm} WPM`;
    $('#qa-volume-out').textContent = String(Math.round(settings.volume * 100));
  };

  charWpm.addEventListener('input', () => {
    settings.charWpm = Number(charWpm.value);
    // 実効速度が文字速度を上回らないようにする
    if (settings.effWpm > settings.charWpm) settings.effWpm = settings.charWpm;
    sync(); applyAudioSettings(); persist();
  });

  effWpm.addEventListener('input', () => {
    settings.effWpm = Math.min(Number(effWpm.value), settings.charWpm);
    sync(); applyAudioSettings(); persist();
  });

  volume.addEventListener('input', () => {
    settings.volume = Number(volume.value) / 100;
    sync(); applyAudioSettings(); persist();
  });

  $('#btn-pause-all').addEventListener('click', togglePause);
  $('#btn-stop-all').addEventListener('click', endCurrentMode);

  // Space で一時停止／再開、Esc で打ち直し・終了。
  // コンテスト運用はこの 2 つを独自に使うので除外する
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if ($('#panel-contest').classList.contains('is-active')) return;

    // 空白は文字そのものなので、打ち込む場所とボタンの上では譲る
    if (e.code === 'Space') {
      if (isTextEntry(e.target) || e.target.tagName === 'BUTTON') return;
      e.preventDefault(); togglePause();
      return;
    }
    if (e.key !== 'Escape') return;

    // 打った符号が残っていれば打ち直し。焦点がどこにあっても効かせる。
    //
    // ここを「入力欄の上では効かせない」としていたため、消えるときと
    // 消えないときがあった。パドル欄の速度つまみ自体が <input> なので、
    // 自分の速度を変えただけで Esc が死ぬ。打面のすぐ下のボタンが
    // 「打ち直す（Esc）」と出している以上、焦点の置き場所で変わってはいけない
    if (keyer.text || keyer.buffer) {
      e.preventDefault();
      redoKeying();
      return;
    }

    // 打った符号が無いときの Esc は練習の終了。取り消しの利かない操作なので、
    // 文字を打ち込んでいる最中だけは効かせない
    if (isTextEntry(e.target)) return;
    e.preventDefault();
    endCurrentMode();
  });

  sync();
}

// ═══════════════════════════════════════════ 一時停止・再開・終了

/** 一時停止と再開を切り替える。どのタブでも同じボタンで効く。 */
async function togglePause() {
  const ok = player.paused ? await player.resumePlay() : await player.pause();
  if (!ok && !player.paused) return;   // 鳴っていないときは何もしない
  syncTransport();
}

function syncTransport() {
  const btn = $('#btn-pause-all');
  if (!btn) return;
  // 記号と語を分けておく。狭い画面では語だけを隠して記号ボタンにする
  btn.innerHTML = player.paused
    ? '▶<span class="t-label"> 再開</span>'
    : '❙❙<span class="t-label"> 一時停止</span>';
  btn.classList.toggle('is-paused', player.paused);
  document.body.classList.toggle('is-paused', player.paused);
}

/**
 * 今開いているタブの練習を終了する。
 * 音を止めるだけでなく、そのモードを開始前の状態に戻す。
 */
function endCurrentMode() {
  player.stop();
  syncTransport();

  const panel = $('.panel.is-active')?.id;
  if (panel === 'panel-qso') return endQso();
  if (panel === 'panel-drill') return endDrill();
  if (panel === 'panel-contest') return contest.running ? contest.stopSession() : undefined;
  if (panel === 'panel-keyer') return endKeyerTask();
  return undefined;
}

// ═══════════════════════════════════════════ 交信シミュレーター

// scored は「今のターンの採点で liveScores に点を積んだか」。打ち直しで
// 取り消す対象を、点を積んだターンだけに限るために持つ
const qso = { script: null, index: 0, results: [], graded: false, scored: false };

function initQso() {
  $('#qso-mode').value = settings.qsoMode;
  $('#qso-length').value = settings.qsoLength;

  const reactionSel = $('#qso-reaction');
  reactionSel.innerHTML = Object.entries(REACTION_LABELS)
    .map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
  reactionSel.value = settings.qsoReaction;

  $('#qso-mode').addEventListener('change', (e) => {
    settings.qsoMode = e.target.value; persist();
  });
  $('#qso-length').addEventListener('change', (e) => {
    settings.qsoLength = e.target.value; persist();
  });
  reactionSel.addEventListener('change', (e) => {
    settings.qsoReaction = e.target.value; persist();
  });

  $('#qso-style').addEventListener('click', (e) => {
    const btn = e.target.closest('.style-option');
    if (!btn) return;
    settings.qsoStyle = btn.dataset.style;
    persist();
    syncQsoStyle();
  });

  $('#qso-copy-reveal').addEventListener('change', (e) => {
    settings.copyReveal = e.target.checked; persist();
  });

  $('#btn-pattern-toggle').addEventListener('click', () => {
    const body = $('#pattern-body');
    body.hidden = !body.hidden;
    $('#btn-pattern-toggle').textContent = body.hidden ? '開く' : 'たたむ';
  });

  renderPatternSheet();
  syncQsoStyle();
  $('#btn-qso-start').addEventListener('click', startQso);
  updateMyProfileLine();

  // 実技モードの打鍵表示。#qso-keyed が画面に無ければ何もしない
  const updateLiveKeyed = () => {
    const el = $('#qso-keyed');
    if (!el) return;
    const pending = keyer.buffer;
    if (!keyer.text && !pending) {
      el.innerHTML = '<span class="empty hint">パドルで打ち始めてください。</span>';
      return;
    }
    el.innerHTML = escapeHtml(keyer.text)
      + (pending ? `<span class="pending">${escapeHtml(pending)}</span>` : '');
  };
  keyer.addEventListener('update', updateLiveKeyed);
  keyer.addEventListener('element', updateLiveKeyed);
  keyer.addEventListener('char', updateLiveKeyed);

  // 実技の自局ターンでは、キーボード(Z/X または ←/→)でも打てるようにする。
  // パドル送信タブの接続とはタブが排他なので二重発火しない
  const liveKeySide = (code) => {
    if (code === 'KeyZ' || code === 'ArrowLeft') return keyer.swap ? 'dah' : 'dit';
    if (code === 'KeyX' || code === 'ArrowRight') return keyer.swap ? 'dit' : 'dah';
    return null;
  };
  const liveKeyActive = () =>
    $('#panel-qso').classList.contains('is-active') && $('#qso-keyed');

  document.addEventListener('keydown', (e) => {
    if (e.repeat || !liveKeyActive()) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const side = liveKeySide(e.code);
    if (!side) return;
    e.preventDefault();
    player.openKeyLine();
    const left = e.code === 'KeyZ' || e.code === 'ArrowLeft';
    $(left ? '#pw-left' : '#pw-right')?.classList.add('on');
    keyer.paddleDown(side);
  });
  document.addEventListener('keyup', (e) => {
    if (!liveKeyActive()) return;
    const side = liveKeySide(e.code);
    if (!side) return;
    const left = e.code === 'KeyZ' || e.code === 'ArrowLeft';
    $(left ? '#pw-left' : '#pw-right')?.classList.remove('on');
    keyer.paddleUp(side);
  });
}

function syncQsoStyle() {
  $$('#qso-style .style-option').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.style === settings.qsoStyle);
  });
  // 受信内容を出すかどうかは、聞き取り練習でしか効かない
  $('#copy-reveal-row').hidden = settings.qsoStyle !== 'copy';
  $('#qso-copy-reveal').checked = settings.copyReveal;
}

/** 型の早見表を描く。自局・相手局のコールサインは実際の設定を当てはめる。 */
function renderPatternSheet() {
  const my = settings.callsign;
  const dx = 'DL1ABC';

  $('#pattern-body').innerHTML = PATTERN_SHEET.map((step) => {
    const info = PHASES[step.phase] || {};
    const who = step.who === '自分' ? 'me' : step.who === '相手' ? 'dx' : 'both';
    const example = step.example.replaceAll('<MY>', my).replaceAll('<DX>', dx);

    return `
      <div class="pattern-step who-${who}">
        <div class="pattern-head">
          <span class="pattern-title">${escapeHtml(info.title || step.phase)}</span>
          <span class="pattern-who">${escapeHtml(step.who)}</span>
        </div>
        <p class="hint" style="margin:.2rem 0">${escapeHtml(info.purpose || '')}</p>
        <div class="pattern-example">${annotateHtml(example, escapeHtml)}</div>
        <div class="pattern-parts">
          ${step.parts.map(([code, meaning]) => `
            <div class="pattern-part">
              <code>${escapeHtml(code.replaceAll('<MY>', my).replaceAll('<DX>', dx))}</code>
              <span>${escapeHtml(meaning)}</span>
            </div>`).join('')}
        </div>
        ${info.tip ? `<p class="hint">${escapeHtml(info.tip)}</p>` : ''}
      </div>`;
  }).join('');
}

function updateMyProfileLine() {
  $('#qso-myprofile').textContent =
    `${settings.callsign} / ${settings.name} / ${settings.qth}`;
}

async function startQso() {
  player.stop();
  qso.script = await responder.buildScript(settings, {
    mode: settings.qsoMode,
    length: settings.qsoLength,
    reaction: settings.qsoReaction,
  });
  qso.index = 0;
  qso.results = [];
  qso.choices = [];
  qso.liveScores = [];
  qso.scored = false;

  $('#qso-stage').hidden = false;
  $('#qso-log').innerHTML = '';
  renderTurn();
  // 開始したらすぐ操作できるよう、今のターンを画面の先頭に出す
  $('#qso-turn').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 交信を途中でやめて、開始前の状態に戻す。 */
function endQso() {
  if (!qso.script) return;
  qso.script = null;
  qso.index = 0;
  $('#qso-stage').hidden = true;
  $('#qso-turn').innerHTML = '';
  $('#qso-log').innerHTML = '';
  syncRedoLabel();
}

function appendLog(turn, { reveal }) {
  const who = turn.side === 'me' ? '自局 TX' : '相手 RX';
  const cls = turn.side === 'me' ? 'tx' : 'rx';
  const el = document.createElement('div');
  el.className = `log-entry ${cls}${reveal ? '' : ' is-hidden'}`;
  el.innerHTML =
    `<span class="who">${who}</span>` +
    `<span class="body">${reveal ? escapeHtml(turn.text) : '（未採点）'}</span>`;
  $('#qso-log').append(el);
  $('#qso-log').scrollTop = $('#qso-log').scrollHeight;
  return el;
}

function renderTurn() {
  // 描き終わったあとに、パドル欄のボタンの見出しを今の状況へ合わせる
  queueMicrotask(syncRedoLabel);

  const box = $('#qso-turn');
  const turn = qso.script.turns[qso.index];

  if (!turn) return renderQsoSummary();

  qso.graded = false;
  qso.scored = false;

  if (settings.qsoStyle === 'guided') return renderGuidedTurn(turn, box);
  if (settings.qsoStyle === 'live') return renderLiveTurn(turn, box);

  if (turn.side === 'me') {
    box.innerHTML = `
      <div class="turn-head">
        <h3>自局の送信 (${qso.index + 1}/${qso.script.turns.length})</h3>
        <span class="turn-badge tx">送信 TX</span>
      </div>
      <p class="hint">下の内容を送信します。実際に鍵を打つつもりで音を聞いてください。</p>
      <div class="annotated">${annotateHtml(turn.text, escapeHtml)}</div>
      <div class="playing-char" id="qso-playing"></div>
      <div class="explain-live" id="qso-explain"></div>
      <div class="turn-actions">
        <button type="button" class="btn btn-primary" id="btn-turn-send">送信する</button>
        <button type="button" class="btn btn-ghost" id="btn-turn-skip">送信を省略して次へ</button>
      </div>`;

    $('#btn-turn-send').addEventListener('click', async (e) => {
      e.target.disabled = true;
      await playText(turn.text, '#qso-playing', {
        explainSelector: '#qso-explain',
        freq: settings.keyerFreq,   // 自局の送信は送信音の高さで鳴らす
      });
      advanceTurn(turn, { reveal: true });
    });
    $('#btn-turn-skip').addEventListener('click', () => {
      player.stop();
      advanceTurn(turn, { reveal: true });
    });
    return;
  }

  // 相手局の送信を聞き取るターン
  const sheet = turn.fields.map((f) => `
    <label class="field">
      <span>${escapeHtml(f.label)}</span>
      <input type="text" data-key="${escapeHtml(f.key)}" autocomplete="off"
             autocapitalize="characters" spellcheck="false"
             placeholder="${escapeHtml(FIELD_HINTS[f.key] || '聞き取った内容を入力')}">
    </label>`).join('');

  // 聞き取り練習では、既定では相手の送信を画面に出さない。
  // 流れている文字や語の意味が見えると、書き取りの答えがそのまま分かってしまう。
  // 出さないときは表示欄ごと省く。空のまま置くと、書き取り欄が
  // その分だけ下に押し下げられて操作しにくくなる
  const reveal = settings.copyReveal;
  const charBox = reveal ? '#qso-playing' : null;
  const rxOpts = reveal ? { explainSelector: '#qso-explain' } : {};

  box.innerHTML = `
    <div class="turn-head">
      <h3>相手局の送信 (${qso.index + 1}/${qso.script.turns.length})</h3>
      <span class="turn-badge rx">受信 RX</span>
    </div>
    <p class="hint">「受信する」を押して聞き取り、下の欄に書き取ってください。</p>
    ${reveal ? '<div class="playing-char" id="qso-playing"></div>' : ''}
    ${reveal ? '<div class="explain-live" id="qso-explain"></div>' : ''}
    <div class="turn-actions">
      <button type="button" class="btn btn-primary" id="btn-turn-rx">受信する</button>
      <button type="button" class="btn" id="btn-turn-again">もう一度</button>
      <button type="button" class="btn btn-ghost" id="btn-turn-slow">ゆっくり</button>
    </div>
    ${sheet ? `<div class="logsheet">${sheet}</div>` : ''}
    <div class="turn-actions">
      <button type="button" class="btn btn-primary" id="btn-turn-grade">答え合わせして次へ</button>
    </div>
    ${settings.showText ? `<div class="tx-preview">${escapeHtml(turn.text)}</div>` : ''}`;
  $('#btn-turn-rx').addEventListener('click', () => playText(turn.text, charBox, rxOpts));
  $('#btn-turn-again').addEventListener('click', () => playText(turn.text, charBox, rxOpts));
  $('#btn-turn-slow').addEventListener('click', () => {
    playText(turn.text, charBox, {
      ...rxOpts,
      charWpm: Math.max(8, settings.charWpm - 5),
      effWpm: Math.max(6, Math.min(settings.effWpm, settings.charWpm - 5) - 3),
    });
  });
  $('#btn-turn-grade').addEventListener('click', () => gradeTurn(turn, box));

  // 最初のフィールドで Enter を押したら採点する
  const inputs = $$('.logsheet input', box);
  inputs.forEach((input, i) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (i < inputs.length - 1) inputs[i + 1].focus();
      else gradeTurn(turn, box);
    });
  });

  // 自動で受信を始める
  playText(turn.text, charBox);
}

// ───────── ガイド付き模擬交信 ─────────

/** 現在の段階を示す帯。 */
function phaseBanner(turn) {
  const info = PHASES[turn.phase] || {};
  const total = qso.script.turns.length;
  return `
    <div class="phase-banner">
      <span class="phase-step">${qso.index + 1} / ${total}</span>
      <span class="phase-name">${escapeHtml(info.title || '')}</span>
      <span class="turn-badge ${turn.side === 'me' ? 'tx' : 'rx'}">
        ${turn.side === 'me' ? '自分が送信' : '相手が送信'}</span>
      <span class="phase-purpose">${escapeHtml(info.purpose || '')}</span>
    </div>`;
}

function renderGuidedTurn(turn, box) {
  const info = PHASES[turn.phase] || {};

  if (turn.side === 'dx') {
    // 相手の送信は、聞かせてから中身と意味を明かす
    box.innerHTML = `
      ${phaseBanner(turn)}
      <p class="hint">まず聞いてみてください。そのあと本文と意味を表示します。</p>
      <div class="playing-char" id="qso-playing"></div>
      <div class="explain-live" id="qso-explain"></div>
      <div class="turn-actions">
        <button type="button" class="btn" id="btn-guide-listen">もう一度聞く</button>
        <button type="button" class="btn btn-primary" id="btn-guide-reveal">内容を見る</button>
      </div>`;

    const opts = { explainSelector: '#qso-explain' };
    $('#btn-guide-listen').addEventListener('click', () => playText(turn.text, '#qso-playing', opts));
    $('#btn-guide-reveal').addEventListener('click', () => revealDxTurn(turn, box));
    playText(turn.text, '#qso-playing', opts);
    return;
  }

  // 自分の送信は、選択肢から選ばせる
  const options = makeReplyOptions(turn, qso.script);
  qso.currentOptions = options;

  box.innerHTML = `
    ${phaseBanner(turn)}
    ${info.tip ? `<div class="guide-tip"><strong>ここでのコツ</strong><br>${escapeHtml(info.tip)}</div>` : ''}
    <p class="hint">この場面で送るべきものはどれでしょう。選ぶと理由を表示します。</p>
    <div class="choices" id="qso-choices">
      ${options.map((opt, i) => `
        <button type="button" class="choice" data-index="${i}">
          ${escapeHtml(opt.text)}
        </button>`).join('')}
    </div>`;

  $('#qso-choices').addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (btn) answerChoice(Number(btn.dataset.index), turn, box);
  });
}

function answerChoice(index, turn, box) {
  if (qso.graded) return;
  qso.graded = true;

  const options = qso.currentOptions;
  const chosen = options[index];
  qso.choices.push({ correct: !!chosen.correct, phase: turn.phase });

  // どれがなぜ駄目なのかを学べるよう、全選択肢に理由を出す
  $$('#qso-choices .choice').forEach((btn, i) => {
    const opt = options[i];
    btn.disabled = true;
    btn.classList.add(opt.correct ? 'is-correct' : 'is-wrong');

    const verdict = opt.correct
      ? (i === index ? '正解。これが定型です。' : 'こちらが正しい送信でした。')
      : `${i === index ? 'これを選びました。' : ''}${opt.why}`;
    btn.insertAdjacentHTML('beforeend', `<span class="verdict">${escapeHtml(verdict)}</span>`);
  });

  const correctText = options.find((o) => o.correct).text;
  box.insertAdjacentHTML('beforeend', `
    <h4>実際に送る内容</h4>
    <div class="annotated">${annotateHtml(correctText, escapeHtml)}</div>
    <div class="playing-char" id="qso-playing"></div>
    <div class="explain-live" id="qso-explain"></div>

    <div class="try-keying">
      <h4>パドルで打ってみる<span class="optional">任意</span></h4>
      <p class="hint">
        上の内容を自分で打てるか試せます。画面右のパドル欄の左右をクリック
        （パドルを接続していればそのまま打鍵）、またはキーボードの
        <kbd>Z</kbd>（短点側）/ <kbd>X</kbd>（長点側）で打てます。
        打たずに次へ進んでもかまいません。
      </p>
      <div class="live-keyed" id="qso-keyed"><span class="empty hint">パドルで打ち始めてください。</span></div>
      <div class="turn-actions">
        <button type="button" class="btn btn-ghost" id="btn-guide-clear"
                title="打った符号を消して打ち直す（Esc）">打ち直す</button>
        <button type="button" class="btn" id="btn-guide-check">お手本と照合する</button>
      </div>
      <div id="qso-guide-keyed-result"></div>
    </div>

    <div class="turn-actions">
      <button type="button" class="btn btn-primary" id="btn-guide-send">送信して次へ</button>
      <button type="button" class="btn btn-ghost" id="btn-guide-skip">音を飛ばして次へ</button>
    </div>`);

  // 打鍵を受け付ける準備（側音のラインを開き、前のターンの符号を消す）
  player.openKeyLine();
  keyer.reset();
  syncRedoLabel();

  $('#btn-guide-clear').addEventListener('click', redoKeying);
  openPaddleSheet();
  $('#btn-guide-check').addEventListener('click', () => {
    const sent = keyer.flush();
    $('#qso-guide-keyed-result').innerHTML = sendingDiffHtml(correctText, sent);
  });

  $('#btn-guide-send').addEventListener('click', async (e) => {
    e.target.disabled = true;
    await playText(correctText, '#qso-playing', {
      explainSelector: '#qso-explain',
      highlightSelector: '.annotated',
      freq: settings.keyerFreq,
      ...(turn.slow ? { charWpm: Math.max(8, settings.charWpm - 6), effWpm: Math.max(6, settings.effWpm - 4) } : {}),
    });
    advanceTurn({ ...turn, text: correctText }, { reveal: true });
  });
  $('#btn-guide-skip').addEventListener('click', () => {
    player.stop();
    advanceTurn({ ...turn, text: correctText }, { reveal: true });
  });
}

/** 相手の送信内容を明かし、意味と次の一手を説明する。 */
function revealDxTurn(turn, box) {
  player.stop();
  const reaction = readDxTurn(turn);
  const isTwist = reaction.key !== 'normal';

  box.innerHTML = `
    ${phaseBanner(turn)}
    <h4>相手が送ってきた内容</h4>
    <div class="annotated">${annotateHtml(turn.text, escapeHtml)}</div>
    <div class="playing-char" id="qso-playing"></div>

    <div class="reaction-note">
      <span class="rlabel">${escapeHtml(reaction.label)}</span>
      ${escapeHtml(reaction.meaning)}
      <span class="rwhat">→ ${escapeHtml(reaction.whatToDo)}</span>
    </div>

    ${turn.wrongCall ? `<p class="hint">
      相手は <code>${escapeHtml(turn.wrongCall)}</code> と打っています。
      あなたのコールサインは <code>${escapeHtml(qso.script.profile.callsign)}</code> です。</p>` : ''}

    ${termListHtml(turn.text)}

    <div class="turn-actions">
      <button type="button" class="btn" id="btn-guide-relisten">もう一度聞く</button>
      <button type="button" class="btn btn-primary" id="btn-guide-next">次へ</button>
    </div>`;

  $('#btn-guide-relisten').addEventListener('click', () =>
    playText(turn.text, '#qso-playing', { highlightSelector: '.annotated' }));
  $('#btn-guide-next').addEventListener('click', () => advanceTurn(turn, { reveal: true }));

  if (isTwist) qso.hadTwist = true;
}

// ───────── 実技（パドルで打つ） ─────────

/**
 * 実技モード。相手の送信はガイドと同じ流れ（聞く → 内容と意味を見る）で、
 * 自分の送信は実際にパドルで打つ。打った符号は手本と文字単位で照合する。
 */
function renderLiveTurn(turn, box) {
  if (turn.side === 'dx') return renderGuidedTurn(turn, box);

  const info = PHASES[turn.phase] || {};
  player.openKeyLine();   // 側音のラインを開いておく（初回はここで AudioContext も起きる）
  keyer.reset();

  box.innerHTML = `
    ${phaseBanner(turn)}
    ${info.tip ? `<div class="guide-tip"><strong>ここでのコツ</strong><br>${escapeHtml(info.tip)}</div>` : ''}
    <p class="hint">
      下の内容を、パドルで実際に打って送信してください。
      画面右のパドル欄の左右をクリック（パドルを接続していればそのまま打鍵）、
      またはキーボードの <kbd>Z</kbd>（短点側）/ <kbd>X</kbd>（長点側）でも打てます。
      <code>=</code> は BT（－…－）、<code>&lt;SK&gt;</code> はプロサインとして続けて打ちます。
    </p>
    <h4>打つ内容</h4>
    <div class="annotated">${annotateHtml(turn.text, escapeHtml)}</div>
    <h4>あなたの符号</h4>
    <div class="live-keyed" id="qso-keyed"><span class="empty hint">パドルで打ち始めてください。</span></div>
    <div class="turn-actions">
      <button type="button" class="btn" id="btn-live-example">お手本を聞く</button>
      <button type="button" class="btn btn-ghost" id="btn-live-clear"
              title="打った符号を消して打ち直す（Esc）">打ち直す</button>
      <button type="button" class="btn btn-primary" id="btn-live-grade">送信を終える（採点）</button>
      <button type="button" class="btn btn-ghost" id="btn-live-skip">この送信を飛ばす</button>
    </div>
    <div id="qso-live-result"></div>`;

  $('#btn-live-example').addEventListener('click', () => {
    playText(turn.text, null, {
      freq: settings.keyerFreq,
      charWpm: settings.keyerWpm,
      effWpm: settings.keyerWpm,
      highlightSelector: '.annotated',
    });
  });
  $('#btn-live-clear').addEventListener('click', redoKeying);
  openPaddleSheet();   // 打つ場面になったので、狭い画面では引き出しを出す
  $('#btn-live-skip').addEventListener('click', () => {
    player.stop();
    advanceTurn(turn, { reveal: true });
  });
  $('#btn-live-grade').addEventListener('click', () => gradeLiveTurn(turn));
}

/**
 * 手本と打った符号の照合結果を HTML にする。
 * 実技モードの採点と、ガイド付きの「お手本と照合する」で共通に使う。
 */
function sendingDiffHtml(target, sent) {
  const result = compareSending(target, sent);
  const diff = result.marks
    // 空白は採点に使っていないので、色を付けず語の切れ目としてだけ出す
    .map((m) => (m.type === 'space'
      ? '<span class="gap"> </span>'
      : `<span class="${m.type}">${escapeHtml(m.char)}</span>`))
    .join('');

  return `
    <div class="score-line">
      <span class="big">${Math.round(result.accuracy * 100)}%</span>
      <span class="hint">${result.correct} / ${result.total} 文字一致${scoreNote(result)}</span>
    </div>
    <div class="diff">${diff}</div>
    <div class="diff-legend">
      <span><span class="diff"><span class="ok">■</span></span> 一致</span>
      <span><span class="diff"><span class="missing">■</span></span> 打ち漏らし</span>
      <span><span class="diff"><span class="extra">■</span></span> 余分・誤り</span>
    </div>`;
}

function gradeLiveTurn(turn) {
  if (qso.graded) return;
  qso.graded = true;
  player.stop();

  const sent = keyer.flush();
  const result = compareSending(turn.text, sent);
  qso.liveScores.push(result.accuracy);
  qso.scored = true;

  $('#qso-live-result').innerHTML = `
    ${sendingDiffHtml(turn.text, sent)}
    <div class="turn-actions">
      <button type="button" class="btn" id="btn-live-retry">もう一度打つ</button>
      <button type="button" class="btn btn-primary" id="btn-live-next">この内容で送信して次へ</button>
    </div>`;

  $('#btn-live-retry').addEventListener('click', () => {
    // 直前の採点は取り消して打ち直す
    qso.liveScores.pop();
    qso.graded = false;
    qso.scored = false;
    keyer.reset();
    $('#qso-live-result').innerHTML = '';
  });
  $('#btn-live-next').addEventListener('click', () => {
    stats = recordKeyPerChar(stats, result.marks);
    saveStats(stats);
    advanceTurn(turn, { reveal: true });
  });
}

function renderLiveSummary() {
  const scores = qso.liveScores;
  const avg = scores.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;
  const good = scores.filter((a) => a >= 0.9).length;

  stats = recordQso(stats, {
    correct: good,
    total: scores.length,
    station: qso.script.station.callsign,
    wpm: settings.keyerWpm,
  });
  saveStats(stats);
  renderStats();

  $('#qso-turn').innerHTML = `
    <div class="qso-summary">
      <h3>交信終了 — ${escapeHtml(qso.script.station.callsign)}</h3>
      <div class="score">${Math.round(avg * 100)}%</div>
      <p class="hint">
        自分で打った送信の平均一致率（${scores.length} 回中 ${good} 回が 90% 以上）
      </p>
    </div>
    <div class="guide-tip">
      <strong>次の一歩</strong><br>
      一致率が安定して 90% を超えるようになったら、送信速度を 1〜2 WPM 上げてみてください。
      「相手の反応」をおまかせにすると、聞き返しへの対応も含めた通し練習になります。
    </div>
    <div class="turn-actions" style="justify-content:center">
      <button type="button" class="btn btn-primary" id="btn-qso-again">もう一局</button>
    </div>`;

  $('#btn-qso-again').addEventListener('click', startQso);
}

function gradeTurn(turn, box) {
  if (qso.graded) return;
  qso.graded = true;
  player.stop();

  const inputs = $$('.logsheet input', box);
  const lines = [];
  let correct = 0;

  turn.fields.forEach((f) => {
    const input = inputs.find((el) => el.dataset.key === f.key);
    const grade = gradeField(f.value, input?.value);
    if (grade.correct) correct += 1;
    lines.push(`
      <div class="grade-line ${grade.correct ? 'ok' : 'ng'}">
        <span class="label">${escapeHtml(f.label)}</span>
        <span class="mark">${grade.correct ? '○' : '×'}</span>
        <span>${escapeHtml((input?.value || '（未記入）').toUpperCase())}</span>
        ${grade.correct ? '' : `<span class="truth">→ ${escapeHtml(f.value)}</span>`}
      </div>`);
  });

  qso.results.push({ correct, total: turn.fields.length });

  box.innerHTML = `
    <div class="turn-head">
      <h3>答え合わせ</h3>
      <span class="turn-badge rx">受信 RX</span>
    </div>
    ${lines.join('') || '<p class="hint">この送信に書き取り項目はありません。</p>'}
    <h4>相手が送ってきた内容</h4>
    <div class="annotated">${annotateHtml(turn.text, escapeHtml)}</div>
    <div class="playing-char" id="qso-playing"></div>
    ${termListHtml(turn.text)}
    <div class="turn-actions">
      <button type="button" class="btn" id="btn-turn-relisten">本文を聞き直す</button>
      <button type="button" class="btn btn-primary" id="btn-turn-next">次へ</button>
    </div>`;

  $('#btn-turn-relisten').addEventListener('click', () =>
    playText(turn.text, '#qso-playing', { highlightSelector: '.annotated' }));
  $('#btn-turn-next').addEventListener('click', () => advanceTurn(turn, { reveal: true }));
}

function advanceTurn(turn, opts) {
  appendLog(turn, opts);
  qso.index += 1;
  renderTurn();
}

function renderQsoSummary() {
  if (settings.qsoStyle === 'guided') return renderGuidedSummary();
  if (settings.qsoStyle === 'live') return renderLiveSummary();

  const total = qso.results.reduce((n, r) => n + r.total, 0);
  const correct = qso.results.reduce((n, r) => n + r.correct, 0);
  const pct = total ? Math.round((correct / total) * 100) : 100;

  stats = recordQso(stats, {
    correct,
    total,
    station: qso.script.station.callsign,
    wpm: settings.charWpm,
  });
  saveStats(stats);
  renderStats();

  $('#qso-turn').innerHTML = `
    <div class="qso-summary">
      <h3>交信終了 — ${escapeHtml(qso.script.station.callsign)}</h3>
      <div class="score">${pct}%</div>
      <p class="hint">書き取り ${correct} / ${total} 項目</p>
    </div>
    <div class="turn-actions" style="justify-content:center">
      <button type="button" class="btn btn-primary" id="btn-qso-again">もう一局</button>
    </div>`;

  $('#btn-qso-again').addEventListener('click', startQso);
}

function renderGuidedSummary() {
  const total = qso.choices.length;
  const correct = qso.choices.filter((c) => c.correct).length;
  const pct = total ? Math.round((correct / total) * 100) : 100;

  stats = recordQso(stats, {
    correct,
    total,
    station: qso.script.station.callsign,
    wpm: settings.charWpm,
  });
  saveStats(stats);
  renderStats();

  const reaction = qso.script.reaction;
  const twist = reaction && reaction !== 'normal'
    ? `<p class="hint">今回の相手は「${escapeHtml(REACTION_LABELS[reaction] || reaction)}」でした。</p>`
    : '';

  $('#qso-turn').innerHTML = `
    <div class="qso-summary">
      <h3>交信終了 — ${escapeHtml(qso.script.station.callsign)}</h3>
      <div class="score">${correct} / ${total}</div>
      <p class="hint">送信の選択が正しかった回数（${pct}%）</p>
      ${twist}
    </div>
    <div class="guide-tip">
      <strong>次の一歩</strong><br>
      型に慣れてきたら「相手の反応」を<em>おまかせ</em>にして、
      聞き返しや取り違えへの対処も練習してください。
      その後、上の「聞き取り練習」に切り替えると実力を試せます。
    </div>
    <div class="turn-actions" style="justify-content:center">
      <button type="button" class="btn btn-primary" id="btn-qso-again">もう一局</button>
    </div>`;

  $('#btn-qso-again').addEventListener('click', startQso);
}

/**
 * 共通の再生処理。
 * selector を渡すとその要素に送信中の文字を表示し、
 * explainSelector を渡すと初心者モードで語ごとの解説を追記していく。
 */
async function playText(text, selector, override = {}) {
  const display = selector ? $(selector) : null;
  const explain = override.explainSelector ? $(override.explainSelector) : null;
  // 本文を並べてある欄。今どこを送っているかを語ごとに光らせる
  const highlight = override.highlightSelector ? $(override.highlightSelector) : null;
  if (display) display.innerHTML = '';
  clearWordHighlight(highlight);

  const live = explain && settings.beginnerMode;
  const tracker = (live || highlight) ? createTracker(text) : null;
  if (explain) {
    explain.innerHTML = live
      ? '<p class="explain-empty">送信中の語をここに解説します。</p>'
      : '';
  }

  const opts = { ...override };
  delete opts.explainSelector;
  delete opts.highlightSelector;

  // 新しい再生は一時停止を解除して始まるので、ボタンの表示も戻す
  queueMicrotask(syncTransport);

  const done = await player.play(text, {
    ...opts,
    onToken: (token, index) => {
      if (display) {
        display.innerHTML =
          `<span>${escapeHtml(token.text)}</span>` +
          `<span class="pattern">${escapeHtml(token.pattern)}</span>`;
      }
      if (!tracker) return;

      const hit = tracker.step(index);
      if (!hit) return;

      if (highlight) {
        clearWordHighlight(highlight);
        $(`.word[data-w="${hit.index}"]`, highlight)?.classList.add('is-playing');
      }
      if (!live) return;

      // 直前の語の強調を外し、新しい語を先頭に足す
      $$('.explain-card.is-current', explain).forEach((el) => el.classList.remove('is-current'));
      if (!hit.entry) return;

      const empty = $('.explain-empty', explain);
      if (empty) empty.remove();

      const card = document.createElement('div');
      card.className = 'explain-card is-current';
      card.innerHTML =
        `<span class="code">${escapeHtml(hit.entry.term)}</span>` +
        `<span class="desc">${escapeHtml(hit.entry.ja)}</span>` +
        `<span class="morse">${escapeHtml(termCode(hit.entry.term))}</span>`;
      explain.prepend(card);

      // 増えすぎないよう直近 8 件だけ残す
      while (explain.children.length > 8) explain.lastElementChild.remove();
    },
  });

  // 鳴り終わったら光を消す。止められた場合も同じ
  clearWordHighlight(highlight);
  return done;
}

/**
 * 点数の内訳。書き間違いと余分は意味が違うので分けて示す。
 *
 * 書き間違いは「その文字を落とした」1 回の誤りとして数える（分母は増えない）。
 * 余分は水増しを防ぐために分母へ足すので、割合が文字数より低く出る。
 */
/**
 * 採点結果を「1 文字 = 1 列」に組み直す。
 *
 * 最長共通部分列は書き間違いを「取り漏らし」と「余分」の 2 件に分けて返すので、
 * そのまま並べると同じ 1 文字が 2 列に散ってしまい、上下で見比べられない。
 * 一致に挟まれたひと続きの誤りの中で、取り漏らしと余分を順に組にして
 * 1 列にまとめる（数え方は countSubstitutions と同じ）。
 *
 * @returns {Array<{ state: 'ok'|'wrong'|'missing'|'extra', mine: string, want: string }>}
 */
function comparisonColumns(marks) {
  const cols = [];
  let run = [];

  const settle = () => {
    const missing = run.filter((m) => m.type === 'missing');
    const extra = run.filter((m) => m.type === 'extra');
    const paired = Math.min(missing.length, extra.length);
    for (let k = 0; k < paired; k++) {
      cols.push({ state: 'wrong', mine: extra[k].actual, want: missing[k].expected });
    }
    // 組にならなかった残り。打ち漏らし（正解だけ）と余分（自分だけ）
    for (let k = paired; k < missing.length; k++) {
      cols.push({ state: 'missing', mine: '', want: missing[k].expected });
    }
    for (let k = paired; k < extra.length; k++) {
      cols.push({ state: 'extra', mine: extra[k].actual, want: '' });
    }
    run = [];
  };

  for (const m of marks) {
    if (m.type === 'ok') {
      settle();
      cols.push({ state: 'ok', mine: m.expected, want: m.expected });
    } else {
      run.push(m);
    }
  }
  settle();
  return cols;
}

/**
 * 自分の答えと正解を 2 段に並べた HTML。
 * 桁を揃えるのに文字送りは使えない（<SK> のようなプロサインは幅が違う）ので、
 * 1 文字ずつ列に入れて上下で対応させる。
 */
function compareRowsHtml(marks) {
  const cols = comparisonColumns(marks);
  // 何も無い側は空欄と分かるように置き字を出す。空のままだと列が潰れて、
  // どこが抜けたのか上下の対応が読めなくなる
  const cell = (row, text, cls) => `<span class="${row} ${cls}">${
    text ? escapeHtml(text) : '<span class="blank">—</span>'}</span>`;

  const cells = cols.map((c) => {
    if (c.state === 'ok') return cell('mine', c.mine, 'ok') + cell('want', c.want, 'ok');
    // 自分の答えは「余分・誤り」の色、正解は「取り漏らし」の色。凡例と同じ
    return cell('mine', c.mine, c.mine ? 'bad' : 'none')
      + cell('want', c.want, c.want ? 'want-bad' : 'none');
  }).join('');

  return `<div class="compare">
      <span class="cmp-label">あなた</span><span class="cmp-label">正解</span>${cells}
    </div>`;
}

/**
 * 100点＋ にならなかった理由（語の切れ目）を、語の単位で見せる。
 *
 * 文字がすべて合っているのに別格にならないと、`=` を `<BT>` と解読された
 * せいだと思ってしまう（実際にはこの 2 つは同じ符号なので差にならない）。
 * どの語が割れた／つながったのかを名指しし、その語だけを上下に並べる。
 */
function spacingNoteHtml(target, sent) {
  const diff = spacingDiff(target, sent);
  const head = `<p class="hint">文字はすべて合っています。<strong>語の切れ目</strong>が
      手本と違うため 100点＋ にはなりません。</p>`;
  // 文字自体が違って語の組が作れないときは、理由だけ述べて 2 行に頼る
  if (!diff.pairs.length) {
    return `${head}<p class="hint">下の「手本」と「あなたの符号」を見比べてください。</p>`;
  }

  const names = (words) => words.map((w) => `<code>${escapeHtml(w.text)}</code>`).join(' ');
  // 割れ（1 語 → 2 語以上）とつなぎ（2 語以上 → 1 語）を分けて述べる。
  // 「切れ目が違う」の中身はこの 2 つしかない
  const notes = diff.pairs.filter((p) => !p.ok).map((p) => (p.sent.length > p.target.length
    ? `${names(p.target)} を ${names(p.sent)} に<strong>割って</strong>います。`
    : `${names(p.target)} を ${names(p.sent)} と<strong>つなげて</strong>います。`));

  // 語と語のあいだに縦棒を立てて、切れ目の位置そのものを示す。
  // 空白で並べるだけだと「BE GINNER」が 1 語に見えて、どこで割れたのか
  // 結局読み取れない
  const cell = (row, words, ok) =>
    `<span class="${row} ${ok ? 'ok' : (row === 'mine' ? 'bad' : 'want-bad')}">${
      words.map((w) => escapeHtml(w.text)).join('<i class="brk"></i>')}</span>`;
  const cells = diff.pairs
    .map((p) => cell('mine', p.sent, p.ok) + cell('want', p.target, p.ok))
    .join('');

  return `${head}
    <p class="hint">${notes.join(' ')}</p>
    <div class="compare compare-words">
      <span class="cmp-label">あなた</span><span class="cmp-label">手本</span>${cells}
    </div>`;
}

function scoreNote(result) {
  const parts = [];
  // 手本にあって出てこなかった分。書き間違いは「取り漏らし＋余分」に
  // 分かれて現れるので、その分を差し引いた純粋な抜けだけを数える。
  // これを出さないと 12 / 14 の残り 2 文字が何なのか画面から読み取れない
  const missing = Math.max(0, result.total - result.correct - (result.wrong || 0));
  if (missing) parts.push(`抜け ${missing} 文字`);
  if (result.wrong) parts.push(`書き間違い ${result.wrong} 文字`);
  if (result.extra) parts.push(`余分 ${result.extra} 文字（減点）`);
  return parts.length ? `・${parts.join('・')}` : '';
}

/**
 * 打った符号を消して、打ち直せる状態に戻す。
 * パドル欄の「打ち直す」、各パネルの同名ボタン、Esc から共通で呼ぶ。
 * 打鍵に付随する採点結果も一緒に片付ける（残っていると、
 * これから打つ符号の採点だと勘違いする）。
 */
function redoKeying() {
  keyer.reset();
  paddle.elements = '';
  paddle.autoGraded = false;
  const el = $('#keyer-elements');
  if (el) el.textContent = '';

  // 打鍵の採点結果を出している欄。開いていないものは触らない
  ['#keyer-result', '#qso-guide-keyed-result', '#qso-live-result']
    .forEach((sel) => {
      const box = $(sel);
      if (!box) return;
      box.innerHTML = '';
      clearCelebration(box);   // 祝いの余韻も一緒に片付ける
    });

  // 打鍵の採点で点を積んでいたときだけ、採点前の状態に戻す。
  // 聞き取りターンの採点は liveScores に積まないので、ここで取り消すと
  // 直前の打鍵ターンの点が消えてしまう
  if (qso.scored) {
    qso.liveScores.pop();
    qso.scored = false;
    qso.graded = false;
  }

  // 計測は「その課題に挑み始めてから 100点＋ が出るまで」。数え直すのは
  // 100点＋ を出したあとの「打ち直す」だけで、途中の失敗では数え直さない
  // （失敗のたびに 0 に戻すと、最後の 1 回ぶんしか計らないことになる）。
  // 計測中は startedAt が入ったまま、100点＋ を記録した時点で 0 に戻る。
  //
  // 他のタブの「打ち直す」で計測が始まってしまわないよう、
  // パドル送信タブを開いていて課題が出ているときだけ数え直す
  if (paddle.task && !paddle.startedAt
      && $('#panel-keyer')?.classList.contains('is-active')) {
    startKeyerAttempt();
  }

  renderKeyedText();
  syncRedoLabel();
}

/** 打鍵の課題が出ているかどうか。Esc の意味を切り替えるのに使う。 */
function keyingActive() {
  return !!($('#qso-keyed') || $('#panel-keyer').classList.contains('is-active'));
}

/** パドル欄のボタンの見出しを、今できることに合わせる。 */
function syncRedoLabel() {
  const btn = $('#pw-clear');
  if (!btn) return;
  const active = keyingActive();
  btn.textContent = active ? '打ち直す' : '消す';
  btn.title = active
    ? '打った符号を消して打ち直す（Esc）'
    : '打った符号の表示を消す（Esc）';
}

/** 本文欄の「今ここ」の強調を消す。 */
function clearWordHighlight(box) {
  if (!box) return;
  $$('.word.is-playing', box).forEach((el) => el.classList.remove('is-playing'));
}

/**
 * 本文に出てきた用語を一覧にした HTML を返す。
 * skip には出したくない種類（'number' など、意味を書いても情報が増えないもの）を渡す。
 */
function termListHtml(text, { heading = 'この送信に出てきた用語', skip = [] } = {}) {
  const terms = explainText(text).filter((t) => !skip.includes(t.kind));
  if (!terms.length) return '';
  return `
    <h4>${escapeHtml(heading)}</h4>
    <div class="explain-live">
      ${terms.map((t) => `
        <div class="explain-card">
          <span class="code">${escapeHtml(t.term)}</span>
          <span class="desc">${escapeHtml(t.ja)}</span>
          <span class="morse">${escapeHtml(termCode(t.term))}</span>
        </div>`).join('')}
    </div>`;
}

// ═══════════════════════════════════════════ 聞き取りドリル

const drill = {
  problem: null, session: null, awaitingNext: false, countdown: null, gradedAt: 0,
};

/** 出題までの間（秒）。構える時間を作るためのもの。 */
const DRILL_COUNTDOWN = 3;

/**
 * 採点してから Enter で次へ進めるようになるまでの間（ミリ秒）。
 * 採点結果を読む前に画面が切り替わってしまうのを防ぐための最小限の待ち。
 */
const NEXT_GUARD_MS = 700;

/** 苦手文字を重み付きの出題アルファベットに変換する。正答率が低いほど多く混ぜる。 */
function weakAlphabet() {
  const weak = weakChars(stats, { minSent: 5, limit: 10 });
  const alphabet = [];
  for (const w of weak) {
    const copies = 1 + Math.round((1 - w.accuracy) * 3);
    for (let i = 0; i < copies; i++) alphabet.push(w.char);
  }
  return alphabet;
}

function initDrill() {
  const typeSel = $('#drill-type');
  typeSel.innerHTML = Object.entries(DRILL_TYPES)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`)
    .join('');
  typeSel.value = settings.drillType;

  $('#drill-groupsize').value = settings.groupSize;
  $('#drill-groupcount').value = settings.groupCount;
  $('#drill-level').value = settings.kochLevel;

  typeSel.addEventListener('change', () => {
    settings.drillType = typeSel.value; persist(); updateDrillControls();
  });
  // 記号ボタンは、答案欄のカーソル位置に差し込む。押しても欄の焦点は保つ
  $('#drill-symbol-keys').addEventListener('mousedown', (e) => e.preventDefault());
  $('#drill-symbol-keys').addEventListener('click', (e) => {
    const btn = e.target.closest('.pad-key');
    if (!btn) return;
    const input = $('#drill-answer');
    const token = btn.dataset.insert;
    const at = input.selectionStart ?? input.value.length;
    const to = input.selectionEnd ?? at;
    input.value = input.value.slice(0, at) + token + input.value.slice(to);
    const caret = at + token.length;
    input.focus();
    input.setSelectionRange(caret, caret);
  });

  $('#drill-level').addEventListener('input', (e) => {
    settings.kochLevel = Number(e.target.value); persist(); updateDrillControls();
  });
  $('#drill-groupsize').addEventListener('change', (e) => {
    settings.groupSize = Math.max(1, Number(e.target.value) || 5); persist();
  });
  $('#drill-groupcount').addEventListener('change', (e) => {
    settings.groupCount = Math.max(1, Number(e.target.value) || 5); persist();
  });
  $('#drill-count').value = String(settings.drillCount ?? 1);
  $('#drill-count').addEventListener('change', (e) => {
    settings.drillCount = Number(e.target.value); persist();
  });

  $('#btn-drill-new').addEventListener('click', () => {
    const count = settings.drillCount ?? 1;
    drill.session = count > 1
      ? { size: count, done: 0, correct: 0, total: 0, perChar: {} }
      : null;
    newProblem();
  });
  // 数えている途中に押されたら「もう構えている」ということなので、
  // 残りを待たずに鳴らす（待ったままだと、あとでもう一度鳴ってしまう）
  $('#btn-drill-replay').addEventListener('click', () => {
    if (!drill.problem) return;
    cancelCountdown();
    focusAnswer();
    player.play(drill.problem.text);
  });
  $('#btn-drill-slow').addEventListener('click', () => {
    if (!drill.problem) return;
    cancelCountdown();
    focusAnswer();
    player.play(drill.problem.text, {
      charWpm: Math.max(8, settings.charWpm - 5),
      effWpm: Math.max(6, Math.min(settings.effWpm, settings.charWpm - 5) - 3),
    });
  });
  $('#drill-answer').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // 押しっぱなしの自動リピートは取らない。答えを打ち終えて Enter を
    // 少し長く押すと、採点した直後にもう一度 Enter が届いて次の問題へ
    // 進んでしまい、採点結果を見ないまま画面が切り替わっていた
    if (e.repeat) return;

    // 採点後にもう一度 Enter で次の問題へ（連続出題が途切れない）
    if (drill.awaitingNext) {
      // 採点の直後は受け付けない。打ち終えた勢いの 2 度押しでも、
      // 結果が一瞬で流れてしまうため
      if (Date.now() - drill.gradedAt < NEXT_GUARD_MS) return;
      newProblem();
    } else {
      gradeCurrentProblem();
    }
  });

  updateDrillControls();
}

function isCharDrill(type) {
  return type === 'koch' || type === 'frequency' || type === 'symbol';
}

function describeWeakDrill() {
  const weak = weakChars(stats, { minSent: 5, limit: 10 });
  return weak.length >= 2
    ? `対象: ${weak.map((w) => w.char).join(' ')}（正答率の低い順）`
    : 'まだ十分な記録がありません。ドリルを数回解くと苦手文字が集まります（それまではコッホ法の文字で代替）。';
}

/**
 * 書き取り欄に焦点を移し、カーソルを末尾に置く。
 *
 * 再生を押したあとは、そのまま打ち込めるのが自然な流れ。ボタンに焦点が
 * 残っていると、いちいち欄をクリックしてからでないと入力できない。
 * 途中まで書いてあるときに消えては困るので、選択せず末尾に付ける。
 */
function focusAnswer() {
  const el = $('#drill-answer');
  if (!el) return;
  el.focus();
  const at = el.value.length;
  el.setSelectionRange(at, at);
}

/** ドリルの種類ごとに、出題に使う文字の並びを返す。 */
function drillOrder(type) {
  if (type === 'frequency') return FREQUENCY_ORDER;
  if (type === 'symbol') return SYMBOL_ORDER;
  return KOCH_ORDER;
}

/**
 * 今の種類で実際に使うレベル。
 *
 * レベルの保存値は種類をまたいで 1 つしか持っていない。コッホ法で 41 まで
 * 進めたあと記号ドリル（11 種）に切り替えると、保存値だけが範囲外に残る。
 * 出題も表示も記録も、必ずこの丸めた値を使う（記録に「記号 Lv41」のような
 * ありえない値が残らないようにするため）。保存値そのものは丸めない —
 * 丸めてしまうと、コッホ法に戻ったときに進み具合が失われる。
 */
function effectiveDrillLevel(type = settings.drillType) {
  const order = drillOrder(type);
  return Math.min(Math.max(2, settings.kochLevel), order.length);
}

/**
 * 記号・プロサインの入力ボタンを出すかどうかを決めて描く。
 *
 * 判断は「今のレベルで使う文字の並び」に記号が含まれるかで行う。
 * 出題された答えの中身では決めない — 答えに記号があるときだけ出したら、
 * ボタンが出ていること自体が答えの手がかりになってしまう。
 */
function updateSymbolPad(alphabet) {
  const symbols = [...new Set(alphabet)].filter((u) => !/^[A-Z0-9]$/.test(u));
  const pad = $('#drill-symbol-pad');
  pad.hidden = symbols.length === 0;
  if (pad.hidden) return;

  $('#drill-symbol-keys').innerHTML = symbols
    .map((u) => `<button type="button" class="btn pad-key" data-insert="${escapeHtml(u)}"
      title="${escapeHtml(termCode(u))}">${escapeHtml(u)}</button>`)
    .join('');
}

function updateDrillControls() {
  const type = settings.drillType;
  const charDrill = isCharDrill(type);
  const order = drillOrder(type);

  $('#drill-level-field').hidden = !charDrill;
  $('#drill-groupsize').closest('.field').hidden = !charDrill;
  $('#drill-groupcount').closest('.field').hidden = !charDrill;
  $('#drill-help').textContent = DRILL_TYPES[type]?.help || '';

  if (type === 'weak') {
    $('#drill-alphabet').textContent = describeWeakDrill();
    updateSymbolPad(weakAlphabet());
    return;
  }
  if (!charDrill) {
    $('#drill-alphabet').textContent = '';
    updateSymbolPad([]);
    return;
  }

  const slider = $('#drill-level');
  slider.max = String(order.length);
  const level = effectiveDrillLevel(type);
  if (Number(slider.value) !== level) slider.value = String(level);

  $('#drill-level-out').textContent = `${level} 文字`;
  $('#drill-alphabet').textContent = `使用文字: ${order.slice(0, level).join(' ')}`;
  updateSymbolPad(order.slice(0, level));
}

/** ドリルを途中でやめる。連続出題の途中なら、そこまでの結果を締める。 */
function endDrill() {
  if (!drill.problem) return;
  if (drill.session && drill.session.done > 0) {
    const box = $('#drill-result');
    box.hidden = false;
    box.innerHTML = sessionSummaryHtml(drill.session);
  } else {
    $('#drill-result').hidden = true;
    $('#drill-result').innerHTML = '';
  }
  cancelCountdown();
  drill.problem = null;
  drill.session = null;
  drill.awaitingNext = false;
  $('#drill-answer').value = '';
  $('#btn-drill-replay').disabled = true;
  $('#btn-drill-slow').disabled = true;
}

/** 数え終わりを待たずに次へ進むとき、走っている数えを止める。 */
function cancelCountdown() {
  const state = drill.countdown;
  if (!state) return;
  clearTimeout(state.timer);
  drill.countdown = null;
  state.resolve(false);      // 待っている側に「取り消された」と伝える

  const el = $('#drill-countdown');
  if (el) { el.hidden = true; el.textContent = ''; }
}

/**
 * 出題までを 3 秒数える。数え終われば true、途中で取り消されれば false。
 * 押してすぐ鳴ると身構える間が無いので、その間を作るためのもの。
 */
function runCountdown(seconds = DRILL_COUNTDOWN) {
  cancelCountdown();
  const el = $('#drill-countdown');

  return new Promise((resolve) => {
    const state = { resolve, timer: null };
    drill.countdown = state;
    let left = seconds;

    const tick = () => {
      if (drill.countdown !== state) return;   // 取り消し済み
      if (left <= 0) {
        drill.countdown = null;
        el.hidden = true;
        el.textContent = '';
        resolve(true);
        return;
      }
      el.hidden = false;
      el.textContent = String(left);
      left -= 1;
      state.timer = setTimeout(tick, 1000);
    };
    tick();
  });
}

async function newProblem() {
  // 音を出す許可はクリックと同じ処理の流れで取っておく。数え終わってから
  // 呼ぶと操作から離れてしまい、ブラウザに拒まれて無音になることがある
  const ready = player.resume();

  drill.awaitingNext = false;
  drill.problem = makeProblem(settings.drillType, {
    level: effectiveDrillLevel(),
    groupSize: settings.groupSize,
    groupCount: settings.groupCount,
    alphabet: settings.drillType === 'weak' ? weakAlphabet() : undefined,
  });

  $('#drill-result').hidden = true;
  $('#drill-answer').value = '';
  focusAnswer();
  $('#btn-drill-replay').disabled = false;
  $('#btn-drill-slow').disabled = false;

  await ready.catch(() => {});
  if (!await runCountdown()) return;   // 途中で終了・出題し直しになった
  if (!drill.problem) return;

  await player.play(drill.problem.text);
}

function gradeCurrentProblem() {
  if (!drill.problem) return;
  // まだ鳴っていないものは採点しない。数えている途中の Enter で
  // 空欄のまま記録され、答えまで見えてしまう
  if (drill.countdown) return;
  player.stop();

  const input = $('#drill-answer').value;
  const result = gradeProblem(drill.problem, input);
  const pct = Math.round(result.accuracy * 100);
  // 上げられるレベルが残っているときだけ勧める。種類ごとに使う文字の並びが
  // 違うので、上限もその並びで見る（記号は 11 種しかない）
  const levelUp = isCharDrill(settings.drillType)
    && shouldLevelUp(result.accuracy)
    && result.total >= 10
    && effectiveDrillLevel() < drillOrder(settings.drillType).length;

  stats = recordDrill(stats, {
    type: settings.drillType,
    result,
    level: effectiveDrillLevel(),
  });
  saveStats(stats);
  renderStats();

  // 全問正解なら 1 段でよい。間違えたときだけ、自分の答えと正解を
  // 上下に並べて見比べられるようにする
  const perfect = result.correct === result.total && !result.extra && !result.wrong;
  const detail = perfect
    ? `<div class="marks">${result.marks
        .map((m) => `<span class="${m.type || (m.ok ? 'ok' : 'ng')}">${
          escapeHtml(m.type === 'extra' ? m.actual : m.expected)}</span>`)
        .join('')}</div>`
    : compareRowsHtml(result.marks);

  // 連続出題の進行を記録する
  const session = drill.session;
  if (session) {
    session.done += 1;
    session.correct += result.correct;
    // 余分に打った分も分母に入れる（1 問ごとの点数と同じ数え方にそろえる）
    session.total += result.total + (result.extra ?? 0);
    for (const [ch, c] of Object.entries(result.perChar)) {
      if (!session.perChar[ch]) session.perChar[ch] = { sent: 0, correct: 0 };
      session.perChar[ch].sent += c.sent;
      session.perChar[ch].correct += c.correct;
    }
  }

  drill.awaitingNext = true;
  drill.gradedAt = Date.now();

  // Q 符号・略語などの意味を、符号と一緒に添える。
  // 「数字 0537」のような当たり前の言い換えは出さない
  const terms = termListHtml(drill.problem.answer, {
    heading: 'この問題に出てきた符号の意味',
    skip: ['number'],
  });
  // 答えが 1 語で、それ自体が解説の見出しになっているとき。
  // 解説カードに符号が入っているので、別に「モールス:」を出すと同じものが 2 行並ぶ
  const wholeIsOneTerm = !!terms && !/\s/.test(drill.problem.answer.trim());

  const sessionDone = session && session.done >= session.size;
  const progress = session
    ? `<span class="hint">${session.done} / ${session.size} 問</span>`
    : '';

  const box = $('#drill-result');
  box.hidden = false;
  box.innerHTML = `
    <div class="score-line">
      <span class="big">${pct}%</span>
      <span class="hint">${result.correct} / ${result.total} 文字${scoreNote(result)}</span>
      ${progress}
      ${levelUp ? '<span class="levelup">90% 到達 — レベルを上げましょう</span>' : ''}
    </div>
    ${detail}
    <div class="diff-legend">
      <span><span class="marks"><span class="ok">■</span></span> 一致</span>
      <span><span class="marks"><span class="missing">■</span></span> 取り漏らし</span>
      <span><span class="marks"><span class="extra">■</span></span> 余分・誤り</span>
    </div>
    <p class="hint">正解: <code>${escapeHtml(drill.problem.answer)}</code>${
      // 解説を出すときは意味を書かない。解説の側に符号付きで出るので、
      // 同じ説明が 1 画面に 2 度並んでしまう
      !terms && drill.problem.hint ? ` — ${escapeHtml(drill.problem.hint)}` : ''}</p>
    ${wholeIsOneTerm ? ''
      : `<p class="hint">モールス: <code>${escapeHtml(toMorseString(drill.problem.answer))}</code></p>`}
    ${terms}
    ${sessionDone ? sessionSummaryHtml(session) : ''}
    <div class="drill-actions" style="margin-top:.9rem">
      ${levelUp ? '<button type="button" class="btn" id="btn-levelup">レベルを 1 上げる</button>' : ''}
      <button type="button" class="btn btn-primary" id="btn-drill-next">
        ${sessionDone ? 'もう一度セッション' : '次の問題（Enter）'}</button>
    </div>`;

  if (sessionDone) {
    // まとめを見せたのでセッションを閉じる。次はボタンから新規に始める
    drill.session = null;
    drill.awaitingNext = false;
    $('#btn-drill-next').addEventListener('click', () => {
      drill.session = { size: session.size, done: 0, correct: 0, total: 0, perChar: {} };
      newProblem();
    });
  } else {
    $('#btn-drill-next').addEventListener('click', newProblem);
  }
  const levelBtn = $('#btn-levelup');
  if (levelBtn) {
    levelBtn.addEventListener('click', () => {
      // 今の種類の並びで上限を見る。ここを取り違えると、上限に達した種類でも
      // 保存値だけが増え続け、別の種類に戻したときに一気に飛んでしまう
      const order = drillOrder(settings.drillType);
      settings.kochLevel = Math.min(effectiveDrillLevel() + 1, order.length);
      persist();
      updateDrillControls();
      // ここで次の問題を始めてはいけない。採点結果が消えてしまい、
      // 「レベルを上げたら採点を見ないまま次へ進んだ」ことになる。
      // 次へ進むかどうかは、隣の「次の問題」で本人が決める
      levelBtn.disabled = true;
      levelBtn.textContent = `レベル ${effectiveDrillLevel()} になりました`;
      const banner = $('#drill-result .levelup');
      if (banner) banner.textContent = '次の問題から新しい文字が入ります';
    });
  }
}

// ═══════════════════════════════════════════ コンテスト運用

const CONDITION_KEYS = ['qrn', 'qrm', 'qsb', 'flutter', 'lids'];

function initContest() {
  const modeSel = $('#contest-mode');
  modeSel.innerHTML = Object.entries(RUN_MODES)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`).join('');

  const exchangeSel = $('#contest-exchange');
  exchangeSel.innerHTML = Object.entries(EXCHANGE_TYPES)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`).join('');

  const hintSel = $('#contest-hint');
  hintSel.innerHTML = Object.entries(HINT_LEVELS)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`).join('');

  const sync = () => {
    modeSel.value = settings.contestMode;
    exchangeSel.value = settings.contestExchange;
    hintSel.value = settings.contestHint;
    $('#contest-hint-help').textContent = HINT_LEVELS[settings.contestHint]?.help || '';
    $('#contest-minutes').value = String(settings.contestMinutes);
    $('#contest-activity').value = settings.contestActivity;
    $('#contest-activity-out').textContent = `${settings.contestActivity} / 9`;
    $('#contest-mynumber').value = settings.contestMyNumber;
    $('#contest-record').checked = settings.contestRecord;
    $('#contest-mode-help').textContent = RUN_MODES[settings.contestMode]?.help || '';
    $('#contest-exchange-help').textContent = EXCHANGE_TYPES[settings.contestExchange]?.help || '';
    CONDITION_KEYS.forEach((k) => { $(`#cond-${k}`).checked = settings[condKey(k)]; });

    // 競技モードは条件と時間が規定で決まるため、設定を触れなくする
    const fixed = settings.contestMode === 'wpx' || settings.contestMode === 'hst';
    $('#contest-minutes-field').hidden = fixed;
    $('#contest-activity-field').hidden = settings.contestMode === 'single';
    $$('#contest-conditions input').forEach((el) => { el.disabled = fixed; });
    $('#contest-cond-note').textContent = fixed
      ? (settings.contestMode === 'wpx'
        ? 'WPX 競技では条件が固定されます（全条件あり・30 分・マルチはプリフィックス）。'
        : 'HST 競技では妨害の無い理想的な条件で 10 分間行います。')
      : 'LID は、呼び回しの割り込み・符号の打ち間違い・おかしな RST などを起こす局です。';

    $('#contest-dx-wpm').value = settings.contestDxWpm;
    $('#contest-dx-wpm-out').textContent = `${settings.contestDxWpm} WPM`;
    $('#contest-dx-spread').value = settings.contestDxSpread;
    $('#contest-dx-spread-out').textContent = settings.contestDxSpread === 0
      ? 'そろえる' : `±${settings.contestDxSpread} WPM`;

    // 相手局の速度は HST 競技だけ全局そろう規定なので、そのときは触らせない
    const evenSpeed = settings.contestMode === 'hst';
    $('#contest-dx-spread').disabled = evenSpeed;
    const lo = Math.max(10, settings.contestDxWpm - (evenSpeed ? 0 : settings.contestDxSpread));
    const hi = Math.min(45, settings.contestDxWpm + (evenSpeed ? 0 : settings.contestDxSpread));
    $('#contest-dx-wpm-help').textContent = evenSpeed
      ? `HST 競技では全局が ${settings.contestDxWpm} WPM でそろいます。`
      : `呼んでくる局は ${lo}〜${hi} WPM の範囲に散らばります。`
        + '運用中に変えると、そのあと現れる局から反映されます（呼んでいる最中の局は変わりません）。';

    $('#contest-rit').value = String(settings.rit ?? 0);
    $('#contest-rit-out').textContent = `${settings.rit ?? 0} Hz`;
    $('#contest-bandwidth').value = String(settings.bandwidth);
    $('#contest-qsk').checked = settings.qsk;
  };

  modeSel.addEventListener('change', () => { settings.contestMode = modeSel.value; persist(); sync(); });
  exchangeSel.addEventListener('change', () => { settings.contestExchange = exchangeSel.value; persist(); sync(); });
  $('#contest-minutes').addEventListener('change', (e) => { settings.contestMinutes = Number(e.target.value); persist(); });
  $('#contest-activity').addEventListener('input', (e) => { settings.contestActivity = Number(e.target.value); persist(); sync(); });
  $('#contest-mynumber').addEventListener('input', (e) => { settings.contestMyNumber = e.target.value.toUpperCase(); persist(); });
  $('#contest-record').addEventListener('change', (e) => { settings.contestRecord = e.target.checked; persist(); });

  // 難易度は運用中に変えても、その場から効く。表示の決まりが変わるので、
  // 前の段階で出ていた行はいったん片付けて、次の送信から新しい決まりで出す
  hintSel.addEventListener('change', () => {
    settings.contestHint = clampHint(hintSel.value);
    persist(); sync();
    clearHintLines();
    if (contest.running) startHintBoard(); else stopHintBoard();
  });

  $('#contest-dx-wpm').addEventListener('input', (e) => {
    settings.contestDxWpm = Number(e.target.value);
    persist(); sync();
    if (contest.running) contest.setDxWpm(settings.contestDxWpm);
  });
  $('#contest-dx-spread').addEventListener('input', (e) => {
    settings.contestDxSpread = Number(e.target.value);
    persist(); sync();
    if (contest.running) contest.setDxSpread(settings.contestDxSpread);
  });

  CONDITION_KEYS.forEach((k) => {
    $(`#cond-${k}`).addEventListener('change', (e) => {
      settings[condKey(k)] = e.target.checked;
      persist();
      applyAudioSettings();
    });
  });

  // 受信系のつまみは運用中でも即座に効く
  $('#contest-rit').addEventListener('input', (e) => {
    settings.rit = Number(e.target.value);
    $('#contest-rit-out').textContent = `${settings.rit} Hz`;
    player.setSettings({ rit: settings.rit });
    persist();
  });
  $('#contest-bandwidth').addEventListener('change', (e) => {
    settings.bandwidth = Number(e.target.value);
    player.setSettings({ bandwidth: settings.bandwidth });
    persist();
  });
  $('#contest-qsk').addEventListener('change', (e) => {
    settings.qsk = e.target.checked;
    player.setSettings({ qsk: settings.qsk });
    if (settings.qsk) player.releaseRx();
    persist();
  });

  $('#btn-contest-start').addEventListener('click', startContest);
  $('#btn-contest-stop').addEventListener('click', () => contest.stopSession());

  const nudgeWpm = (delta) => {
    const wpm = contest.adjustWpm(delta);
    if (wpm != null) $('#contest-wpm-out').textContent = `${wpm} WPM`;
    $('#contest-call').focus();
  };
  $('#btn-wpm-up').addEventListener('click', () => nudgeWpm(2));
  $('#btn-wpm-down').addEventListener('click', () => nudgeWpm(-2));

  $('#contest-fkeys').addEventListener('click', (e) => {
    const btn = e.target.closest('.fkey');
    if (btn) runContestAction(btn.dataset.fn);
  });

  document.addEventListener('keydown', onContestKey);

  contest.addEventListener('tick', renderContestScore);
  contest.addEventListener('state', renderContestScore);
  contest.addEventListener('qso', () => {
    clearHintLines();
    renderContestScore(); renderContestLog();
  });
  contest.addEventListener('end', (e) => { stopHintBoard(); finishContest(e.detail.score); });
  contest.addEventListener('rxvoice', (e) => addHintLine(e.detail));

  sync();
}

function condKey(k) {
  return `cond${k.charAt(0).toUpperCase()}${k.slice(1)}`;
}

const FKEY_MAP = {
  F1: 'cq', F2: 'exchange', F3: 'confirm', F4: 'myCall',
  F5: 'hisCall', F6: 'b4', F7: 'question', F8: 'again',
};

function onContestKey(e) {
  if (!contest.running) return;
  if (!$('#panel-contest').classList.contains('is-active')) return;

  if (FKEY_MAP[e.key]) {
    e.preventDefault();
    runContestAction(FKEY_MAP[e.key]);
    return;
  }

  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      // 相手が応答済みなら確定、まだなら呼び出しに応答する
      runContestAction(contest.current ? 'confirm' : 'exchange');
      break;

    case ' ': {
      // 部分的に打ち込んだコールサインを、呼んでいる局から補完する
      if (e.target !== $('#contest-call')) return;
      e.preventDefault();
      const full = contest.autoComplete($('#contest-call').value);
      if (full) {
        $('#contest-call').value = full;
      } else {
        $('#contest-exch').focus();
      }
      break;
    }

    case 'Escape':
      e.preventDefault();
      player.stop();
      $('#contest-call').value = '';
      $('#contest-exch').value = '';
      $('#contest-call').focus();
      break;

    case 'PageUp':
    case 'PageDown': {
      e.preventDefault();
      const wpm = contest.adjustWpm(e.key === 'PageUp' ? 2 : -2);
      if (wpm != null) $('#contest-wpm-out').textContent = `${wpm} WPM`;
      break;
    }

    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      const step = e.key === 'ArrowUp' ? 20 : -20;
      const rit = Math.max(-500, Math.min(500, (settings.rit ?? 0) + step));
      settings.rit = rit;
      $('#contest-rit').value = String(rit);
      $('#contest-rit-out').textContent = `${rit} Hz`;
      player.setSettings({ rit });
      persist();
      break;
    }

    default:
      break;
  }
}

async function startContest() {
  await player.resume();

  player.setSettings({
    bandwidth: settings.bandwidth,
    qsk: settings.qsk,
    rit: settings.rit ?? 0,
  });

  contest.start({
    mode: settings.contestMode,
    minutes: settings.contestMinutes,
    activity: settings.contestActivity,
    exchange: settings.contestExchange,
    myCall: settings.callsign,
    myNumber: settings.contestMyNumber,
    myWpm: settings.charWpm,
    dxWpm: settings.contestDxWpm,
    dxSpread: settings.contestDxSpread,
    conditions: {
      qrn: settings.condQrn ? 0.5 : 0,
      qrm: settings.condQrm ? 0.5 : 0,
      qsb: settings.condQsb ? 0.6 : 0,
      flutter: settings.condFlutter,
      lids: settings.condLids,
    },
  });

  // 実際に鳴る空電の強さは、運用モードが決めた条件に合わせる
  player.setSettings({ qrn: contest.opts.conditions.qrn ?? 0 });

  if (settings.contestRecord) await player.startRecording();

  $('#contest-run').hidden = false;
  $('#contest-result').hidden = true;
  $('#contest-log').innerHTML = '';
  $('#btn-contest-start').disabled = true;
  $('#btn-contest-stop').disabled = false;
  $('#contest-call').value = '';
  $('#contest-exch').value = '';
  $('#contest-call').focus();

  $('#contest-wpm-out').textContent = `${contest.opts.myWpm} WPM`;
  startHintBoard();
  renderContestScore();
  renderContestLog();
  contest.cq();
}

// ───────── 受信ヘルプ（難易度） ─────────
//
// 相手局の送信を、難易度に応じて画面に出す。音は voice() が予約済みなので、
// 1 文字ずつの時刻表を AudioContext の時計と見比べるだけで追える。
// 混信局（QRM）は表示しない。妨害として鳴っているだけで、読む対象ではない。

/** 表示中の送信。1 送信につき 1 行。 */
const hintBoard = { lines: [], raf: null };

// 中級は「いま打たれている文字」を見せるだけなので、打ち終わったら消す。
// 初級は打ち終わってからが本番（読んでログに打ち込む）なので、残す。
// 交信が終わる（TU）か、次の CQ を出したところで片付ける
const HINT_LINGER = 1.6;   // 中級で打ち終わってから消えるまでの秒数
const HINT_MAX_LINES = 4;  // 初級で残す行数の上限

function startHintBoard() {
  const board = $('#contest-hint-board');
  const on = settings.contestHint !== 'none';
  board.hidden = !on;
  $('#contest-hint-legend').textContent = on
    ? `${HINT_MASK} は自分で聞き取る部分です（相手のコールサイン）。`
    : '';
  if (!on) return stopHintBoard({ keepBoard: true });
  if (!hintBoard.raf) hintBoard.raf = requestAnimationFrame(drawHintBoard);
}

function stopHintBoard({ keepBoard = false } = {}) {
  if (hintBoard.raf) cancelAnimationFrame(hintBoard.raf);
  hintBoard.raf = null;
  hintBoard.lines = [];
  const lines = $('#contest-hint-lines');
  if (lines) lines.innerHTML = '';
  if (!keepBoard) $('#contest-hint-board').hidden = true;
}

function addHintLine({ station, chars, qrm, startsAt, endsAt }) {
  if (settings.contestHint === 'none' || qrm || !chars?.length) return;

  hintBoard.lines.push({
    station, chars, startsAt, endsAt, qrm,
    mask: hintMask(chars, { myCall: contest.opts?.myCall }),
  });
  while (hintBoard.lines.length > HINT_MAX_LINES) hintBoard.lines.shift();
  startHintBoard();
}

/** 表示を片付ける。交信の確定と、次の CQ で呼ぶ。 */
function clearHintLines() {
  hintBoard.lines = [];
  const box = $('#contest-hint-lines');
  if (box) box.innerHTML = '';
}

/**
 * 初級: 打たれた文字を順に足していく。伏せる語は、その語が始まった時点で
 * 印ひとつに置き換える（文字数も伏せるため）。
 */
function hintTextSeq(line, now) {
  let out = '';
  let maskedWord = -1;
  for (let i = 0; i < line.chars.length; i++) {
    if (line.chars[i].at > now) break;
    const { hidden, word } = line.mask[i];
    if (!hidden) { out += line.chars[i].text; maskedWord = -1; continue; }
    if (word !== maskedWord) { out += HINT_MASK; maskedWord = word; }
  }
  return out;
}

/**
 * 中級: いま打たれている 1 文字だけ。文字と文字のあいだは直前の文字を残す
 * （消えては点くの繰り返しになると、かえって読みにくい）。
 */
function hintTextChar(line, now) {
  let shown = '';
  for (let i = 0; i < line.chars.length; i++) {
    if (line.chars[i].at > now) break;
    const ch = line.chars[i];
    if (ch.text === ' ') continue;
    shown = line.mask[i].hidden ? HINT_MASK : ch.text;
  }
  return shown;
}

function drawHintBoard() {
  hintBoard.raf = null;
  if (!contest.running || settings.contestHint === 'none') return stopHintBoard();

  const now = player.currentTime;
  const seq = settings.contestHint === 'seq';
  // 中級は打ち終わったものを消す。初級は読み終わるまで残す
  if (!seq) hintBoard.lines = hintBoard.lines.filter((l) => now < l.endsAt + HINT_LINGER);
  const html = hintBoard.lines
    .slice()
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((l) => {
      const text = seq ? hintTextSeq(l, now) : hintTextChar(l, now);
      const done = now >= l.endsAt;
      return `<div class="hint-line${done ? ' is-done' : ''}">${escapeHtml(text)}</div>`;
    })
    .join('');

  const box = $('#contest-hint-lines');
  if (box.innerHTML !== html) box.innerHTML = html;

  hintBoard.raf = requestAnimationFrame(drawHintBoard);
}

async function runContestAction(action) {
  const call = $('#contest-call').value;
  const exch = $('#contest-exch').value;
  const btn = $(`#contest-fkeys .fkey[data-fn="${action}"]`);

  if (btn) {
    btn.classList.add('is-hot');
    setTimeout(() => btn.classList.remove('is-hot'), 220);
  }

  switch (action) {
    case 'cq':
      $('#contest-call').value = '';
      $('#contest-exch').value = '';
      clearHintLines();   // 入力欄と同じく、受信ヘルプも次の交信に備えて空にする
      await contest.cq();
      break;
    case 'exchange':
      await contest.exchange(call);
      break;
    case 'confirm': {
      const entry = await contest.confirm(call, exch);
      if (entry) {
        $('#contest-call').value = '';
        $('#contest-exch').value = '';
        setTimeout(() => { if (contest.running) contest.cq(); }, 200);
      }
      break;
    }
    case 'myCall': await contest.myCall(); break;
    case 'hisCall': await contest.hisCall(call); break;
    case 'b4': await contest.b4(call); break;
    case 'question': await contest.question(); break;
    case 'again': await contest.again(); break;
    default: break;
  }

  $('#contest-call').focus();
}

function renderContestScore() {
  const s = contest.score;
  const remain = contest.remaining;
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(Math.floor(remain % 60)).padStart(2, '0');
  const wpx = contest.opts?.mode === 'wpx';

  const tiles = [
    `<div class="stat clock ${remain < 60 ? 'low' : ''}">
       <div class="value">${mm}:${ss}</div><div class="label">残り時間</div></div>`,
    `<div class="stat"><div class="value">${s.points}</div><div class="label">有効 QSO</div></div>`,
    `<div class="stat"><div class="value">${s.errors}</div><div class="label">ミス</div></div>`,
  ];
  if (wpx) {
    tiles.push(`<div class="stat"><div class="value">${s.mults}</div><div class="label">マルチ</div></div>`);
    tiles.push(`<div class="stat"><div class="value">${s.score}</div><div class="label">得点</div></div>`);
  }
  tiles.push(`<div class="stat"><div class="value">${s.rate}</div><div class="label">QSO/時</div></div>`);
  tiles.push(`<div class="stat"><div class="value">${Math.round(s.accuracy * 100)}%</div><div class="label">正確度</div></div>`);
  tiles.push(`<div class="stat"><div class="value">${s.callers}</div><div class="label">呼んでいる局</div></div>`);

  $('#contest-score').innerHTML = tiles.join('');
}

function renderContestLog() {
  const qsos = [...contest.log.qsos].reverse();
  $('#contest-log').innerHTML = qsos.length
    ? qsos.map((q) => {
        const ok = q.err === QSO_ERROR.NONE;
        const label = escapeHtml(QSO_ERROR_LABEL[q.err] || q.err);
        // 該当局が無い場合は正解が存在しないので、理由だけを出す
        const why = q.trueCall
          ? `${label} → ${escapeHtml(q.trueCall)} ${escapeHtml(q.trueNr ?? '')}`
          : label;
        return `<div class="contest-qso ${ok ? 'ok' : 'ng'}">
            <span>${escapeHtml(q.call)} <span class="truth">${escapeHtml(q.nr)}</span></span>
            ${ok ? '' : `<span class="why">${why}</span>`}
            <span class="mark">${ok ? '○' : '×'}</span>
          </div>`;
      }).join('')
    : '<p class="empty">まだ交信がありません。</p>';
}

async function finishContest(score) {
  $('#btn-contest-start').disabled = false;
  $('#btn-contest-stop').disabled = true;

  const mode = contest.opts?.mode || 'pileup';
  const wpx = mode === 'wpx';

  stats = recordContest(stats, {
    score,
    minutes: contest.opts?.minutes ?? settings.contestMinutes,
    exchange: settings.contestExchange,
  });
  saveStats(stats);
  renderStats();

  const isHigh = saveHighScore(mode, {
    score: wpx ? score.score : score.points,
    points: score.points,
    mults: score.mults,
    accuracy: score.accuracy,
    rate: score.rate,
    callsign: settings.callsign,
  });
  const best = loadHighScores()[mode];

  // 5 分ごとの交信数
  const blocks = contest.log.histogram(contest.startedAt, contest.stoppedAt || Date.now());
  const peak = Math.max(1, ...blocks.map((b) => b.raw));
  const hist = blocks.map((b) => `
    <div class="rate-bar" style="height:${Math.max(2, (b.valid / peak) * 100)}%"
         title="${b.valid} / ${b.raw} QSO">
      <span class="n">${b.valid || ''}</span>
    </div>`).join('');

  const box = $('#contest-result');
  box.hidden = false;
  box.innerHTML = `
    <div class="qso-summary">
      <h3>運用終了 — ${escapeHtml(RUN_MODES[mode]?.label || mode)}</h3>
      <div class="score">${wpx ? score.score : score.points}</div>
      <p class="hint">${wpx ? '得点（有効 QSO × マルチ）' : '有効 QSO 数'}</p>
      ${isHigh ? '<p class="highscore">自己ベスト更新</p>' : ''}
    </div>

    <table class="score-table">
      <tr><th></th><th>素点</th><th>確定</th></tr>
      <tr><td>QSO 数</td><td>${score.rawPoints}</td><td>${score.points}</td></tr>
      ${wpx ? `<tr><td>マルチ</td><td>${score.rawMults}</td><td>${score.mults}</td></tr>` : ''}
      <tr class="total"><td>${wpx ? '得点' : '有効数'}</td>
        <td>${wpx ? score.rawScore : score.rawPoints}</td>
        <td>${wpx ? score.score : score.points}</td></tr>
    </table>

    <h4>5 分ごとの交信数</h4>
    <div class="rate-hist">${hist}</div>
    <div class="rate-axis"><span>開始</span><span>終了</span></div>

    <p class="hint">
      正確度 ${Math.round(score.accuracy * 100)}%（誤り ${score.errors} 件）／
      ${score.rate} QSO 毎時ペース
      ${best ? `／ 自己ベスト ${best.score}` : ''}
    </p>

    <div class="turn-actions" style="justify-content:center">
      <button type="button" class="btn btn-primary" id="btn-contest-again">もう一度</button>
      <span id="contest-download"></span>
    </div>`;

  $('#btn-contest-again').addEventListener('click', startContest);

  // 録音していれば、ダウンロードできるようにする
  if (player.isRecording) {
    const blob = await player.stopRecording();
    if (blob) {
      const url = URL.createObjectURL(blob);
      const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
      $('#contest-download').innerHTML =
        `<a class="btn" download="contest-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.${ext}"
            href="${url}">録音を保存</a>`;
    }
  }

  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ═══════════════════════════════════════════ パドル送信（キーヤー）

const paddle = {
  detach: null, task: null, elements: '',
  // 自動採点は 1 回の打鍵につき 1 度だけ。打ち直すまで次は走らせない
  autoGraded: false,
  // 100点＋（間隔まで手本どおり）が出るまでの時間を計る。
  // startedAt は課題が出た時点／打ち直した時点。runs は今の課題での記録
  startedAt: 0,
  runs: [],
};

/** 100点＋の記録を残す回数。これ以上は数えず、次の課題で数え直す。 */
const KEYER_PLUS_MAX = 5;

/** 計測を始める（課題が出たとき・打ち直したとき）。 */
function startKeyerAttempt() {
  paddle.startedAt = performance.now();
}

/**
 * 100点＋の記録表。打ち直しても消えないよう、採点結果とは別の器に描く。
 */
function renderKeyerPlus() {
  const box = $('#keyer-plus');
  if (!box) return;
  if (!paddle.runs.length) { box.innerHTML = ''; return; }

  const best = Math.min(...paddle.runs.map((r) => r.seconds));
  box.innerHTML = `
    <div class="plus-head">
      <h4>100点＋ の記録</h4>
      <span class="hint">${paddle.runs.length >= KEYER_PLUS_MAX
        ? `${KEYER_PLUS_MAX} 回そろいました。次の課題で数え直します。`
        : '「打ち直す」から次に出るまでを計ります（途中で外しても数え直しません）'}</span>
    </div>
    <table class="plus-table">
      <thead><tr><th>回</th><th>かかった時間</th></tr></thead>
      <tbody>${paddle.runs.map((r, i) => `
        <tr class="${r.seconds === best ? 'best' : ''}${i === paddle.runs.length - 1 ? ' just-in' : ''}">
          <td class="rank">${i + 1}</td><td>${r.seconds.toFixed(1)} 秒</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

/**
 * 100点＋ を出したときの祝い。
 *
 * 「間隔までそろった」は狙って出せるものではないので、出たときは
 * はっきり別格だと分かるようにする。祝い方は 10 種類から選べる
 * （設定・記録 →「100点＋ の祝い方」）。中身は celebrate.js。
 */
function celebrateKeyerPlus(box) {
  runCelebration(box, {
    id: settings.plusStyle,
    play: (pattern) => player.fanfare(pattern),
  });
}

/** 「おまかせ」を選んだときの説明。祝い方そのものの説明とは別に要る。 */
const RANDOM_NOTE = '出るたびに 10 種類から選び直します（続けて同じものは出ません）。';

/**
 * 設定画面の「100点＋ の祝い方」。
 *
 * 10 種類を打たずに比べられるよう、その場で動く見本を付ける。
 * 見本が無いと、選ぶために毎回 100点＋ を出さねばならない。
 */
function initPlusStyle() {
  const sel = $('#set-plus-style');
  const note = $('#plus-style-note');
  const preview = $('#plus-preview');
  if (!sel || !preview) return;

  sel.innerHTML = `<option value="${RANDOM_ID}">おまかせ（毎回変わる）</option>`
    + CELEBRATIONS
      .map((c, i) => `<option value="${c.id}">${i + 1}. ${escapeHtml(c.name)}</option>`)
      .join('');
  sel.value = settings.plusStyle === RANDOM_ID
    || CELEBRATIONS.some((c) => c.id === settings.plusStyle)
    ? settings.plusStyle : RANDOM_ID;

  /** 見本の中身を、採点欄と同じ組み立てで置き直す。 */
  const frame = (footer) => {
    // 飾りを重ねる前に器ごと作り直す。前の飾りが残っていると混ざる
    clearCelebration(preview);
    preview.innerHTML = `
      <div class="score-line">
        <span class="big is-plus">100点＋</span>
        <span class="hint">文字も語の切れ目も手本どおり — 0.8 秒</span>
        <span class="plus-best">自己ベスト更新</span>
      </div>
      <p class="hint">${footer}</p>`;
  };

  const show = () => {
    frame('これは見本です。実際の採点でも同じように出ます。');
    // どれが出たかは runCelebration が返す。おまかせのときは、
    // 何が出たのか分からないと見本の意味がないので名前を添える
    const style = runCelebration(preview, {
      id: sel.value, play: (p) => player.fanfare(p),
    });
    if (note && style) {
      note.textContent = sel.value === RANDOM_ID
        ? `${RANDOM_NOTE}　いまのは「${style.name}」。`
        : style.note;
    }
  };

  // 選んだ時点で保存し、そのまま見本を出す。「決定」を押させない
  sel.addEventListener('change', () => {
    settings.plusStyle = sel.value;
    persist();
    show();
  });
  $('#btn-plus-preview')?.addEventListener('click', show);

  // 開いた直後は静かにしておく。音が勝手に鳴ると驚かせる
  if (note) {
    note.textContent = sel.value === RANDOM_ID
      ? RANDOM_NOTE
      : (CELEBRATIONS.find((c) => c.id === sel.value)?.note ?? '');
  }
  frame('「見本を見る」で動きと音を確かめられます。');
}

/** 交信の中で実際に打つことの多い定型文。 */
/** いま選ばれている話題の定型文。「おまかせ」なら全話題から選ぶ。 */
function keyPhrasePool() {
  const topic = KEY_PHRASE_TOPICS[settings.keyerTopic];
  return topic ? topic.phrases : ALL_KEY_PHRASES;
}

// initKeyer が設定同期関数をここに登録する（チュートリアルの警告からも呼ぶため）
let syncKeyerControls = () => {};

function initKeyer() {
  const modeSel = $('#keyer-mode');
  modeSel.innerHTML = Object.entries(KEYER_MODES)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`)
    .join('');

  const weightOut = $('#keyer-weight-out');
  const wpmOut = $('#keyer-wpm-out');

  const syncKeyer = () => {
    modeSel.value = settings.keyerMode;
    $('#keyer-weight').value = settings.keyerWeight;
    $('#keyer-wpm').value = settings.keyerWpm;
    $('#keyer-hand').value = settings.keyerHand;
    $('#keyer-thumb').checked = settings.keyerThumb === 'dah';
    weightOut.textContent = `${settings.keyerWeight}%`;
    wpmOut.textContent = `${settings.keyerWpm} WPM`;
    $('#keyer-freq').value = settings.keyerFreq;
    $('#keyer-freq-out').textContent = `${settings.keyerFreq} Hz`;
    $('#keyer-mode-help').textContent = KEYER_MODES[settings.keyerMode]?.help || '';

    renderPaddleAssignment();

    keyer.setParams({
      mode: settings.keyerMode,
      wpm: settings.keyerWpm,
      weight: settings.keyerWeight,
      swap: paddleAssignment(settings).swapped,
    });
  };

  // 設定を触ったこと自体がチュートリアルの合格条件になる課題がある
  const touched = (name) => { tutorial.markTouched(name); checkTutorial(); };

  modeSel.addEventListener('change', () => {
    settings.keyerMode = modeSel.value; persist(); syncKeyer(); touched('keyerMode');
  });
  $('#keyer-weight').addEventListener('input', (e) => {
    settings.keyerWeight = Number(e.target.value); persist(); syncKeyer(); touched('keyerWeight');
  });
  // パドル送信タブのつまみと、右のパドル欄のつまみは同じ設定を指す
  const setKeyerWpm = (e) => {
    settings.keyerWpm = Number(e.target.value); persist(); syncKeyer(); touched('keyerWpm');
  };
  $('#keyer-wpm').addEventListener('input', setKeyerWpm);
  $('#pw-wpm').addEventListener('input', setKeyerWpm);
  $('#keyer-freq').addEventListener('input', (e) => {
    settings.keyerFreq = Number(e.target.value);
    player.setSettings({ keyerFreq: settings.keyerFreq });  // 打鍵中でも即時反映
    persist(); syncKeyer(); touched('keyerFreq');
  });
  $('#keyer-hand').addEventListener('change', (e) => {
    settings.keyerHand = e.target.value; persist(); syncKeyer(); touched('keyerHand');
  });
  $('#keyer-thumb').addEventListener('change', (e) => {
    settings.keyerThumb = e.target.checked ? 'dah' : 'dit';
    persist(); syncKeyer(); touched('keyerThumb');
  });
  // 話題は「交信の定型文」のときだけ意味を持つので、そのときだけ出す
  const topicSel = $('#keyer-topic');
  topicSel.innerHTML = '<option value="">おまかせ（すべての話題）</option>'
    + Object.entries(KEY_PHRASE_TOPICS)
      .map(([key, t]) => `<option value="${key}">${t.label}</option>`).join('');

  const syncTopicField = () => {
    $('#keyer-topic-field').hidden = settings.keyerTaskType !== 'phrase';
    topicSel.value = KEY_PHRASE_TOPICS[settings.keyerTopic] ? settings.keyerTopic : '';
  };

  $('#keyer-task-type').value = settings.keyerTaskType;
  $('#keyer-task-type').addEventListener('change', (e) => {
    settings.keyerTaskType = e.target.value; persist(); syncTopicField(); newKeyerTask();
  });
  topicSel.addEventListener('change', (e) => {
    settings.keyerTopic = e.target.value; persist(); newKeyerTask();
  });
  syncTopicField();
  $('#btn-keyer-task').addEventListener('click', newKeyerTask);
  $('#btn-keyer-listen').addEventListener('click', () => {
    if (paddle.task) player.play(paddle.task);
  });
  $('#btn-keyer-grade').addEventListener('click', gradeKeying);
  $('#btn-keyer-clear').addEventListener('click', redoKeying);
  // 採点しなくても次へ進めるようにする。打ってみて手応えが無いときに、
  // わざわざ採点を通す必要はない
  $('#btn-keyer-next').addEventListener('click', newKeyerTask);

  keyer.addEventListener('element', (e) => {
    paddle.elements = (paddle.elements + e.detail.element).slice(-60);
    $('#keyer-elements').textContent = paddle.elements;
    renderKeyedText();
    tutorial.pushElement(e.detail.element);
    checkTutorial();
  });
  keyer.addEventListener('char', (e) => {
    paddle.elements = '';
    $('#keyer-elements').textContent = '';
    renderKeyedText();
    tutorial.pushChar(e.detail.char);
    checkTutorial();
  });
  keyer.addEventListener('update', () => {
    renderKeyedText();
    maybeAutoGrade();
  });

  syncKeyerControls = syncKeyer;
  syncKeyer();
  initTutorial();
  newKeyerTask();
  renderKeyedText();
}

// ───────── チュートリアル ─────────

function initTutorial() {
  $('#btn-tutorial-next').addEventListener('click', () => {
    if (tutorial.isLast) {
      // 最後まで来たら折りたたんで練習に移る
      $('#tutorial').classList.add('is-collapsed');
      $('#btn-tutorial-toggle').textContent = '開く';
      return;
    }
    tutorial.next();
    renderTutorial();
  });
  $('#btn-tutorial-prev').addEventListener('click', () => { tutorial.prev(); renderTutorial(); });
  $('#btn-tutorial-retry').addEventListener('click', () => {
    tutorial.clearInput();
    keyer.reset();
    paddle.elements = '';
    $('#keyer-elements').textContent = '';
    renderTutorial();
  });

  $('#btn-tutorial-toggle').addEventListener('click', () => {
    const card = $('#tutorial');
    const collapsed = card.classList.toggle('is-collapsed');
    $('#btn-tutorial-toggle').textContent = collapsed ? '開く' : 'たたむ';
  });

  // 今のモード・速度・ウェイトで手本を鳴らし、設定の効果を耳で確かめる
  $('#btn-tutorial-sample').addEventListener('click', () => {
    player.play('PARIS PARIS', {
      charWpm: settings.keyerWpm,
      effWpm: settings.keyerWpm,
      freq: settings.keyerFreq,
    });
  });

  $('#tutorial-dots').addEventListener('click', (e) => {
    const dot = e.target.closest('.tutorial-dot');
    if (!dot) return;
    tutorial.goto(Number(dot.dataset.index));
    renderTutorial();
  });

  renderTutorial();
}

function renderTutorial() {
  const step = tutorial.step;
  if (!step) return;

  $('#tutorial-count').textContent = `${tutorial.index + 1} / ${tutorial.total}`;
  $('#tutorial-title').textContent = step.title;
  // 説明文には <strong> のみを意図的に含めている
  $('#tutorial-text').innerHTML = step.body.map((p) => `<p>${p}</p>`).join('');

  $('#tutorial-dots').innerHTML = TUTORIAL_STEPS.map((s, i) => `
    <button type="button" class="tutorial-dot ${
      i === tutorial.index ? 'is-current' : i < tutorial.index ? 'is-done' : ''
    }" data-index="${i}" title="${escapeHtml(s.title)}"></button>`).join('');

  $('#btn-tutorial-prev').disabled = tutorial.index === 0;
  $('#btn-tutorial-next').textContent = tutorial.isLast ? '閉じる' : '次へ';
  $('#btn-tutorial-retry').hidden = !step.check;
  $('#btn-tutorial-sample').hidden = !['speed', 'weight', 'mode'].includes(step.id);

  checkTutorial();
}

/** 合格条件を判定し、満たしていれば表示を更新して自動で次へ進める。 */
function checkTutorial() {
  const step = tutorial.step;
  const goalBox = $('#tutorial-goal');
  if (!step || !goalBox) return;

  // キーヤーの自動送出を使う課題は、縦振り電鍵モードでは成立しない。
  // （縦振りでは符号の長さが押した時間で決まり、送信速度も反映されない）
  if (step.needsKeyer && settings.keyerMode === 'straight') {
    goalBox.className = 'tutorial-goal';
    goalBox.innerHTML =
      '<span class="tag">注意</span>'
      + '<span>キーヤーモードが「縦振り電鍵」になっています。この課題は自動送出が前提で、'
      + '送信速度の設定も縦振りでは音に反映されません。'
      + ' <button type="button" class="btn" id="btn-tutorial-fixmode" style="margin-left:.5rem">'
      + 'アイアンビック B に戻す</button></span>';
    $('#btn-tutorial-fixmode')?.addEventListener('click', () => {
      settings.keyerMode = 'iambicB';
      persist();
      syncKeyerControls();
      checkTutorial();
    });
    return;
  }

  if (!step.check) {
    goalBox.className = 'tutorial-goal';
    goalBox.innerHTML =
      `<span class="tag">説明</span><span>${escapeHtml(tutorial.goalText(settings))}</span>`;
    return;
  }

  const cleared = tutorial.isCleared(settings);
  goalBox.className = `tutorial-goal ${cleared ? 'is-cleared' : ''}`;
  goalBox.innerHTML = cleared
    ? '<span class="tag">できました</span><span>次の課題に進みましょう。</span>'
    : `<span class="tag">課題</span><span>${escapeHtml(tutorial.goalText(settings))}</span>`;

  if (cleared && !tutorial.isLast && !tutorial._advancing) {
    // 達成感が残るよう、少し置いてから次のステップへ
    tutorial._advancing = true;
    setTimeout(() => {
      tutorial._advancing = false;
      if (tutorial.isCleared(settings)) { tutorial.next(); renderTutorial(); }
    }, 1400);
  }
}

/** 利き手設定に応じて、説明文とパドル欄の案内をまとめて描き直す。 */
function renderPaddleAssignment() {
  const map = paddleAssignment(settings);
  const handName = settings.keyerHand === 'left' ? '左手用' : '右手用';

  $('#keyer-hand-current').textContent = handName;

  const thumbSide = map.thumbButton === 'right' ? '右' : '左';
  const thumbElement = settings.keyerThumb === 'dah' ? '長点' : '短点';
  $('#keyer-hand-help').textContent =
    `${handName}では、パドルの${thumbSide}レバーに親指が当たります。`
    + `親指＝${thumbElement}になるよう、${thumbSide}ボタンを${thumbElement}に割り当てています。`;

  syncPaddleWidget();
}

function renderKeyedText() {
  const box = $('#keyer-decoded');
  const pending = keyer.buffer;
  if (!keyer.text && !pending) {
    box.innerHTML = '<span class="empty">まだ何も打っていません。</span>';
    return;
  }
  box.innerHTML = escapeHtml(keyer.text)
    + (pending ? `<span class="pending">${escapeHtml(pending)}</span>` : '');
}

/**
 * パドル送信タブを開いている間、画面全体でパドル入力を受け付ける。
 *
 * 打面そのものは右のパドル欄が常時受け付けているので、ここで足すのは
 * 画面全体への取り付けだけ。打つたびに打面までマウスを運ばせるのでは
 * 練習にならないので、切り替えではなく常にこうする。ボタンや入力欄の
 * 上は attachPaddleInput 側で除いてある（押せなくなっては困るため）。
 */
function setPaddleActive(active) {
  if (paddle.detach) { paddle.detach(); paddle.detach = null; }
  if (!active) { keyer.stop(); return; }

  keyer.start();
  const lamps = (state) => {
    $('#pw-left').classList.toggle('on', state.left);
    $('#pw-right').classList.toggle('on', state.right);
  };

  // 打面は右のパドル欄が受け持つので、ここで足すのは
  // キーボード（Z/X）と、全画面モードのときだけマウスも
  paddle.detach = attachPaddleInput(keyer, document.body, {
    global: true,
    mouse: true,
    onState: lamps,
  });
}

/**
 * 課題に出てくる Q 符号・略語に、短い意味を添える。
 * 打つ前に何を送ろうとしているのか分かるように。長い解説は
 * ホバーで全文が出るので、ここでは頭の一節だけを見せる。
 */
/**
 * 1 語に割く長さの上限（見出し＋意味＋符号）。横に何語も並ぶので短く保つ。
 *
 * 8 文字の語は符号だけで 30 文字を超える（BLIZZARD で 33 文字）。
 * 意味を 3 文字まで詰めても 44 になるので、これより下げると
 * 詰めようのない語が必ずはみ出す。
 */
const TASK_TERM_BUDGET = 46;

/**
 * 意味を、その語の符号と並べても収まる長さに詰める。
 *
 * 補足は「— 」「（」「 (」のうしろに置いてあるので、そこで切れば
 * 頭の一言だけが残る。符号の長さは語によって違うため、固定の文字数では
 * なく、実際に並べたときの長さで判断する。
 */
function briefMeaning(entry) {
  const room = TASK_TERM_BUDGET - entry.term.length - termCode(entry.term).length;
  const forms = [
    entry.ja,
    entry.ja.split(' — ')[0],
    entry.ja.split('（')[0],
    entry.ja.split(' (')[0],
  ];
  return forms.find((f) => f.length <= room)
    // どれも収まらなければ、いちばん短い形を出す（切り詰めて意味を壊さない）
    ?? forms.reduce((a, b) => (b.length < a.length ? b : a));
}

function taskTermsHtml(text) {
  // コールサインと数字は見れば分かるので、意味を添える対象から外す
  const terms = explainText(text).filter((t) => t.kind !== 'callsign' && t.kind !== 'number');
  if (!terms.length) return '';

  return terms.map((t) => `<span class="task-term" title="${escapeHtml(termTitle(t))}">
      <span class="code">${escapeHtml(t.term)}</span>${escapeHtml(briefMeaning(t))}` +
      `<span class="morse">${escapeHtml(termCode(t.term))}</span></span>`).join('');
}

function newKeyerTask() {
  const type = settings.keyerTaskType;
  const preview = $('#keyer-task-text');
  const terms = $('#keyer-task-terms');

  if (type === 'free') {
    paddle.task = null;
    preview.textContent = '自由練習モードです。好きな符号を打ってください。';
    terms.innerHTML = '';
    $('#btn-keyer-listen').disabled = true;
    // 自由練習には「次の課題」が無いので、進むボタンは押せなくする
    $('#btn-keyer-next').disabled = true;
  } else {
    if (type === 'phrase') {
      const pool = keyPhrasePool();
      const dx = makeProblem('callsign', {}).answer;
      paddle.task = pool[Math.floor(Math.random() * pool.length)]
        .replaceAll('{ME}', settings.callsign)
        .replaceAll('{DX}', dx)
        .replaceAll('{NAME}', settings.name)
        .replaceAll('{QTH}', settings.qth)
        .replaceAll('{RIG}', settings.rig)
        .replaceAll('{PWR}', settings.pwr)
        .replaceAll('{ANT}', settings.ant);
    } else {
      paddle.task = makeProblem(type, {}).answer;
    }
    // 語ごとに色分けし、下に意味を並べる
    preview.innerHTML = annotateHtml(paddle.task, escapeHtml);
    terms.innerHTML = taskTermsHtml(paddle.task);
    // 課題が変われば記録の意味も変わるので、数え直す
    paddle.runs = [];
    renderKeyerPlus();
    startKeyerAttempt();
    $('#btn-keyer-listen').disabled = false;
    $('#btn-keyer-next').disabled = false;
  }

  keyer.reset();
  paddle.elements = '';
  paddle.autoGraded = false;
  $('#keyer-elements').textContent = '';
  $('#keyer-result').innerHTML = '';
  clearCelebration($('#keyer-result'));
  renderKeyedText();
}

/** パドル送信の課題をやめて、打鍵と採点結果を消す。 */
function endKeyerTask() {
  keyer.reset();
  paddle.elements = '';
  paddle.autoGraded = false;
  $('#keyer-elements').textContent = '';
  $('#keyer-result').innerHTML = '';
  clearCelebration($('#keyer-result'));
  renderKeyedText();
}

/**
 * 打ち終わった瞬間の時刻。100点＋ までの時間はここで止める。
 *
 * 解読が確定するのは文字間の待ち時間を過ぎてからで、「採点する」を
 * 押すのはさらにそのあと。そこで計ると、打ち終わってからの間まで
 * 打鍵時間に入ってしまう。自動採点と手押しで違う物差しになっては
 * 記録表で見比べられないので、どちらもこの時刻を使う。
 */
function keyingEndedAt() {
  const at = keyer.lastMarkAt;
  // まだ何も打っていない（課題を出し直した直後など）なら今の時刻に落とす
  return at > paddle.startedAt ? at : performance.now();
}

/**
 * 手本どおりに打ち切った時点で、押さずに採点する。
 *
 * 照合できるのは 100点＋ のときだけ。手本と符号が 1 つでも違えば
 * 一致しないので、途中で誤って採点が走ることはない。外したときは
 * これまでどおり「採点する」を押してもらう。
 */
function maybeAutoGrade() {
  if (!paddle.task || paddle.autoGraded) return;
  if (!$('#panel-keyer')?.classList.contains('is-active')) return;
  if (!sameSpacing(paddle.task, keyer.text)) return;

  paddle.autoGraded = true;
  gradeKeying();
}

function gradeKeying() {
  const sent = keyer.flush();
  const box = $('#keyer-result');

  if (!sent) {
    box.innerHTML = '<p class="hint">まだ符号が解読されていません。パドルで打ってから採点してください。</p>';
    return;
  }
  if (!paddle.task) {
    box.innerHTML = `
      <p class="hint">自由練習では手本との照合はしません。解読結果:</p>
      <div class="diff"><span class="ok">${escapeHtml(sent)}</span></div>`;
    return;
  }

  const result = compareSending(paddle.task, sent);
  const pct = Math.round(result.accuracy * 100);

  stats = recordKeying(stats, {
    correct: result.correct,
    total: result.total,
    extra: result.extra,
    target: paddle.task,
    wpm: settings.keyerWpm,
  });
  stats = recordKeyPerChar(stats, result.marks);
  saveStats(stats);
  renderStats();

  const diff = result.marks
    // 空白は採点に使っていないので、色を付けず語の切れ目としてだけ出す
    .map((m) => (m.type === 'space'
      ? '<span class="gap"> </span>'
      : `<span class="${m.type}">${escapeHtml(m.char)}</span>`))
    .join('');

  // 文字の採点は語間を見ない（手が止まっただけで語間が入るため）。
  // 語の切れ目までそろっているかは別に見て、そろっていれば別格に扱う
  const plus = sameSpacing(paddle.task, sent);
  let plusTime = '';
  let plusBest = false;
  if (plus) {
    if (paddle.startedAt) {
      const seconds = (keyingEndedAt() - paddle.startedAt) / 1000;
      plusTime = ` — ${seconds.toFixed(1)} 秒`;
      // 記録に足す前に見る。1 回目は比べる相手がいないので自己ベストとは言わない
      plusBest = paddle.runs.length > 0
        && seconds < Math.min(...paddle.runs.map((r) => r.seconds));
      if (paddle.runs.length < KEYER_PLUS_MAX) paddle.runs.push({ seconds });
      // 記録したら計測を止める。打ち直すまで次の計測は始めない
      paddle.startedAt = 0;
      renderKeyerPlus();
    }
  }

  const scoreLine = plus
    ? `<span class="big is-plus">100点＋</span>
       <span class="hint">文字も語の切れ目も手本どおり${escapeHtml(plusTime)}</span>
       ${plusBest ? '<span class="plus-best">自己ベスト更新</span>' : ''}`
    : `<span class="big">${pct}%</span>
       <span class="hint">${result.correct} / ${result.total} 文字一致${scoreNote(result)}</span>`;

  // 文字は合っているのに別格にならなかったときは、理由が分かるようにする。
  // 「語の切れ目が違います」だけでは、どこで割れたのかは 2 行を目で追わないと
  // 分からない。割れた語そのものを名指しして、上下に並べて見せる
  const spacingNote = (!plus && result.accuracy >= 1)
    ? spacingNoteHtml(paddle.task, sent)
    : '';

  // 凡例は、色の付いた印が実際に出ているときだけ。全部合っているのに
  // 「打ち漏らし・余分」の説明を並べても、読む場所が増えるだけになる
  const hasMarks = result.marks.some((m) => m.type === 'missing' || m.type === 'extra');
  const legend = hasMarks ? `
    <div class="diff-legend">
      <span><span class="diff"><span class="ok">■</span></span> 一致</span>
      <span><span class="diff"><span class="missing">■</span></span> 打ち漏らし</span>
      <span><span class="diff"><span class="extra">■</span></span> 余分・誤り</span>
    </div>` : '';

  box.innerHTML = `
    <div class="score-line">${scoreLine}</div>
    <div class="diff">${diff}</div>
    ${legend}
    ${spacingNote}
    <div class="sent-pair">
      <span class="hint">手本: <code>${escapeHtml(paddle.task)}</code></span>
      <span class="hint">あなたの符号: <code>${escapeHtml(sent)}</code></span>
    </div>`;

  if (plus) celebrateKeyerPlus(box);
  else clearCelebration(box);

  // 次へ進む導線は「採点する・打ち直す」と同じ段に常設してあるので、
  // ここには置かない（同じ操作のボタンが 2 つあると迷う）
}

/** 連続出題のまとめ。平均正答率と、このセッションで崩れた文字を示す。 */
function sessionSummaryHtml(session) {
  const avg = session.total ? Math.round((session.correct / session.total) * 100) : 0;
  const worst = Object.entries(session.perChar)
    .filter(([, c]) => c.sent >= 3)
    .map(([ch, c]) => ({ ch, acc: c.correct / c.sent }))
    .sort((a, b) => a.acc - b.acc)
    .slice(0, 5);

  return `
    <div class="guide-tip" style="margin-top:1rem">
      <strong>セッション終了 — 平均 ${avg}%</strong><br>
      ${worst.length
        ? `このセッションで崩れた文字: ${worst
            .map((w) => `<code>${escapeHtml(w.ch)}</code> ${Math.round(w.acc * 100)}%`)
            .join('　')}`
        : '大きく崩れた文字はありませんでした。'}
    </div>`;
}

// ═══════════════════════════════════════════ 変換・電鍵

function initTools() {
  const text = $('#tool-text');

  const refresh = () => {
    $('#tool-morse').textContent = toMorseString(text.value);
    const sec = estimateDuration(text.value, settings.charWpm, settings.effWpm);
    $('#tool-duration').textContent = sec ? `約 ${sec.toFixed(1)} 秒` : '';
    $('#tool-annotated').innerHTML = annotateHtml(text.value, escapeHtml);
  };

  text.addEventListener('input', refresh);
  $('#btn-tool-play').addEventListener('click', () => {
    const tokens = tokenize(text.value);
    const patterns = tokens.map((t) => (t.type === 'space' ? '/' : t.pattern));
    // 語の追跡は、初心者モードが切でも本文の強調のために使う
    const tracker = createTracker(text.value);
    const live = settings.beginnerMode;
    const annotated = $('#tool-annotated');
    const explain = $('#tool-explain');
    explain.innerHTML = live
      ? '<p class="explain-empty">送信中の語をここに解説します。</p>'
      : '<p class="explain-empty">初心者モードをオンにすると、送信中の語を順に解説します。</p>';
    clearWordHighlight(annotated);

    player.play(text.value, {
      onToken: (token, index) => {
        $('#tool-morse').innerHTML = patterns
          .map((p, n) => (n === index ? `<span class="cur">${p}</span>` : p))
          .join(' ');
        const hit = tracker.step(index);
        if (!hit) return;

        clearWordHighlight(annotated);
        $(`.word[data-w="${hit.index}"]`, annotated)?.classList.add('is-playing');
        if (!live) return;

        $$('.explain-card.is-current', explain).forEach((el) => el.classList.remove('is-current'));
        if (!hit.entry) return;

        $('.explain-empty', explain)?.remove();
        const card = document.createElement('div');
        card.className = 'explain-card is-current';
        card.innerHTML =
          `<span class="code">${escapeHtml(hit.entry.term)}</span>` +
          `<span class="desc">${escapeHtml(hit.entry.ja)}</span>`;
        explain.prepend(card);
        while (explain.children.length > 10) explain.lastElementChild.remove();
      },
    }).then((finished) => {
      // 途中で別の再生に差し替えられた場合は触らない。
      // ここで本文を組み直すと、始まったばかりの再生の強調を消してしまう
      if (finished) { clearWordHighlight(annotated); refresh(); }
    });
  });
  $('#btn-tool-stop').addEventListener('click', () => { player.stop(); refresh(); });

  // 電鍵
  const key = $('#btn-key');
  const down = (e) => { e.preventDefault(); key.classList.add('is-down'); player.keyOn(); };
  const up = (e) => { e.preventDefault(); key.classList.remove('is-down'); player.keyOff(); };

  key.addEventListener('mousedown', down);
  key.addEventListener('mouseup', up);
  key.addEventListener('mouseleave', up);
  key.addEventListener('touchstart', down, { passive: false });
  key.addEventListener('touchend', up);
  key.addEventListener('touchcancel', up);

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    if (!$('#panel-tools').classList.contains('is-active')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    key.classList.add('is-down');
    player.keyOn();
  });
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    key.classList.remove('is-down');
    player.keyOff();
  });

  refresh();
}

// ═══════════════════════════════════════════ 略語集

function initGlossary() {
  const list = $('#glossary-list');

  // 略語・Q 符号に、記号とプロサインも並べる。
  // ローマ字以外も覚える対象なので、同じ場所で引けて音も聞けるようにする
  const entries = [
    ...ABBREVIATIONS,
    // 天候の語も引けるようにする。略語ではないが、聞こえたときに
    // 意味が分からないと困るのは同じ。2 語つなげて送る言い方も並べる
    ...WX_WORDS,
    ...WX_PHRASES,
    ...SYMBOL_ORDER.map((u) => ({ code: u, ja: lookupTerm(u)?.ja ?? '', symbol: true })),
  ];

  const render = (query = '') => {
    const q = query.trim().toLowerCase();
    const items = entries.filter(
      (a) => !q || a.code.toLowerCase().includes(q) || a.ja.toLowerCase().includes(q),
    );
    list.innerHTML = items.length
      ? items.map((a) => `
          <button type="button" class="gloss-item${a.symbol ? ' is-symbol' : ''}"
                  data-code="${escapeHtml(a.code)}">
            <span class="code">${escapeHtml(a.code)}</span>
            <span class="ja">${escapeHtml(a.ja)}</span>
            <span class="morse">${escapeHtml(termCode(a.code))}</span>
          </button>`).join('')
      : '<p class="empty">該当する略語がありません。</p>';
  };

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.gloss-item');
    if (item) player.play(item.dataset.code);
  });
  $('#glossary-search').addEventListener('input', (e) => render(e.target.value));

  render();
}

// ═══════════════════════════════════════════ 設定・記録

function initSettings() {
  const textFields = ['callsign', 'name', 'qth', 'rig', 'pwr', 'ant', 'wx'];
  textFields.forEach((key) => {
    const el = $(`#set-${key}`);
    el.value = settings[key];
    el.addEventListener('input', () => {
      settings[key] = el.value.toUpperCase();
      persist();
      updateMyProfileLine();
      // 早見表の例文にも自局のコールサインを反映する
      if (key === 'callsign') renderPatternSheet();
    });
  });

  const ranges = [
    ['freq', (v) => `${v} Hz`, (v) => v],
    ['qrn', (v) => `${v}%`, (v) => v],
    ['qsb', (v) => `${v}%`, (v) => v],
    ['qrm', (v) => `${v}%`, (v) => v],
  ];
  ranges.forEach(([key, fmt]) => {
    const el = $(`#set-${key}`);
    const out = $(`#set-${key}-out`);
    el.value = settings[key];
    out.textContent = fmt(settings[key]);
    el.addEventListener('input', () => {
      settings[key] = Number(el.value);
      out.textContent = fmt(settings[key]);
      applyAudioSettings();
      persist();
    });
  });

  const waveSel = $('#set-wave');
  waveSel.value = settings.toneWave ?? 'sine';
  waveSel.addEventListener('change', () => {
    settings.toneWave = waveSel.value;
    applyAudioSettings();
    persist();
  });

  const rampSel = $('#set-ramp');
  rampSel.value = String(settings.toneRamp ?? 5);
  rampSel.addEventListener('change', () => {
    settings.toneRamp = Number(rampSel.value);
    applyAudioSettings();
    persist();
  });

  const showText = $('#set-showtext');
  showText.checked = settings.showText;
  showText.addEventListener('change', () => {
    settings.showText = showText.checked; persist();
  });

  const beginner = $('#set-beginner');
  beginner.checked = settings.beginnerMode;
  beginner.addEventListener('change', () => {
    settings.beginnerMode = beginner.checked;
    persist();
    syncBeginnerToggles();
  });

  initPlusStyle();

  // 記録の書き出し（設定・成績・自己ベストをまとめた JSON）
  $('#btn-export-data').addEventListener('click', () => {
    const payload = {
      app: 'CWtraining',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      stats,
      highscores: loadHighScores(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cwtraining-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#btn-import-data').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload.app !== 'CWtraining' || !payload.settings || !payload.stats) {
        alert('このファイルは CW 交信トレーニングの記録ではないようです。');
        return;
      }
      if (!confirm('現在の設定と記録を、ファイルの内容で置き換えます。よろしいですか？')) return;
      saveSettings(payload.settings);
      saveStats(payload.stats);
      localStorage.setItem('cwtraining.highscores.v1', JSON.stringify(payload.highscores || {}));
      location.reload();
    } catch {
      alert('ファイルを読み込めませんでした。書き出した JSON を選んでください。');
    }
  });

  $('#btn-reset-stats').addEventListener('click', () => {
    if (!confirm('学習の記録をすべて消去します。よろしいですか？')) return;
    stats = resetStats();
    renderStats();
  });
}

// ───────── 上達の推移（小さな折れ線） ─────────

/**
 * 単系列のスパークラインを描く。
 * 線は 2px、値ラベルは本文色、点には SVG ネイティブのツールチップを付ける。
 */
function sparklineHtml(label, values, { fmt = (v) => String(v), min = 0, max = 1, color = 'var(--accent)' } = {}) {
  if (values.length < 3) return '';

  const W = 200;
  const H = 44;
  const span = Math.max(1e-9, max - min);
  const x = (i) => (values.length === 1 ? W / 2 : (i / (values.length - 1)) * W);
  const y = (v) => H - ((Math.min(Math.max(v, min), max) - min) / span) * H;

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];

  // 点は透明の大きめ円で当たりを取り、<title> で値を出す
  const hits = values.map((v, i) => `
    <circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="7" fill="transparent">
      <title>${escapeHtml(`${i + 1} 回目: ${fmt(v)}`)}</title>
    </circle>`).join('');

  return `
    <div class="spark-card">
      <div class="spark-head">
        <span>${escapeHtml(label)}</span>
        <span class="last">${escapeHtml(fmt(last))}</span>
      </div>
      <svg viewBox="0 -4 ${W} ${H + 8}" preserveAspectRatio="none" role="img"
           aria-label="${escapeHtml(`${label}の推移。最新 ${fmt(last)}`)}">
        <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--line-soft)" stroke-width="1"/>
        <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"
                  stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" fill="${color}"/>
        ${hits}
      </svg>
    </div>`;
}

function renderProgressCharts() {
  const box = $('#progress-charts');
  if (!box) return;

  // history は新しい順なので、時系列に直す
  const chrono = [...stats.history].reverse();
  const drillAcc = chrono.filter((h) => h.kind === 'drill').map((h) => h.accuracy);
  const kochLevels = chrono
    .filter((h) => h.kind === 'drill' && h.type === 'koch' && h.level)
    .map((h) => h.level);
  const sendAcc = chrono
    .filter((h) => h.kind === 'keying' || (h.kind === 'qso' && h.total > 0))
    .map((h) => h.accuracy);

  const pctFmt = (v) => `${Math.round(v * 100)}%`;
  const charts = [
    sparklineHtml('ドリル正答率', drillAcc, { fmt: pctFmt, color: 'var(--accent)' }),
    sparklineHtml('コッホ法レベル', kochLevels, {
      fmt: (v) => `Lv${v}`, min: 2, max: 41, color: 'var(--rx)',
    }),
    sparklineHtml('交信・送信の成績', sendAcc, { fmt: pctFmt, color: 'var(--tx)' }),
  ].filter(Boolean);

  box.innerHTML = charts.length
    ? charts.join('')
    : '<p class="empty">練習を 3 回以上すると、推移がここに表示されます。</p>';
}

function renderStats() {
  renderProgressCharts();
  const d = stats.drills;
  const q = stats.qso;
  const k = stats.keying || { attempts: 0, chars: 0, correct: 0 };
  const c = stats.contest || { sessions: 0, qsos: 0, valid: 0, bestRate: 0 };

  const pct = (num, den) => (den ? `${Math.round((num / den) * 100)}%` : '—');

  $('#stat-summary').innerHTML = [
    ['ドリル回数', d.attempts],
    ['ドリル正答率', pct(d.correct, d.chars)],
    ['受信文字数', d.chars],
    ['交信回数', q.completed],
    ['交信書取率', pct(q.correct, q.fields)],
    ['送信練習', k.attempts],
    ['送信一致率', pct(k.correct, k.chars)],
    ['コンテスト', `${c.valid} QSO`],
    ['最高ペース', c.bestRate ? `${c.bestRate}/h` : '—'],
  ].map(([label, value]) => `
    <div class="stat">
      <div class="value">${escapeHtml(value)}</div>
      <div class="label">${escapeHtml(label)}</div>
    </div>`).join('');

  const weak = weakChars(stats);
  $('#weak-actions').innerHTML = weak.length >= 2
    ? '<button type="button" class="btn" id="btn-weak-drill">この文字を集中練習する</button>'
    : '';
  $('#btn-weak-drill')?.addEventListener('click', () => {
    settings.drillType = 'weak';
    persist();
    $('#drill-type').value = 'weak';
    updateDrillControls();
    $$('.tab').find((t) => t.dataset.panel === 'drill')?.click();
    drill.session = (settings.drillCount ?? 1) > 1
      ? { size: settings.drillCount, done: 0, correct: 0, total: 0, perChar: {} }
      : null;
    newProblem();
  });
  const weakListHtml = (list, emptyText) => (list.length
    ? list.map((w) => `
        <span class="weak-char">
          <span class="ch">${escapeHtml(w.char)}</span>${Math.round(w.accuracy * 100)}%
          <span class="hint" style="display:inline">(${w.sent})</span>
        </span>`).join('')
    : `<p class="empty">${emptyText}</p>`);
  $('#weak-chars').innerHTML = weakListHtml(weak,
    'まだ十分なデータがありません。聞き取りドリルを 5 回ほど試してください。');
  $('#weak-chars-keying').innerHTML = weakListHtml(weakChars(stats, { source: 'keying' }),
    'まだ十分なデータがありません。パドル送信で採点すると集まります。');

  $('#history-list').innerHTML = stats.history.length
    ? stats.history.slice(0, 20).map((h) => {
        const when = new Date(h.at).toLocaleString('ja-JP', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        let what;
        if (h.kind === 'qso') what = `QSO ${h.station}`;
        else if (h.kind === 'keying') what = `送信 ${h.target || ''}`;
        else if (h.kind === 'contest') what = `コンテスト ${h.minutes}分 ${h.rate ?? 0}/h`;
        else what = `${DRILL_TYPES[h.type]?.label || h.type}${h.level ? ` Lv${h.level}` : ''}`;

        return `<div class="history-item">
            <span>${escapeHtml(when)} ${escapeHtml(what)}</span>
            <span class="acc">${Math.round(h.accuracy * 100)}%</span>
          </div>`;
      }).join('')
    : '<p class="empty">まだ記録がありません。</p>';
}

// ═══════════════════════════════════════════ CW 交信サポート

const support = {
  decoder: null,        // CWDecoder。マイクを初めて開いたときに作る
  session: null,        // SupportSession
  serial: new SerialKeyer(),
  micOpen: false,
  word: '',             // 組み立て中の語
  autoTimer: null,
  sending: false,
  manualTarget: '',     // 「自分のパドルで打つ」の手本
};

function supportSession() {
  if (!support.session) {
    support.session = new SupportSession({
      myCall: settings.callsign, myName: settings.name, myQth: settings.qth,
    });
    support.session.addEventListener('update', renderSupport);
  }
  return support.session;
}

/** 解読した文字を受信欄に流し、語が切れたら解析へ渡す。 */
function supportChar(char) {
  const box = $('#sup-decoded');
  if ($('.empty', box)) box.innerHTML = '';
  box.textContent += char;
  box.scrollTop = box.scrollHeight;
  support.word += char;
}

function supportWordBreak() {
  const word = support.word.trim();
  support.word = '';
  if (!word) return;
  const box = $('#sup-decoded');
  if (!$('.empty', box)) { box.textContent += ' '; box.scrollTop = box.scrollHeight; }
  supportSession().feedRx(word);
}

async function openSupportMic() {
  const btn = $('#btn-sup-mic');
  if (support.micOpen) {
    support.decoder.detachMic();
    support.micOpen = false;
    btn.textContent = 'マイクを開く';
    $('#btn-sup-autopitch').disabled = true;
    return;
  }
  await player.resume().catch(() => {});
  if (!support.decoder) {
    support.decoder = new CWDecoder(player.ctx);
    await support.decoder.init();
    support.decoder.setPitch(Number($('#sup-pitch').value));
    support.decoder.addEventListener('char', (e) => {
      supportChar(e.detail.char);
      $('#sup-wpm').textContent = `${e.detail.wpm} WPM`;
    });
    support.decoder.addEventListener('word', supportWordBreak);
    support.decoder.addEventListener('level', (e) => {
      const { env, peak, on } = e.detail;
      const bar = $('#sup-level-bar');
      bar.style.width = `${Math.min(100, Math.round((env / (peak || 1e-6)) * 100))}%`;
      bar.classList.toggle('is-on', !!on);
    });
  }
  try {
    await support.decoder.attachMic();
    support.micOpen = true;
    btn.textContent = 'マイクを閉じる';
    $('#btn-sup-autopitch').disabled = false;
  } catch (err) {
    $('#sup-decoded').innerHTML = `<span class="empty">マイクを開けませんでした: ${escapeHtml(err.message)}。ブラウザの許可を確認してください。</span>`;
  }
}

/** 返答を送る。音を鳴らし、つながっていればシリアルの電鍵も叩く。 */
async function sendSupportReply(text) {
  const t = String(text || '').trim();
  if (!t || support.sending) return;
  support.sending = true;
  $('#btn-sup-send').disabled = true;
  $('#btn-sup-send-stop').hidden = false;
  supportSession().noteTx(t);

  const wpm = keyer.wpm;
  if (support.serial.connected) {
    support.serial.playTimeline(keyTimeline(tokenize(t), computeTiming(wpm, wpm)));
  }
  try {
    await player.play(t, { charWpm: wpm, effWpm: wpm });
  } finally {
    support.sending = false;
    $('#btn-sup-send').disabled = false;
    $('#btn-sup-send-stop').hidden = true;
  }
}

/**
 * 「自分のパドルで打つ」。手本を見せて、右のパドル欄で打ってもらい、
 * 打ち終わったら手本と照合して、実際に打った内容を交信記録に残す。
 * 無線機へは側音の経路（音声インターフェース + VOX など）でそのまま出る。
 */
function openSupportManual() {
  const target = $('#sup-tx-text').value.trim();
  if (!target) {
    $('#sup-manual-result').innerHTML = '<p class="hint">先に候補を選ぶか、送る内容を入れてください。</p>';
    $('#sup-manual').hidden = false;
    return;
  }
  support.manualTarget = target;
  $('#sup-manual').hidden = false;
  $('#sup-manual-target').textContent = target;
  $('#sup-manual-morse').textContent = toMorseString(target);
  $('#sup-manual-result').innerHTML = '';
  keyer.start();
  keyer.reset();
}

function finishSupportManual() {
  const sent = (keyer.text + ' ' + keyer.buffer).trim();
  if (!sent) {
    $('#sup-manual-result').innerHTML = '<p class="hint">まだ何も打っていません。右のパドル欄か Z / X で打ってください。</p>';
    return;
  }
  // 照合は見せるだけ。記録に残すのは手本ではなく、実際に打った内容。
  // 相手に届いたのはそちらだから
  $('#sup-manual-result').innerHTML = sendingDiffHtml(support.manualTarget, sent);
  supportSession().noteTx(sent);
  keyer.reset();
}

function renderSupport() {
  const s = supportSession();

  // 情報欄は自動で埋めるが、書き込み中の欄は上書きしない
  for (const [sel, key] of [['#sup-dxcall', 'dxCall'], ['#sup-rstr', 'rstR'],
    ['#sup-name', 'name'], ['#sup-qth', 'qth']]) {
    const el = $(sel);
    if (document.activeElement !== el && s.fields[key]) el.value = s.fields[key];
  }

  $('#sup-suggestions').innerHTML = s.suggestions().map((sug, i) => `
    <button type="button" class="sug" data-i="${i}">
      <span class="lbl">${escapeHtml(sug.label)}</span>
      <span class="txt">${escapeHtml(sug.text)}</span>
    </button>`).join('');
  $$('#sup-suggestions .sug').forEach((btn) => btn.addEventListener('click', () => {
    $('#sup-tx-text').value = s.suggestions()[Number(btn.dataset.i)].text;
  }));

  const box = $('#sup-transcript');
  box.innerHTML = s.transcript.length
    ? s.transcript.map((l) => `<span class="${l.dir === 'tx' ? 'tx' : 'rx'}">`
        + `${escapeHtml(l.at)} ${l.dir === 'tx' ? '送' : '受'}: ${escapeHtml(l.text)}</span>`).join('\n')
    : 'まだ記録がありません。';
  box.scrollTop = box.scrollHeight;

  // 自動応答。相手が自分を呼んできたときだけ、少し待ってから最初の候補を送る。
  // 電波が出得る操作なので、必ず取り消せる形で予告する
  const note = $('#sup-auto-note');
  // 「自分宛ての送信を受けた直後」だけ。called-me はレポート付きで
  // 呼ばれると同じ受信内で exchange まで進むので、両方を対象にする。
  // 自分が返すと記録の末尾が tx になるため、二重には発火しない
  const calledUs = s.phase === 'called-me' || s.phase === 'exchange';
  if ($('#sup-auto').checked && calledUs && !support.autoTimer && !support.sending
      && s.transcript.at(-1)?.dir === 'rx') {
    const reply = s.suggestions()[0]?.text;
    if (reply) {
      note.hidden = false;
      note.textContent = `自動応答: 2 秒後に「${reply}」を送ります — 送りたくなければ自動応答を外してください`;
      support.autoTimer = setTimeout(() => {
        support.autoTimer = null;
        note.hidden = true;
        if ($('#sup-auto').checked) sendSupportReply(reply);
      }, 2000);
    }
  }
}

function initSupport() {
  $('#btn-sup-mic').addEventListener('click', openSupportMic);
  $('#sup-pitch').addEventListener('input', () => {
    $('#sup-pitch-out').textContent = `${$('#sup-pitch').value} Hz`;
    support.decoder?.setPitch(Number($('#sup-pitch').value));
  });
  $('#btn-sup-autopitch').addEventListener('click', () => {
    const hz = support.decoder?.strongestPitch();
    if (hz) {
      $('#sup-pitch').value = String(hz);
      $('#sup-pitch-out').textContent = `${hz} Hz`;
      support.decoder.setPitch(hz);
    }
  });
  $('#btn-sup-clear').addEventListener('click', () => {
    support.decoder?.reset();
    support.word = '';
    $('#sup-decoded').innerHTML = '<span class="empty">マイクを開くと、解読した文字がここに流れます。</span>';
  });

  // 情報欄の手直しはセッションに書き戻す（登録時にそのまま使われる）
  for (const [sel, key] of [['#sup-dxcall', 'dxCall'], ['#sup-rstr', 'rstR'],
    ['#sup-name', 'name'], ['#sup-qth', 'qth']]) {
    $(sel).addEventListener('change', () => {
      supportSession().fields[key] = $(sel).value.toUpperCase().trim();
    });
  }

  $('#btn-sup-log').addEventListener('click', () => {
    const s = supportSession();
    const note = $('#sup-log-note');
    if (!s.fields.dxCall) { note.textContent = '相手のコールサインが取れていません。手で入れてください。'; return; }
    const entry = addLogEntry(s.toLogFields($('#sup-freq').value.trim()));
    note.textContent = `${entry.call} を登録しました（交信記録 ${entry.transcript?.length ?? 0} 行つき）。ログ帳タブで確認できます。`;
  });
  $('#btn-sup-reset').addEventListener('click', () => {
    supportSession().reset();
    ['#sup-dxcall', '#sup-rstr', '#sup-name', '#sup-qth'].forEach((sel) => { $(sel).value = ''; });
    $('#sup-log-note').textContent = '';
    clearTimeout(support.autoTimer);
    support.autoTimer = null;
  });

  $('#btn-sup-manual').addEventListener('click', openSupportManual);
  $('#btn-sup-manual-done').addEventListener('click', finishSupportManual);
  $('#btn-sup-manual-close').addEventListener('click', () => { $('#sup-manual').hidden = true; });

  $('#btn-sup-send').addEventListener('click', () => sendSupportReply($('#sup-tx-text').value));
  $('#btn-sup-send-stop').addEventListener('click', () => {
    player.stop();
    support.serial.stop();
  });

  $('#btn-sup-serial').addEventListener('click', async () => {
    const state = $('#sup-serial-state');
    if (!SerialKeyer.supported) { state.textContent = 'このブラウザは Web Serial に対応していません'; return; }
    try {
      if (support.serial.connected) {
        await support.serial.close();
        state.textContent = '未接続';
        $('#btn-sup-serial').textContent = 'ポートを選んで接続';
      } else {
        await support.serial.connect();
        state.textContent = `接続中（${support.serial.line.toUpperCase()} でキーイング）`;
        $('#btn-sup-serial').textContent = '切断する';
      }
    } catch (err) {
      state.textContent = `接続できませんでした: ${err.message}`;
    }
  });
  $('#sup-serial-line').addEventListener('change', () => {
    support.serial.line = $('#sup-serial-line').value;
  });

  renderSupport();
}

// ═══════════════════════════════════════════ ログ帳

const logbook = { entries: loadLogbook(), editId: null, tz: 'jst', openTranscript: null };

/** JST は UTC + 9 時間。夏時間が無いので足し引きだけでよい。 */
const JST_MS = 9 * 3600 * 1000;

/** 保存している UTC の ISO を、表示設定に合わせて読める形にする。 */
function fmtLogTs(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const shown = logbook.tz === 'jst' ? new Date(d.getTime() + JST_MS) : d;
  return shown.toISOString().slice(0, 16).replace('T', ' ');
}

/** datetime-local（JST として扱う）→ UTC ISO。 */
const jstInputToIso = (value) => new Date(`${value}+09:00`).toISOString();

function setLogFormNow() {
  $('#log-date').value = new Date(Date.now() + JST_MS).toISOString().slice(0, 19);
}

function clearLogForm() {
  // 周波数・モード・RST は残す。連続してログを付けるとき、バンドや
  // モードは変わらないことが多い（HAMLOG などと同じ振る舞い）
  ['#log-call', '#log-name', '#log-qth', '#log-jcc', '#log-notes'].forEach((s) => { $(s).value = ''; });
  $('#log-qsls').checked = false;
  $('#log-qslr').checked = false;
  $('#log-history').hidden = true;
  logbook.editId = null;
  $('#log-form-title').textContent = '交信を登録する';
  $('#btn-log-add').textContent = '登録する';
  $('#btn-log-cancel').hidden = true;
  setLogFormNow();
}

/** コールを打ったら、その局との交信歴を出し、空欄を前回の値で埋める。 */
function showCallHistory() {
  const call = $('#log-call').value.toUpperCase().trim();
  const box = $('#log-history');
  const past = logHistory(logbook.entries, call).filter((e) => e.id !== logbook.editId);
  if (!call || !past.length) { box.hidden = true; return; }

  const last = past[0];
  const filled = [];
  for (const [sel, key] of [['#log-name', 'name'], ['#log-qth', 'qth'], ['#log-jcc', 'jcc']]) {
    if (!$(sel).value && last[key]) { $(sel).value = last[key]; filled.push($(sel).previousElementSibling?.textContent || key); }
  }
  box.hidden = false;
  box.textContent = `この局とは ${past.length} 回交信しています（前回 ${fmtLogTs(last.ts)} ${last.band || ''} ${last.mode || ''}）`
    + (filled.length ? ` — ${filled.join('・')}を前回の値で埋めました` : '');
}

function readLogForm() {
  const dateValue = $('#log-date').value;
  return {
    ts: dateValue ? jstInputToIso(dateValue) : new Date().toISOString(),
    call: $('#log-call').value,
    freq: $('#log-freq').value.trim(),
    band: bandFromFreq($('#log-freq').value),
    mode: $('#log-mode').value,
    rstS: $('#log-rsts').value.trim(),
    rstR: $('#log-rstr').value.trim(),
    name: $('#log-name').value.trim(),
    qth: $('#log-qth').value.trim(),
    jcc: $('#log-jcc').value.trim(),
    qslS: $('#log-qsls').checked,
    qslR: $('#log-qslr').checked,
    notes: $('#log-notes').value.trim(),
  };
}

function submitLogForm() {
  const fields = readLogForm();
  if (!fields.call.trim()) {
    const box = $('#log-history');
    box.hidden = false;
    box.textContent = 'コールサインを入れてください。';
    return;
  }
  if (logbook.editId) {
    const entry = logbook.entries.find((e) => e.id === logbook.editId);
    if (entry) Object.assign(entry, fields, { call: fields.call.toUpperCase().trim() });
  } else {
    logbook.entries.push(newEntry(fields));
  }
  saveLogbook(logbook.entries);
  clearLogForm();
  renderLogList();
  renderLogStats();
  $('#log-call').focus();
}

function startLogEdit(id) {
  const e = logbook.entries.find((x) => x.id === id);
  if (!e) return;
  logbook.editId = id;
  $('#log-date').value = new Date(new Date(e.ts).getTime() + JST_MS).toISOString().slice(0, 19);
  $('#log-call').value = e.call;
  $('#log-freq').value = e.freq;
  $('#log-band-out').textContent = e.band || '';
  $('#log-mode').value = e.mode || 'CW';
  $('#log-rsts').value = e.rstS;
  $('#log-rstr').value = e.rstR;
  $('#log-name').value = e.name;
  $('#log-qth').value = e.qth;
  $('#log-jcc').value = e.jcc;
  $('#log-notes').value = e.notes;
  $('#log-qsls').checked = !!e.qslS;
  $('#log-qslr').checked = !!e.qslR;
  $('#log-form-title').textContent = `${e.call} の記録を編集する`;
  $('#btn-log-add').textContent = '更新する';
  $('#btn-log-cancel').hidden = false;
  renderLogList();
  $('#panel-logbook').scrollIntoView?.();
  $('#log-call').focus();
}

/**
 * JCC 検索結果の共通描画。選ぶとフォームの JCC 欄と QTH 欄に入る。
 *
 * 名前は都道府県から書き下した形（jccQth）で出す。表の生の名前は
 * 「札幌」「西」のように県が抜けていて、そのままログに入れると
 * どこの市区か分からなくなるため。
 *
 * QTH は空でなくても入れ直す。選び直したのに前の地名が残っていては、
 * 直したつもりで直っていないログができてしまう。
 */
function renderJccHits(hits, box) {
  box.innerHTML = hits.map((h) => `
    <button type="button" class="jcc-hit" data-code="${h.code}">
      <span class="code">${h.code}</span>
      <span>${escapeHtml(jccQth(h.code) || h.name)}</span>
      ${h.gone ? '<span class="gone">消滅</span>' : ''}
      <span class="kind">${h.km != null ? `約 ${h.km} km / ` : ''}${h.kind}${h.roman ? ` / ${escapeHtml(h.roman)}` : ''}</span>
    </button>
    ${(h.wards || []).map((w) => `
      <button type="button" class="jcc-hit jcc-ward" data-code="${w.code}">
        <span class="code">${w.code}</span>
        <span>${escapeHtml(jccQth(w.code) || w.name)}</span>
        <span class="kind">区</span>
      </button>`).join('')}`).join('');
  $$('.jcc-hit', box).forEach((btn) => btn.addEventListener('click', () => {
    $('#log-jcc').value = btn.dataset.code;
    $('#log-qth').value = jccQth(btn.dataset.code);
  }));
}

/** 現在地（ブラウザの位置情報）に近い市郡を出す。 */
function findJccHere() {
  const note = $('#jcc-here-note');
  note.hidden = false;
  if (!navigator.geolocation) {
    note.textContent = 'このブラウザでは位置情報が使えません。';
    return;
  }
  note.textContent = '位置を調べています…（ブラウザの許可が要ります）';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const hits = nearestJcc(latitude, longitude);
      note.textContent = '現在地に近い順です。収録している座標は各市郡の代表点なので、'
        + '境界の近くでは隣が先に出ることがあります。正しいものを選んでください。';
      renderJccHits(hits, $('#jcc-results'));
    },
    (err) => {
      note.textContent = `位置を取れませんでした: ${err.message}。番号か名前で検索してください。`;
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  );
}

function renderJccResults() {
  const q = $('#jcc-query').value;
  const box = $('#jcc-results');
  const hits = jccSearch(q, 40);
  if (!q.trim()) { box.innerHTML = ''; return; }
  if (!hits.length) { box.innerHTML = '<p class="hint">見つかりません。漢字かローマ字、または番号で。</p>'; return; }
  renderJccHits(hits, box);
}

function renderLogList() {
  const filtered = searchLog(logbook.entries, {
    text: $('#log-search').value,
    band: $('#log-filter-band').value,
    mode: $('#log-filter-mode').value,
  }).sort((a, b) => b.ts.localeCompare(a.ts));

  const LIMIT = 200;
  const shown = filtered.slice(0, LIMIT);
  $('#log-count').textContent = filtered.length > LIMIT
    ? `${filtered.length} 件（新しい ${LIMIT} 件を表示。検索で絞り込めます）`
    : `${filtered.length} 件`;

  $('#log-rows').innerHTML = shown.map((e) => `
    <tr data-id="${e.id}" class="${e.id === logbook.editId ? 'is-editing' : ''}">
      <td class="mono">${fmtLogTs(e.ts)}</td>
      <td class="mono">${escapeHtml(e.call)}</td>
      <td>${escapeHtml(e.band || e.freq || '')}</td>
      <td>${escapeHtml(e.mode || '')}</td>
      <td class="mono">${escapeHtml([e.rstS, e.rstR].filter(Boolean).join('/'))}</td>
      <td>${escapeHtml(e.name || '')}</td>
      <td>${escapeHtml(e.qth || '')}</td>
      <td class="mono">${escapeHtml(e.jcc || '')}</td>
      <td>${e.qslS ? '送' : ''}${e.qslR ? '受' : ''}</td>
      <td class="row-actions">
        ${e.transcript?.length ? '<button type="button" class="btn" data-act="transcript">記録</button>' : ''}
        <button type="button" class="btn" data-act="edit">編集</button>
        <button type="button" class="btn" data-act="delete">削除</button>
      </td>
    </tr>`).join('');
}

function renderLogTranscript(entry) {
  const box = $('#log-transcript');
  if (!entry || logbook.openTranscript === entry.id) {
    logbook.openTranscript = null;
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  logbook.openTranscript = entry.id;
  box.hidden = false;
  box.innerHTML = `<strong>${escapeHtml(entry.call)} との交信記録</strong>\n`
    + entry.transcript.map((l) => `<span class="${l.dir === 'tx' ? 'tx' : 'rx'}">`
      + `${escapeHtml(l.at || '')} ${l.dir === 'tx' ? '送' : '受'}: ${escapeHtml(l.text)}</span>`).join('\n');
}

function renderLogStats() {
  const s = logStats(logbook.entries);
  const list = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`).join(' / ') || '—';
  $('#log-stats').innerHTML = `
    <div class="stat"><span class="n">${s.total}</span><span class="l">交信</span></div>
    <div class="stat"><span class="n">${s.calls}</span><span class="l">ユニーク局</span></div>
    <div class="stat"><span class="n">${s.jcc}</span><span class="l">JCC ワークド</span></div>
    <div class="stat"><span class="n">${s.jcg}</span><span class="l">JCG ワークド</span></div>
    <div class="stat"><span class="n">${s.qslR}</span><span class="l">QSL 受領</span></div>
    <div class="stat"><span class="l">バンド別</span><span>${list(s.byBand)}</span></div>
    <div class="stat"><span class="l">モード別</span><span>${list(s.byMode)}</span></div>`;
}

function downloadText(filename, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 交信サポートなど、他の画面からログへ 1 件登録する入口。 */
function addLogEntry(fields) {
  const entry = newEntry(fields);
  logbook.entries.push(entry);
  saveLogbook(logbook.entries);
  renderLogList();
  renderLogStats();
  return entry;
}

function initLogbook() {
  setLogFormNow();
  $('#btn-log-now').addEventListener('click', setLogFormNow);
  $('#log-freq').addEventListener('input', () => {
    $('#log-band-out').textContent = bandFromFreq($('#log-freq').value) || '';
  });
  $('#log-call').addEventListener('change', showCallHistory);
  $('#btn-log-add').addEventListener('click', submitLogForm);
  $('#btn-log-cancel').addEventListener('click', () => { clearLogForm(); renderLogList(); });
  $('#jcc-query').addEventListener('input', renderJccResults);
  $('#btn-jcc-here').addEventListener('click', findJccHere);

  // 絞り込みの選択肢。バンドは決まった並び、モードは登録フォームと同じ
  $('#log-filter-band').innerHTML = '<option value="">すべて</option>'
    + BAND_LABELS.map((b) => `<option>${b}</option>`).join('');
  $('#log-filter-mode').innerHTML = '<option value="">すべて</option>'
    + [...$('#log-mode').options].map((o) => `<option>${o.value}</option>`).join('');
  $('#log-search').addEventListener('input', renderLogList);
  $('#log-filter-band').addEventListener('change', renderLogList);
  $('#log-filter-mode').addEventListener('change', renderLogList);

  $('#btn-log-tz').addEventListener('click', () => {
    logbook.tz = logbook.tz === 'jst' ? 'utc' : 'jst';
    $('#btn-log-tz').textContent = logbook.tz === 'jst' ? 'JST 表示' : 'UTC 表示';
    renderLogList();
  });

  // 一覧の編集・削除・交信記録。行ごとにハンドラを張らず、表で受ける
  $('#log-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('tr')?.dataset.id;
    const entry = logbook.entries.find((x) => x.id === id);
    if (!entry) return;
    if (btn.dataset.act === 'edit') startLogEdit(id);
    else if (btn.dataset.act === 'transcript') renderLogTranscript(entry);
    else if (btn.dataset.act === 'delete') {
      if (!confirm(`${entry.call} ${fmtLogTs(entry.ts)} の記録を削除しますか？`)) return;
      logbook.entries = logbook.entries.filter((x) => x.id !== id);
      if (logbook.editId === id) clearLogForm();
      saveLogbook(logbook.entries);
      renderLogList();
      renderLogStats();
    }
  });

  const today = () => new Date().toISOString().slice(0, 10);
  $('#btn-log-adif').addEventListener('click', () =>
    downloadText(`cwtraining-log-${today()}.adi`, toAdif(logbook.entries), 'text/plain'));
  $('#btn-log-csv').addEventListener('click', () =>
    downloadText(`cwtraining-log-${today()}.csv`, toCsv(logbook.entries), 'text/csv'));

  const importFile = (input, parse, label) => async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = parse(await file.text());
      logbook.entries.push(...parsed);
      saveLogbook(logbook.entries);
      renderLogList();
      renderLogStats();
      $('#log-count').textContent = `${label}から ${parsed.length} 件を取り込みました（全 ${logbook.entries.length} 件）`;
    } catch (err) {
      $('#log-count').textContent = `取り込めませんでした: ${err.message}`;
    }
  };
  $('#log-import-adif').addEventListener('change', importFile($('#log-import-adif'), fromAdif, 'ADIF'));
  $('#log-import-csv').addEventListener('change', importFile($('#log-import-csv'), fromCsv, 'CSV'));

  renderLogList();
  renderLogStats();
}

init();

// 動作確認や自動テストから内部状態を触るためのハンドル。
// 画面の操作には使っていない。
window.__cw = {
  player, keyer, contest, responder,
  gradeProblem, compareSending, lookupTerm,  // 採点・用語引きを検証できるように公開する
  buildScript, gradeField, makeStation,       // ラバースタンプの言い回しを検証できるように
  sendingDiffHtml, comparisonColumns,        // 採点結果の見せ方を検証できるように
  sameSpacing, spacingUnits, spacingDiff,    // 100点＋（語の切れ目）の判定を検証できるように
  maybeAutoGrade, keyingEndedAt,             // 自動採点と、時間を止める時刻を検証できるように
  CELEBRATIONS, RANDOM_ID, celebrationById, runCelebration, clearCelebration,  // 祝い方 10 種類を検証できるように
  get paddleState() { return paddle; },
  redoKeying,                                // 打ち直しの入口を検証できるように
  DRILL_TYPES, makeProblem, termListHtml,    // ドリルの種類と解説を検証できるように
  jccSearch, jccQth, nearestJcc, toAdif, fromAdif, toCsv, fromCsv, bandFromFreq, logStats,  // ログ帳の検証用
  recordKeyPerChar,                          // 苦手文字の数え方を検証できるように
  addLogEntry,
  get logEntries() { return logbook.entries; },
  CWDecoder, SupportSession, SerialKeyer, keyTimeline,  // 交信サポートの検証用
  supportChar, supportWordBreak,             // デコーダー → 画面の配線を検証できるように
  get supportSession() { return supportSession(); },
  get supportState() { return support; },
  MORSE_TABLE,                               // 鳴らせない文字が混ざっていないかを検証できるように
  hintMask, HINT_LEVELS, HINT_MASK,          // 受信ヘルプの伏せ方を検証できるように
  KEY_PHRASE_TOPICS, ALL_KEY_PHRASES, ABBREVIATIONS,  // 定型文・語彙を検証できるように
  SYMBOL_ORDER,                              // 記号・プロサインの並びを検証できるように
  termCode, termTitle, taskTermsHtml,        // 説明に添える符号を検証できるように
  get hintLines() { return hintBoard.lines.map((l) => ({ ...l })); },
  get settings() { return settings; },
  get stats() { return stats; },
  get qsoScript() { return qso.script; },
  get qsoTurn() { return qso.script?.turns[qso.index] ?? null; },
  get qsoOptions() { return qso.currentOptions ?? null; },
  get qsoScores() { return qso.liveScores ? [...qso.liveScores] : null; },
  get drillProblem() { return drill.problem; },
  get keyerTask() { return paddle.task; },
};
