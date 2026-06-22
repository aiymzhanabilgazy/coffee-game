// Защита от двойного запуска (Live Server hot-reload)
if (window.__coffeeGameStarted) { throw new Error("already running"); }
window.__coffeeGameStarted = true;
 
const BACKEND = "https://comfortable-charisma-production-bb4b.up.railway.app";
 
// Читаем ID кофейни из URL: ?cafe=blackcat
const CAFE_ID = new URLSearchParams(window.location.search).get("cafe") || "demo";
 
// ─── Настройки (перезапишутся с бэкенда) ─────────────────────────────────────
let totalBeans  = 15;   // сколько зёрен всего упадёт за игру
let minBeans    = 10;   // сколько нужно поймать для шанса выиграть
let gameDuration = 20;  // секунды (запасное время, если зёрна не кончились)
let prizeTitle  = "Скидка 50% на пончик 🍩";
let socialLink  = "https://instagram.com/yourcoffee";
 
// ─── Состояние ────────────────────────────────────────────────────────────────
let score        = 0;
let gameOver     = false;
let beansSpawned = 0;   // сколько уже заспавнили
let beansFallen  = 0;   // сколько упало/поймано (для определения конца)
let timeLeft     = 20;
let spawnEvent   = null;
 
let timerText, scoreText, cupContainer, beanGroup, progressBar;
let cupX = 180;
let phaserScene = null;
 
const W = 360, H = 640;
 
// ─── Старт ───────────────────────────────────────────────────────────────────
async function bootstrap() {
    try {
        const cfg = await fetch(BACKEND + "/config?cafe=" + CAFE_ID).then(r => r.json());
        totalBeans   = cfg.totalBeans   || 15;
        minBeans     = cfg.minBeans     || 10;
        gameDuration = cfg.gameDuration || 20;
        prizeTitle   = cfg.prizeTitle   || prizeTitle;
        socialLink   = cfg.socialLink   || socialLink;
        timeLeft     = gameDuration;
    } catch (_) { timeLeft = gameDuration; }
 
    // Записываем лимит ДО начала игры (не в конце)
    // Это значит: если человек открыл — уже считается
    // (можно убрать этот блок если хочешь записывать после)
    try {
        const check = await fetch(BACKEND + "/check?cafe=" + CAFE_ID, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId: getDeviceId() })
        }).then(r => r.json());
        if (!check.allowed) {
            // Показываем "уже играли" ещё до Phaser
            showPreGameBlock();
            return;
        }
    } catch (_) {}
 
    if (window.__phaserGame) { window.__phaserGame.destroy(true); }
    window.__phaserGame = new Phaser.Game({
        type: Phaser.AUTO,
        width: W, height: H,
        parent: "game",
        backgroundColor: "#1a0a00",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: { preload, create, update }
    });
}
 
