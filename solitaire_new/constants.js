const SUITS = Object.freeze(['hearts', 'diamonds', 'spades', 'clubs']);
const RANKS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

// スート（マーク）に関する設定
const SUIT_DATA = Object.freeze({
    hearts:   { symbol: '♥', color: 'red' },
    diamonds: { symbol: '♦', color: 'red' },
    spades:   { symbol: '♠', color: 'black' },
    clubs:    { symbol: '♣', color: 'black' }
});

// ランク（数字）の表示文字変換マップ
const RANK_SYMBOLS = Object.freeze({
    1: 'A',
    11: 'J',
    12: 'Q',
    13: 'K',
    // 2~10はそのまま数字を使うため定義しない
});

// ゲーム設定（コンフィグ）
const GAME_CONFIG = Object.freeze({
    // 場札でカードを重ねる時のずらし幅（ピクセル）
    TABLEAU_OFFSET_Y: 25,
    
    // アニメーション速度 (ms)
    ANIMATION_SPEED: 200,
    
    // ダブルクリック判定の間隔 (ms)
    DOUBLE_CLICK_DELAY: 300,
});

// スコアリングルール（標準的なクロンダイクのルールに基づく）
const SCORING = Object.freeze({
    WASTE_TO_TABLEAU: 5,        // 捨て札から場札へ
    WASTE_TO_FOUNDATION: 10,    // 捨て札から組札へ
    TABLEAU_TO_FOUNDATION: 10,  // 場札から組札へ
    TURN_OVER_TABLEAU_CARD: 5,  // 場札の裏向きカードをめくる
    FOUNDATION_TO_TABLEAU: -15, // 組札から場札へ戻す（ペナルティ）
    RECYCLE_STOCK: -100         // 山札を再利用（ペナルティ）
});

// HTML要素のIDプレフィックス（DOM操作用）
const DOM_IDS = Object.freeze({
    STOCK: 'stock',
    WASTE: 'waste',
    FOUNDATION_PREFIX: 'foundation-',
    TABLEAU_PREFIX: 'tableau-',
    SCORE: 'score',
    MOVES: 'moves'
});

// パイル（カード置き場）の種類識別子
const PILE_TYPES = Object.freeze({
    STOCK: 'stock',
    WASTE: 'waste',
    FOUNDATION: 'foundation',
    TABLEAU: 'tableau'
});

// Z-Index管理（CSSと整合性を取るための参考値）
const Z_LAYERS = Object.freeze({
    BASE: 10,
    DRAGGING: 9999
});

// エラーメッセージ定義
const ERRORS = Object.freeze({
    INVALID_MOVE: "その場所には置けません。",
    NO_MORE_UNDO: "これ以上戻せません。",
    DECK_EMPTY: "山札が空です。"
});