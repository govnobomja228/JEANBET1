require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(cors({
  origin: process.env.SERVER_URL,
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Конфигурация загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

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
        odds DECIMAL(4,2) DEFAULT 2.00,
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
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_id TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        card_details TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO racers (id, name, odds, is_active) VALUES 
        (1, 'Max Verstappen', 2.00, true),
        (2, 'Lewis Hamilton', 2.00, true)
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('Database initialized');
  } catch (err) {
    console.error('Database init error:', err);
    process.exit(1);
  }
}

// Middleware аутентификации
const authenticate = (req, res, next) => {
  try {
    const authData = req.headers.authorization;
    if (!authData) return res.status(401).json({ error: 'Unauthorized' });
    req.user = JSON.parse(authData);
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid authorization' });
  }
};

// API для фронтенда
app.get('/api/racers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM racers WHERE is_active = true');
    res.json({ racers: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get racers' });
  }
});

app.post('/api/bets', authenticate, async (req, res) => {
  try {
    const { amount, racerId } = req.body;
    const userId = req.user.id;
    
    await pool.query('BEGIN');
    const user = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE', 
      [userId]
    );
    
    if (user.rows[0].balance < amount) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    const racer = await pool.query(
      'SELECT odds FROM racers WHERE id = $1 AND is_active = true', 
      [racerId]
    );
    
    await pool.query(
      'INSERT INTO bets (user_id, amount, racer_id, odds) VALUES ($1, $2, $3, $4)',
      [userId, amount, racerId, racer.rows[0].odds]
    );
    
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, userId]
    );
    
    await pool.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

// ЮКасса интеграция
app.post('/api/payment/create', authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    const idempotenceKey = crypto.randomUUID();
    const response = await axios.post(
      'https://api.yookassa.ru/v3/payments',
      {
        amount: { value: amount, currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: `${process.env.SERVER_URL}/success` },
        description: `Deposit for ${req.user.id}`
      },
      {
        auth: {
          username: process.env.YOOKASSA_SHOP_ID,
          password: process.env.YOOKASSA_SECRET_KEY
        },
        headers: { 'Idempotence-Key': idempotenceKey }
      }
    );
    
    await pool.query(
      'INSERT INTO payments (user_id, amount, payment_id) VALUES ($1, $2, $3)',
      [req.user.id, amount, response.data.id]
    );
    
    res.json({ url: response.data.confirmation.confirmation_url });
  } catch (err) {
    res.status(500).json({ error: 'Payment creation failed' });
  }
});

app.post('/api/payment-webhook', express.json(), async (req, res) => {
  const event = req.body;
  try {
    if (event.event === 'payment.succeeded') {
      const payment = event.object;
      await pool.query('BEGIN');
      await pool.query(
        'UPDATE payments SET status = $1 WHERE payment_id = $2',
        ['succeeded', payment.id]
      );
      await pool.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [payment.amount.value, payment.metadata.userId]
      );
      await pool.query('COMMIT');
    }
    res.status(200).end();
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).end();
  }
});

// Запуск сервера
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.setWebHook(`${process.env.SERVER_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`);
  });
});