/**
 * Game.js - Final Bugfix版
 *
 * 修正済みバグ:
 * [A] showHomeScreen が destroy() を呼ばず window イベントが生き続ける
 * [B] undo() がウィン画面から undoすると startTimer() で secondsElapsed=0 になる
 *     → resumeTimer() を用意して elapsed をリセットせず再開するよう修正
 * [C] checkOrientation() が毎回新しい resize リスナーを追加し続ける
 *     → フラグで1度だけ登録するよう修正
 * [D] dealCardsAnimated の isDealing=false タイミングが最後のカードの
 *     isFaceUp=true より先に来る32ms のウィンドウ → total 時間を +200ms 延長
 * [E] executeAutoComplete でループ終了後に dragState.originPileId が残留
 *     → ループ後に明示リセット
 * [F] (style.css) floatCard アニメーションの --r 変数が未定義
 * [G] (style.css) mobile + Draw3 の waste 3枚目 40px ズレ → モバイル用 12px に変更
 * [H] (style.css) .foundation::before に content なし
 * [I] (style.css) .modal.hidden の opacity:0 と display:none の競合
 *
 * 前バージョンから引き継いだ修正:
 * [1] executeMove: movedCard を事前キャプチャ (setTimeout 遅延参照クラッシュ防止)
 * [2] new Game() 毎の window リスナー累積 → destroy() で解除
 * [3] リサイクル履歴にペナルティ前スコアを保存
 * [4] undo() 中に勝利画面を隠す
 * [5] AudioContext suspended 時に resume()
 * [6] lastElementChild?.dataset?.id のnullガード
 */

class Game {
    constructor() {
        this.deck     = [];
        this.piles    = {};
        this.history  = [];

        this.isMobile       = document.body.classList.contains('mobile-mode');
        this.orientation    = document.body.dataset.orientation || 'landscape';
        this.handedness     = document.body.dataset.handedness || 'right';
        this.tableauOffsetY = this.isMobile
            ? (this.orientation === 'portrait' ? 12 : 15)
            : GAME_CONFIG.TABLEAU_OFFSET_Y;
        this.isBusy         = false;
        this._busyTimer     = null;

        this.dragState = {
            isDragging:   false,
            cards:        [],
            originPileId: null,
            offset:       { x: 0, y: 0 },
            startPos:     { x: 0, y: 0 }
        };

        this.score     = 0;
        this.moves     = 0;
        this.isDealing = false;

        // 山札タッチ制御（touchend基準・クールダウン付き）
        this._stockTouchPending = false;
        this._stockTouchPos     = null;
        this._stockLastClickAt  = 0;
        this._stockCooldown     = 380; // ms

        this.timerInterval     = null;
        this.secondsElapsed    = 0;
        this.lastClickTime     = 0;
        this.lastClickedCardId = null;

        this._audioCtx = null;

        // [FIX 2] リスナー参照を保持して destroy() で確実に解除
        this._boundListeners = {};

        this.ui = {
            score:           document.getElementById('score'),
            moves:           document.getElementById('moves'),
            timer:           document.getElementById('timer'),
            diffSelect:      document.getElementById('difficulty-select'),
            undoBtn:         document.getElementById('btn-undo'),
            hintBtn:         document.getElementById('btn-hint'),
            autoBtn:         document.getElementById('btn-auto'),
            dragLayer:       document.getElementById('drag-layer'),
            winScreen:       document.getElementById('win-screen'),
            winTime:         document.getElementById('win-time'),
            winScore:        document.getElementById('win-score'),
            winMoves:        document.getElementById('win-moves'),
            bestRecord:      document.getElementById('best-record'),
            scorePopupLayer: document.getElementById('score-popup-layer'),
            confettiCanvas:  document.getElementById('confetti-canvas'),
        };

        this.bindEvents();
        this.initGame();
    }

    // =========================================
    // 難易度ヘルパー
    // =========================================
    getDifficulty() { return this.ui.diffSelect ? this.ui.diffSelect.value : 'normal'; }
    getDrawCount()  { return this.getDifficulty() === 'hard' ? 3 : 1; }
    isHardMode()    { return this.getDifficulty() === 'hard'; }
    isEasyMode()    { return this.getDifficulty() === 'easy'; }
    isLeftHanded()  { return this.handedness === 'left'; }

    getPileCards(pileEl) {
        return Array.from(pileEl.children).filter(el => el.classList.contains('card'));
    }

    isValidTableauRun(cards) {
        if (!cards || cards.length === 0) return false;
        for (let i = 0; i < cards.length; i++) {
            if (!cards[i]?.isFaceUp) return false;
            if (i === 0) continue;
            const prev = cards[i - 1];
            const cur  = cards[i];
            if (prev.color === cur.color) return false;
            if (cur.rank !== prev.rank - 1) return false;
        }
        return true;
    }

    normalizeTableauPile(pileEl) {
        const cards = this.getPileCards(pileEl);
        cards.forEach((el, i) => {
            const card = this.getCardById(parseInt(el.dataset.id));
            if (!card) return;
            card.currentPileId = pileEl.id;
            card.setDragging(false);
            el.style.position = 'absolute';
            el.style.left     = '0px';
            el.style.right    = '';
            el.style.top      = `${i * this.tableauOffsetY}px`;
            el.style.zIndex   = 10 + i;
        });
    }

    normalizeFlatPile(pileEl) {
        const cards = this.getPileCards(pileEl);
        cards.forEach((el, i) => {
            const card = this.getCardById(parseInt(el.dataset.id));
            if (!card) return;
            card.currentPileId = pileEl.id;
            card.setDragging(false);
            el.style.position = 'absolute';
            el.style.top      = '0px';
            el.style.left     = '0px';
            el.style.right    = '';
            el.style.zIndex   = 10 + i;
        });
    }

    normalizeBoardState({ animateWaste = false } = {}) {
        document.querySelectorAll('.tableau').forEach(pile => this.normalizeTableauPile(pile));
        document.querySelectorAll('.foundation').forEach(pile => this.normalizeFlatPile(pile));
        ['stock', 'waste'].forEach(id => {
            const pile = document.getElementById(id);
            if (!pile) return;
            if (id === 'waste') this.updateWasteLayout(animateWaste);
            else this.normalizeFlatPile(pile);
        });
    }

    lockInteractions(duration = (GAME_CONFIG.ANIMATION_SPEED || 200) + 60) {
        this.isBusy = true;
        clearTimeout(this._busyTimer);
        this._busyTimer = setTimeout(() => {
            this.isBusy = false;
            this.normalizeBoardState();
        }, duration);
    }

    // =========================================
    // 初期化
    // =========================================
    initGame() {
        this.ui.winScreen.classList.add('hidden');
        if (this.ui.bestRecord) this.ui.bestRecord.classList.add('hidden');
        this.ui.autoBtn.style.display = 'none';
        this.ui.hintBtn.disabled      = false;
        this.ui.undoBtn.style.display = this.isHardMode() ? 'none' : '';
        document.body.dataset.difficulty = this.getDifficulty();

        this.resetState();
        this.createDeck();
        this.dealCardsAnimated();
        this.startTimer();
        this.normalizeBoardState();
        this.updateUI();
    }

