/**
 * Card.js
 * トランプ1枚のデータ構造と振る舞いを定義するクラス
 * DOM要素の生成と、カード固有のルール判定ロジックを担当します。
 * 
 * [改善] コーナーインジケーター追加 - 重なっても下のカードのマークと数字が見える
 */
class Card {
    /**
     * @param {string} suit - 'hearts', 'diamonds', 'spades', 'clubs'
     * @param {number} rank - 1 to 13
     * @param {number} id - ユニークID
     */
    constructor(suit, rank, id) {
        this.suit = suit;
        this.rank = rank;
        this.id = id;

        this.color = SUIT_DATA[suit].color;
        this.isFaceUp = false;
        this.currentPileId = null;

        this.element = this._createDOM();
    }

    _createDOM() {
        const el = document.createElement('div');
        el.className = `card back ${this.color}`;
        el.id = `card-${this.id}`;

        el.setAttribute('data-id', this.id);
        el.setAttribute('data-rank', this.rank);
        el.setAttribute('data-suit', this.suit);
        el.setAttribute('data-color', this.color);

        const rankSymbol = Utils.getRankSymbol(this.rank);
        const suitSymbol = SUIT_DATA[this.suit].symbol;

        // コーナーインジケーター付きのリアルカードデザイン
        el.innerHTML = `
            <div class="card-corner card-corner-tl" aria-hidden="true">
                <span class="corner-rank">${rankSymbol}</span>
                <span class="corner-suit">${suitSymbol}</span>
            </div>
            <div class="card-center" aria-hidden="true">
                <span class="center-suit">${suitSymbol}</span>
            </div>
            <div class="card-corner card-corner-br" aria-hidden="true">
                <span class="corner-rank">${rankSymbol}</span>
                <span class="corner-suit">${suitSymbol}</span>
            </div>
        `;
        el.setAttribute('aria-label', `${rankSymbol} ${suitSymbol}`);

        return el;
    }

    /**
     * カードを表/裏にする（アニメーションあり）
     */
    flip(faceUp = true, animated = false) {
        if (animated) {
            this._flipAnimated(faceUp);
        } else {
            this.isFaceUp = faceUp;
            if (faceUp) {
                this.element.classList.remove('back');
            } else {
                this.element.classList.add('back');
            }
        }
    }

    /**
     * 3Dっぽいフリップアニメーション付きめくり
     */
    _flipAnimated(faceUp) {
        const el = this.element;

        // 既存アニメを止める
        el.getAnimations().forEach(a => a.cancel());

        el.classList.add('flipping');

        // アニメの半分で面を切り替え
        setTimeout(() => {
            this.isFaceUp = faceUp;
            if (faceUp) {
                el.classList.remove('back');
            } else {
                el.classList.add('back');
            }
        }, 130);

        setTimeout(() => {
            el.classList.remove('flipping');
        }, 300);
    }

    setPosition(x, y, zIndex) {
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
        if (zIndex !== undefined) {
            this.element.style.zIndex = zIndex;
        }
    }

    canPlaceOnTableau(targetCard) {
        if (!targetCard.isFaceUp) return false;
        const isDifferentColor = this.color !== targetCard.color;
        const isOneRankLower = this.rank === (targetCard.rank - 1);
        return isDifferentColor && isOneRankLower;
    }

    canPlaceOnFoundation(targetSuit, currentTopRank) {
        const isSameSuit = this.suit === targetSuit;
        const isNextRank = this.rank === (currentTopRank + 1);
        return isSameSuit && isNextRank;
    }

    /**
     * ドロップ成功バウンスエフェクト
     */
    playDropEffect() {
        this.element.classList.remove('drop-bounce');
        void this.element.offsetWidth;
        this.element.classList.add('drop-bounce');
        setTimeout(() => this.element.classList.remove('drop-bounce'), 350);
    }

    setDragging(isDragging) {
        if (isDragging) {
            this.element.classList.add('dragging');
        } else {
            this.element.classList.remove('dragging');
            this.element.style.left = '';
            this.element.style.right = '';
            this.element.style.top = '';
            this.element.style.width = '';
            this.element.style.position = '';
        }
    }
}
