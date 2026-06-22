const BACKEND = "https://comfortable-charisma-production-bb4b.up.railway.app";

// Защита от двойного запуска (Live Server hot-reload)
if (window.__coffeeGameStarted) {
    throw new Error("game.js already running — skipping duplicate init");
}
window.__coffeeGameStarted = true;

let score = 0;
let gameOver = false;
let timeLeft = 15;
let minBeans = 10;
let prizeTitle = "Скидка 50% на пончик 🍩";
let socialLink = "https://instagram.com/yourcoffee";

let timerText, scoreText, cupContainer, beanGroup;
let cupX = 180;
let phaserScene = null;

let beansSpawned = 0;        // сколько зёрен всего упало за игру
let maxBeansToSpawn = 16;    // лимит — по умолчанию minBeans + 6, пересчитывается после загрузки конфига

const W = 360, H = 640;

// ─── Сначала грузим конфиг, потом запускаем Phaser ───────────────────────────
async function bootstrap() {
    try {
        const cfg = await fetch(BACKEND + "/config").then(r => r.json());
        timeLeft   = cfg.gameDuration || 15;
        minBeans   = cfg.minBeans    || 10;
        prizeTitle = cfg.prizeTitle  || prizeTitle;
        socialLink = cfg.socialLink  || socialLink;
    } catch (_) { /* бэкенд недоступен — используем дефолты */ }

    // лимит зёрен пересчитываем от актуального minBeans (запас сверху, чтобы было непросто, но реально)
    maxBeansToSpawn = minBeans + 6;

    startPhaser();
}

function startPhaser() {
    // Уничтожить старый инстанс если есть (на случай hot-reload)
    if (window.__phaserGame) {
        window.__phaserGame.destroy(true);
        window.__phaserGame = null;
    }
    window.__phaserGame = new Phaser.Game({
        type: Phaser.AUTO,
        width: W, height: H,
        parent: "game",
        backgroundColor: "#1a0a00",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: { preload, create, update }
    });
}


bootstrap();

// ─── PRELOAD ──────────────────────────────────────────────────────────────────
function preload() {}