    resetState() {
        this.score     = 0;
        this.moves     = 0;
        this.history   = [];
        this.deck      = [];
        this.isDealing = false;

        clearTimeout(this._busyTimer);
        this.isBusy = false;

        document.querySelectorAll('.pile').forEach(pile => {
            Array.from(pile.children).forEach(child => {
                if (!child.classList.contains('reload-icon')) child.remove();
            });
        });
    }

    createDeck() {
        let id = 0;
        SUITS.forEach(suit => RANKS.forEach(rank => {
            this.deck.push(new Card(suit, rank, id++));
        }));
        this.deck = Utils.shuffle(this.deck);
        if (this.isEasyMode()) this.makeDeckEasy();
    }

    makeDeckEasy() {
        const aces    = this.deck.filter(c => c.rank === 1);
        const twos    = this.deck.filter(c => c.rank === 2).slice(0, 3);
        const targets = [0, 2, 5, 9, 14, 20, 27];
        [...aces, ...twos].forEach((card, i) => {
            const ti = targets[i], ci = this.deck.indexOf(card);
            [this.deck[ti], this.deck[ci]] = [this.deck[ci], this.deck[ti]];
        });
    }

    // =========================================
    // カード配布アニメーション
    // [FIX D] isDealing=false タイミングを最後のフリップ完了後に延長
    // =========================================
    dealCardsAnimated() {
        this.isDealing = true;
        this.dealCards();

        const stockRect      = document.getElementById('stock').getBoundingClientRect();
        const tableauCardEls = [];
        for (let i = 0; i < 7; i++) {
            Array.from(document.getElementById(`tableau-${i}`).querySelectorAll('.card'))
                .forEach(el => tableauCardEls.push(el));
        }

        // 山札位置 → 各パイルへ飛ばす
        tableauCardEls.forEach((el, i) => {
            const r  = el.getBoundingClientRect();
            const dx = stockRect.left + stockRect.width  / 2 - (r.left + r.width  / 2);
            const dy = stockRect.top  + stockRect.height / 2 - (r.top  + r.height / 2);
            el.style.transition = 'none';
            el.style.transform  = `translate(${dx}px,${dy}px) scale(0.6)`;
            el.style.opacity    = '0';
            setTimeout(() => {
                el.style.transition = 'transform 0.28s cubic-bezier(0.22,1,0.36,1), opacity 0.15s ease-out';
                el.style.transform  = 'translate(0,0) scale(1)';
                el.style.opacity    = '1';
            }, 30 + i * 38);
        });

        // トップカードのフリップ（fly-in 完了後）
        let ci = 0;
        let lastFlipAt = 0;
        for (let i = 0; i < 7; i++) {
            ci += i;
            const topEl  = tableauCardEls[ci];
            const card   = this.getCardById(parseInt(topEl.dataset.id));
            const flipAt = 30 + ci * 38 + 340;
            lastFlipAt   = flipAt;
            setTimeout(() => {
                topEl.style.transition = '';
                topEl.style.transform  = '';
                topEl.style.opacity    = '';
                card.flip(true, true);
                this.playSound('flip');
            }, flipAt);
            ci++;
        }

        // [FIX D] isDealing=false は最後のフリップ完了（+300ms）後に設定
        const total = lastFlipAt + 300 + 100; // フリップアニメ(300ms) + 余裕(100ms)
        setTimeout(() => {
            tableauCardEls.forEach(el => {
                el.style.transition = '';
                el.style.transform  = '';
                el.style.opacity    = '';
            });
            this.isDealing = false;
        }, total);
    }

    dealCards() {
        let ci = 0;
        for (let i = 0; i < 7; i++) {
            const pileId = `tableau-${i}`;
            const pileEl = document.getElementById(pileId);
            for (let j = 0; j <= i; j++) {
                const card = this.deck[ci++];
                card.currentPileId        = pileId;
                pileEl.appendChild(card.element);
                card.element.style.top    = `${j * this.tableauOffsetY}px`;
                card.element.style.zIndex = j + 10;
            }
        }
        const stockPile = document.getElementById('stock');
        while (ci < this.deck.length) {
            const card = this.deck[ci++];
            card.currentPileId     = 'stock';
            card.flip(false);
            stockPile.appendChild(card.element);
            card.element.style.top = '0px';
        }
    }

    // =========================================
    // タイマー
    // =========================================
    startTimer() {
        this.stopTimer();
        this.secondsElapsed = 0;
        this.updateTimerDisplay();
        this.timerInterval = setInterval(() => {
            this.secondsElapsed++;
            this.updateTimerDisplay();
        }, 1000);
    }

