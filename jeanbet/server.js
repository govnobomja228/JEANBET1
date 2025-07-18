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
const ADMIN_PASSWORD = 'admin123'; // Пароль для админки

// Глобальные переменные для коэффициентов
let currentOdds = {
  racer1: 1.85,
  racer2: 2.10,
  margin: 0.10 // 10% маржа
};

// Расчет коэффициентов с маржой
function calculateOdds(probability1, probability2) {
  const totalProbability = probability1 + probability2;
  const marginFactor = 1 + currentOdds.margin;
  
  return {
    racer1: (totalProbability / probability1) * marginFactor,
    racer2: (totalProbability / probability2) * marginFactor
  };
}

// API для обновления коэффициентов
app.post('/api/update-odds', async (req, res) => {
  const { probability1, probability2 } = req.body;
  
  const newOdds = calculateOdds(probability1, probability2);
  currentOdds.racer1 = newOdds.racer1;
  currentOdds.racer2 = newOdds.racer2;
  
  res.json({ 
    success: true,
    odds: currentOdds
  });
});

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Инициализация БД
async function initDB() {
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
  const res = await pool.query(
    "SELECT value FROM settings WHERE key = 'odds'"
  );
  if (res.rows[0]) {
    currentOdds = res.rows[0].value;
  }
}

// Middleware для проверки админа
async function checkAdmin(req, res, next) {
  const userId = req.body.userId || req.query.userId;
  const user = await pool.query(
    'SELECT is_admin FROM users WHERE telegram_id = $1',
    [userId]
  );
  
  if (user.rows[0]?.is_admin) {
    return next();
  }
  res.status(403).json({ error: 'Forbidden' });
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
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, userId]
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
  const { userId, amount } = req.body;
  
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
      [userId, amount, 'withdraw', 'pending', { method: 'bank_card' }]
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

// Вспомогательная функция для получения баланса
async function getBalance(userId) {
  const res = await pool.query(
    'SELECT balance FROM users WHERE telegram_id = $1',
    [userId]
  );
  return parseFloat(res.rows[0]?.balance || 0);
}

// Запуск сервера
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.setWebHook(`https://jeanbet-1-j9dw-eight.vercel.app/bot${TELEGRAM_BOT_TOKEN}`);
  });
});