// ─── CREATE ───────────────────────────────────────────────────────────────────
function create() {
    phaserScene = this;

    drawBackground(this);

    beanGroup = this.add.group();

    // Чашка
    cupContainer = this.add.container(cupX, H - 72);
    const cupG = this.add.graphics();
    drawCup(cupG);
    cupContainer.add(cupG);

    // UI — заголовок
    this.add.text(W / 2, 23, "☕  COFFEE CATCH  ☕", {
        fontSize: "20px", fontFamily: "Georgia, serif",
        fill: "#c8862a", stroke: "#0d0500", strokeThickness: 4
    }).setOrigin(0.5);

    scoreText = this.add.text(18, 50, `Зёрна: 0 / ${minBeans}`, {
        fontSize: "13px", fontFamily: "Georgia, serif", fill: "#faf0e6"
    }).setOrigin(0, 0.5);

    timerText = this.add.text(W - 18, 50, `⏱ ${timeLeft}`, {
        fontSize: "16px", fontFamily: "Georgia, serif",
        fill: "#ff9933", stroke: "#0d0500", strokeThickness: 3
    }).setOrigin(1, 0.5);

    this.add.text(W / 2, H - 8, "Двигай пальцем или мышью", {
        fontSize: "11px", fontFamily: "Georgia, serif", fill: "#5a3010"
    }).setOrigin(0.5, 1);

    // Управление
    this.input.on("pointermove", p => {
        cupX = Phaser.Math.Clamp(p.x, 50, W - 50);
        cupContainer.x = cupX;
    });
    this.cursors = this.input.keyboard.createCursorKeys();

    // Спавн зёрен
    this.time.addEvent({ delay: 700, loop: true, callback: () => spawnBean(phaserScene) });

    // Пар
    this.time.addEvent({ delay: 500, loop: true, callback: () => spawnSteam(phaserScene) });

    // Таймер обратного отсчёта
    this.time.addEvent({
        delay: 1000, loop: true,
        callback: () => {
            if (gameOver) return;
            timeLeft--;
            timerText.setText(`⏱ ${timeLeft}`);
            if (timeLeft <= 5) {
                timerText.setStyle({
                    fontSize: "16px", fontFamily: "Georgia, serif",
                    fill: "#ff3300", stroke: "#0d0500", strokeThickness: 3
                });
                phaserScene.tweens.add({
                    targets: timerText, scaleX: 1.25, scaleY: 1.25, duration: 180, yoyo: true
                });
            }
            if (timeLeft <= 0) endGame(phaserScene);
        }
    });
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update() {
    if (gameOver) return;

    if (this.cursors?.left.isDown)  { cupX = Math.max(50, cupX - 5); cupContainer.x = cupX; }
    if (this.cursors?.right.isDown) { cupX = Math.min(W - 50, cupX + 5); cupContainer.x = cupX; }

    const cupTop   = cupContainer.y - 20;
    const cupLeft  = cupContainer.x - 40;
    const cupRight = cupContainer.x + 40;

    beanGroup.getChildren().forEach(bean => {
        if (!bean.active) return;
        if (bean.y >= cupTop && bean.y <= cupTop + 38 && bean.x >= cupLeft && bean.x <= cupRight) {
            score++;
            scoreText.setText(`Зёрна: ${score} / ${minBeans}`);

            const pop = this.add.text(bean.x, bean.y, "+1", {
                fontSize: "18px", fontFamily: "Georgia, serif",
                fill: "#ffcc00", stroke: "#0d0500", strokeThickness: 3
            }).setOrigin(0.5);
            this.tweens.add({
                targets: pop, y: bean.y - 55, alpha: 0, duration: 650,
                onComplete: () => pop.destroy()
            });

            const flash = this.add.graphics();
            flash.fillStyle(0xffcc00, 0.4);
            flash.fillCircle(cupContainer.x, cupContainer.y, 44);
            this.tweens.add({
                targets: flash, alpha: 0, scaleX: 1.9, scaleY: 1.9, duration: 280,
                onComplete: () => flash.destroy()
            });

            bean.destroy();
            beanGroup.remove(bean);

            // если набрали нужное количество зёрен — сразу завершаем игру, не дожидаясь таймера
            if (score >= minBeans && !gameOver) {
                endGame(this);
            }
        }
    });
}

// ─── СПАВН ЗЕРНА ─────────────────────────────────────────────────────────────
function spawnBean(scene) {
    if (gameOver) return;
    if (beansSpawned >= maxBeansToSpawn) return; // ← лимит зёрен на игру достигнут, больше не спавним
    beansSpawned++;

    const bean = scene.add.graphics();
    bean.x = Phaser.Math.Between(28, W - 28);
    bean.y = -15;
    bean.rotation = Phaser.Math.FloatBetween(0, Math.PI * 2);
    drawBean(bean);
    beanGroup.add(bean);
    scene.tweens.add({
        targets: bean,
        y: H + 20,
        rotation: bean.rotation + Phaser.Math.FloatBetween(3, 9),
        duration: Phaser.Math.Between(2000, 3400),
        ease: "Sine.easeIn",
        onComplete: () => { bean.destroy(); beanGroup.remove(bean); }
    });
}

// ─── ПАР ─────────────────────────────────────────────────────────────────────
function spawnSteam(scene) {
    if (gameOver) return;
    [-12, 0, 12].forEach(dx => {
        const s = scene.add.graphics();
        s.fillStyle(0xffffff, 0.11);
        s.fillCircle(0, 0, Phaser.Math.Between(4, 9));
        s.x = cupContainer.x + dx;
        s.y = cupContainer.y - 27;
        scene.tweens.add({
            targets: s,
            y: s.y - Phaser.Math.Between(30, 65),
            x: s.x + Phaser.Math.Between(-18, 18),
            alpha: 0, scaleX: 2.2, scaleY: 2.2,
            duration: Phaser.Math.Between(900, 1500),
            onComplete: () => s.destroy()
        });
    });
}

// ─── КОНЕЦ ИГРЫ ───────────────────────────────────────────────────────────────
function endGame(scene) {
    if (gameOver) return;
    gameOver = true;

    // Затемнение
    const ov = scene.add.graphics();
    ov.fillStyle(0x000000, 0.78);
    ov.fillRect(0, 0, W, H);
    ov.alpha = 0;
    scene.tweens.add({ targets: ov, alpha: 1, duration: 500 });

    // Карточка
    const cy = H / 2;
    const card = scene.add.graphics();
    card.fillStyle(0x1e0d00, 1);
    card.fillRoundedRect(W / 2 - 145, cy - 170, 290, 340, 18);
    card.lineStyle(2, 0xc8862a, 1);
    card.strokeRoundedRect(W / 2 - 145, cy - 170, 290, 340, 18);
    card.alpha = 0;
    scene.tweens.add({ targets: card, alpha: 1, duration: 500, delay: 250 });

    const scoreLabel = scene.add.text(W / 2, cy - 130,
        `Собрано зёрен: ${score} / ${minBeans}`,
        { fontSize: "14px", fontFamily: "Georgia, serif", fill: "#a07850", align: "center" }
    ).setOrigin(0.5).setAlpha(0);
    scene.tweens.add({ targets: scoreLabel, alpha: 1, duration: 400, delay: 400 });

    const statusText = scene.add.text(W / 2, cy - 90, "⏳ Определяем результат…",
        { fontSize: "15px", fontFamily: "Georgia, serif", fill: "#c8862a", align: "center" }
    ).setOrigin(0.5).setAlpha(0);
    scene.tweens.add({ targets: statusText, alpha: 1, duration: 400, delay: 550 });

    // Запрос к бэкенду
    const deviceId = getDeviceId();

    fetch(BACKEND + "/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId })
    })
    .then(r => r.json())
    .then(check => {
        if (!check.allowed) {
            showAlreadyPlayed(scene, statusText, cy);
            return;
        }
        return fetch(BACKEND + "/result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ score })
        }).then(r => r.json()).then(result => {
            if (result.win) {
                showWinScreen(scene, statusText, result, cy);
            } else {
                showLoseScreen(scene, statusText, cy);
            }
        });
    })
    .catch(() => {
        statusText.setText("⚠️ Нет соединения с сервером");
    });
}