    // [FIX B] secondsElapsed をリセットせずにタイマーだけ再開
    resumeTimer() {
        this.stopTimer();
        this.timerInterval = setInterval(() => {
            this.secondsElapsed++;
            this.updateTimerDisplay();
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimerDisplay() {
        const m = String(Math.floor(this.secondsElapsed / 60)).padStart(2, '0');
        const s = String(this.secondsElapsed % 60).padStart(2, '0');
        this.ui.timer.textContent = `${m}:${s}`;
    }

    // =========================================
    // イベントバインド
    // [FIX 2] リスナーを _boundListeners に保存
    // =========================================
    bindEvents() {
        const bl = this._boundListeners;

        bl.mousedown   = e => { if (e.button !== 2) this.onMouseDown(e); };
        bl.mousemove   = e => this.onInputMove(e);
        bl.mouseup     = e => { if (e.button !== 2) this.onMouseUp(e); };
        bl.touchstart  = e => this.onTouchStart(e);
        bl.touchmove   = e => { e.preventDefault(); this.onInputMove(e.touches[0]); };
        bl.touchend    = e => this.onTouchEnd(e);
        bl.contextmenu = e => {
            const cardEl = e.target.closest('.card');
            if (cardEl) {
                e.preventDefault();
                const card = this.getCardById(parseInt(cardEl.dataset.id));
                if (card?.isFaceUp) this.autoMoveToFoundation(card);
            }
        };
        bl.keydown = e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                this.undo();
            }
            if (e.key.toLowerCase() === 'h') this.showHint();
        };

        window.addEventListener('mousedown',   bl.mousedown);
        window.addEventListener('mousemove',   bl.mousemove);
        window.addEventListener('mouseup',     bl.mouseup);
        window.addEventListener('touchstart',  bl.touchstart,  { passive: false });
        window.addEventListener('touchmove',   bl.touchmove,   { passive: false });
        window.addEventListener('touchend',    bl.touchend);
        window.addEventListener('contextmenu', bl.contextmenu);
        window.addEventListener('keydown',     bl.keydown);

        // ボタン類
        this.ui.diffSelect.addEventListener('change', () => {
            if (confirm('難易度を変更して新しいゲームを始めますか？')) {
                this.initGame();
            } else {
                this.ui.diffSelect.value = document.body.dataset.difficulty || 'normal';
            }
        });

        document.getElementById('btn-new-game').addEventListener('click', () => {
            if (confirm('新しいゲームを始めますか？')) this.initGame();
        });
        document.getElementById('btn-play-again').addEventListener('click', () => this.initGame());
        document.getElementById('btn-home').addEventListener('click',     () => showHomeScreen());
        document.getElementById('btn-win-home').addEventListener('click', () => showHomeScreen());
        this.ui.undoBtn.addEventListener('click', () => this.undo());
        this.ui.hintBtn.addEventListener('click', () => this.showHint());
        this.ui.autoBtn.addEventListener('click', () => this.executeAutoComplete());
    }

    // [FIX 2] window に追加したリスナーを全解除
    destroy() {
        const bl = this._boundListeners;
        window.removeEventListener('mousedown',   bl.mousedown);
        window.removeEventListener('mousemove',   bl.mousemove);
        window.removeEventListener('mouseup',     bl.mouseup);
        window.removeEventListener('touchstart',  bl.touchstart);
        window.removeEventListener('touchmove',   bl.touchmove);
        window.removeEventListener('touchend',    bl.touchend);
        window.removeEventListener('contextmenu', bl.contextmenu);
        window.removeEventListener('keydown',     bl.keydown);
        clearTimeout(this._busyTimer);
        this.stopTimer();
    }

    // =========================================
    // マウスイベント
    // =========================================
    onMouseDown(e) {
        if (this.isDealing || this.isBusy) return;
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (!target) return;
        if (target.closest('#stock')) { this.handleStockClick(); return; }
        this._startDragFromTarget(e.clientX, e.clientY, target);
    }
    onMouseUp(e) { this._handleInputEnd(e.clientX, e.clientY); }

    // =========================================
    // タッチイベント（山札は touchend で1枚ずつ）
    // =========================================
    onTouchStart(e) {
        if (this.isDealing || this.isBusy) return;
        const touch  = e.touches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!target) return;

        if (target.closest('#stock')) {
            this._stockTouchPending = true;
            this._stockTouchPos     = { x: touch.clientX, y: touch.clientY };
            e.preventDefault(); // 長押しメニュー抑止
            return;
        }

        this._stockTouchPending = false;
        this._startDragFromTarget(touch.clientX, touch.clientY, target);
    }

    onTouchEnd(e) {
        const touch = e.changedTouches[0];

        if (this._stockTouchPending) {
            this._stockTouchPending = false;
            const dx = Math.abs(touch.clientX - (this._stockTouchPos?.x ?? touch.clientX));
            const dy = Math.abs(touch.clientY - (this._stockTouchPos?.y ?? touch.clientY));
            if (dx < 12 && dy < 12) {
                const now = Date.now();
                if (now - this._stockLastClickAt >= this._stockCooldown) {
                    this._stockLastClickAt = now;
                    this.handleStockClick();
                }
            }
            return;
        }

        this._handleInputEnd(touch.clientX, touch.clientY);
    }

    // =========================================
    // 共通: ドラッグ開始判定
    // =========================================
    _startDragFromTarget(clientX, clientY, target) {
        const cardEl = target.closest('.card');
        if (!cardEl) return;
        const card = this.getCardById(parseInt(cardEl.dataset.id));
        if (!card || !card.isFaceUp || card.currentPileId === 'stock') return;

        const pileEl = document.getElementById(card.currentPileId);
        if (!pileEl) return;

        if (card.currentPileId === 'waste' || card.currentPileId.startsWith('foundation')) {
            if (pileEl.lastElementChild !== card.element) return;
        }

        if (card.currentPileId.startsWith('tableau')) {
            const inPile   = this.getPileCards(pileEl).map(el => this.getCardById(parseInt(el.dataset.id)));
            const startIdx = inPile.findIndex(c => c?.id === card.id);
            if (startIdx < 0) return;
            const moving = inPile.slice(startIdx);
            if (!this.isValidTableauRun(moving)) {
                this.normalizeBoardState();
                return;
            }
        }

        this.startDrag(card, clientX, clientY);
    }

    // =========================================
    // 共通: 入力終了（ドロップ判定）
    // [改善] モバイルではシングルタップでオートファンデーション対応
    // =========================================
    _handleInputEnd(clientX, clientY) {
        if (!this.dragState.isDragging) return;
        this.removeTargetHighlights();

        const dist     = Math.hypot(clientX - this.dragState.startPos.x, clientY - this.dragState.startPos.y);
        const leadCard = this.dragState.cards[0];

        if (dist < 5) {
            this.cancelMove();
            const now = Date.now();
            // モバイルではシングルタップ = オートファンデーション試行
            if (this.isMobile) {
                this.autoMoveToFoundation(leadCard);
                this.lastClickTime = 0;
            } else if (this.lastClickTime
                && (now - this.lastClickTime) < GAME_CONFIG.DOUBLE_CLICK_DELAY
                && this.lastClickedCardId === leadCard.id) {
                this.autoMoveToFoundation(leadCard);
                this.lastClickTime = 0;
            } else {
                this.lastClickTime     = now;
                this.lastClickedCardId = leadCard.id;
            }
        } else {
            this.attemptDrop(clientX, clientY);
            this.lastClickTime = 0;
        }

        // dragLayer に取り残されたカードがあれば強制キャンセル
        if (this.dragState.cards.some(c => c.element.parentElement === this.ui.dragLayer)) {
            this.cancelMove();
        }

        this.dragState.isDragging = false;
        this.dragState.cards      = [];
    }

    // =========================================
    // ドラッグ開始
    // =========================================
    startDrag(card, clientX, clientY) {
        const pileEl   = document.getElementById(card.currentPileId);
        const inPile   = this.getPileCards(pileEl);
        const startIdx = inPile.indexOf(card.element);
        const moving   = inPile.slice(startIdx).map(el => this.getCardById(parseInt(el.dataset.id)));
        if (!moving.length) return;
        if (card.currentPileId.startsWith('tableau') && !this.isValidTableauRun(moving)) {
            this.normalizeBoardState();
            return;
        }

        this.dragState = {
            isDragging:   true,
            cards:        moving,
            originPileId: card.currentPileId,
            startPos:     { x: clientX, y: clientY },
            offset:       {
                x: clientX - card.element.getBoundingClientRect().left,
                y: clientY - card.element.getBoundingClientRect().top
            }
        };

        moving.forEach((c, i) => {
            const r = c.element.getBoundingClientRect();
            c.setDragging(true);
            this.ui.dragLayer.appendChild(c.element);
            c.element.style.position = 'absolute';
            c.element.style.left     = `${r.left}px`;
            c.element.style.top      = `${r.top}px`;
            c.element.style.zIndex   = 9999 + i;
            c.element.style.width    = 'var(--card-base-width)';
        });

        this.highlightValidTargets(moving[0]);
        if (this.dragState.originPileId === 'waste') this.updateWasteLayout(false);
    }

