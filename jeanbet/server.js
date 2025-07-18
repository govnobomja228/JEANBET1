require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || 'postgres://user:pass@localhost:5432/db',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware для проверки пользователя
async function validateUser(req, res, next) {
  const userId = req.body.userId || req.query.userId;
  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  try {
    const user = await pool.query(
      'SELECT telegram_id FROM users WHERE telegram_id = $1', 
      [userId]
    );
    
    if (!user.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    next();
  } catch (error) {
    console.error('User validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Инициализация пользователя
app.post('/api/user', async (req, res) => {
  const { userId, username } = req.body;
  
  try {
    await pool.query(`
      INSERT INTO users (telegram_id, username, balance)
      VALUES ($1, $2, 0)
      ON CONFLICT (telegram_id) DO UPDATE
      SET username = EXCLUDED.username
      RETURNING *
    `, [userId, username]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('User init error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Пополнение баланса (тестовое)
app.post('/api/deposit', validateUser, async (req, res) => {
  const { userId, amount } = req.body;

  try {
    await pool.query('BEGIN');
    
    // Обновляем баланс
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, userId]
    );
    
    // Записываем транзакцию
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status)
       VALUES ($1, $2, 'deposit', 'completed')`,
      [userId, amount]
    );
    
    await pool.query('COMMIT');
    
    // Получаем новый баланс
    const result = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    res.json({
      success: true,
      newBalance: parseFloat(result.rows[0].balance)
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'Transaction failed' });
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
      balance: result.rows[0]?.balance || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

module.exports = app;