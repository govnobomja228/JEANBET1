require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8040187426:AAGG7YZMryaLNch-JenpHmowS0O-0YIiAPY';
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const ADMIN_USERNAME = 'bus1o';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // Для уведомлений о выводах

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
      
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        details TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
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
    if (!authData) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = JSON.parse(authData);
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Invalid auth data' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid authorization header' });
  }
};

// Middleware для проверки админа
const checkAdmin = (req, res, next) => {
  if (req.user?.username === ADMIN_USERNAME) {
    return next();
  }
  res.status(403).json({ error: 'Forbidden' });
};

// API для создания платежа
app.post('/api/create-payment', authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;
    
    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }

    if (amount < 100) {
      return res.status(400).json({ error: 'Minimum amount is 100 RUB' });
    }

    // Создаем запись о платеже
    await pool.query(
      'INSERT INTO payments (user_id, amount, status) VALUES ($1, $2, $3)',
      [userId, amount, 'pending']
    );

    // Интеграция с платежной системой (пример для ЮKassa)
    const paymentData = {
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: `${SERVER_URL}/payment-success`
      },
      description: `Пополнение баланса на ${amount} руб.`,
      metadata: { userId }
    };

    const idempotenceKey = crypto.randomBytes(16).toString('hex');
    const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');

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
    console.error('Payment creation error:', err);
    res.status(500).json({ error: 'Payment creation failed' });
  }
});

// API для вывода средств
app.post('/api/withdraw', authenticate, async (req, res) => {
  try {
    const { amount, details } = req.body;
    const userId = req.user.id;
    
    if (!amount || !details) {
      return res.status(400).json({ error: 'Amount and details are required' });
    }

    if (amount < 500) {
      return res.status(400).json({ error: 'Minimum withdrawal amount is 500 RUB' });
    }

    // Проверяем баланс
    const user = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE',
      [userId]
    );
    
    if (user.rows.length === 0 || user.rows[0].balance < amount) {
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    // Создаем запись о выводе
    await pool.query('BEGIN');
    
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, userId]
    );
    
    await pool.query(
      'INSERT INTO withdrawals (user_id, amount, details) VALUES ($1, $2, $3)',
      [userId, amount, details]
    );
    
    await pool.query('COMMIT');
    
    // Уведомляем админа
    if (ADMIN_CHAT_ID && bot) {
      const userInfo = await pool.query(
        'SELECT username FROM users WHERE telegram_id = $1',
        [userId]
      );
      
      const username = userInfo.rows[0]?.username || userId;
      const message = `📤 Новый запрос на вывод:\n\n` +
                     `Пользователь: @${username}\n` +
                     `Сумма: ${amount} RUB\n` +
                     `Реквизиты: ${details}`;
      
      bot.sendMessage(ADMIN_CHAT_ID, message);
    }
    
    res.json({ success: true, message: 'Withdrawal request created' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Withdrawal error:', err);
    res.status(500).json({ error: 'Withdrawal failed' });
  }
});

// API для ставок
app.post('/api/bets', authenticate, async (req, res) => {
  try {
    const { amount, racerId } = req.body;
    const userId = req.user.id;
    
    if (!amount || !racerId) {
      return res.status(400).json({ error: 'Amount and racerId are required' });
    }

    // Коэффициенты
    const odds = {
      '1': 1.85,
      '2': 2.10
    };

    if (!odds[racerId]) {
      return res.status(400).json({ error: 'Invalid racer ID' });
    }

    // Проверяем баланс
    await pool.query('BEGIN');
    
    const user = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE',
      [userId]
    );
    
    if (user.rows.length === 0 || user.rows[0].balance < amount) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    // Создаем ставку
    await pool.query(
      'INSERT INTO bets (user_id, amount, racer_id, odds) VALUES ($1, $2, $3, $4)',
      [userId, amount, racerId, odds[racerId]]
    );

    // Списание средств
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, userId]
    );

    await pool.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Bet error:', err);
    res.status(500).json({ error: 'Bet placement failed' });
  }
});

// API для истории ставок
app.get('/api/bets/history', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;
    
    const result = await pool.query(
      'SELECT * FROM bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );
    
    res.json({ bets: result.rows });
  } catch (err) {
    console.error('Bets history error:', err);
    res.status(500).json({ error: 'Failed to get bets history' });
  }
});

// API для объявления победителя (админ)
app.post('/api/settle-bets', authenticate, checkAdmin, async (req, res) => {
  try {
    const { winner } = req.body;
    
    if (!winner) {
      return res.status(400).json({ error: 'Winner is required' });
    }

    await pool.query('BEGIN');
    
    // Находим все активные ставки
    const bets = await pool.query(
      'SELECT * FROM bets WHERE status = $1 FOR UPDATE',
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
        if (bot) {
          bot.sendMessage(bet.user_id, `🎉 Вы выиграли ${winAmount.toFixed(2)} руб.!`);
        }
      } else {
        await pool.query(
          'UPDATE bets SET status = $1, updated_at = NOW() WHERE id = $2',
          ['lost', bet.id]
        );
      }
    }

    await pool.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Settle bets error:', err);
    res.status(500).json({ error: 'Failed to settle bets' });
  }
});

// API для баланса
app.get('/api/balance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ balance: 0 });
    }
    
    res.json({ balance: result.rows[0].balance });
  } catch (err) {
    console.error('Balance error:', err);
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

// API для проверки роли
app.get('/api/check-role', authenticate, async (req, res) => {
  res.json({
    isAdmin: req.user.username === ADMIN_USERNAME
  });
});

// Обработка успешного платежа
app.get('/payment-success', async (req, res) => {
  try {
    const { userId, amount } = req.query;
    
    if (!userId || !amount) {
      return res.status(400).send('Invalid parameters');
    }

    await pool.query('BEGIN');
    
    // Обновляем баланс пользователя
    await pool.query(
      'INSERT INTO users (telegram_id, balance) VALUES ($1, $2) ' +
      'ON CONFLICT (telegram_id) DO UPDATE SET balance = users.balance + $2',
      [userId, parseFloat(amount)]
    );
    
    // Обновляем статус платежа
    await pool.query(
      'UPDATE payments SET status = $1, updated_at = NOW() ' +
      'WHERE user_id = $2 AND amount = $3 AND status = $4',
      ['completed', userId, amount, 'pending']
    );
    
    await pool.query('COMMIT');
    
    // Уведомляем пользователя
    if (bot) {
      bot.sendMessage(userId, `✅ Ваш баланс пополнен на ${amount} руб.!`);
    }
    
    res.send(`
      <html>
        <body style="background: #17212b; color: white; font-family: sans-serif; padding: 20px;">
          <h1>Платеж успешно завершен!</h1>
          <p>Ваш баланс пополнен на ${amount} руб.</p>
          <script>
            setTimeout(() => {
              if (window.Telegram && window.Telegram.WebApp) {
                window.Telegram.WebApp.close();
              }
            }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Payment success error:', err);
    res.status(500).send('Payment processing failed');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Инициализация и запуск
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (bot) {
      bot.setWebHook(`${SERVER_URL}/bot${TELEGRAM_BOT_TOKEN}`);
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;