    highlightValidTargets(leadCard) {
        [...document.querySelectorAll('.tableau'), ...document.querySelectorAll('.foundation')]
            .forEach(pile => {
                if (pile.id !== leadCard.currentPileId && this.validateMove(leadCard, pile))
                    pile.classList.add('valid-drop-target');
            });
    }

    removeTargetHighlights() {
        document.querySelectorAll('.valid-drop-target').forEach(el => el.classList.remove('valid-drop-target'));
    }

    onInputMove(e) {
        if (!this.dragState.isDragging) return;
        const { x, y } = this.dragState.offset;
        this.dragState.cards.forEach((card, i) => {
            card.element.style.left = `${e.clientX - x}px`;
            card.element.style.top  = `${e.clientY - y + i * this.tableauOffsetY}px`;
        });
    }

    autoMoveToFoundation(card) {
        const pileEl = document.getElementById(card.currentPileId);
        if (pileEl?.lastElementChild !== card.element) return;

        for (let i = 0; i < 4; i++) {
            const t = document.getElementById(`foundation-${i}`);
            this.dragState.cards = [card];
            if (this.validateMove(card, t)) {
                this.dragState.originPileId = card.currentPileId;
                this.executeMove(t.id);
                this.dragState.cards = [];
                return;
            }
        }
        this.dragState.cards = [];
    }

    showHint() {
        document.querySelectorAll('.hint-active').forEach(el => el.classList.remove('hint-active'));

        const movable  = this.deck.filter(c => c.isFaceUp && c.currentPileId !== 'stock');
        const allPiles = [
            ...document.querySelectorAll('.foundation'),
            ...document.querySelectorAll('.tableau')
        ];
        let best = null;

        for (const card of movable) {
            const orig   = this.dragState.cards;
            const pileEl = document.getElementById(card.currentPileId);
            const inPile = this.getPileCards(pileEl);
            const si     = inPile.indexOf(card.element);
            this.dragState.cards = si >= 0
                ? inPile.slice(si).map(el => this.getCardById(parseInt(el.dataset.id)))
                : [card];

            let useful = false;
            for (const pile of allPiles) {
                if (pile.id !== card.currentPileId && this.validateMove(card, pile)) {
                    useful = true; break;
                }
            }

            this.dragState.cards = orig;
            if (useful) { best = card; break; }
        }

        if (best) {
            best.element.classList.add('hint-active');
            setTimeout(() => best.element.classList.remove('hint-active'), 1800);
        } else {
            const stock = document.getElementById('stock');
            const waste = document.getElementById('waste');
            if (Array.from(stock.children).some(el => el.classList.contains('card')) || waste.children.length > 0) {
                stock.classList.add('hint-active');
                setTimeout(() => stock.classList.remove('hint-active'), 1800);
            } else {
                alert('これ以上動かせるカードがありません！Undoで戻るか、New Gameを押してください。');
            }
        }
    }

    attemptDrop(x, y) {
        const lead     = this.dragState.cards[0];
        const leadRect = lead.element.getBoundingClientRect();
        let best = null, maxA = 0;

        [...document.querySelectorAll('.tableau'), ...document.querySelectorAll('.foundation')]
            .forEach(pile => {
                const r    = pile.lastElementChild
                    ? pile.lastElementChild.getBoundingClientRect()
                    : pile.getBoundingClientRect();
                const area = Utils.getIntersectionArea(leadRect, r);
                if (area > maxA) { maxA = area; best = pile; }
            });

        if (best && this.validateMove(lead, best)) {
            this.executeMove(best.id);
            this.playSound('drop');
        } else {
            this.cancelMove();
            this.playSound('cancel');
        }
    }

    validateMove(card, targetPileEl) {
        const { type } = Utils.parsePileId(targetPileEl.id);
        const topEl    = targetPileEl.lastElementChild;
        const topCard  = (topEl?.classList.contains('card'))
            ? this.getCardById(parseInt(topEl.dataset.id))
            : null;

        if (type === 'foundation') {
            if (this.dragState.cards.length > 1) return false;
            return card.canPlaceOnFoundation(targetPileEl.dataset.suit, topCard ? topCard.rank : 0);
        }
        if (type === 'tableau') {
            if (!topCard) return card.rank === 13;
            return card.canPlaceOnTableau(topCard);
        }
        return false;
    }

