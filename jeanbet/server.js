require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Настройка загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secureadmin123';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Инициализация БД
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        username TEXT,
        balance DECIMAL(10,2) DEFAULT 0,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS bets (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
        amount DECIMAL(10,2),
        racer_id INTEGER,
        odds DECIMAL(4,2),
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS racers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        odds DECIMAL(4,2) DEFAULT 2.00,
        image_url TEXT,
        is_active BOOLEAN DEFAULT TRUE
      );
      
      CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // Добавляем стандартных гонщиков
    await pool.query(`
      INSERT INTO racers (id, name, odds, image_url)
      VALUES (1, 'Max Verstappen', 2.00, '/uploads/racer1.jpg'),
             (2, 'Lewis Hamilton', 2.00, '/uploads/racer2.jpg')
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('Database initialized');
  } catch (err) {
    console.error('Database init error:', err);
    process.exit(1);
  }
}

// Middleware для проверки авторизации
const authenticate = (req, res, next) => {
  try {
    const authData = req.headers.authorization;
    if (!authData) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = JSON.parse(authData);
    if (!user?.id) return res.status(401).json({ error: 'Invalid auth data' });
    
    req.user = user;
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid authorization header' });
  }
};

// Middleware для проверки админа
const checkAdmin = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT is_admin FROM users WHERE telegram_id = $1',
      [req.user.id]
    );
    
    if (result.rows[0]?.is_admin) return next();
    res.status(403).json({ error: 'Forbidden' });
  } catch (err) {
    console.error('Admin check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// API для входа в админ-панель
app.post('/api/admin/login', authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    await pool.query(
      'UPDATE users SET is_admin = TRUE WHERE telegram_id = $1',
      [req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// API для управления гонщиками
app.post('/api/admin/racers', authenticate, checkAdmin, upload.single('image'), async (req, res) => {
  try {
    const { name, odds, is_active } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await pool.query(
      'INSERT INTO racers (name, odds, image_url, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, odds, imageUrl, is_active === 'true']
    );

    res.json({ racer: result.rows[0] });
  } catch (err) {
    console.error('Add racer error:', err);
    res.status(500).json({ error: 'Failed to add racer' });
  }
});

// API для обновления гонщиков
app.put('/api/admin/racers/:id', authenticate, checkAdmin, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, odds, is_active } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await pool.query(
      `UPDATE racers SET 
        name = COALESCE($1, name),
        odds = COALESCE($2, odds),
        image_url = COALESCE($3, image_url),
        is_active = COALESCE($4, is_active)
      WHERE id = $5 RETURNING *`,
      [name || null, odds || null, imageUrl, is_active ? is_active === 'true' : null, id]
    );

    res.json({ racer: result.rows[0] });
  } catch (err) {
    console.error('Update racer error:', err);
    res.status(500).json({ error: 'Failed to update racer' });
  }
});

// API для получения списка гонщиков
app.get('/api/racers', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM racers WHERE is_active = TRUE ORDER BY id'
    );
    res.json({ racers: result.rows });
  } catch (err) {
    console.error('Get racers error:', err);
    res.status(500).json({ error: 'Failed to get racers' });
  }
});

// API для изменения настроек сайта
app.post('/api/admin/settings', authenticate, checkAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    
    await pool.query(
      'INSERT INTO site_settings (key, value) VALUES ($1, $2) ' +
      'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, value]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Остальные API (ставки, баланс и т.д.) остаются как в предыдущей версии
// ... [остальной код из предыдущего server.js]

// Запуск сервера
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (bot) {
      bot.setWebHook(`${process.env.SERVER_URL}/bot${TELEGRAM_BOT_TOKEN}`);
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;