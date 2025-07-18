require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Initialize database
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        username TEXT,
        balance DECIMAL(10,2) DEFAULT 0,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
        amount DECIMAL(10,2),
        type VARCHAR(20),
        status VARCHAR(20) DEFAULT 'pending',
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bets (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
        amount DECIMAL(10,2),
        racer_id INTEGER,
        odds DECIMAL(4,2),
        status VARCHAR(20) DEFAULT 'pending',
        race_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS races (
        id SERIAL PRIMARY KEY,
        winner_id INTEGER,
        settled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

    await client.query('COMMIT');
    console.log('Database tables created successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database initialization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Auth middleware
async function authMiddleware(req, res, next) {
  try {
    const userId = req.body.userId || req.query.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID is required' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1 LIMIT 1',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    req.user = rows[0];
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
}

// Admin middleware
function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// User auth
app.post('/api/auth', async (req, res) => {
  try {
    const { userId, username } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO users (telegram_id, username)
       VALUES ($1, $2)
       ON CONFLICT (telegram_id) 
       DO UPDATE SET username = EXCLUDED.username
       RETURNING *`,
      [userId, username]
    );

    res.json({ success: true, user: rows[0] });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
});

// Get balance
app.get('/api/balance/:userId', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [req.params.userId]
    );
    
    res.json({ 
      success: true,
      balance: rows[0]?.balance || 0 
    });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ success: false, error: 'Failed to get balance' });
  }
});

// Deposit
app.post('/api/payment/deposit', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    await client.query('BEGIN');

    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, req.user.telegram_id]
    );

    await client.query(
      `INSERT INTO transactions (user_id, amount, type, status)
       VALUES ($1, $2, 'deposit', 'completed')`,
      [req.user.telegram_id, amount]
    );

    await client.query('COMMIT');

    res.json({ 
      success: true,
      message: `Balance updated by ${amount} RUB`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Deposit error:', error);
    res.status(500).json({ success: false, error: 'Transaction failed' });
  } finally {
    client.release();
  }
});

// Place bet
app.post('/api/bets', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, racerId } = req.body;
    
    if (![1, 2].includes(Number(racerId))) {
      return res.status(400).json({ success: false, error: 'Invalid racer ID' });
    }
    if (!amount || amount < 50) {
      return res.status(400).json({ success: false, error: 'Minimum bet is 50 RUB' });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE',
      [req.user.telegram_id]
    );

    if (rows[0].balance < amount) {
      return res.status(400).json({ success: false, error: 'Insufficient funds' });
    }

    const odds = racerId === 1 ? 1.85 : 2.10;
    await client.query(
      'INSERT INTO bets (user_id, amount, racer_id, odds) VALUES ($1, $2, $3, $4)',
      [req.user.telegram_id, amount, racerId, odds]
    );

    await client.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [amount, req.user.telegram_id]
    );

    await client.query('COMMIT');

    res.json({ 
      success: true,
      message: 'Bet placed successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Bet error:', error);
    res.status(500).json({ success: false, error: 'Failed to place bet' });
  } finally {
    client.release();
  }
});

// Get odds
app.get('/api/odds', async (req, res) => {
  try {
    res.json({
      success: true,
      odds: {
        racer1: 1.85,
        racer2: 2.10
      }
    });
  } catch (error) {
    console.error('Odds error:', error);
    res.status(500).json({ success: false, error: 'Failed to get odds' });
  }
});

// Admin routes

// Admin login
app.post('/api/admin/login', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (password === process.env.ADMIN_PASSWORD) {
      await pool.query(
        'UPDATE users SET is_admin = TRUE WHERE telegram_id = $1',
        [req.user.telegram_id]
      );
      
      res.json({ success: true, isAdmin: true });
    } else {
      res.status(401).json({ success: false, error: 'Invalid password' });
    }
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Get active bets
app.get('/api/admin/active-bets', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.user_id, u.username, b.amount, b.racer_id, b.odds, b.created_at
       FROM bets b
       LEFT JOIN users u ON b.user_id = u.telegram_id
       WHERE b.status = 'pending'
       ORDER BY b.created_at DESC`
    );
    
    res.json({ success: true, bets: rows });
  } catch (error) {
    console.error('Active bets error:', error);
    res.status(500).json({ success: false, error: 'Failed to get active bets' });
  }
});

// Get all users
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT telegram_id, username, balance, is_admin, created_at FROM users ORDER BY created_at DESC'
    );
    
    res.json({ success: true, users: rows });
  } catch (error) {
    console.error('Users error:', error);
    res.status(500).json({ success: false, error: 'Failed to get users' });
  }
});

// Get stats
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
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// Settle race
app.post('/api/admin/races/settle', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { winnerId } = req.body;
    if (![1, 2].includes(Number(winnerId))) {
      return res.status(400).json({ success: false, error: 'Invalid winner ID' });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      'INSERT INTO races (winner_id, settled_at) VALUES ($1, NOW()) RETURNING id',
      [winnerId]
    );
    
    const raceId = rows[0].id;

    const bets = await client.query(
      `SELECT id, user_id, amount, odds, racer_id 
       FROM bets WHERE status = 'pending'`
    );
    
    for (const bet of bets.rows) {
      if (bet.racer_id === winnerId) {
        const winAmount = bet.amount * bet.odds;
        await client.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [winAmount, bet.user_id]
        );
        
        bot.sendMessage(
          bet.user_id,
          `🎉 Your bet won! You received ${winAmount.toFixed(2)} RUB`
        );
      }
      
      await client.query(
        `UPDATE bets SET status = $1, race_id = $2 WHERE id = $3`,
        [bet.racer_id === winnerId ? 'won' : 'lost', raceId, bet.id]
      );
    }
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true,
      message: 'Race settled successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Settle error:', error);
    res.status(500).json({ success: false, error: 'Failed to settle race' });
  } finally {
    client.release();
  }
});

// Adjust balance
app.post('/api/admin/adjust-balance', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) {
      return res.status(400).json({ success: false, error: 'Missing parameters' });
    }

    await client.query('BEGIN');

    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, userId]
    );

    await client.query(
      `INSERT INTO transactions 
       (user_id, amount, type, status, details)
       VALUES ($1, $2, 'adjustment', 'completed', $3)`,
      [userId, amount, { adminId: req.user.telegram_id, note: 'Manual adjustment' }]
    );

    await client.query('COMMIT');

    res.json({ 
      success: true,
      message: `Balance adjusted by ${amount} RUB`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Adjust balance error:', error);
    res.status(500).json({ success: false, error: 'Failed to adjust balance' });
  } finally {
    client.release();
  }
});

// Cancel bet
app.post('/api/admin/cancel-bet', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { betId } = req.body;
    if (!betId) {
      return res.status(400).json({ success: false, error: 'Bet ID required' });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT user_id, amount FROM bets 
       WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [betId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Bet not found or already settled' });
    }

    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [rows[0].amount, rows[0].user_id]
    );

    await client.query(
      'UPDATE bets SET status = \'canceled\' WHERE id = $1',
      [betId]
    );

    await client.query('COMMIT');

    res.json({ 
      success: true,
      message: 'Bet canceled successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cancel bet error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel bet' });
  } finally {
    client.release();
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not Found' });
});

// Start server
async function startServer() {
  try {
    await initDB();
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      if (process.env.TELEGRAM_BOT_TOKEN) {
        bot.setWebHook(`https://${process.env.VERCEL_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;