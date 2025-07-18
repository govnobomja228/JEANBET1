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

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

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
    process.exit(1);
  }
}

// Middleware для проверки админа
const checkAdmin = (req, res, next) => {
  try {
    const user = req.body.user || req.query.user;
    if (user?.username === ADMIN_USERNAME) {
      return next();
    }
    res.status(403).json({ error: 'Forbidden' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.post('/api/admin/declare-winner', checkAdmin, async (req, res) => {
  const { raceId, winner } = req.body;
  
  if (!raceId || !winner) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const bets = await pool.query(
      'SELECT * FROM bets WHERE status = $1',
      ['pending']
    );

    for (const bet of bets.rows) {
      if (bet.racer_id === winner) {
        const winAmount = bet.amount * bet.odds;
        
        await pool.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [winAmount, bet.user_id]
        );
        
        await pool.query(
          'UPDATE bets SET status = $1, updated_at = NOW() WHERE id = $2',
          ['won', bet.id]
        );
        
        bot.sendMessage(bet.user_id, `🎉 Вы выиграли ${winAmount.toFixed(2)} руб.!`);
      } else {
        await pool.query(
          'UPDATE bets SET status = $1, updated_at = NOW() WHERE id = $2',
          ['lost', bet.id]
        );
      }
    }

    res.json({ success: true, message: 'Winner declared successfully' });
  } catch (err) {
    console.error('Declare winner error:', err);
    res.status(500).json({ error: 'Error declaring winner' });
  }
});

app.post('/api/create-payment', async (req, res) => {
  const { userId, amount } = req.body;
  
  if (!userId || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (amount < 100) {
    return res.status(400).json({ error: 'Minimum amount is 100 RUB' });
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
    res.status(500).json({ error: 'Payment creation error' });
  }
});

app.post('/api/yookassa-webhook', async (req, res) => {
  try {
    if (req.body.event === 'payment.succeeded') {
      const payment = req.body.object;
      const userId = payment.metadata.userId;
      const amount = parseFloat(payment.amount.value);

      await pool.query(
        'INSERT INTO users (telegram_id, balance) VALUES ($1, $2) ' +
        'ON CONFLICT (telegram_id) DO UPDATE SET balance = users.balance + $2',
        [userId, amount]
      );

      bot.sendMessage(userId, `✅ Баланс пополнен на ${amount} руб.!`);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Internal server error');
  }
});

app.post('/api/bets', async (req, res) => {
  const { userId, amount, racerId } = req.body;
  
  if (!userId || !amount || !racerId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const user = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (user.rows.length === 0 || user.rows[0].balance < amount) {
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    const odds = {
      '1': 1.85,
      '2': 2.10
    };

    if (!odds[racerId]) {
      return res.status(400).json({ error: 'Invalid racer ID' });
    }

    await pool.query('BEGIN');
    
    await pool.query(
      'INSERT INTO bets (user_id, amount, racer_id, odds) VALUES ($1, $2, $3, $4)',
      [userId, amount, racerId, odds[racerId]]
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
    res.status(500).json({ error: 'Bet placement error' });
  }
});

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
    res.status(500).json({ error: 'Error fetching balance' });
  }
});

app.get('/api/check-role', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const user = await pool.query(
      'SELECT username FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    res.json({
      isAdmin: user.rows[0]?.username === ADMIN_USERNAME
    });
  } catch (err) {
    console.error('Role check error:', err);
    res.status(500).json({ error: 'Error checking role' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;