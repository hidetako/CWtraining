// 交信シミュレーションとドリルで使う語彙データ

/** コッホ法の標準的な学習順序。前から順に 1 文字ずつ増やしていく。 */
export const KOCH_ORDER = [
  'K', 'M', 'R', 'S', 'U', 'A', 'P', 'T', 'L', 'O', 'W', 'I', '.', 'N', 'J',
  'E', 'F', '0', 'Y', ',', 'V', 'G', '5', '/', 'Q', '9', 'Z', 'H', '3', '8',
  'B', '?', '4', '2', '7', 'C', '1', 'D', '6', 'X', '=',
];

/**
 * ローマ字・数字以外に、実際の交信で出てくる記号とプロサイン。
 * 交信で耳にする頻度の高い順に並べてある。
 *
 * 同じ符号を持つ表記は片方だけを載せている。+ は <AR>、( は <KN> と
 * まったく同じ音なので、両方を出題すると答えが一意に決まらなくなる。
 * 音として通用しているプロサイン表記のほうを採った（= だけは記号の
 * ほうが書かれることが多いので = を採用。<BT> と打っても正解になる）。
 */
export const SYMBOL_ORDER = [
  '=',      // BT。話題の切れ目。交信でいちばん多く出る記号
  '/',      // 移動運用の斜線（JA1ABC/1 など）
  '?',      // 問い合わせ
  '.',      // ピリオド
  ',',      // コンマ
  '<AR>',   // 送信の終わり
  '<SK>',   // 交信終了
  '<KN>',   // 指定局のみどうぞ
  '-',      // ハイフン（IC-7300 など）
  '<BK>',   // ブレークイン
  '@',      // アットマーク（メールアドレス）
];

/**
 * 実際の運用で耳にする頻度が高い順の文字群（頻度順練習用）。
 * 文字・数字のあとに記号とプロサインが続く。交信では区切りの = や
 * 移動局の / を取れないと意味が変わってしまうため、覚える対象に入れている。
 */
export const FREQUENCY_ORDER = [
  'E', 'T', 'A', 'O', 'I', 'N', 'S', 'R', 'H', 'D', 'L', 'U', 'C', 'M', 'F',
  'W', 'G', 'Y', 'P', 'B', 'V', 'K', 'J', 'X', 'Q', 'Z',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  ...SYMBOL_ORDER,
];