// Показать заглушку "уже играли" без запуска Phaser
function showPreGameBlock() {
    document.getElementById("game").innerHTML = `
        <div style="
            width:360px; height:100vh; max-height:640px;
            background: linear-gradient(180deg,#1a0a00,#2d1200);
            display:flex; flex-direction:column; align-items:center;
            justify-content:center; gap:18px; font-family:Georgia,serif;
            border-left:1px solid rgba(200,134,42,0.2);
            border-right:1px solid rgba(200,134,42,0.2);
        ">
            <div style="font-size:54px">☕</div>
            <div style="color:#c8862a;font-size:22px">До завтра!</div>
            <div style="color:#faf0e6;font-size:15px;text-align:center;line-height:1.6;max-width:240px">
                Вы уже играли сегодня.<br>Приходите завтра<br>за новым шансом!
            </div>
            <a href="${socialLink}" target="_blank" style="
                margin-top:12px; background:#3d1f00; color:#c8862a;
                border:1px solid #c8862a; border-radius:24px;
                padding:12px 28px; font-size:14px; text-decoration:none;
            ">☕ Подписаться на нас</a>
        </div>`;
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
 
    // UI
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
 
    // Прогресс-бар зёрен (сколько упало из totalBeans)
    this.add.graphics().fillStyle(0x3d1f00, 1).fillRect(20, 60, W - 40, 4);
    progressBar = this.add.graphics();
    drawProgress(0);
 
    this.add.text(W / 2, H - 8, "Двигай пальцем или мышью", {
        fontSize: "11px", fontFamily: "Georgia, serif", fill: "#5a3010"
    }).setOrigin(0.5, 1);
 
    // Управление
    this.input.on("pointermove", p => {
        cupX = Phaser.Math.Clamp(p.x, 50, W - 50);
        cupContainer.x = cupX;
    });
    this.cursors = this.input.keyboard.createCursorKeys();
 
    // Спавн: интервал рассчитывается так чтобы все зёрна успели упасть за gameDuration
    const spawnDelay = Math.floor((gameDuration * 1000 * 0.85) / totalBeans);
    spawnEvent = this.time.addEvent({
        delay: spawnDelay,
        loop: true,
        callback: () => {
            if (gameOver) return;
            if (beansSpawned >= totalBeans) {
                spawnEvent.remove();
                return;
            }
            spawnBean(phaserScene);
        }
    });
 
    // Пар
    this.time.addEvent({ delay: 500, loop: true, callback: () => spawnSteam(phaserScene) });
 
    // Таймер (запасной — если не все зёрна упали вовремя)
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
 
function drawProgress(fallen) {
    if (!progressBar) return;
    progressBar.clear();
    const pct = Math.min(fallen / totalBeans, 1);
    if (pct <= 0) return;
    progressBar.fillStyle(0xc8862a, 0.7);
    progressBar.fillRect(20, 60, (W - 40) * pct, 4);
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
 
            // +1 pop
            const pop = this.add.text(bean.x, bean.y, "+1", {
                fontSize: "18px", fontFamily: "Georgia, serif",
                fill: "#ffcc00", stroke: "#0d0500", strokeThickness: 3
            }).setOrigin(0.5);
            this.tweens.add({ targets: pop, y: bean.y - 55, alpha: 0, duration: 650, onComplete: () => pop.destroy() });
 
            // Вспышка
            const flash = this.add.graphics();
            flash.fillStyle(0xffcc00, 0.4);
            flash.fillCircle(cupContainer.x, cupContainer.y, 44);
            this.tweens.add({ targets: flash, alpha: 0, scaleX: 1.9, scaleY: 1.9, duration: 280, onComplete: () => flash.destroy() });
 
            bean.destroy();
            beanGroup.remove(bean);
        }
    });
}
 
// ─── СПАВН ЗЕРНА ─────────────────────────────────────────────────────────────
function spawnBean(scene) {
    if (gameOver || beansSpawned >= totalBeans) return;
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
        duration: Phaser.Math.Between(2200, 3200),
        ease: "Sine.easeIn",
        onComplete: () => {
            if (bean.active) { bean.destroy(); beanGroup.remove(bean); }
            beansFallen++;
            drawProgress(beansFallen);
            // Когда все зёрна упали или поймали — конец игры
            if (beansFallen >= totalBeans && !gameOver) {
                scene.time.delayedCall(600, () => endGame(scene));
            }
        }
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
 
    const cy = H / 2;
 
    // Карточка результата
    scene.time.delayedCall(400, () => {
        const card = scene.add.graphics();
        card.fillStyle(0x1e0d00, 1);
        card.fillRoundedRect(W / 2 - 145, cy - 175, 290, 350, 18);
        card.lineStyle(2, 0xc8862a, 1);
        card.strokeRoundedRect(W / 2 - 145, cy - 175, 290, 350, 18);
        card.alpha = 0;
        scene.tweens.add({ targets: card, alpha: 1, duration: 400 });
 
        const scoreLabel = scene.add.text(W / 2, cy - 140,
            `Собрано зёрен: ${score} из ${totalBeans}`,
            { fontSize: "13px", fontFamily: "Georgia, serif", fill: "#a07850", align: "center" }
        ).setOrigin(0.5).setAlpha(0);
        scene.tweens.add({ targets: scoreLabel, alpha: 1, duration: 350, delay: 150 });
 
        // Запрос результата
        fetch(BACKEND + "/result?cafe=" + CAFE_ID, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ score })
        })
        .then(r => r.json())
        .then(result => {
            if (result.win) {
                showWinScreen(scene, result, cy);
            } else {
                showLoseScreen(scene, cy);
            }
        })
        .catch(() => {
            showLoseScreen(scene, cy);
        });
    });
}
 
