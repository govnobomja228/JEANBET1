require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');

const app = express();

// Настройки CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { 
    rejectUnauthorized: false
  }
});

// Инициализация Telegram бота
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Инициализация БД
async function initDB() {
  try {
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
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

// Middleware для проверки пользователя
const authMiddleware = async (req, res, next) => {
  try {
    const userId = req.body.userId || req.query.userId;
    if (!userId) throw new Error('User ID is required');
    
    const user = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1', 
      [userId]
    );
    
    if (!user.rows.length) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }
    
    req.user = user.rows[0];
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false,
      error: error.message 
    });
  }
};

/* ========== КЛИЕНТСКИЕ ЭНДПОИНТЫ ========== */

// Регистрация/авторизация пользователя
app.post('/api/auth', async (req, res) => {
  try {
    const { userId, username } = req.body;
    if (!userId) throw new Error('User ID is required');

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
      error: 'Authentication failed' 
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

// Тестовое пополнение баланса
app.post('/api/payment/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) throw new Error('Invalid amount');

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
      error: 'Transaction failed',
      details: error.message
    });
  }
});

// Размещение ставки
app.post('/api/bets', authMiddleware, async (req, res) => {
  try {
    const { amount, racerId } = req.body;
    
    if (![1, 2].includes(Number(racerId))) throw new Error('Invalid racer ID');
    if (amount < 50) throw new Error('Minimum bet is 50 RUB');

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

// Получение коэффициентов
app.get('/api/odds', (req, res) => {
  res.json({
    success: true,
    odds: {
      racer1: 1.85,
      racer2: 2.10
    }
  });
});

/* ========== АДМИН ЭНДПОИНТЫ ========== */

// Авторизация админа
app.post('/api/admin/login', authMiddleware, async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Объявление победителя
app.post('/api/admin/races/settle', authMiddleware, async (req, res) => {
  try {
    if (!req.user.is_admin) throw new Error('Forbidden');
    
    const { winnerId } = req.body;
    if (![1, 2].includes(Number(winnerId))) throw new Error('Invalid winner ID');

    await pool.query('BEGIN');
    
    // Находим все активные ставки
    const bets = await pool.query(
      `SELECT id, user_id, amount, odds 
       FROM bets WHERE status = 'pending'`
    );
    
    // Обрабатываем каждую ставку
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
      error: error.message
    });
  }
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ 
    success: false,
    error: 'Internal Server Error' 
  });
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