// ─── УЖЕ ИГРАЛИ ──────────────────────────────────────────────────────────────
function showAlreadyPlayed(scene, statusText, cy) {
    statusText.setText("☕  До завтра!");
    statusText.setStyle({ fontSize: "22px", fontFamily: "Georgia, serif", fill: "#c8862a", align: "center" });

    const t = scene.add.text(W / 2, cy - 45,
        "Вы уже играли сегодня.\nПриходите завтра\nза новым шансом!",
        { fontSize: "15px", fontFamily: "Georgia, serif", fill: "#faf0e6", align: "center", wordWrap: { width: 250 } }
    ).setOrigin(0.5).setAlpha(0);
    scene.tweens.add({ targets: t, alpha: 1, delay: 200, duration: 400 });

    addSocialButton(scene, cy + 95);
}

// ─── ПРОИГРЫШ ─────────────────────────────────────────────────────────────────
function showLoseScreen(scene, statusText, cy) {
    statusText.setText("Почти получилось!");
    statusText.setStyle({ fontSize: "20px", fontFamily: "Georgia, serif", fill: "#c8862a", align: "center" });

    const t = scene.add.text(W / 2, cy - 40,
        `Нужно собрать ${minBeans} зёрен.\nПриходите завтра —\nудача ждёт! ☕`,
        { fontSize: "15px", fontFamily: "Georgia, serif", fill: "#faf0e6", align: "center", wordWrap: { width: 250 } }
    ).setOrigin(0.5).setAlpha(0);
    scene.tweens.add({ targets: t, alpha: 1, delay: 200, duration: 400 });

    addSocialButton(scene, cy + 95);
}