// ─── ПРОИГРЫШ ─────────────────────────────────────────────────────────────────
function showLoseScreen(scene, cy) {
    const needed = minBeans - score;
    const msg = score >= minBeans
        ? `Не повезло в этот раз.\nПриходите завтра — удача ждёт! ☕`
        : `Не хватило ${needed} зёрен.\nПриходите завтра\nи попробуйте снова! ☕`;
 
    scene.add.text(W / 2, cy - 100, "Почти получилось!", {
        fontSize: "20px", fontFamily: "Georgia, serif",
        fill: "#c8862a", align: "center", stroke: "#0d0500", strokeThickness: 3
    }).setOrigin(0.5).setAlpha(0);
    scene.tweens.add({ targets: scene.children.list[scene.children.list.length-1], alpha: 1, duration: 350, delay: 200 });
 
    scene.add.text(W / 2, cy - 45, msg, {
        fontSize: "15px", fontFamily: "Georgia, serif", fill: "#faf0e6",
        align: "center", wordWrap: { width: 250 }, lineSpacing: 6
    }).setOrigin(0.5).setAlpha(0);
    scene.tweens.add({ targets: scene.children.list[scene.children.list.length-1], alpha: 1, duration: 350, delay: 350 });
 
    // Кнопка соцсети
    scene.time.delayedCall(600, () => {
        const btn = makeButton(scene, W / 2, cy + 90, "☕ Подписаться на нас", "#3d1f00", "#c8862a", 220, 44);
        btn.on("pointerdown", () => window.open(socialLink, "_blank"));
    });
}
 
// ─── ВЫИГРЫШ: шаг 1 — Share ──────────────────────────────────────────────────
function showWinScreen(scene, result, cy) {
    // Конфетти зёрен
    for (let i = 0; i < 20; i++) {
        scene.time.delayedCall(i * 100, () => {
            const cb = scene.add.graphics();
            cb.x = Phaser.Math.Between(0, W);
            cb.y = -20;
            drawBean(cb);
            scene.tweens.add({
                targets: cb,
                y: H + 20,
                x: cb.x + Phaser.Math.Between(-120, 120),
                rotation: Phaser.Math.FloatBetween(0, 12),
                duration: Phaser.Math.Between(1400, 2800),
                onComplete: () => cb.destroy()
            });
        });
    }
 
    // Заголовок
    scene.add.text(W / 2, cy - 138, "🎉  Вы выиграли!", {
        fontSize: "24px", fontFamily: "Georgia, serif",
        fill: "#ffcc00", stroke: "#0d0500", strokeThickness: 4, align: "center"
    }).setOrigin(0.5).setAlpha(0);
    scene.tweens.add({ targets: scene.children.list[scene.children.list.length-1], alpha: 1, duration: 400, delay: 200 });
 
    // Блок приза
    scene.time.delayedCall(350, () => {
        const prizeBox = scene.add.graphics();
        prizeBox.fillStyle(0xc8862a, 0.12);
        prizeBox.fillRoundedRect(W / 2 - 120, cy - 105, 240, 60, 10);
        prizeBox.lineStyle(1.5, 0xc8862a, 0.6);
        prizeBox.strokeRoundedRect(W / 2 - 120, cy - 105, 240, 60, 10);
    });
 
    scene.add.text(W / 2, cy - 75, result.prizeTitle || prizeTitle, {
        fontSize: "16px", fontFamily: "Georgia, serif", fill: "#ffcc00",
        align: "center", wordWrap: { width: 220 }
    }).setOrigin(0.5).setAlpha(0);
    scene.tweens.add({ targets: scene.children.list[scene.children.list.length-1], alpha: 1, duration: 350, delay: 450 });
 
    // CTA текст
    scene.add.text(W / 2, cy - 15,
        "Сделай репост в сторис,\nчтобы получить приз! 📸",
        { fontSize: "14px", fontFamily: "Georgia, serif", fill: "#faf0e6",
          align: "center", wordWrap: { width: 255 }, lineSpacing: 5 }
    ).setOrigin(0.5).setAlpha(0);
    scene.tweens.add({ targets: scene.children.list[scene.children.list.length-1], alpha: 1, duration: 350, delay: 600 });
 
    // Кнопка ПОДЕЛИТЬСЯ
    scene.time.delayedCall(800, () => {
        const shareBtn = makeButton(scene, W / 2, cy + 55, "📲  Поделиться в сторис", "#e8303a", "#fff", 238, 50);
        shareBtn.on("pointerdown", () => doShare(scene, result));
    });
 
    // Мелкая подсказка
    scene.time.delayedCall(1000, () => {
        scene.add.text(W / 2, cy + 100,
            "После репоста появится промокод",
            { fontSize: "11px", fontFamily: "Georgia, serif", fill: "#5a3010", align: "center" }
        ).setOrigin(0.5);
    });
}
 
