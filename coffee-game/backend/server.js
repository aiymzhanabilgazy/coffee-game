const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const DATA_FILE = path.join(__dirname, "gameData.json");

// ─── Хранилище ───────────────────────────────────────────────────────────────
function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        const defaults = {
            promoCodes: ["COFFEE_FREE_01", "COFFEE_FREE_02", "COFFEE_FREE_03"],
            winChance: 0.3,       // вероятность выигрыша 0–1
            minBeans: 10,         // минимум зёрен для шанса выиграть
            gameDuration: 15,     // секунды
            prizeTitle: "Скидка 50% на пончик 🍩",
            socialLink: "https://instagram.com/yourcoffee",
            users: {}
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2));
        return defaults;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─── API для игры ─────────────────────────────────────────────────────────────

// Получить настройки игры (фронтенд запрашивает при старте)
app.get("/config", (req, res) => {
    const data = loadData();
    res.json({
        gameDuration: data.gameDuration,
        minBeans: data.minBeans,
        prizeTitle: data.prizeTitle,
        socialLink: data.socialLink
    });
});

// Проверка лимита — 1 раз в сутки
app.post("/check", (req, res) => {
    const data = loadData();
    const { deviceId } = req.body;
    const today = new Date().toDateString();

    if (data.users[deviceId] === today) {
        return res.json({ allowed: false });
    }

    data.users[deviceId] = today;
    saveData(data);
    return res.json({ allowed: true });
});

// Результат игры → выдача промокода
app.post("/result", (req, res) => {
    const data = loadData();
    const { score } = req.body;

    const qualified = score >= data.minBeans;
    const win = qualified && Math.random() < data.winChance;

    if (!win) {
        return res.json({ win: false });
    }

    if (data.promoCodes.length === 0) {
        return res.json({ win: false, message: "Промокоды закончились" });
    }

    const code = data.promoCodes.pop();
    saveData(data);

    res.json({ win: true, code, prizeTitle: data.prizeTitle });
});

// ─── Админка API ──────────────────────────────────────────────────────────────
const ADMIN_PASS = process.env.ADMIN_PASS || "coffee2024";

function adminAuth(req, res, next) {
    const auth = req.headers["x-admin-key"];
    if (auth !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
    next();
}

// Получить все данные (для админки)
app.get("/admin/data", adminAuth, (req, res) => {
    const data = loadData();
    const { users, ...rest } = data;
    res.json({ ...rest, totalUsers: Object.keys(users).length });
});

// Обновить настройки
app.post("/admin/settings", adminAuth, (req, res) => {
    const data = loadData();
    const { winChance, minBeans, gameDuration, prizeTitle, socialLink } = req.body;
    if (winChance !== undefined) data.winChance = Math.min(1, Math.max(0, Number(winChance)));
    if (minBeans !== undefined) data.minBeans = Number(minBeans);
    if (gameDuration !== undefined) data.gameDuration = Number(gameDuration);
    if (prizeTitle !== undefined) data.prizeTitle = prizeTitle;
    if (socialLink !== undefined) data.socialLink = socialLink;
    saveData(data);
    res.json({ ok: true });
});

// Добавить промокоды (через запятую или построчно)
app.post("/admin/codes", adminAuth, (req, res) => {
    const data = loadData();
    const { codes } = req.body; // string
    const newCodes = codes.split(/[\n,]+/).map(c => c.trim()).filter(Boolean);
    data.promoCodes.push(...newCodes);
    saveData(data);
    res.json({ ok: true, added: newCodes.length, total: data.promoCodes.length });
});

// Сбросить лимиты пользователей
app.post("/admin/reset-users", adminAuth, (req, res) => {
    const data = loadData();
    data.users = {};
    saveData(data);
    res.json({ ok: true });
});

// Главная
app.get("/", (req, res) => res.send("<h2>☕ Coffee Game Backend is running!</h2>"));

app.listen(PORT, () => console.log(`Backend: http://localhost:${PORT}`));