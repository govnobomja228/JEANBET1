require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Инициализация БД
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      balance DECIMAL(10,2) DEFAULT 0,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(telegram_id),
      amount DECIMAL(10,2),
      type VARCHAR(20),
      status VARCHAR(20) DEFAULT 'pending',
      details JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bets (
      id SERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(telegram_id),
      amount DECIMAL(10,2),
      racer_id INTEGER,
      odds DECIMAL(4,2),
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS races (
      id SERIAL PRIMARY KEY,
      winner_id INTEGER,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

// Промежуточное ПО для проверки пользователя
const authMiddleware = async (req, res, next) => {
  try {
    const userId = req.body.userId || req.query.userId;
    if (!userId) throw new Error('User ID required');
    
    req.user = (await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1', 
      [userId]
    )).rows[0];
    
    if (!req.user) throw new Error('User not found');
    
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false,
      error: error.message 
    });
  }
};

// Промежуточное для админа
const adminMiddleware = async (req, res, next) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ 
      success: false,
      error: 'Forbidden' 
    });
  }
  next();
};

/* ========== КЛИЕНТСКИЕ ЭНДПОИНТЫ ========== */

// Регистрация/авторизация
app.post('/api/auth', async (req, res) => {
  const { userId, username } = req.body;
  
  try {
    const result = await pool.query(`
      INSERT INTO users (telegram_id, username)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET username = EXCLUDED.username
      RETURNING *
    `, [userId, username]);
    
    res.json({ 
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Auth failed' 
    });
  }
});

// Получение баланса
app.get('/api/balance/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [req.params.userId]
    );
    
    res.json({
      success: true,
      balance: result.rows[0]?.balance || 0
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Тестовое пополнение
app.post('/api/payment/deposit', authMiddleware, async (req, res) => {
  const { amount } = req.body;

  try {
    await pool.query('BEGIN');
    
    // Обновляем баланс
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, req.user.telegram_id]
    );
    
    // Записываем транзакцию
    await pool.query(
      `INSERT INTO transactions 
       (user_id, amount, type, status)
       VALUES ($1, $2, 'deposit', 'completed')`,
      [req.user.telegram_id, amount]
    );
    
    await pool.query('COMMIT');
    
    res.json({ 
      success: true,
      message: `Balance updated by ${amount} RUB`
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Deposit error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Transaction failed'
    });
  }
});

// Создание ставки
app.post('/api/bets', authMiddleware, async (req, res) => {
  const { amount, racerId } = req.body;
  
  try {
    if (![1, 2].includes(Number(racerId))) {
      throw new Error('Invalid racer ID');
    }

    if (amount < 50) {
      throw new Error('Minimum bet is 50 RUB');
    }

    await pool.query('BEGIN');
    
    // Проверяем баланс с блокировкой
    const balance = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE',
      [req.user.telegram_id]
    );
    
    if (balance.rows[0].balance < amount) {
      throw new Error('Insufficient funds');
    }
    
    // Создаем ставку
    const odds = racerId === 1 ? 1.85 : 2.10;
    await pool.query(
      'INSERT INTO bets (user_id, amount, racer_id, odds) VALUES ($1, $2, $3, $4)',
      [req.user.telegram_id, amount, racerId, odds]
    );
    
    // Списание средств
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, req.user.telegram_id]
    );
    
    await pool.query('COMMIT');
    
    res.json({ 
      success: true,
      message: 'Bet placed successfully'
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as time');
    res.json({ success: true, time: result.rows[0].time });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получение активных гонок
app.get('/api/races', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, status, 
       (SELECT COUNT(*) FROM bets WHERE race_id = races.id) as bets_count
       FROM races ORDER BY created_at DESC LIMIT 5`
    );
    
    res.json({
      success: true,
      races: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* ========== АДМИН ЭНДПОИНТЫ ========== */

// Авторизация админа
app.post('/api/admin/login', authMiddleware, async (req, res) => {
  const { password } = req.body;
  
  if (password === process.env.ADMIN_PASSWORD) {
    await pool.query(
      'UPDATE users SET is_admin = TRUE WHERE telegram_id = $1',
      [req.user.telegram_id]
    );
    
    res.json({ 
      success: true,
      isAdmin: true 
    });
  } else {
    res.status(401).json({ 
      success: false,
      error: 'Invalid password' 
    });
  }
});

// Объявление победителя
app.post('/api/admin/races/:raceId/settle', authMiddleware, adminMiddleware, async (req, res) => {
  const { winnerId } = req.body;
  
  try {
    await pool.query('BEGIN');
    
    // Обновляем статус гонки
    await pool.query(
      'UPDATE races SET status = 'completed', winner_id = $1 WHERE id = $2',
      [winnerId, req.params.raceId]
    );
    
    // Обрабатываем ставки
    const bets = await pool.query(
      `SELECT b.id, b.user_id, b.amount, b.odds 
       FROM bets b WHERE b.race_id = $1 AND b.status = 'pending'`,
      [req.params.raceId]
    );
    
    for (const bet of bets.rows) {
      if (bet.racer_id === winnerId) {
        const winAmount = bet.amount * bet.odds;
        await pool.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [winAmount, bet.user_id]
        );
        
        // Уведомляем пользователя
        bot.sendMessage(
          bet.user_id,
          `🎉 Ваша ставка выиграла! Вы получили ${winAmount.toFixed(2)} ₽`
        );
      }
      
      await pool.query(
        `UPDATE bets SET status = $1 
         WHERE id = $2`,
        [bet.racer_id === winnerId ? 'won' : 'lost', bet.id]
      );
    }
    
    await pool.query('COMMIT');
    
    res.json({ 
      success: true,
      message: 'Race settled successfully'
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Settle error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Settlement failed'
    });
  }
});

// Инициализация сервера
initDB().then(() => {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    bot.setWebHook(`https://jeanbet-1-j9dw-eight.vercel.app/bot${process.env.TELEGRAM_BOT_TOKEN}`);
  });
});

module.exports = app;