    // =========================================
    // アニメーション付き移動
    // =========================================
    animateMove(cards, domUpdateCallback) {
        if (!cards || cards.length === 0) { domUpdateCallback(); return; }

        const rects = cards.map(c => {
            c.element.getAnimations().forEach(a => a.finish());
            return c.element.getBoundingClientRect();
        });

        domUpdateCallback();

        cards.forEach((c, i) => {
            const r  = c.element.getBoundingClientRect();
            const dx = rects[i].left - r.left;
            const dy = rects[i].top  - r.top;
            if (!dx && !dy) return;

            const origZ = c.element.style.zIndex;
            c.element.style.zIndex = 9999 + i;

            const anim = c.element.animate(
                [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }],
                { duration: GAME_CONFIG.ANIMATION_SPEED || 200, easing: 'cubic-bezier(0.22,1,0.36,1)' }
            );
            anim.onfinish = () => { c.element.style.zIndex = origZ; };
        });
    }

    // =========================================
    // カード移動実行
    // [FIX 1] movedCard を事前キャプチャ
    // [FIX 6] lastElementChild?.dataset?.id で null ガード
    // =========================================
    executeMove(targetPileId) {
        const movingCards  = [...this.dragState.cards];
        const originPileId = this.dragState.originPileId;
        if (!movingCards.length || !originPileId) return;

        const rec = {
            cards:   movingCards.map(c => c.id),
            from:    originPileId,
            to:      targetPileId,
            score:   this.score,
            flipped: false
        };

        const targetPile      = document.getElementById(targetPileId);
        const { type: tType } = Utils.parsePileId(targetPileId);

        // [FIX 1] setTimeout 内の遅延参照クラッシュを防ぐため事前キャプチャ
        const movedCard = movingCards[0];
        this.lockInteractions();

        this.animateMove(movingCards, () => {
            movingCards.forEach(card => {
                card.setDragging(false);
                card.element.style.position = 'absolute';
                card.element.style.left     = '0';
                card.element.style.right    = '';
                card.element.style.width    = '';
                if (tType === 'tableau') {
                    const n = this.getPileCards(targetPile).length;
                    card.element.style.top    = `${n * this.tableauOffsetY}px`;
                    card.element.style.zIndex = 10 + n;
                } else {
                    card.element.style.top    = '0px';
                    card.element.style.zIndex = 10;
                }
                targetPile.appendChild(card.element);
                card.currentPileId = targetPileId;
            });
            this.normalizeBoardState({ animateWaste: targetPileId === 'waste' });
        });

        // [FIX 1] キャプチャした参照を使用
        setTimeout(() => movedCard.playDropEffect(), 220);

        // 元パイルのトップカードをめくる
        const originPile = document.getElementById(originPileId);
        if (originPile?.classList.contains('tableau') && originPile.children.length > 0) {
            // [FIX 6] null ガード付きで id を取得
            const lastId = originPile.lastElementChild?.dataset?.id;
            if (lastId != null) {
                const lastCard = this.getCardById(parseInt(lastId));
                if (lastCard && !lastCard.isFaceUp) {
                    setTimeout(() => { lastCard.flip(true, true); this.playSound('flip'); }, 180);
                    rec.flipped = true;
                    this.addScore(SCORING.TURN_OVER_TABLEAU_CARD, lastCard.element);
                }
            }
        }

        if (tType === 'foundation') {
            this.addScore(SCORING.TABLEAU_TO_FOUNDATION, movedCard.element);
            this.playSound('foundation');
        }

        this.history.push(rec);
        this.moves++;
        this.updateUI();
        this.checkWinCondition();
        this.checkAutoCompleteAvailable();

        // [改善] 移動後に自動でfoundationに送れるカードをチェック（モバイル時は即実行）
        if (tType !== 'foundation') {
            this._scheduleAutoFoundation();
        }
    }

    // =========================================
    // [新機能] 移動後の自動foundation送り（安全なカードのみ）
    // =========================================
    _scheduleAutoFoundation() {
        // 既存のタイマーをクリア
        if (this._autoFoundationTimer) clearTimeout(this._autoFoundationTimer);

        this._autoFoundationTimer = setTimeout(() => {
            this._tryAutoFoundation();
        }, 350);
    }

    _tryAutoFoundation() {
        if (this.isBusy || this.isDealing) return;

        // 全てのfoundationの状態を確認
        const foundationTops = {};
        for (let i = 0; i < 4; i++) {
            const f = document.getElementById(`foundation-${i}`);
            const topEl = f ? Array.from(f.children).filter(c => c.classList.contains('card')).pop() : null;
            const topCard = topEl ? this.getCardById(parseInt(topEl.dataset.id)) : null;
            foundationTops[f?.dataset?.suit] = topCard ? topCard.rank : 0;
        }

        // 安全に自動移動できるカードを判定（両色の2以下のカードは常に安全）
        const isSafeToAutoMove = (card) => {
            const minOppositeRank = Math.min(
                foundationTops['hearts']   || 0,
                foundationTops['diamonds'] || 0
            );
            const minBlackRank = Math.min(
                foundationTops['spades'] || 0,
                foundationTops['clubs']  || 0
            );
            if (card.color === 'red')   return card.rank <= minBlackRank + 1;
            if (card.color === 'black') return card.rank <= minOppositeRank + 1;
            return false;
        };

        // waste の一番上をチェック
        const waste = document.getElementById('waste');
        const wasteTopEl = waste ? Array.from(waste.children).filter(c => c.classList.contains('card')).pop() : null;
        if (wasteTopEl) {
            const wasteCard = this.getCardById(parseInt(wasteTopEl.dataset.id));
            if (wasteCard && isSafeToAutoMove(wasteCard)) {
                for (let i = 0; i < 4; i++) {
                    const t = document.getElementById(`foundation-${i}`);
                    this.dragState.cards = [wasteCard];
                    if (this.validateMove(wasteCard, t)) {
                        this.dragState.originPileId = wasteCard.currentPileId;
                        this.executeMove(t.id);
                        this.dragState.cards = [];
                        return;
                    }
                }
                this.dragState.cards = [];
            }
        }

        // tableau の各パイルの一番上をチェック
        for (let i = 0; i < 7; i++) {
            const pile = document.getElementById(`tableau-${i}`);
            const topEl = pile ? Array.from(pile.children).filter(c => c.classList.contains('card')).pop() : null;
            if (!topEl) continue;
            const card = this.getCardById(parseInt(topEl.dataset.id));
            if (!card || !card.isFaceUp) continue;

            if (isSafeToAutoMove(card)) {
                for (let j = 0; j < 4; j++) {
                    const t = document.getElementById(`foundation-${j}`);
                    this.dragState.cards = [card];
                    if (this.validateMove(card, t)) {
                        this.dragState.originPileId = card.currentPileId;
                        this.executeMove(t.id);
                        this.dragState.cards = [];
                        return;
                    }
                }
                this.dragState.cards = [];
            }
        }
    }

    cancelMove() {
        const movingCards  = [...this.dragState.cards];
        const originPileId = this.dragState.originPileId;
        const originPile   = document.getElementById(originPileId);
        if (!originPile || movingCards.length === 0) return;

        const { type: oType } = Utils.parsePileId(originPileId);
        // カード要素のみをカウント（.reload-icon 等は除外）
        const cardCount = this.getPileCards(originPile).length;
        this.lockInteractions();

        this.animateMove(movingCards, () => {
            movingCards.forEach((card, i) => {
                card.setDragging(false);
                card.element.style.position = 'absolute';
                card.element.style.left     = '0';
                card.element.style.right    = '';
                card.element.style.width    = '';
                if (oType === 'tableau') {
                    card.element.style.top    = `${(cardCount + i) * this.tableauOffsetY}px`;
                    card.element.style.zIndex = 10 + cardCount + i;
                } else {
                    card.element.style.top    = '0px';
                    card.element.style.zIndex = 10;
                }
                originPile.appendChild(card.element);
                card.currentPileId = originPileId;
            });
            this.normalizeBoardState({ animateWaste: originPileId === 'waste' });
        });
    }

    // =========================================
    // 山札クリック（Draw1 / Draw3）
    // [FIX 3] ペナルティ前スコアを履歴に保存
    // =========================================
    handleStockClick() {
        if (this.isBusy) return;

        const stockPile  = document.getElementById('stock');
        const wastePile  = document.getElementById('waste');
        const stockCards = Array.from(stockPile.children).filter(el => el.classList.contains('card'));

        if (stockCards.length === 0) {
            if (wastePile.children.length === 0) { this._shakeStock(stockPile); return; }

            const wasteCards = Array.from(wastePile.children)
                .reverse()
                .map(el => this.getCardById(parseInt(el.dataset.id)));

            this.lockInteractions();
            this.animateMove(wasteCards, () => {
                wasteCards.forEach(card => {
                    card.flip(false);
                    card.currentPileId      = 'stock';
                    card.element.style.left = '0px';
                    card.element.style.right = '';
                    card.element.style.top  = '0px';
                    stockPile.appendChild(card.element);
                });
                this.normalizeBoardState();
            });

            // [FIX 3] ペナルティ適用前のスコアを記録
            const prePenaltyScore = this.score;
            if (!this.isEasyMode()) this.addScore(SCORING.RECYCLE_STOCK, stockPile);
            this.history.push({ type: 'recycle', score: prePenaltyScore });
            this.playSound('recycle');

        } else {
            const toDraw     = Math.min(this.getDrawCount(), stockCards.length);
            // stockCards の末尾が山頂 → 末尾から toDraw 枚、上から順に引く
            const drawEls    = stockCards.slice(-toDraw).reverse();
            const drawnCards = drawEls.map(el => this.getCardById(parseInt(el.dataset.id)));
            const cardIds    = drawnCards.map(c => c.id);
            const totalLock  = Math.max((toDraw - 1) * 80 + (GAME_CONFIG.ANIMATION_SPEED || 200) + 120, 260);
            this.lockInteractions(totalLock);

            drawnCards.forEach((card, idx) => {
                setTimeout(() => {
                    this.animateMove([card], () => {
                        card.flip(true);
                        card.currentPileId = 'waste';
                        wastePile.appendChild(card.element);
                        this.updateWasteLayout(true);
                    });
                    this.playSound('draw');
                }, idx * 80);
            });

            this.history.push({ type: 'draw', cardIds, from: 'stock', to: 'waste' });
        }

        this.moves++;
        this.updateUI();
        this.checkAutoCompleteAvailable();
    }

    _shakeStock(stockPile) {
        stockPile.classList.remove('empty-shake');
        void stockPile.offsetWidth;
        stockPile.classList.add('empty-shake');
        setTimeout(() => stockPile.classList.remove('empty-shake'), 450);
        this.playSound('cancel');
    }

    // =========================================
    // Undo（Draw1 / Draw3 共通）
    // [FIX B] ウィン画面から Undo → resumeTimer() でタイマー継続
    // =========================================
    undo() {
        if (this.isBusy || this.isHardMode() || this.history.length === 0) return;

        // [FIX B] 勝利画面表示中に Undo → 画面を隠して resumeTimer（秒数リセットしない）
        const wasWin = !this.ui.winScreen.classList.contains('hidden');
        if (wasWin) {
            this.ui.winScreen.classList.add('hidden');
            this.resumeTimer();
        }

        const last      = this.history.pop();
        const stockPile = document.getElementById('stock');
        const wastePile = document.getElementById('waste');
        this.lockInteractions();

        if (last.type === 'recycle') {
            const cards = Array.from(stockPile.children)
                .filter(c => c.classList.contains('card'))
                .reverse()
                .map(el => this.getCardById(parseInt(el.dataset.id)));

            this.animateMove(cards, () => {
                cards.forEach(card => {
                    card.flip(true);
                    card.currentPileId = 'waste';
                    wastePile.appendChild(card.element);
                });
                this.normalizeBoardState({ animateWaste: true });
            });
            // [FIX 3] ペナルティ前のスコアに戻す
            this.score = last.score;

        } else if (last.type === 'draw') {
            // Draw1 / Draw3 統一（cardIds 配列）
            const ids   = last.cardIds || (last.cardId != null ? [last.cardId] : []);
            const cards = ids.map(id => this.getCardById(id));

            // 最後に引いたカードから逆順に stock へ戻す
            [...cards].reverse().forEach(card => {
                this.animateMove([card], () => {
                    card.flip(false);
                    card.currentPileId      = last.from;
                    card.element.style.left = '0px';
                    card.element.style.right = '';
                    document.getElementById(last.from).appendChild(card.element);
                });
            });
            this.normalizeBoardState();

        } else if (last.cards) {
            const fromPile        = document.getElementById(last.from);
            const { type: fType } = Utils.parsePileId(last.from);
            const cards           = last.cards.map(id => this.getCardById(id));

            this.animateMove(cards, () => {
                cards.forEach(card => {
                    const n = this.getPileCards(fromPile).length;
                    if (fType === 'tableau') {
                        card.element.style.top    = `${n * this.tableauOffsetY}px`;
                        card.element.style.zIndex = 10 + n;
                    } else {
                        card.element.style.top = '0px';
                    }
                    card.currentPileId = last.from;
                    fromPile.appendChild(card.element);
                });
                this.normalizeBoardState({ animateWaste: last.from === 'waste' });
            });

            if (last.flipped) {
                const inPile = Array.from(fromPile.children).filter(el => el.classList.contains('card'));
                const ti     = inPile.length - last.cards.length - 1;
                if (ti >= 0) {
                    const c = this.getCardById(parseInt(inPile[ti].dataset.id));
                    if (c) c.flip(false);
                }
            }
            this.score = last.score;
        }

        this.updateUI();
        this.checkAutoCompleteAvailable();
    }

    // =========================================
    // UI 更新
    // =========================================
    getCardById(id) { return this.deck.find(c => c.id === id); }

    updateUI() {
        this.ui.score.textContent  = this.score;
        this.ui.moves.textContent  = this.moves;
        this.ui.undoBtn.disabled   = this.history.length === 0 || this.isHardMode();
    }

    // =========================================
    // スコアポップアップ
    // =========================================
    addScore(amount, refEl) {
        this.score += amount;
        if (!this.ui.scorePopupLayer) return;

        const popup = document.createElement('div');
        popup.className   = 'score-popup';
        popup.textContent = amount > 0 ? `+${amount}` : `${amount}`;
        popup.style.color = amount > 0 ? '#f1c40f' : '#e74c3c';

        try {
            const r          = refEl.getBoundingClientRect();
            popup.style.left = `${r.left + r.width / 2 - 18}px`;
            popup.style.top  = `${r.top}px`;
        } catch (_) {
            popup.style.left = '80px';
            popup.style.top  = '80px';
        }

        this.ui.scorePopupLayer.appendChild(popup);
        setTimeout(() => popup.remove(), 950);
    }

    // =========================================
    // 効果音（Web Audio API）
    // [FIX 5] suspended 状態で resume() してから再生
    // =========================================
    _getAudioCtx() {
        if (!this._audioCtx) {
            try { this._audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (_) {}
        }
        return this._audioCtx;
    }

    playSound(type) {
        const ctx = this._getAudioCtx();
        if (!ctx) return;

        const s = {
            flip:       { f: 680,  d: 0.07, v: 0.08, t: 'sine'     },
            draw:       { f: 420,  d: 0.09, v: 0.07, t: 'sine'     },
            drop:       { f: 520,  d: 0.12, v: 0.10, t: 'triangle' },
            foundation: { f: 880,  d: 0.18, v: 0.12, t: 'sine'     },
            cancel:     { f: 220,  d: 0.12, v: 0.06, t: 'square'   },
            recycle:    { f: 300,  d: 0.15, v: 0.07, t: 'sawtooth' },
            win:        { f: 1046, d: 0.40, v: 0.14, t: 'sine'     },
        }[type] || { f: 440, d: 0.1, v: 0.08, t: 'sine' };

        const play = () => {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.connect(g);
            g.connect(ctx.destination);
            osc.type            = s.t;
            osc.frequency.value = s.f;
            g.gain.setValueAtTime(s.v, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + s.d);
            osc.start(now);
            osc.stop(now + s.d);
        };

        // [FIX 5] suspended 状態なら resume してから鳴らす
        if (ctx.state === 'suspended') {
            ctx.resume().then(play).catch(() => {});
        } else {
            play();
        }
    }

    // =========================================
    // 勝利判定 & ベストスコア記録
    // =========================================
    checkWinCondition() {
        let n = 0;
        for (let i = 0; i < 4; i++) n += document.getElementById(`foundation-${i}`).children.length;
        if (n !== 52) return;

        this.stopTimer();
        this.ui.autoBtn.style.display = 'none';
        this.ui.hintBtn.disabled      = true;
        this.ui.winTime.textContent   = this.ui.timer.textContent;
        this.ui.winScore.textContent  = this.score;
        this.ui.winMoves.textContent  = this.moves;

        const isNewRecord = this._saveRecord();
        this._showBestRecord(isNewRecord);

        setTimeout(() => {
            this.ui.winScreen.classList.remove('hidden');
            this.launchConfetti();
            this.playSound('win');
            setTimeout(() => this.playSound('foundation'), 200);
            setTimeout(() => this.playSound('win'),        400);
        }, 400);
    }

    _recordKey() { return `solitaire_best_${this.getDifficulty()}`; }

    _saveRecord() {
        const key  = this._recordKey();
        const prev = (() => { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } })();
        const cur  = { time: this.secondsElapsed, score: this.score, moves: this.moves };
        const better = !prev
            || cur.score > prev.score
            || (cur.score === prev.score && cur.time < prev.time);
        if (better) localStorage.setItem(key, JSON.stringify(cur));
        return better;
    }

    _showBestRecord(isNew) {
        const raw = (() => { try { return JSON.parse(localStorage.getItem(this._recordKey())); } catch (_) { return null; } })();
        if (!raw || !this.ui.bestRecord) return;
        const m  = String(Math.floor(raw.time / 60)).padStart(2, '0');
        const s  = String(raw.time % 60).padStart(2, '0');
        const el = this.ui.bestRecord;
        el.classList.remove('hidden', 'new-record');
        if (isNew) {
            el.textContent = '🏆 NEW BEST RECORD！';
            el.classList.add('new-record');
        } else {
            el.textContent = `📌 BEST: ${m}:${s}  ${raw.score}pt  ${raw.moves}moves`;
        }
    }

    // =========================================
    // 紙吹雪
    // =========================================
    launchConfetti() {
        const canvas = this.ui.confettiCanvas;
        canvas.style.display = 'block';
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        const ctx    = canvas.getContext('2d');
        const suits  = ['♠', '♥', '♦', '♣'];
        const colors = ['#f1c40f', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#fff'];

        const ps = Array.from({ length: 130 }, () => ({
            x:        Math.random() * canvas.width,
            y:        -20 - Math.random() * 120,
            vx:       (Math.random() - 0.5) * 5,
            vy:       Math.random() * 3.5 + 2,
            color:    colors[Math.floor(Math.random() * colors.length)],
            suit:     suits[Math.floor(Math.random() * suits.length)],
            size:     Math.random() * 14 + 10,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.15,
            opacity:  1,
        }));

        let frame = 0;
        const go  = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ps.forEach(p => {
                p.x += p.vx; p.y += p.vy;
                p.rotation += p.rotSpeed;
                p.vy += 0.06; p.vx *= 0.995;
                if (frame > 150) p.opacity = Math.max(0, p.opacity - 0.013);
                ctx.save();
                ctx.globalAlpha  = p.opacity;
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                ctx.fillStyle    = p.color;
                ctx.font         = `bold ${p.size}px Times New Roman`;
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(p.suit, 0, 0);
                ctx.restore();
            });
            if (++frame < 230) {
                requestAnimationFrame(go);
            } else {
                canvas.style.display = 'none';
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        };
        requestAnimationFrame(go);
    }

    // =========================================
    // オートコンプリート
    // [FIX E] ループ後に dragState をリセット
    // =========================================
    checkAutoCompleteAvailable() {
        const stock = document.getElementById('stock');
        const waste = document.getElementById('waste');
        if (Array.from(stock.children).some(el => el.classList.contains('card')) || waste.children.length > 0) {
            this.ui.autoBtn.style.display = 'none'; return;
        }
        for (const t of document.querySelectorAll('.tableau')) {
            for (const cEl of Array.from(t.children).filter(c => c.classList.contains('card'))) {
                if (!this.getCardById(parseInt(cEl.dataset.id))?.isFaceUp) {
                    this.ui.autoBtn.style.display = 'none'; return;
                }
            }
        }
        this.ui.autoBtn.style.display = 'inline-block';
    }

    async executeAutoComplete() {
        this.ui.autoBtn.style.display = 'none';
        let moving = true;
        while (moving) {
            moving = false;
            for (let i = 0; i < 7; i++) {
                const pile = document.getElementById(`tableau-${i}`);
                if (!pile.children.length) continue;
                const last = pile.lastElementChild;
                if (!last.classList.contains('card')) continue;
                const card = this.getCardById(parseInt(last.dataset.id));
                for (let j = 0; j < 4; j++) {
                    const t = document.getElementById(`foundation-${j}`);
                    this.dragState.cards = [card];
                    if (this.validateMove(card, t)) {
                        this.dragState.originPileId = card.currentPileId;
                        this.executeMove(t.id);
                        moving = true;
                        await Utils.sleep(100);
                        break;
                    }
                }
                if (moving) break;
            }
        }
        // [FIX E] ループ後に dragState を確実にリセット
        this.dragState.cards        = [];
        this.dragState.originPileId = null;
    }

    // =========================================
    // 捨て札レイアウト更新
    // =========================================
    updateWasteLayout(animate = true) {
        const waste = document.getElementById('waste');
        if (!waste) return;
        const cards = Array.from(waste.children).filter(el => el.classList.contains('card'));
        if (animate) cards.forEach(el => el.getAnimations().forEach(a => a.finish()));
        const rects = animate ? cards.map(el => el.getBoundingClientRect()) : [];

        // [FIX G] モバイルでは 3 枚目のズレを抑える
        const shiftPx = this.isMobile ? (this.orientation === 'portrait' ? 8 : 12) : 20;

        cards.forEach((el, i) => {
            let shift = 0;
            if      (cards.length === 1) shift = 0;
            else if (cards.length === 2) shift = i === 0 ? 0 : 1;
            else { shift = i === cards.length - 1 ? 2 : i === cards.length - 2 ? 1 : 0; }

            const offset = `${shift * shiftPx}px`;
            el.style.top = '0px';
            el.style.position = 'absolute';
            if (this.isLeftHanded()) {
                el.style.left  = '';
                el.style.right = offset;
            } else {
                el.style.left  = offset;
                el.style.right = '';
            }
            el.style.zIndex = 10 + i;

            const card = this.getCardById(parseInt(el.dataset.id));
            if (card) card.currentPileId = 'waste';
        });

        if (!animate) return;

        cards.forEach((el, i) => {
            const dx = rects[i].left - el.getBoundingClientRect().left;
            if (dx !== 0) {
                el.animate(
                    [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }],
                    { duration: GAME_CONFIG.ANIMATION_SPEED || 200, easing: 'ease-out' }
                );
            }
        });
    }
}


