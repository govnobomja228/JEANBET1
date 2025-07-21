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

// Настройка CORS
app.use(cors({
  origin: process.env.SERVER_URL || 'https://jeanbet-1-j9dw-eight.vercel.app',
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Настройка загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'DanyaJEANbet';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

// Настройка подключения к PostgreSQL
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Проверка подключения к БД
pool.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => console.error('Connection error', err.stack));

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Инициализация БД с начальным балансом 500р
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        username TEXT,
        balance DECIMAL(10,2) DEFAULT 500,
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
      
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        card_details TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Добавляем начальные настройки
    await pool.query(`
      INSERT INTO settings (key, value)
      VALUES 
        ('siteName', 'JEAN Bet'),
        ('minBet', '50'),
        ('minDeposit', '100'),
        ('minWithdraw', '500')
      ON CONFLICT (key) DO NOTHING;
    `);

    // Добавляем тестовых гонщиков
    await pool.query(`
      INSERT INTO racers (id, name, odds, image_url)
      VALUES 
        (1, 'Max Verstappen', 2.00, '/uploads/racer1.jpg'),
        (2, 'Lewis Hamilton', 2.00, '/uploads/racer2.jpg')
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('Database initialized successfully');
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

// Middleware для проверки админки
const adminAuth = (req, res, next) => {
  try {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid admin password' });
    }
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
};

// API для баланса
app.get('/api/balance/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [req.params.userId]
    );
    res.json({ balance: result.rows[0]?.balance || 500 });
  } catch (err) {
    console.error('Balance error:', err);
    res.status(500).json({ error: 'Failed to get balance' });
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

    const settings = await pool.query(
      'SELECT value FROM settings WHERE key = $1',
      ['minBet']
    );
    const minBet = settings.rows[0] ? Number(settings.rows[0].value) : 50;

    if (amount < minBet) {
      return res.status(400).json({ error: `Minimum bet is ${minBet}` });
    }

    await pool.query('BEGIN');
    
    const racer = await pool.query(
      'SELECT odds, is_active FROM racers WHERE id = $1',
      [racerId]
    );
    
    if (racer.rows.length === 0 || !racer.rows[0].is_active) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Selected racer is not available' });
    }
    
    const odds = racer.rows[0].odds;

    const user = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE',
      [userId]
    );
    
    if (user.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (telegram_id, username) VALUES ($1, $2)',
        [userId, req.user.username]
      );
    } else if (user.rows[0].balance < amount) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    await pool.query(
      'INSERT INTO bets (user_id, amount, racer_id, odds) VALUES ($1, $2, $3, $4)',
      [userId, amount, racerId, odds]
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

// API для гонщиков
app.get('/api/racers', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM racers WHERE is_active = true ORDER BY id'
    );
    res.json({ racers: result.rows });
  } catch (err) {
    console.error('Racers error:', err);
    res.status(500).json({ error: 'Failed to get racers' });
  }
});

// API для настроек
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM settings'
    );
    
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = isNaN(row.value) ? row.value : Number(row.value);
    });
    
    res.json({ settings });
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// API для создания платежа через ЮКассу
app.post('/api/payment/create', authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;
    
    const settings = await pool.query(
      'SELECT value FROM settings WHERE key = $1',
      ['minDeposit']
    );
    const minDeposit = settings.rows[0] ? Number(settings.rows[0].value) : 100;

    if (!amount || amount < minDeposit) {
      return res.status(400).json({ error: `Minimum deposit is ${minDeposit} ₽` });
    }

    const idempotenceKey = crypto.randomUUID();
    const yookassaResponse = await axios.post(
      'https://api.yookassa.ru/v3/payments',
      {
        amount: {
          value: amount.toFixed(2),
          currency: 'RUB'
        },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: `${process.env.SERVER_URL}/payment-success`
        },
        description: `Deposit for user ${userId}`,
        metadata: {
          userId
        }
      },
      {
        auth: {
          username: YOOKASSA_SHOP_ID,
          password: YOOKASSA_SECRET_KEY
        },
        headers: {
          'Idempotence-Key': idempotenceKey,
          'Content-Type': 'application/json'
        }
      }
    );

    await pool.query(
      'INSERT INTO payments (user_id, amount, payment_id, status) VALUES ($1, $2, $3, $4)',
      [userId, amount, yookassaResponse.data.id, 'pending']
    );

    res.json({ url: yookassaResponse.data.confirmation.confirmation_url });
  } catch (err) {
    console.error('Payment creation error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// Webhook для обработки уведомлений от ЮКассы
app.post('/api/payment/webhook', express.json(), async (req, res) => {
  try {
    const { object } = req.body;
    
    if (object.status === 'succeeded') {
      const payment = await pool.query(
        'SELECT * FROM payments WHERE payment_id = $1',
        [object.id]
      );

      if (payment.rows.length > 0 && payment.rows[0].status !== 'succeeded') {
        await pool.query('BEGIN');

        await pool.query(
          'UPDATE payments SET status = $1, updated_at = NOW() WHERE payment_id = $2',
          ['succeeded', object.id]
        );

        await pool.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [payment.rows[0].amount, payment.rows[0].user_id]
        );

        await pool.query('COMMIT');

        try {
          await bot.sendMessage(
            payment.rows[0].user_id,
            `✅ Ваш депозит на ${payment.rows[0].amount} ₽ успешно зачислен!`
          );
        } catch (err) {
          console.error('Failed to send notification:', err);
        }
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// API для создания запроса на вывод
app.post('/api/withdraw/create', authenticate, async (req, res) => {
  try {
    const { amount, cardDetails } = req.body;
    const userId = req.user.id;
    
    const settings = await pool.query(
      'SELECT value FROM settings WHERE key = $1',
      ['minWithdraw']
    );
    const minWithdraw = settings.rows[0] ? Number(settings.rows[0].value) : 500;

    if (!amount || amount < minWithdraw) {
      return res.status(400).json({ error: `Minimum withdrawal is ${minWithdraw} ₽` });
    }

    if (!cardDetails || cardDetails.length < 16) {
      return res.status(400).json({ error: 'Invalid card details' });
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
      'INSERT INTO withdrawals (user_id, amount, card_details) VALUES ($1, $2, $3)',
      [userId, amount, cardDetails]
    );

    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, userId]
    );

    await pool.query('COMMIT');

    if (bot && ADMIN_CHAT_ID) {
      try {
        const userInfo = await pool.query(
          'SELECT username FROM users WHERE telegram_id = $1',
          [userId]
        );
        const username = userInfo.rows[0]?.username || userId;

        await bot.sendMessage(
          ADMIN_CHAT_ID,
          `⚠️ Новый запрос на вывод!\n\n👤 Пользователь: @${username}\n💳 Карта: ${cardDetails}\n💰 Сумма: ${amount} ₽\n\nОбработайте запрос в админ-панели.`
        );
      } catch (err) {
        console.error('Failed to send admin notification:', err);
      }
    }

    res.json({ success: true, message: 'Withdrawal request created successfully' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Withdrawal creation error:', err);
    res.status(500).json({ error: 'Failed to create withdrawal' });
  }
});

// API для админки
app.post('/api/admin/login', adminAuth, (req, res) => {
  res.json({ success: true });
});

// API для получения списка выводов (админ)
app.get('/api/admin/withdrawals', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.*, u.username 
       FROM withdrawals w
       LEFT JOIN users u ON w.user_id = u.telegram_id
       ORDER BY w.created_at DESC`
    );
    res.json({ withdrawals: result.rows });
  } catch (err) {
    console.error('Withdrawals error:', err);
    res.status(500).json({ error: 'Failed to get withdrawals' });
  }
});

