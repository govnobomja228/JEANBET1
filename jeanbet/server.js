require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Конфигурация
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = '8040187426:AAGG7YZMryaLNch-JenpHmowS0O-0YIiAPY';
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const ADMIN_USERNAME = 'bus1o';

// Подключение к PostgreSQL (используем Supabase)
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Инициализация БД
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        username TEXT,
        balance DECIMAL(10,2) DEFAULT 0,
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
    `);
    console.log('Database initialized');
  } catch (err) {
    console.error('Database init error:', err);
  }
}

// API для создания платежа в ЮКассу
app.post('/api/create-payment', async (req, res) => {
  const { userId, amount } = req.body;
  
  if (amount < 100) {
    return res.status(400).json({ error: 'Минимальная сумма 100 рублей' });
  }

  const paymentData = {
    amount: { value: amount.toFixed(2), currency: 'RUB' },
    capture: true,
    confirmation: {
      type: 'redirect',
      return_url: 'https://jeanbet-1-j9dw-eight.vercel.app/success'
    },
    description: `Пополнение баланса на ${amount} руб.`,
    metadata: { userId }
  };

  const idempotenceKey = crypto.randomBytes(16).toString('hex');
  const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');

  try {
    const yooResponse = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        'Idempotence-Key': idempotenceKey
      },
      body: JSON.stringify(paymentData)
    });
    
    const data = await yooResponse.json();
    res.json({ url: data.confirmation.confirmation_url });
  } catch (err) {
    console.error('Payment error:', err);
    res.status(500).json({ error: 'Ошибка создания платежа' });
  }
});

// Вебхук для ЮКассы
app.post('/api/yookassa-webhook', async (req, res) => {
  if (req.body.event === 'payment.succeeded') {
    const payment = req.body.object;
    const userId = payment.metadata.userId;
    const amount = parseFloat(payment.amount.value);

    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, userId]
    );

    bot.sendMessage(userId, `✅ Баланс пополнен на ${amount} руб.!`);
  }
  res.sendStatus(200);
});

// API для ставок
app.post('/api/bets', async (req, res) => {
  const { userId, amount, racerId } = req.body;
  
  try {
    // Проверка баланса
    const user = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (user.rows.length === 0 || user.rows[0].balance < amount) {
      return res.status(400).json({ error: 'Недостаточно средств' });
    }

    // Коэффициенты с маржой 10%
    const odds = {
      '1': 1.85,
      '2': 2.10
    };

    // Создание ставки
    await pool.query(
      'INSERT INTO bets (user_id, amount, racer_id, odds) VALUES ($1, $2, $3, $4)',
      [userId, amount, racerId, odds[racerId]]
    );

    // Списание средств
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Bet error:', err);
    res.status(500).json({ error: 'Ошибка приема ставки' });
  }
});

// API для админа - объявление победителя
app.post('/api/settle-bets', async (req, res) => {
  const { winner } = req.body;
  const user = req.body.user;
  
  if (user?.username !== ADMIN_USERNAME) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Находим все активные ставки
    const bets = await pool.query(
      'SELECT * FROM bets WHERE status = $1',
      ['pending']
    );

    for (const bet of bets.rows) {
      if (bet.racer_id === winner) {
        const winAmount = bet.amount * bet.odds;
        
        // Начисляем выигрыш
        await pool.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [winAmount, bet.user_id]
        );
        
        // Обновляем статус ставки
        await pool.query(
          'UPDATE bets SET status = $1, updated_at = NOW() WHERE id = $2',
          ['won', bet.id]
        );
        
        // Уведомляем пользователя
        bot.sendMessage(bet.user_id, `🎉 Вы выиграли ${winAmount.toFixed(2)} руб.!`);
      } else {
        await pool.query(
          'UPDATE bets SET status = $1, updated_at = NOW() WHERE id = $2',
          ['lost', bet.id]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Settle error:', err);
    res.status(500).json({ error: 'Ошибка обработки ставок' });
  }
});

// Проверка роли пользователя
app.get('/api/check-role', async (req, res) => {
  const userId = req.query.userId;
  const user = await pool.query(
    'SELECT username FROM users WHERE telegram_id = $1',
    [userId]
  );
  
  res.json({
    isAdmin: user.rows[0]?.username === ADMIN_USERNAME
  });
});

// Инициализация и запуск
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.setWebHook(`https://jeanbet-1-j9dw-eight.vercel.app/bot${TELEGRAM_BOT_TOKEN}`);
  });
});