// ─── ВЫИГРЫШ ─────────────────────────────────────────────────────────────────
function showWinScreen(scene, statusText, result, cy) {
    // Конфетти
    for (let i = 0; i < 22; i++) {
        const cb = scene.add.graphics();
        cb.x = Phaser.Math.Between(0, W);
        cb.y = -20;
        drawBean(cb);
        scene.tweens.add({
            targets: cb,
            y: H + 20,
            x: cb.x + Phaser.Math.Between(-120, 120),
            rotation: Phaser.Math.FloatBetween(0, 12),
            duration: Phaser.Math.Between(1400, 3000),
            delay: i * 90,
            onComplete: () => cb.destroy()
        });
    }

    statusText.setText("🎉  Вы выиграли!");
    statusText.setStyle({
        fontSize: "24px", fontFamily: "Georgia, serif",
        fill: "#ffcc00", stroke: "#0d0500", strokeThickness: 4, align: "center"
    });

    // Блок приза
    const prizeBox = scene.add.graphics();
    prizeBox.fillStyle(0xc8862a, 0.15);
    prizeBox.fillRoundedRect(W / 2 - 118, cy - 58, 236, 64, 10);
    prizeBox.lineStyle(1.5, 0xc8862a, 0.6);
    prizeBox.strokeRoundedRect(W / 2 - 118, cy - 58, 236, 64, 10);

    scene.add.text(W / 2, cy - 26, result.prizeTitle || prizeTitle, {
        fontSize: "17px", fontFamily: "Georgia, serif", fill: "#ffcc00",
        align: "center", wordWrap: { width: 220 }
    }).setOrigin(0.5);

    scene.add.text(W / 2, cy + 30,
        "Сделай репост в сторис,\nчтобы получить приз! 📸",
        { fontSize: "14px", fontFamily: "Georgia, serif", fill: "#faf0e6", align: "center", stroke: "#0d0500", strokeThickness: 2 }
    ).setOrigin(0.5);

    // Кнопка ПОДЕЛИТЬСЯ
    const shareBtn = makeButton(scene, W / 2, cy + 100, "📲  Поделиться в сторис", "#e8303a", "#fff", 234, 48);
    shareBtn.on("pointerup", () => doShare(scene, result, cy));
}

// ─── ШЭРИНГ → ПРОМОКОД ───────────────────────────────────────────────────────
function doShare(scene, result, cy) {
    const afterShare = () => showPromoScreen(scene, result);

    if (navigator.share) {
        navigator.share({
            title: "Я выиграл в Coffee Catch! ☕",
            text: `Поймал кофейные зёрна и выиграл: ${result.prizeTitle || prizeTitle}! Попробуй сам — сканируй QR на стаканчике!`,
            url: window.location.href
        })
        .then(afterShare)
        .catch(err => {
            // Если отменили шаринг — всё равно показываем промокод
            afterShare();
        });
    } else {
        // На десктопе — сразу показываем промокод
        afterShare();
    }
}