// API для обработки вывода (админ)
app.post('/api/admin/withdrawals/:id/process', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['completed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await pool.query('BEGIN');

    const withdrawal = await pool.query(
      'SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (withdrawal.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    if (withdrawal.rows[0].status !== 'pending') {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Withdrawal already processed' });
    }

    await pool.query(
      'UPDATE withdrawals SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, id]
    );

    if (status === 'rejected') {
      await pool.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [withdrawal.rows[0].amount, withdrawal.rows[0].user_id]
      );
    }

    await pool.query('COMMIT');

    try {
      const message = status === 'completed' 
        ? `✅ Ваш вывод на сумму ${withdrawal.rows[0].amount} ₽ успешно обработан!` 
        : `❌ Ваш вывод на сумму ${withdrawal.rows[0].amount} ₽ был отклонен. Средства возвращены на баланс.`;

      await bot.sendMessage(withdrawal.rows[0].user_id, message);
    } catch (err) {
      console.error('Failed to send notification:', err);
    }

    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Withdrawal processing error:', err);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  }
});

// API для объявления победителя
app.post('/api/admin/declare-winner', async (req, res) => {
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
        const winAmount = bet.amount * bet.odds;
        await pool.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [winAmount, bet.user_id]
        );
        
        if (bot) {
          try {
            await bot.sendMessage(
              bet.user_id, 
              `🎉 Вы выиграли ${winAmount.toFixed(2)} ₽! Ваша ставка на гонщика ${bet.racer_id} сыграла!`
            );
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

// API для управления гонщиками
app.get('/api/admin/racers', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM racers ORDER BY id'
    );
    res.json({ racers: result.rows });
  } catch (err) {
    console.error('Admin racers error:', err);
    res.status(500).json({ error: 'Failed to get racers' });
  }
});

app.post('/api/admin/racers', upload.single('image'), async (req, res) => {
  try {
    const { name, odds, is_active } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await pool.query(
      `INSERT INTO racers (name, odds, image_url, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, parseFloat(odds), imageUrl, is_active === 'true']
    );

    res.json({ racer: result.rows[0] });
  } catch (err) {
    console.error('Add racer error:', err);
    res.status(500).json({ error: 'Failed to add racer' });
  }
});

app.put('/api/admin/racers/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, odds, is_active } = req.body;
    let imageUrl = null;

    const currentRacer = await pool.query(
      'SELECT image_url FROM racers WHERE id = $1',
      [id]
    );

    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    } else if (currentRacer.rows[0]?.image_url) {
      imageUrl = currentRacer.rows[0].image_url;
    }

    const result = await pool.query(
      `UPDATE racers 
       SET name = $1, odds = $2, image_url = $3, is_active = $4
       WHERE id = $5
       RETURNING *`,
      [name, parseFloat(odds), imageUrl, is_active === 'true', id]
    );

    res.json({ racer: result.rows[0] });
  } catch (err) {
    console.error('Update racer error:', err);
    res.status(500).json({ error: 'Failed to update racer' });
  }
});

// API для обновления настроек
app.post('/api/admin/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    
    await pool.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, value]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
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
      bot.setWebHook(`${process.env.SERVER_URL}/bot${TELEGRAM_BOT_TOKEN}`);
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});