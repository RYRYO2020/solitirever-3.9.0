/**
 * utils.js
 * 汎用ユーティリティ関数群
 * ゲーム固有のロジックを含まず、計算やDOM操作のヘルパーを提供します。
 */

const Utils = {
    /**
     * 配列をランダムにシャッフルします (Fisher-Yates algorithm)
     * バイアスのかからない公平なランダム性を保証します。
     * @param {Array} array - シャッフルする配列
     * @returns {Array} シャッフルされた配列
     */
    shuffle: (array) => {
        const arr = [...array]; // 元の配列を破壊しないようコピー
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    },

    /**
     * DOM要素を生成するヘルパー
     * @param {string} tag - HTMLタグ名 (div, span, etc)
     * @param {string} className - クラス名
     * @param {Object} attributes - 属性オブジェクト { id: '...', 'data-x': '...' }
     * @returns {HTMLElement} 生成された要素
     */
    createElement: (tag, className = '', attributes = {}) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        
        Object.keys(attributes).forEach(key => {
            el.setAttribute(key, attributes[key]);
        });
        return el;
    },


    getRankSymbol: (rank) => {
        if (RANK_SYMBOLS[rank]) {
            return RANK_SYMBOLS[rank];
        }
        return rank.toString();
    },

    /**
     * 要素の絶対座標とサイズを取得します
     * @param {HTMLElement} element 
     * @returns {Object} { left, top, right, bottom, width, height }
     */
    getRect: (element) => {
        const rect = element.getBoundingClientRect();
        // スクロール量を加味する場合に備えてラップしていますが
        // 今回は overflow: hidden なのでそのままでOK
        return rect;
    },


    /**
     * 2つの矩形が重なっている面積を計算します
     * ドラッグ＆ドロップで「どのパイルに落とそうとしているか」の判定精度を上げるために使用します。
     * 単なるマウス座標の点判定よりも、直感的な操作感が得られます。
     * * @param {Object} rect1 - ドラッグ中のカードの矩形
     * @param {Object} rect2 - ターゲット候補の矩形
     * @returns {number} 重なっている面積 (px^2)
     */
    getIntersectionArea: (rect1, rect2) => {
        // 水平方向の重なり
        const xOverlap = Math.max(0, Math.min(rect1.right, rect2.right) - Math.max(rect1.left, rect2.left));
        // 垂直方向の重なり
        const yOverlap = Math.max(0, Math.min(rect1.bottom, rect2.bottom) - Math.max(rect1.top, rect2.top));
        
        return xOverlap * yOverlap;
    },

    /**
     * 指定されたミリ秒だけ待機する (非同期処理用)
     * アニメーションのタイミング調整などに使用
     */
    sleep: (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * ID文字列からパイルの種類とインデックスを解析します
     * 例: "tableau-3" -> { type: "tableau", index: 3 }
     */
    parsePileId: (pileId) => {
        if (!pileId) return null;
        
        if (pileId === 'stock' || pileId === 'waste') {
            return { type: pileId, index: 0 };
        }
        
        // "foundation-1" や "tableau-5" の解析
        const parts = pileId.split('-');
        if (parts.length === 2) {
            return { type: parts[0], index: parseInt(parts[1], 10) };
        }
        return null;
    },

    /**
     * スマートフォンのタッチイベントかマウスか判定する簡易ヘルパー
     */
    isTouchDevice: () => {
        return (('ontouchstart' in window) ||
           (navigator.maxTouchPoints > 0) ||
           (navigator.msMaxTouchPoints > 0));
    }
};