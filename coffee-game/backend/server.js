const express = require("express");
const cors    = require("cors");
const fs      = require("fs");
const path    = require("path");
 
const app = express();
app.use(cors());
app.use(express.json());
 
const PORT      = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "gameData.json");
 
// ─── Дефолтные настройки для новой кофейни ───────────────────────────────────
function defaultCafe(cafeId) {
    return {
        name:        cafeId,
        winChance:   0.3,
        minBeans:    10,
        totalBeans:  16,
        gameDuration: 15,
        socialLink:  "https://instagram.com/yourcoffee",
        prizes: [
            { title: "Бесплатный кофе ☕",       codes: [] },
            { title: "Скидка 50% на пончик 🍩",  codes: [] },
            { title: "Круассан в подарок 🥐",     codes: [] }
        ],
        users: {}
    };
}
 
// ─── Загрузка / сохранение ────────────────────────────────────────────────────
function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        const init = { cafes: { demo: defaultCafe("demo") } };
        // Добавляем тестовые промокоды в demo
        init.cafes.demo.prizes[0].codes = ["COFFEE_FREE_01","COFFEE_FREE_02","COFFEE_FREE_03"];
        init.cafes.demo.prizes[1].codes = ["DONUT_50_01","DONUT_50_02"];
        init.cafes.demo.prizes[2].codes = ["CROISSANT_01"];
        fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
        return init;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
 
function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
 
function getCafe(data, cafeId) {
    if (!data.cafes[cafeId]) {
        data.cafes[cafeId] = defaultCafe(cafeId);
        saveData(data);
    }
    return data.cafes[cafeId];
}
 
// ─── Публичный API (для игры) ─────────────────────────────────────────────────
 
// Конфиг кофейни
app.get("/config", (req, res) => {
    const data   = loadData();
    const cafeId = req.query.cafe || "demo";
    const cafe   = getCafe(data, cafeId);
    res.json({
        cafeName:    cafe.name,
        gameDuration: cafe.gameDuration,
        minBeans:    cafe.minBeans,
        totalBeans:  cafe.totalBeans,
        socialLink:  cafe.socialLink,
        // Отдаём только названия призов (без кодов!)
        prizes:      cafe.prizes.map(p => ({ title: p.title, hasStock: p.codes.length > 0 }))
    });
});
 
// Проверка лимита (1 раз в сутки)
app.post("/check", (req, res) => {
    const data   = loadData();
    const cafeId = req.query.cafe || "demo";
    const cafe   = getCafe(data, cafeId);
    const { deviceId } = req.body;
    const today  = new Date().toDateString();
 
    if (cafe.users[deviceId] === today) return res.json({ allowed: false });
    cafe.users[deviceId] = today;
    saveData(data);
    res.json({ allowed: true });
});
 
// Результат игры → выдача приза
app.post("/result", (req, res) => {
    const data   = loadData();
    const cafeId = req.query.cafe || "demo";
    const cafe   = getCafe(data, cafeId);
    const { score } = req.body;
 
    const qualified = score >= cafe.minBeans;
    const win = qualified && Math.random() < cafe.winChance;
    if (!win) return res.json({ win: false });
 
    // Выбираем призы у которых есть промокоды
    const available = cafe.prizes.filter(p => p.codes.length > 0);
    if (available.length === 0) return res.json({ win: false, message: "Промокоды закончились" });
 
    // Случайный приз из доступных
    const prize = available[Math.floor(Math.random() * available.length)];
    const code  = prize.codes.pop();
    saveData(data);
 
    res.json({ win: true, code, prizeTitle: prize.title });
});
 
// ─── Админка API ──────────────────────────────────────────────────────────────
const ADMIN_PASS = process.env.ADMIN_PASS || "coffee2024";
 