// =========================================
// ホーム画面制御 + 全画面 + 向きロック
// =========================================

async function requestFullscreen(el) {
    try {
        const fn = el.requestFullscreen || el.webkitRequestFullscreen
                || el.mozRequestFullScreen || el.msRequestFullscreen;
        if (fn) await fn.call(el);
    } catch (e) { console.warn('Fullscreen:', e); }
}

async function exitFullscreen() {
    try {
        const fn = document.exitFullscreen || document.webkitExitFullscreen
                || document.mozCancelFullScreen || document.msExitFullscreen;
        if (fn) await fn.call(document);
    } catch (_) {}
}

const mobileSetupState = {
    orientation: 'landscape',
    handedness: 'right'
};

async function lockOrientation(mode = 'landscape') {
    try {
        if (screen.orientation?.lock) { await screen.orientation.lock(mode); return true; }
    } catch (e) { console.warn('Orientation lock:', e.name); }
    return false;
}

function applyIosFullscreenMeta() {
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
        const m = document.createElement('meta');
        m.name = 'apple-mobile-web-app-capable'; m.content = 'yes';
        document.head.appendChild(m);
    }
}

function refreshMobileSetupButtons() {
    document.querySelectorAll('#mobile-setup-panel .setup-option-btn').forEach(btn => btn.classList.remove('selected'));
    document.getElementById(`btn-orientation-${mobileSetupState.orientation}`)?.classList.add('selected');
    document.getElementById(`btn-handedness-${mobileSetupState.handedness}`)?.classList.add('selected');
}

