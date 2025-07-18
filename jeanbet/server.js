require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = '8040187426:AAGG7YZMryaLNch-JenpHmowS0O-0YIiAPY';
const ADMIN_PASSWORD = 'DanyaJEANbet';

// API для тестового пополнения баланса
app.post('/api/test-deposit', async (req, res) => {
  const { userId, amount } = req.body;
  
  if (!userId || !amount) {
    return res.status(400).json({ error: 'User ID and amount are required' });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be positive' });
  }
  
  try {
    // Создаем пользователя если не существует, или пополняем баланс
    await pool.query(`
      INSERT INTO users (telegram_id, balance) 
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET balance = users.balance + $2
    `, [userId, amount]);
    
    // Записываем транзакцию
    await pool.query(
      `INSERT INTO transactions 
       (user_id, amount, type, status) 
       VALUES ($1, $2, $3, $4)`,
      [userId, amount, 'test_deposit', 'completed']
    );
    
    // Получаем обновленный баланс
    const balanceResult = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    res.json({ 
      success: true, 
      newBalance: parseFloat(balanceResult.rows[0].balance) 
    });
  } catch (error) {
    console.error('Test deposit error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Глобальные переменные для коэффициентов
let currentOdds = {
  racer1: 1.85,
  racer2: 2.10,
  margin: 0.10
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/jeanbet',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Расчет коэффициентов с маржой
function calculateOdds(probability1, probability2) {
  const totalProbability = probability1 + probability2;
  const marginFactor = 1 + currentOdds.margin;
  
  return {
    racer1: (totalProbability / probability1) * marginFactor,
    racer2: (totalProbability / probability2) * marginFactor
  };
}

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
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        amount DECIMAL(10,2),
        type TEXT,
        status TEXT DEFAULT 'pending',
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB
      );
      
      INSERT INTO settings (key, value) 
      VALUES ('odds', '{"racer1":1.85,"racer2":2.10,"margin":0.1}')
      ON CONFLICT (key) DO NOTHING;
    `);
    
    // Загрузка коэффициентов из БД
    const res = await pool.query("SELECT value FROM settings WHERE key = 'odds'");
    if (res.rows[0]) {
      currentOdds = res.rows[0].value;
    }
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Middleware для проверки админа
async function checkAdmin(req, res, next) {
  try {
    const userId = req.body.userId || req.query.userId;
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    const user = await pool.query(
      'SELECT is_admin FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (user.rows[0]?.is_admin) {
      return next();
    }
    res.status(403).json({ error: 'Forbidden' });
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// API для получения коэффициентов
app.get('/api/odds', (req, res) => {
  res.json({
    racer1: currentOdds.racer1,
    racer2: currentOdds.racer2
  });
});

// API для тестового депозита
app.post('/api/test-deposit', async (req, res) => {
  const { userId, amount } = req.body;
  
  if (amount <= 0) {
    return res.status(400).json({ error: 'Неверная сумма' });
  }
  
  try {
    await pool.query(
      'INSERT INTO users (telegram_id, balance) VALUES ($1, $2) ON CONFLICT (telegram_id) DO UPDATE SET balance = users.balance + $2',
      [userId, amount]
    );
    
    await pool.query(
      'INSERT INTO transactions (user_id, amount, type, status) VALUES ($1, $2, $3, $4)',
      [userId, amount, 'deposit', 'completed']
    );
    
    res.json({ success: true, newBalance: await getBalance(userId) });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API для вывода средств
app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, cardNumber } = req.body;
  
  if (amount < 500) {
    return res.status(400).json({ error: 'Минимальная сумма вывода 500 ₽' });
  }
  
  try {
    const balance = await getBalance(userId);
    if (balance < amount) {
      return res.status(400).json({ error: 'Недостаточно средств' });
    }
    
    // Резервируем средства
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, userId]
    );
    
    // Создаем заявку на вывод
    await pool.query(
      `INSERT INTO transactions 
       (user_id, amount, type, status, details) 
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, amount, 'withdraw', 'pending', { 
        method: 'bank_card',
        card_number: cardNumber 
      }]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API для админки
app.post('/api/admin/login', async (req, res) => {
  const { userId, password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    await pool.query(
      'UPDATE users SET is_admin = TRUE WHERE telegram_id = $1',
      [userId]
    );
    res.json({ isAdmin: true });
  } else {
    res.status(401).json({ error: 'Неверный пароль' });
  }
});

// API для обновления коэффициентов (только админ)
app.post('/api/admin/odds', checkAdmin, async (req, res) => {
  const { racer1, racer2, margin } = req.body;
  
  try {
    currentOdds = { racer1, racer2, margin };
    
    await pool.query(
      "UPDATE settings SET value = $1 WHERE key = 'odds'",
      [currentOdds]
    );
    
    res.json({ success: true, odds: currentOdds });
  } catch (error) {
    console.error('Update odds error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API для объявления победителя (только админ)
app.post('/api/admin/settle', checkAdmin, async (req, res) => {
  const { winner } = req.body;
  
  try {
    // Находим все активные ставки
    const bets = await pool.query(
      'SELECT * FROM bets WHERE status = $1',
      ['pending']
    );
    
    // Обрабатываем каждую ставку
    for (const bet of bets.rows) {
      if (bet.racer_id == winner) {
        const winAmount = bet.amount * bet.odds;
        
        // Начисляем выигрыш
        await pool.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [winAmount, bet.user_id]
        );
        
        // Обновляем статус ставки
        await pool.query(
          'UPDATE bets SET status = $1 WHERE id = $2',
          ['won', bet.id]
        );
        
        // Уведомляем пользователя
        bot.sendMessage(
          bet.user_id,
          `🎉 Ваша ставка выиграла! Вы получили ${winAmount.toFixed(2)} ₽`
        );
      } else {
        await pool.query(
          'UPDATE bets SET status = $1 WHERE id = $2',
          ['lost', bet.id]
        );
      }
    }
    
    res.json({ success: true, processed: bets.rowCount });
  } catch (error) {
    console.error('Settle bets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API для получения активных ставок (админ)
app.get('/api/admin/active-bets', checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, u.username 
      FROM bets b
      LEFT JOIN users u ON b.user_id = u.telegram_id
      WHERE b.status = 'pending'
      ORDER BY b.created_at DESC
    `);
    res.json({ bets: result.rows });
  } catch (error) {
    console.error('Error fetching active bets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API для получения списка пользователей (админ)
app.get('/api/admin/users', checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT telegram_id, username, balance 
      FROM users
      ORDER BY created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API для получения статистики (админ)
app.get('/api/admin/stats', checkAdmin, async (req, res) => {
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    const activeBets = await pool.query("SELECT COUNT(*) FROM bets WHERE status = 'pending'");
    const totalVolume = await pool.query('SELECT COALESCE(SUM(amount), 0) FROM bets');
    const betsByHour = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM created_at) AS hour,
        COUNT(*) AS bets
      FROM bets
      GROUP BY hour
      ORDER BY hour
    `);
    
    res.json({
      stats: {
        totalUsers: parseInt(usersCount.rows[0].count),
        activeBets: parseInt(activeBets.rows[0].count),
        totalVolume: parseFloat(totalVolume.rows[0].coalesce),
        betsByHour: betsByHour.rows.map(row => ({
          hour: row.hour,
          bets: parseInt(row.bets)
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API для отмены ставки (админ)
app.post('/api/admin/cancel-bet', checkAdmin, async (req, res) => {
  const { betId } = req.body;
  
  try {
    const bet = await pool.query('SELECT * FROM bets WHERE id = $1', [betId]);
    if (bet.rows.length === 0) {
      return res.status(404).json({ error: 'Bet not found' });
    }
    
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [bet.rows[0].amount, bet.rows[0].user_id]
    );
    
    await pool.query(
      'UPDATE bets SET status = $1 WHERE id = $2',
      ['canceled', betId]
    );
    
    bot.sendMessage(
      bet.rows[0].user_id,
      `Ваша ставка #${betId} была отменена администратором. Средства возвращены на ваш баланс.`
    );
    
    res.json({ message: 'Bet canceled successfully' });
  } catch (error) {
    console.error('Error canceling bet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API для изменения баланса пользователя (админ)
app.post('/api/admin/adjust-balance', checkAdmin, async (req, res) => {
  const { userId, amount } = req.body;
  
  if (!userId || !amount) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  try {
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, userId]
    );
    
    await pool.query(
      'INSERT INTO transactions (user_id, amount, type, status) VALUES ($1, $2, $3, $4)',
      [userId, amount, amount > 0 ? 'admin_deposit' : 'admin_withdraw', 'completed']
    );
    
    res.json({ 
      message: `Balance adjusted by ${amount > 0 ? '+' : ''}${amount}`,
      newBalance: await getBalance(userId)
    });
  } catch (error) {
    console.error('Error adjusting balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Получить все транзакции пользователя (для проверки)
app.get('/api/test/transactions/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC',
      [req.params.userId]
    );
    res.json({ transactions: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Сбросить тестового пользователя
app.post('/api/test/reset-user', async (req, res) => {
  try {
    const { userId } = req.body;
    await pool.query('DELETE FROM users WHERE telegram_id = $1', [userId]);
    await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Вспомогательная функция для получения баланса
async function getBalance(userId) {
  const res = await pool.query(
    'SELECT balance FROM users WHERE telegram_id = $1',
    [userId]
  );
  return parseFloat(res.rows[0]?.balance || 0);
}

// Тестовые маршруты
app.get('/api/test', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/test/create-user', async (req, res) => {
  try {
    const { userId } = req.body;
    await pool.query(
      'INSERT INTO users (telegram_id, username, balance) VALUES ($1, $2, $3) ON CONFLICT (telegram_id) DO NOTHING',
      [userId || 123456, 'testuser', 1000]
    );
    res.json({ success: true, message: 'Test user created' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/test/place-bet', async (req, res) => {
  try {
    const { userId, amount, racerId } = req.body;
    await pool.query(
      'INSERT INTO bets (user_id, amount, racer_id, odds) VALUES ($1, $2, $3, $4)',
      [userId || 123456, amount || 100, racerId || 1, 1.85]
    );
    res.json({ success: true, message: 'Test bet placed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/test/declare-winner', async (req, res) => {
  try {
    const { winner } = req.body;
    await pool.query(
      "UPDATE bets SET status = CASE WHEN racer_id = $1 THEN 'won' ELSE 'lost' END WHERE status = 'pending'",
      [winner || 1]
    );
    res.json({ success: true, message: 'Test winner declared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Запуск сервера
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.setWebHook(`https://jeanbet-1-j9dw-eight.vercel.app/bot${TELEGRAM_BOT_TOKEN}`);
  });
});