// ─── ЭКРАН ПРОМОКОДА ─────────────────────────────────────────────────────────
function showPromoScreen(scene, result) {
    const ov2 = scene.add.graphics();
    ov2.fillStyle(0x080200, 0.97);
    ov2.fillRect(0, 0, W, H);
    ov2.alpha = 0;
    scene.tweens.add({ targets: ov2, alpha: 1, duration: 350 });

    const cy = H / 2;
    const card2 = scene.add.graphics();
    card2.fillStyle(0x1e0d00, 1);
    card2.fillRoundedRect(W / 2 - 148, cy - 205, 296, 410, 20);
    card2.lineStyle(2.5, 0xffcc00, 1);
    card2.strokeRoundedRect(W / 2 - 148, cy - 205, 296, 410, 20);
    card2.alpha = 0;
    scene.tweens.add({ targets: card2, alpha: 1, duration: 400, delay: 200 });

    const addText = (txt, y, style, delay = 300) => {
        const t = scene.add.text(W / 2, y, txt, style).setOrigin(0.5).setAlpha(0);
        scene.tweens.add({ targets: t, alpha: 1, delay, duration: 350 });
        return t;
    };

    addText("🏆  Ваш приз!", cy - 168, {
        fontSize: "22px", fontFamily: "Georgia, serif", fill: "#ffcc00", align: "center"
    }, 350);

    addText(result.prizeTitle || prizeTitle, cy - 125, {
        fontSize: "16px", fontFamily: "Georgia, serif", fill: "#faf0e6",
        align: "center", wordWrap: { width: 260 }
    }, 480);

    /// Белая карточка + промокод рисуются вместе чтобы текст был поверх
scene.time.delayedCall(600, () => {
    const codeBox = scene.add.graphics();
    codeBox.fillStyle(0xffffff, 1);
    codeBox.fillRoundedRect(W / 2 - 122, cy - 88, 244, 96, 10);

    const labelText = scene.add.text(W / 2, cy - 72, "ПРОМОКОД", {
        fontSize: "11px", fontFamily: "Georgia, serif",
        fill: "#7a5030", align: "center", letterSpacing: 3
    }).setOrigin(0.5);

    const codeText = scene.add.text(W / 2, cy - 40, result.code || "???", {
        fontSize: "26px", fontFamily: "Courier New, monospace",
        fill: "#1a0a00", align: "center"
    }).setOrigin(0.5);
});

    addText("Покажи этот экран бариста\nили назови промокод вслух 👆", cy + 68, {
        fontSize: "13px", fontFamily: "Georgia, serif", fill: "#c8862a",
        align: "center", wordWrap: { width: 260 }
    }, 820);

    // Кнопка копировать
    scene.time.delayedCall(920, () => {
        const copyBtn = makeButton(scene, W / 2, cy + 130, "📋  Скопировать промокод", "#2d6a2d", "#fff", 230, 44);
        copyBtn.on("pointerup", () => {
            navigator.clipboard?.writeText(result.code).catch(() => {});
            const ok = scene.add.text(W / 2, cy + 130, "✓ Скопировано!", {
                fontSize: "15px", fontFamily: "Georgia, serif", fill: "#66ff88", align: "center"
            }).setOrigin(0.5);
            copyBtn.destroy();
            scene.tweens.add({ targets: ok, alpha: 0, delay: 2000, duration: 500, onComplete: () => ok.destroy() });
        });
    });

    // Ссылка на соцсети
    scene.time.delayedCall(1050, () => {
        const link = scene.add.text(W / 2, cy + 185,
            "Подписаться на нас →",
            { fontSize: "12px", fontFamily: "Georgia, serif", fill: "#7a5030", align: "center" }
        ).setOrigin(0.5).setAlpha(0).setInteractive({ useHandCursor: true });
        link.on("pointerup", () => window.open(socialLink, "_blank"));
        scene.tweens.add({ targets: link, alpha: 1, duration: 350 });
    });
}

// ─── КНОПКА СОЦСЕТЕЙ ─────────────────────────────────────────────────────────
function addSocialButton(scene, y) {
    const btn = makeButton(scene, W / 2, y, "☕ Подписаться на нас", "#3d1f00", "#c8862a", 210, 42);
    btn.setAlpha(0);
    scene.tweens.add({ targets: btn, alpha: 1, delay: 400, duration: 350 });
    // pointerup работает надёжнее на мобиле чем pointerup
    btn.on("pointerup", () => window.open(socialLink, "_blank"));
}

