/**
 * Confetti.js
 * ウィン時の紙吹雪アニメーション
 */
class Confetti {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.animId = null;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    _randomParticle() {
        const colors = ['#f1c40f', '#e74c3c', '#2ecc71', '#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#fff'];
        const shapes = ['rect', 'circle', 'suit'];
        const suits = ['♥', '♦', '♠', '♣'];
        return {
            x: Math.random() * this.canvas.width,
            y: -20,
            vx: (Math.random() - 0.5) * 4,
            vy: Math.random() * 3 + 2,
            vr: (Math.random() - 0.5) * 0.2,
            rotation: Math.random() * Math.PI * 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            shape: shapes[Math.floor(Math.random() * shapes.length)],
            suit: suits[Math.floor(Math.random() * suits.length)],
            size: Math.random() * 10 + 6,
            alpha: 1,
            life: 1,
            decay: Math.random() * 0.003 + 0.001
        };
    }

    burst(count = 120) {
        for (let i = 0; i < count; i++) {
            const p = this._randomParticle();
            // Spread from top
            p.x = Math.random() * this.canvas.width;
            p.y = -10 - Math.random() * 50;
            this.particles.push(p);
        }
        if (!this.animId) this._loop();
    }

    _loop() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.particles = this.particles.filter(p => p.life > 0 && p.y < this.canvas.height + 50);

        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.rotation += p.vr;
            p.vy += 0.05; // gravity
            p.vx *= 0.99;
            p.life -= p.decay;
            p.alpha = Math.max(0, p.life);

            this.ctx.save();
            this.ctx.globalAlpha = p.alpha;
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.rotation);
            this.ctx.fillStyle = p.color;

            if (p.shape === 'rect') {
                this.ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            } else if (p.shape === 'circle') {
                this.ctx.beginPath();
                this.ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                this.ctx.fill();
            } else {
                // suit symbol
                this.ctx.font = `${p.size}px serif`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(p.suit, 0, 0);
            }
            this.ctx.restore();
        });

        if (this.particles.length > 0) {
            this.animId = requestAnimationFrame(() => this._loop());
        } else {
            this.animId = null;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    stop() {
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
        this.particles = [];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