function updateMobileSetupSelection(type, value) {
    mobileSetupState[type] = value;
    refreshMobileSetupButtons();
}

function showMobileSetupChooser() {
    refreshMobileSetupButtons();
    document.getElementById('platform-select')?.classList.add('hidden');
    document.getElementById('mobile-setup-panel')?.classList.remove('hidden');
}

function hideMobileSetupChooser() {
    document.getElementById('mobile-setup-panel')?.classList.add('hidden');
    document.getElementById('platform-select')?.classList.remove('hidden');
}

// [FIX A] showHomeScreen で destroy() を呼んでリスナーを解除
function showHomeScreen() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('home-screen').style.display = 'flex';
    document.getElementById('rotate-warning')?.classList.add('hidden');
    document.getElementById('fs-banner')?.style && (document.getElementById('fs-banner').style.display = 'none');
    hideMobileSetupChooser();
    if (window._gameInstance) {
        window._gameInstance.destroy(); // [FIX A]
        window._gameInstance = null;
    }
    document.body.classList.remove('mobile-mode', 'pc-mode', 'left-handed', 'right-handed', 'mobile-landscape', 'mobile-portrait');
    delete document.body.dataset.device;
    delete document.body.dataset.handedness;
    delete document.body.dataset.orientation;
    exitFullscreen();
}