// ─── SHARE → ПРОМОКОД ────────────────────────────────────────────────────────
function doShare(scene, result) {
    const afterShare = () => showPromoScreen(scene, result);
 
    if (navigator.share) {
        navigator.share({
            title: "Я выиграл в Coffee Catch! ☕",
            text: `Поймал кофейные зёрна и выиграл: ${result.prizeTitle || prizeTitle}! Сканируй QR на стаканчике!`,
            url: window.location.href
        }).then(afterShare).catch(afterShare); // catch тоже показываем промокод
    } else {
        // Десктоп: копируем ссылку и сразу показываем промокод
        navigator.clipboard?.writeText(window.location.href).catch(() => {});
        afterShare();
    }
}
 
// ─── ЭКРАН ПРОМОКОДА ─────────────────────────────────────────────────────────
function showPromoScreen(scene, result) {
    // Полное перекрытие
    const ov = scene.add.graphics();
    ov.fillStyle(0x050100, 0.97);
    ov.fillRect(0, 0, W, H);
    ov.alpha = 0;
    scene.tweens.add({ targets: ov, alpha: 1, duration: 400 });
 
    const cy = H / 2;
 
    scene.time.delayedCall(300, () => {
        // Карточка
        const card = scene.add.graphics();
        card.fillStyle(0x1e0d00, 1);
        card.fillRoundedRect(W / 2 - 148, cy - 215, 296, 430, 20);
        card.lineStyle(2.5, 0xffcc00, 1);
        card.strokeRoundedRect(W / 2 - 148, cy - 215, 296, 430, 20);
 
        // Заголовок
        scene.add.text(W / 2, cy - 178, "🏆  Ваш приз!", {
            fontSize: "22px", fontFamily: "Georgia, serif", fill: "#ffcc00", align: "center"
        }).setOrigin(0.5);
 
        // Название приза
        scene.add.text(W / 2, cy - 135, result.prizeTitle || prizeTitle, {
            fontSize: "16px", fontFamily: "Georgia, serif", fill: "#faf0e6",
            align: "center", wordWrap: { width: 260 }
        }).setOrigin(0.5);
 
        // Белая карточка промокода
        const codeCard = scene.add.graphics();
        codeCard.fillStyle(0xffffff, 1);
        codeCard.fillRoundedRect(W / 2 - 125, cy - 100, 250, 100, 12);
 
        scene.add.text(W / 2, cy - 82, "ПРОМОКОД", {
            fontSize: "11px", fontFamily: "Georgia, serif", fill: "#7a5030",
            align: "center", letterSpacing: 3
        }).setOrigin(0.5);
 
        scene.add.text(W / 2, cy - 48, result.code, {
            fontSize: "28px", fontFamily: "Courier New, monospace",
            fill: "#1a0a00", align: "center", letterSpacing: 3
        }).setOrigin(0.5);
 
        // Штрихкод декор
        drawBarcode(scene, W / 2, cy - 12);
 
        // Инструкция
        scene.add.text(W / 2, cy + 22,
            "Покажи этот экран бариста\nили назови промокод вслух 👆",
            { fontSize: "13px", fontFamily: "Georgia, serif", fill: "#c8862a",
              align: "center", wordWrap: { width: 260 }, lineSpacing: 5 }
        ).setOrigin(0.5);
 
        // Кнопка "Скопировать"
        const copyBtn = makeButton(scene, W / 2, cy + 100, "📋  Скопировать промокод", "#2d6a2d", "#fff", 232, 44);
        copyBtn.on("pointerdown", () => {
            navigator.clipboard?.writeText(result.code).catch(() => {});
            copyBtn.destroy();
            const ok = scene.add.text(W / 2, cy + 100, "✓ Скопировано!", {
                fontSize: "15px", fontFamily: "Georgia, serif", fill: "#66ff88", align: "center"
            }).setOrigin(0.5);
            scene.tweens.add({ targets: ok, alpha: 0, delay: 2200, duration: 500, onComplete: () => ok.destroy() });
        });
 
        // Ссылка на соцсети
        const link = scene.add.text(W / 2, cy + 160,
            "Подписаться на нас →",
            { fontSize: "12px", fontFamily: "Georgia, serif", fill: "#7a5030", align: "center" }
        ).setOrigin(0.5).setInteractive({ useHandCursor: true });
        link.on("pointerdown", () => window.open(socialLink, "_blank"));
        link.on("pointerover", () => link.setStyle({ fill: "#c8862a" }));
        link.on("pointerout",  () => link.setStyle({ fill: "#7a5030" }));
    });
}
 
