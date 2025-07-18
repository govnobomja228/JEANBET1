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

      CREATE TABLE IF NOT EXISTS races (
        id SERIAL PRIMARY KEY,
        winner_id INTEGER,
        settled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('База данных успешно инициализирована');
  } catch (error) {
    console.error('Ошибка инициализации БД:', error);
    process.exit(1);
  }
}

// Middleware для проверки пользователя
const authMiddleware = async (req, res, next) => {
  try {
    const userId = req.body.userId || req.query.userId;
    if (!userId) throw new Error('Требуется ID пользователя');
    
    const user = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1', 
      [userId]
    );
    
    if (!user.rows.length) {
      return res.status(404).json({ 
        success: false,
        error: 'Пользователь не найден' 
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

// Middleware для проверки администратора
const adminMiddleware = async (req, res, next) => {
  try {
    if (!req.user?.is_admin) {
      throw new Error('Доступ запрещен');
    }
    next();
  } catch (error) {
    res.status(403).json({
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
    if (!userId) throw new Error('Требуется ID пользователя');

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
    console.error('Ошибка авторизации:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка авторизации' 
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

// Пополнение баланса
app.post('/api/payment/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) throw new Error('Неверная сумма');

    await pool.query('BEGIN');
    
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, req.user.telegram_id]
    );
    
    await pool.query(
      `INSERT INTO transactions 
       (user_id, amount, type, status)
       VALUES ($1, $2, 'deposit', 'completed')`,
      [req.user.telegram_id, amount]
    );
    
    await pool.query('COMMIT');
    
    res.json({ 
      success: true,
      message: `Баланс пополнен на ${amount} ₽`
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Ошибка пополнения:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка транзакции',
      details: error.message
    });
  }
});

// Размещение ставки
app.post('/api/bets', authMiddleware, async (req, res) => {
  try {
    const { amount, racerId } = req.body;
    
    if (![1, 2].includes(Number(racerId))) throw new Error('Неверный ID гонщика');
    if (amount < 50) throw new Error('Минимальная ставка 50 ₽');

    await pool.query('BEGIN');
    
    const balance = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE',
      [req.user.telegram_id]
    );
    
    if (balance.rows[0].balance < amount) {
      throw new Error('Недостаточно средств');
    }
    
    const odds = racerId === 1 ? 1.85 : 2.10;
    await pool.query(
      'INSERT INTO bets (user_id, amount, racer_id, odds) VALUES ($1, $2, $3, $4)',
      [req.user.telegram_id, amount, racerId, odds]
    );
    
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, req.user.telegram_id]
    );
    
    await pool.query('COMMIT');
    
    res.json({ 
      success: true,
      message: 'Ставка принята'
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
        error: 'Неверный пароль' 
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Получение активных ставок
app.get('/api/admin/active-bets', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.user_id, u.username, b.amount, b.racer_id, b.odds, b.created_at
       FROM bets b
       LEFT JOIN users u ON b.user_id = u.telegram_id
       WHERE b.status = 'pending'`
    );
    
    res.json({
      success: true,
      bets: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Получение списка пользователей
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT telegram_id, username, balance, is_admin FROM users ORDER BY created_at DESC'
    );
    
    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Получение статистики
app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [users, activeBets, totalBets, totalVolume, betsByHour] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM bets WHERE status = \'pending\''),
      pool.query('SELECT COUNT(*) FROM bets'),
      pool.query('SELECT COALESCE(SUM(amount), 0) FROM bets'),
      pool.query(`
        SELECT 
          EXTRACT(HOUR FROM created_at) AS hour,
          COUNT(*) AS bets
        FROM bets
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY hour
        ORDER BY hour
      `)
    ]);
    
    res.json({
      success: true,
      stats: {
        totalUsers: parseInt(users.rows[0].count),
        activeBets: parseInt(activeBets.rows[0].count),
        totalBets: parseInt(totalBets.rows[0].count),
        totalVolume: parseFloat(totalVolume.rows[0].coalesce),
        betsByHour: betsByHour.rows.map(row => ({
          hour: row.hour,
          bets: parseInt(row.bets)
        }))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Объявление победителя
app.post('/api/admin/races/settle', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { winnerId } = req.body;
    if (![1, 2].includes(Number(winnerId))) throw new Error('Неверный ID победителя');

    await pool.query('BEGIN');
    
    // Создаем запись о гонке
    const race = await pool.query(
      'INSERT INTO races (winner_id, settled_at) VALUES ($1, NOW()) RETURNING id',
      [winnerId]
    );
    
    const raceId = race.rows[0].id;

    // Находим все активные ставки
    const bets = await pool.query(
      `SELECT id, user_id, amount, odds, racer_id 
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
        `UPDATE bets SET status = $1, race_id = $2
         WHERE id = $3`,
        [bet.racer_id === winnerId ? 'won' : 'lost', raceId, bet.id]
      );
    }
    
    await pool.query('COMMIT');
    
    res.json({ 
      success: true,
      message: 'Гонка завершена. Победитель объявлен'
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Ошибка завершения гонки:', error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// Корректировка баланса пользователя
app.post('/api/admin/adjust-balance', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) throw new Error('Не указаны обязательные параметры');
    
    await pool.query('BEGIN');
    
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, userId]
    );
    
    await pool.query(
      `INSERT INTO transactions 
       (user_id, amount, type, status, details)
       VALUES ($1, $2, 'adjustment', 'completed', $3)`,
      [userId, amount, { adminId: req.user.telegram_id, note: 'Ручная корректировка' }]
    );
    
    await pool.query('COMMIT');
    
    res.json({ 
      success: true,
      message: `Баланс пользователя изменен на ${amount} ₽`
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// Отмена ставки
app.post('/api/admin/cancel-bet', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { betId } = req.body;
    if (!betId) throw new Error('Не указан ID ставки');

    await pool.query('BEGIN');
    
    const bet = await pool.query(
      `SELECT user_id, amount FROM bets WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [betId]
    );
    
    if (!bet.rows.length) {
      throw new Error('Ставка не найдена или уже обработана');
    }
    
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [bet.rows[0].amount, bet.rows[0].user_id]
    );
    
    await pool.query(
      'UPDATE bets SET status = \'canceled\' WHERE id = $1',
      [betId]
    );
    
    await pool.query('COMMIT');
    
    res.json({ 
      success: true,
      message: 'Ставка успешно отменена'
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// Глобальный обработчик ошибок
app.use((req, res) => {
  console.log('Необработанный маршрут:', req.path);
  res.status(404).json({ error: 'Не найдено' });
});

// Инициализация сервера
initDB().then(() => {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
    bot.setWebHook(`https://jeanbet-1-j9dw-eight.vercel.app/bot${process.env.TELEGRAM_BOT_TOKEN}`);
  });
});

module.exports = app;