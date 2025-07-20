require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(cors({
  origin: 'https://jeanbet-1-j9dw-eight.vercel.app',
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

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
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

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

// API для ставок
app.post('/api/bets', authenticate, async (req, res) => {
  try {
    const { amount, racerId } = req.body;
    const userId = req.user.id;
    
    if (!amount || !racerId) {
      return res.status(400).json({ error: 'Amount and racerId are required' });
    }

    if (amount < 50) {
      return res.status(400).json({ error: 'Minimum bet is 50' });
    }

    await pool.query('BEGIN');
    
    const user = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE',
      [userId]
    );
    
    if (user.rows.length === 0 || user.rows[0].balance < amount) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    await pool.query(
      'INSERT INTO bets (user_id, amount, racer_id) VALUES ($1, $2, $3)',
      [userId, amount, racerId]
    );

    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, userId]
    );

    await pool.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Bet error:', err);
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

// API для истории ставок
app.get('/api/bets/history', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, r.name as racer_name, r.image_url as racer_image 
       FROM bets b LEFT JOIN racers r ON b.racer_id = r.id 
       WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json({ bets: result.rows });
  } catch (err) {
    console.error('Bets history error:', err);
    res.status(500).json({ error: 'Failed to get bets history' });
  }
});

// API для объявления победителя
app.post('/api/admin/declare-winner', authenticate, async (req, res) => {
  try {
    const { winner } = req.body;
    if (!winner) return res.status(400).json({ error: 'Winner is required' });

    await pool.query('BEGIN');
    
    const updateBets = await pool.query(
      `UPDATE bets SET 
        status = CASE WHEN racer_id = $1 THEN 'won' ELSE 'lost' END,
        updated_at = NOW()
       WHERE status = 'pending' 
       RETURNING *`,
      [winner]
    );

    for (const bet of updateBets.rows) {
      if (bet.status === 'won') {
        const winAmount = bet.amount * 2.00;
        await pool.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [winAmount, bet.user_id]
        );
        
        if (bot) {
          try {
            await bot.sendMessage(bet.user_id, `🎉 Вы выиграли ${winAmount.toFixed(2)} руб.!`);
          } catch (err) {
            console.error('Failed to send notification:', err);
          }
        }
      }
    }

    await pool.query('COMMIT');
    res.json({ 
      success: true,
      message: `Winner declared and ${updateBets.rowCount} bets processed`
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Declare winner error:', err);
    res.status(500).json({ error: 'Failed to declare winner' });
  }
});

// API для баланса
app.get('/api/balance/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [req.params.userId]
    );
    res.json({ balance: result.rows[0]?.balance || 0 });
  } catch (err) {
    console.error('Balance error:', err);
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Инициализация и запуск
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (bot) {
      bot.setWebHook(`https://jeanbet-1-j9dw-eight.vercel.app/bot${TELEGRAM_BOT_TOKEN}`);
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});