async function startGame(deviceType, handedness = 'right', orientation = 'landscape') {
    document.body.classList.remove('mobile-mode', 'pc-mode', 'left-handed', 'right-handed', 'mobile-landscape', 'mobile-portrait');
    document.body.classList.add(`${deviceType}-mode`);
    document.body.classList.add(handedness === 'left' ? 'left-handed' : 'right-handed');
    if (deviceType === 'mobile') {
        document.body.classList.add(orientation === 'portrait' ? 'mobile-portrait' : 'mobile-landscape');
    }
    document.body.dataset.device = deviceType;
    document.body.dataset.handedness = handedness;
    document.body.dataset.orientation = deviceType === 'mobile' ? orientation : 'landscape';
    mobileSetupState.handedness = handedness;
    mobileSetupState.orientation = orientation;

    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('rotate-warning')?.classList.add('hidden');

    if (deviceType === 'mobile') {
        applyIosFullscreenMeta();
        await requestFullscreen(document.documentElement);
        setTimeout(async () => {
            await lockOrientation(orientation);
            checkOrientation();
        }, 300);
    } else {
        document.getElementById('rotate-warning')?.classList.add('hidden');
    }

    // [FIX 2] 既存インスタンスを破棄してから新規生成
    if (window._gameInstance) window._gameInstance.destroy();
    window._gameInstance = new Game();
}

function onFullscreenChange() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    let banner = document.getElementById('fs-banner');

    if (!isFs && document.body.dataset.device === 'mobile') {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'fs-banner';
            banner.innerHTML = `
                <span>全画面に戻る</span>
                <button onclick="requestFullscreen(document.documentElement);
                    this.parentElement.style.display='none';">▶ 全画面</button>
            `;
            document.body.appendChild(banner);
        }
        banner.style.display = 'flex';
    } else if (banner) {
        banner.style.display = 'none';
    }
}

// [FIX C] resize リスナーの重複登録を防ぐフラグ
let _orientationListenerAdded = false;

function checkOrientation() {
    const warn = document.getElementById('rotate-warning');
    const ja   = document.getElementById('rotate-warning-ja');
    const en   = document.getElementById('rotate-warning-en');
    const upd  = () => {
        const isMobileGame = document.body.dataset.device === 'mobile';
        const target = document.body.dataset.orientation || 'landscape';
        const isPortraitNow = window.innerHeight > window.innerWidth;
        const isMatched = target === 'portrait' ? isPortraitNow : !isPortraitNow;
        if (ja) ja.textContent = target === 'portrait' ? 'スマホを縦向きにしてください' : 'スマホを横向きにしてください';
        if (en) en.textContent = target === 'portrait'
            ? 'Please rotate your device to portrait'
            : 'Please rotate your device to landscape';
        warn.classList.toggle('hidden', !isMobileGame || isMatched);
    };
    upd();
    if (!_orientationListenerAdded) {
        window.addEventListener('resize', upd);
        window.addEventListener('orientationchange', upd);
        _orientationListenerAdded = true;
    }
}

window.onload = () => {
    refreshMobileSetupButtons();
    document.getElementById('btn-pc').addEventListener('click', () => startGame('pc', 'right', 'landscape'));
    document.getElementById('btn-mobile').addEventListener('click', () => showMobileSetupChooser());
    document.getElementById('btn-orientation-landscape').addEventListener('click', () => updateMobileSetupSelection('orientation', 'landscape'));
    document.getElementById('btn-orientation-portrait').addEventListener('click', () => updateMobileSetupSelection('orientation', 'portrait'));
    document.getElementById('btn-handedness-right').addEventListener('click', () => updateMobileSetupSelection('handedness', 'right'));
    document.getElementById('btn-handedness-left').addEventListener('click', () => updateMobileSetupSelection('handedness', 'left'));
    document.getElementById('btn-mobile-start').addEventListener('click', () => startGame('mobile', mobileSetupState.handedness, mobileSetupState.orientation));
    document.getElementById('btn-mobile-back').addEventListener('click', () => hideMobileSetupChooser());
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
};