// ─── ШТРИХКОД (декор) ────────────────────────────────────────────────────────
function drawBarcode(scene, cx, y) {
    const g = scene.add.graphics();
    g.fillStyle(0x1a0a00, 1);
    const widths = [2,1,3,1,2,1,1,2,3,1,2,1,3,2,1,1,2,1,2,1,3,1];
    let x = cx - 56;
    widths.forEach((w, i) => {
        if (i % 2 === 0) g.fillRect(x, y - 11, w * 3, 22);
        x += w * 3 + 1.5;
    });
}
 
// ─── УНИВЕРСАЛЬНАЯ КНОПКА ────────────────────────────────────────────────────
function makeButton(scene, x, y, label, bgHex, textColor, w = 200, h = 46) {
    const cont = scene.add.container(x, y);
    const col = parseInt(bgHex.replace("#", ""), 16);
    const bg = scene.add.graphics();
    bg.fillStyle(col, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    cont.add(bg);
    cont.add(scene.add.text(0, 1, label, {
        fontSize: "14px", fontFamily: "Georgia, serif", fill: textColor, align: "center"
    }).setOrigin(0.5));
    cont.setSize(w, h).setInteractive({ useHandCursor: true });
    cont.on("pointerover", () => bg.setAlpha(0.82));
    cont.on("pointerout",  () => bg.setAlpha(1));
    return cont;
}
 
// ─── ФОН ─────────────────────────────────────────────────────────────────────
function drawBackground(scene) {
    const bg = scene.add.graphics();
    bg.fillGradientStyle(0x1a0a00, 0x1a0a00, 0x2d1200, 0x2d1200, 1);
    bg.fillRect(0, 0, W, H);
    const pat = scene.add.graphics();
    pat.lineStyle(1, 0x3d1f00, 0.2);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 5; c++) {
        const px = c * 78 + 28, py = r * 75 + 30;
        pat.strokeCircle(px, py, 16);
        pat.moveTo(px, py - 9); pat.lineTo(px, py + 9);
    }
    pat.strokePath();
    const top = scene.add.graphics();
    top.fillStyle(0x220e00, 1); top.fillRect(0, 0, W, 70);
    top.lineStyle(1.5, 0xc8862a, 0.5); top.strokeRect(7, 7, W - 14, 56);
    const bot = scene.add.graphics();
    bot.fillStyle(0x100500, 0.5); bot.fillRect(0, H - 95, W, 95);
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
 