/** コールサインのプレフィックス。JA 系を厚めにしている。 */
const PREFIXES = {
  JA: ['JA', 'JE', 'JF', 'JG', 'JH', 'JI', 'JJ', 'JK', 'JL', 'JM', 'JN',
       'JO', 'JP', 'JQ', 'JR', 'JS', '7K', '7L', '7M', '7N', '8J'],
  NA: ['W', 'K', 'N', 'AA', 'AB', 'KB', 'KC', 'KD', 'WA', 'WB', 'VE', 'VA'],
  EU: ['DL', 'DK', 'DJ', 'G', 'G0', 'M0', 'F', 'I', 'IK', 'EA', 'SM', 'OH',
       'PA', 'ON', 'OK', 'SP', 'OZ', 'LA', 'S5', 'YO', 'HA', 'UA', 'RA'],
  AS: ['BY', 'BG', 'BH', 'HL', 'DS', 'VU', 'YB', 'YC', 'HS', 'E2', '9M2',
       '9V1', 'BV', 'XV', 'DU'],
  OC: ['VK', 'ZL', 'KH6', 'KH2', 'FK', 'YJ'],
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** オペレーター名。和名ローマ字と欧米名を混ぜている。 */
export const NAMES = {
  JA: ['TAKA', 'HIRO', 'KEN', 'YOSHI', 'MASA', 'TOMO', 'NORI', 'AKI', 'SHIN',
       'KAZU', 'JUN', 'TARO', 'SATO', 'YUKI', 'TETSU', 'MAKO', 'NAO', 'DAI',
       'KOJI', 'MITSU', 'HARU', 'RYO'],
  DX: ['BOB', 'JIM', 'TOM', 'JOHN', 'MIKE', 'DAVE', 'BILL', 'RON', 'STEVE',
       'PAUL', 'HANS', 'PETER', 'CARLOS', 'ANDY', 'MAX', 'LUIS', 'IVAN',
       'ERIC', 'FRANK', 'GEORGE', 'NICK', 'ALEX'],
};

export const QTH = {
  JA: ['TOKYO', 'OSAKA', 'NAGOYA', 'SAPPORO', 'FUKUOKA', 'SENDAI', 'KYOTO',
       'KOBE', 'YOKOHAMA', 'HIROSHIMA', 'CHIBA', 'SAITAMA', 'NIIGATA',
       'KANAZAWA', 'OKAYAMA', 'KUMAMOTO', 'NAGANO', 'SHIZUOKA', 'GIFU',
       'MATSUYAMA', 'AOMORI', 'NARA'],
  DX: ['SEATTLE', 'BOSTON', 'DALLAS', 'DENVER', 'CHICAGO', 'MIAMI',
       'TORONTO', 'BERLIN', 'MUNICH', 'LONDON', 'PARIS', 'ROME', 'MADRID',
       'STOCKHOLM', 'HELSINKI', 'WARSAW', 'PRAGUE', 'MOSCOW', 'SEOUL',
       'BEIJING', 'TAIPEI', 'BANGKOK', 'SYDNEY', 'AUCKLAND', 'JAKARTA'],
};

export const RIGS = [
  'FT-991A', 'FT-710', 'FT-817', 'FT-857', 'IC-7300', 'IC-705', 'IC-7610',
  'IC-7100', 'TS-590', 'TS-890', 'TS-850', 'K3', 'KX3', 'KX2', 'FTDX10',
  'FTDX101', 'QCX', 'HOMEBREW',
];

export const ANTENNAS = [
  'DP', 'INV V', 'GP', 'VERTICAL', '3ELE YAGI', '4ELE YAGI', '2ELE HB9CV',
  'LOOP', 'MAG LOOP', 'LW', 'EFHW', 'MOBILE WHIP', 'DELTA LOOP',
];

export const POWERS = ['5W', '10W', '20W', '50W', '100W', '200W', '500MW'];

export const WEATHER = [
  'FINE', 'SUNNY', 'CLOUDY', 'RAIN', 'HEAVY RAIN', 'SNOW', 'WINDY',
  'FOGGY', 'CLEAR', 'HOT', 'CLD', 'MILD',
];

export const RST_POOL = [
  '599', '599', '599', '589', '579', '569', '559', '549', '539', '449',
  '339', '229', '5NN',
];

export const GREETINGS = { morning: 'GM', afternoon: 'GA', evening: 'GE' };

/** CW 略語・Q 符号の対訳表。ドリルと用語集で共用する。 */
export const ABBREVIATIONS = [
  { code: 'CQ', ja: '一般呼出し' },
  { code: 'DE', ja: '〜から（こちらは）' },
  { code: 'K', ja: 'どうぞ（送信してください）' },
  { code: 'KN', ja: '指定局のみどうぞ' },
  { code: 'AR', ja: '送信の終わり' },
  { code: 'SK', ja: '交信終了' },
  { code: 'BT', ja: '区切り（=）' },
  { code: 'BK', ja: 'ブレークイン' },
  { code: 'R', ja: '了解' },
  { code: 'RST', ja: '信号レポート（了解度・信号強度・音調）' },
  { code: 'UR', ja: 'あなたの (your)' },
  { code: 'ES', ja: '〜と (and)' },
  { code: 'FB', ja: '素晴らしい (fine business)' },
  { code: 'FER', ja: '〜のために (for)' },
  { code: 'TNX', ja: 'ありがとう (thanks)' },
  { code: 'TKS', ja: 'ありがとう (thanks)' },
  { code: 'TU', ja: 'ありがとう (thank you)' },
  { code: 'PSE', ja: 'どうぞ (please)' },
  { code: 'HW', ja: 'いかがですか (how copy?)' },
  { code: 'GM', ja: 'おはようございます' },
  { code: 'GA', ja: 'こんにちは' },
  { code: 'GE', ja: 'こんばんは' },
  { code: 'GB', ja: 'さようなら' },
  { code: 'GL', ja: '幸運を (good luck)' },
  { code: 'GUD', ja: '良い (good)' },
  { code: 'OM', ja: '男性局 (old man)' },
  { code: 'YL', ja: '女性局 (young lady)' },
  { code: 'XYL', ja: '妻' },
  { code: 'OP', ja: 'オペレーター' },
  { code: 'QTH', ja: '所在地' },
  { code: 'RIG', ja: '無線機' },
  { code: 'ANT', ja: 'アンテナ' },
  { code: 'PWR', ja: '送信出力' },
  { code: 'WX', ja: '天気' },
  { code: 'TEMP', ja: '気温' },
  { code: 'AGN', ja: 'もう一度 (again)' },
  { code: 'ABT', ja: '約・〜について (about)' },
  { code: 'CFM', ja: '確認する (confirm)' },
  { code: 'CUAGN', ja: 'また会いましょう' },
  { code: 'HPE', ja: '望む (hope)' },
  { code: 'HR', ja: 'ここ (here)' },
  { code: 'NW', ja: '今 (now)' },
  { code: 'MNI', ja: 'たくさんの (many)' },
  { code: 'VY', ja: 'とても (very)' },
  { code: 'WID', ja: '〜と共に (with)' },
  { code: 'WKD', ja: '交信した (worked)' },
  { code: 'SRI', ja: 'ごめんなさい (sorry)' },
  { code: 'NIL', ja: '何もない' },
  { code: 'HI', ja: '笑い' },
  { code: '73', ja: '敬意を込めて（さようなら）' },
  { code: '88', ja: '愛と口づけを' },
  { code: 'QRL', ja: 'この周波数は使用中ですか' },
  { code: 'QRM', ja: '混信を受けている' },
  { code: 'QRN', ja: '空電に妨害されている' },
  { code: 'QRO', ja: '出力を上げてください' },
  { code: 'QRP', ja: '出力を下げてください／小電力局' },
  { code: 'QRQ', ja: 'もっと速く送ってください' },
  { code: 'QRS', ja: 'もっとゆっくり送ってください' },
  { code: 'QRT', ja: '送信を中止します' },
  { code: 'QRU', ja: '用件はありません' },
  { code: 'QRV', ja: '準備ができました' },
  { code: 'QRX', ja: '少しお待ちください' },
  { code: 'QRZ', ja: '誰が呼びましたか' },
  { code: 'QSB', ja: 'フェージングがあります' },
  { code: 'QSL', ja: '受信証（了解しました）' },
  { code: 'QSO', ja: '交信' },
  { code: 'QSY', ja: '周波数を変更してください' },
  { code: 'QTR', ja: '正確な時刻' },
  { code: 'QRG', ja: '正確な周波数' },

  // 天気・時刻・場所・電波の状況の話題で使う語
  { code: 'CLD', ja: '寒い (cold)' },
  { code: 'CLDY', ja: '曇り (cloudy)' },
  { code: 'SIG', ja: '信号 (signal)' },
  { code: 'SIGS', ja: '信号 (signals)' },
  { code: 'CONDX', ja: '伝搬状況 (conditions)' },
  { code: 'CPY', ja: '受信する・コピーする (copy)' },
  { code: 'RPRT', ja: 'レポート (report)' },
  { code: 'RPT', ja: '繰り返す (repeat)' },
  { code: 'STN', ja: '局 (station)' },
  { code: 'HVY', ja: '強い・激しい (heavy)' },
  { code: 'NR', ja: '〜の近く (near)／番号 (number)' },
  { code: 'ASL', ja: '海抜 (above sea level)' },
  { code: 'JCC', ja: 'JARL の市郡番号' },
  { code: 'JST', ja: '日本標準時' },
  { code: 'UTC', ja: '協定世界時' },
  { code: 'PCT', ja: '％ (percent)' },
  { code: 'DB', ja: 'デシベル（信号の強さ）' },
  { code: 'BURO', ja: 'QSL ビューロー（転送組織）' },
  { code: 'VIA', ja: '〜経由で' },
  { code: 'B4', ja: '以前に (before)' },
  { code: 'DWN', ja: '下がる (down)' },
];

/**
 * パドル送信の「交信の定型文」。話題ごとにまとめてある。
 *
 * {ME} {DX} {NAME} {QTH} {RIG} {PWR} {ANT} は自局の設定に差し替わる。
 * 実際の交信で打たれる書き方に寄せてあり、記号は = （BT・区切り）と
 * ? のみを使う。文の長さは 20〜40 文字程度に収め、1 回で打ち切れるようにした。
 */
export const KEY_PHRASE_TOPICS = {
  call: {
    label: '呼び出し・応答',
    phrases: [
      'CQ CQ CQ DE {ME} {ME} K',
      'CQ CQ DE {ME} {ME} PSE K',
      '{DX} DE {ME} {ME} K',
      '{DX} DE {ME} GE OM TNX FER CALL',
      'QRZ? DE {ME} K',
      'QRL? DE {ME}',
      '{DX} DE {ME} = R R GE OM',
    ],
  },

  basic: {
    label: '基本の交換（RST・名前・QTH）',
    phrases: [
      'UR RST 599 599 = NAME {NAME} {NAME}',
      'QTH {QTH} {QTH} = HW?',
      'R R FB OM ALL SOLID',
      'UR RST 579 579 = OP {NAME} {NAME}',
      'RIG HR {RIG} ES PWR {PWR}',
      'ANT HR {ANT} = HW CPY?',
      'TNX FER RPRT = UR RST 589 HR',
    ],
  },

  wx: {
    label: '天気',
    phrases: [
      'WX HR FINE ES TEMP 25C',
      'WX CLOUDY ES TEMP 18C = HW?',
      'HR WX RAIN NW ES WINDY',
      'WX SNOW HR = VY CLD TEMP -3C',
      'WX FB HR SUNNY ES WARM',
      'HR WX HOT ES HUMID TEMP 33C',
      'WX HR CLDY = TEMP 12C ES QRN',
      'RAIN STOPPED NW ES SUN OUT HI',
      'WX HR FOGGY = VY DAMP TODAY',
      'TNX FER WX INFO = HR SAME WX',
    ],
  },

  time: {
    label: '時刻',
    phrases: [
      'QTR HR 1430 JST',
      'QTR? = HR 0930 UTC',
      'HR TIME 2100 JST = GE OM',
      'NW 0600 JST ES SUN UP HR',
      'TIME HR 1200 JST = LUNCH TIME HI',
      'QTR 1800 JST = GE ES TNX QSO',
      'SRI MUST QRT = 2300 JST HR',
      'UR QTR PSE? = MY QTR 0745',
    ],
  },

  qth: {
    label: '場所・地理',
    phrases: [
      'QTH HR {QTH} {QTH}',
      'MY QTH {QTH} = ABT 50 KM N OF TOKYO',
      'QTH {QTH} = JCC 1001',
      'HR QTH NR THE SEA = VY QUIET',
      'QTH {QTH} = 100 M ASL',
      'UR QTH PSE AGN? = QRM HR',
      'QTH {QTH} ES OP {NAME} = HW?',
      'FB QTH = NR WKD UR AREA B4',
    ],
  },

  condx: {
    label: '電波の状況',
    phrases: [
      'UR SIGS 579 HR = SOME QRN',
      'CONDX FB TODAY ES BAND OPEN',
      'UR SIG STRONG ES SOLID CPY',
      'CONDX POOR HR = BAND NOISY',
      'UR RST 449 = QRN HVY HR',
      'SRI QRM DE OTHER STN PSE AGN',
      'BAND CLOSING NW = SIGS DOWN',
      'FB SIGS HR = 599 PLUS 20 DB',
      'CONDX UP ES DWN = HW UR SIDE?',
    ],
  },

  qsb: {
    label: 'フェージング',
    phrases: [
      'QSB HR PSE AGN',
      'UR SIG QSB DEEP = PSE RPT NAME',
      'SRI QSB = UR CALL AGN PSE',
      'QSB NW BUT CPY OK',
      'DEEP QSB HR = PSE QRS',
      'SIG FADING = PSE RPT UR QTH',
      'QSB ES QRN = CPY ABT 70 PCT',
      'QSB GONE NW = UR 599 AGN',
    ],
  },

  close: {
    label: '締めくくり',
    phrases: [
      'TNX FER NICE QSO ES 73',
      '{DX} DE {ME} TU 73 <SK>',
      'TNX QSO = HPE CUAGN ES 73',
      'GB OM ES GL = 73 73 <SK>',
      'QSL VIA BURO = TU 73',
      'MNI TNX FB QSO = 73 ES GB',
    ],
  },

  trouble: {
    label: '聞き返し・トラブル',
    phrases: [
      'PSE AGN AGN',
      'SRI QRM PSE QRS',
      'UR CALL AGN PSE = QRN HR',
      'PSE QRS = I AM BEGINNER HI',
      'SRI OM PSE RPT ALL AFTER RST',
      'QRX PSE = QRL HR = 5 MIN',
    ],
  },
};

/** 話題を指定せず、すべての定型文をひとつの配列にしたもの。 */
export const ALL_KEY_PHRASES =
  Object.values(KEY_PHRASE_TOPICS).flatMap((t) => t.phrases);

export function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

export function pickInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 現実的なコールサインを生成する。
 * region を省略すると JA を多めに含む配分で選ぶ。
 */
export function makeCallsign(region) {
  const key = region || pick(['JA', 'JA', 'JA', 'NA', 'EU', 'AS', 'OC']);
  const prefix = pick(PREFIXES[key] || PREFIXES.JA);

  // エリア番号は、プレフィックスが数字で終わっていない場合だけ付ける。
  // 9M2 や KH6 は番号を含んで完結しているが、7K や 7L は 7K1ABC のように続く。
  const endsWithDigit = /\d$/.test(prefix);
  const digit = endsWithDigit ? '' : String(pickInt(0, 9));

  const suffixLen = key === 'JA' ? pick([2, 3, 3]) : pick([2, 3, 3]);
  let suffix = '';
  for (let i = 0; i < suffixLen; i++) suffix += pick(LETTERS.split(''));

  return `${prefix}${digit}${suffix}`;
}

/** コールサインから日本局かどうかを推定する。 */
export function isJapanese(callsign) {
  return /^(J[A-S]|7[K-N]|8J)/.test(String(callsign).toUpperCase());
}

/** 現在時刻から挨拶（GM / GA / GE）を選ぶ。 */
export function greetingForHour(hour) {
  if (hour < 11) return GREETINGS.morning;
  if (hour < 17) return GREETINGS.afternoon;
  return GREETINGS.evening;
}