function adminAuth(req, res, next) {
    if (req.headers["x-admin-key"] !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
    next();
}
 
// Список всех кофеен
app.get("/admin/cafes", adminAuth, (req, res) => {
    const data = loadData();
    const list = Object.entries(data.cafes).map(([id, cafe]) => ({
        id,
        name:       cafe.name,
        totalCodes: cafe.prizes.reduce((s, p) => s + p.codes.length, 0),
        totalUsers: Object.keys(cafe.users).length,
        winChance:  cafe.winChance
    }));
    res.json(list);
});
 
// Создать новую кофейню
app.post("/admin/cafes", adminAuth, (req, res) => {
    const data = loadData();
    const { cafeId, name } = req.body;
    if (!cafeId || !/^[a-z0-9_-]+$/.test(cafeId)) return res.status(400).json({ error: "Некорректный ID (только a-z, 0-9, -, _)" });
    if (data.cafes[cafeId]) return res.status(400).json({ error: "Кофейня уже существует" });
    data.cafes[cafeId]      = defaultCafe(cafeId);
    data.cafes[cafeId].name = name || cafeId;
    saveData(data);
    res.json({ ok: true });
});
 
// Данные конкретной кофейни
app.get("/admin/cafe/:cafeId", adminAuth, (req, res) => {
    const data = loadData();
    const cafe = getCafe(data, req.params.cafeId);
    const { users, ...rest } = cafe;
    res.json({ ...rest, totalUsers: Object.keys(users).length });
});
 
// Обновить настройки кофейни
app.post("/admin/cafe/:cafeId/settings", adminAuth, (req, res) => {
    const data = loadData();
    const cafe = getCafe(data, req.params.cafeId);
    const { name, winChance, minBeans, totalBeans, gameDuration, socialLink } = req.body;
    if (name        !== undefined) cafe.name        = name;
    if (winChance   !== undefined) cafe.winChance   = Math.min(1, Math.max(0, Number(winChance)));
    if (minBeans    !== undefined) cafe.minBeans    = Number(minBeans);
    if (totalBeans  !== undefined) cafe.totalBeans  = Number(totalBeans);
    if (gameDuration!== undefined) cafe.gameDuration= Number(gameDuration);
    if (socialLink  !== undefined) cafe.socialLink  = socialLink;
    saveData(data);
    res.json({ ok: true });
});
 
// Добавить промокоды к призу
app.post("/admin/cafe/:cafeId/codes", adminAuth, (req, res) => {
    const data     = loadData();
    const cafe     = getCafe(data, req.params.cafeId);
    const { prizeIndex, codes } = req.body;
    const idx = Number(prizeIndex);
    if (!cafe.prizes[idx]) return res.status(400).json({ error: "Приз не найден" });
    const newCodes = codes.split(/[\n,]+/).map(c => c.trim()).filter(Boolean);
    cafe.prizes[idx].codes.push(...newCodes);
    saveData(data);
    res.json({ ok: true, added: newCodes.length, total: cafe.prizes[idx].codes.length });
});
 
// Обновить названия призов
app.post("/admin/cafe/:cafeId/prizes", adminAuth, (req, res) => {
    const data  = loadData();
    const cafe  = getCafe(data, req.params.cafeId);
    const { prizes } = req.body; // [{ title }]
    prizes.forEach((p, i) => {
        if (cafe.prizes[i]) cafe.prizes[i].title = p.title;
        else cafe.prizes.push({ title: p.title, codes: [] });
    });
    saveData(data);
    res.json({ ok: true });
});
 
// Сброс лимитов игроков
app.post("/admin/cafe/:cafeId/reset-users", adminAuth, (req, res) => {
    const data = loadData();
    const cafe = getCafe(data, req.params.cafeId);
    cafe.users = {};
    saveData(data);
    res.json({ ok: true });
});
 
app.get("/", (req, res) => res.send("<h2>☕ Coffee Game Backend running!</h2>"));
app.listen(PORT, () => console.log(`Backend: http://localhost:${PORT}`));