// ─── УНИВЕРСАЛЬНАЯ КНОПКА ────────────────────────────────────────────────────
function makeButton(scene, x, y, label, bgHex, textColor, w = 200, h = 46) {
    const cont = scene.add.container(x, y);
    const col = parseInt(bgHex.replace("#", ""), 16);
    const bg = scene.add.graphics();
    bg.fillStyle(col, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    cont.add(bg);
    const txt = scene.add.text(0, 1, label, {
        fontSize: "14px", fontFamily: "Georgia, serif", fill: textColor, align: "center"
    }).setOrigin(0.5);
    cont.add(txt);
    cont.setSize(w, h).setInteractive({ useHandCursor: true });
    cont.on("pointerover",  () => bg.setAlpha(0.82));
    cont.on("pointerout",   () => bg.setAlpha(1));
    cont.on("pointerup", () => bg.setAlpha(1));
    return cont;
}

// ─── ФОН ─────────────────────────────────────────────────────────────────────
function drawBackground(scene) {
    const bg = scene.add.graphics();
    bg.fillGradientStyle(0x3d1a00, 0x3d1a00, 0x5a2800, 0x5a2800, 1);
    bg.fillRect(0, 0, W, H);

    const pat = scene.add.graphics();
    pat.lineStyle(1, 0x7a4010, 0.25);
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 5; c++) {
            const px = c * 78 + 28, py = r * 75 + 30;
            pat.strokeCircle(px, py, 16);
            pat.moveTo(px, py - 9); pat.lineTo(px, py + 9);
        }
    }
    pat.strokePath();

    const top = scene.add.graphics();
    top.fillStyle(0x4a2000, 1); top.fillRect(0, 0, W, 68);
    top.lineStyle(1.5, 0xc8862a, 0.7); top.strokeRect(7, 7, W - 14, 54);

    const bot = scene.add.graphics();
    bot.fillStyle(0x2d1200, 0.6); bot.fillRect(0, H - 95, W, 95);
}

// ─── ЧАШКА ───────────────────────────────────────────────────────────────────
function drawCup(g) {
    g.fillStyle(0xa06820, 1); g.fillEllipse(0, 40, 90, 14);
    g.fillStyle(0xc8862a, 1); g.fillEllipse(0, 37, 90, 14);
    g.fillStyle(0xfaf0e6, 1);
    g.fillPoints([
        new Phaser.Geom.Point(-40, 34), new Phaser.Geom.Point(40, 34),
        new Phaser.Geom.Point(32, -18), new Phaser.Geom.Point(-32, -18)
    ], true);
    g.fillStyle(0xc8862a, 1); g.fillRect(-40, -22, 80, 8); g.fillEllipse(0, -22, 80, 10);
    g.lineStyle(8, 0xc8862a, 1); g.strokeCircle(48, 10, 15);
    g.fillStyle(0xfaf0e6, 1); g.fillCircle(48, 10, 7);
    g.fillStyle(0x3d1500, 1); g.fillEllipse(0, -16, 58, 10);
    g.fillStyle(0xe8d5b0, 0.85); g.fillEllipse(-7, -18, 22, 7); g.fillEllipse(8, -17, 16, 6);
    g.fillStyle(0xffffff, 0.18); g.fillRect(-30, -10, 10, 26);
}

// ─── ЗЕРНО ───────────────────────────────────────────────────────────────────
function drawBean(g) {
    g.fillStyle(0x000000, 0.28); g.fillEllipse(2, 2, 22, 28);
    g.fillStyle(0x4a2200, 1);    g.fillEllipse(0, 0, 22, 28);
    g.fillStyle(0x7a4020, 0.75); g.fillEllipse(-4, -5, 9, 13);
    g.lineStyle(2, 0x1a0800, 0.9); g.moveTo(0, -11); g.lineTo(0, 11); g.strokePath();
    g.lineStyle(1, 0x1a0800, 0.5);
    g.moveTo(0, -3); g.lineTo(-5, 3); g.strokePath();
    g.moveTo(0, -3); g.lineTo(5, 3);  g.strokePath();
}

// ─── DEVICE ID ───────────────────────────────────────────────────────────────
function getDeviceId() {
    let id = localStorage.getItem("deviceId");
    if (!id) { id = Math.random().toString(36).substring(2); localStorage.setItem("deviceId", id); }
    return id;
}
