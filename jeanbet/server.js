require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { TonClient } = require('ton');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

// Конфигурация
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const TON_API_KEY = process.env.TON_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// Инициализация клиентов
const tonClient = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: TON_API_KEY
});

let db;
let bot;

async function connectDB() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('ton-racing');
    console.log('Connected to MongoDB');
}

if (TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
}

// Middleware для аутентификации
app.use(async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ error: 'Authorization header missing' });
        }
        
        // В реальном приложении проверяйте JWT или другой токен
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// API для ставок
app.post('/api/bets', async (req, res) => {
    try {
        const { userId, amount, racerId, currency, txHash } = req.body;
        
        // Проверка минимальной ставки
        if (amount < 1) {
            return res.status(400).json({ error: 'Minimum bet is 1 TON/Star' });
        }
        
        // Проверка баланса для Stars
        if (currency === 'stars') {
            const user = await db.collection('users').findOne({ telegramId: userId });
            if (!user || user.balance < amount) {
                return res.status(400).json({ error: 'Insufficient Stars balance' });
            }
        }
        
        // Проверка транзакции для TON
        if (currency === 'ton' && txHash) {
            const tx = await tonClient.getTransaction(CONTRACT_ADDRESS, txHash);
            if (!tx) {
                return res.status(400).json({ error: 'Transaction not found' });
            }
        }
        
        // Сохранение ставки
        const bet = {
            userId,
            amount,
            racerId,
            currency,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await db.collection('bets').insertOne(bet);
        
        // Обновление баланса для Stars
        if (currency === 'stars') {
            await db.collection('users').updateOne(
                { telegramId: userId },
                { $inc: { balance: -amount } }
            );
        }
        
        res.status(201).json({ 
            success: true, 
            betId: result.insertedId 
        });
        
    } catch (error) {
        console.error('Error placing bet:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API для получения истории ставок
app.get('/api/bets/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 10, offset = 0 } = req.query;
        
        const bets = await db.collection('bets')
            .find({ userId })
            .sort({ createdAt: -1 })
            .skip(parseInt(offset))
            .limit(parseInt(limit))
            .toArray();
            
        res.status(200).json(bets);
    } catch (error) {
        console.error('Error fetching bets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API для обработки вебхуков от TON
app.post('/api/ton/webhook', async (req, res) => {
    try {
        const { event, transaction } = req.body;
        
        if (event === 'transaction' && transaction.to === CONTRACT_ADDRESS) {
            // Обработка транзакции
            await processTonTransaction(transaction);
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Обработка транзакции TON
async function processTonTransaction(tx) {
    // Декодирование сообщения
    const message = tx.in_msg.message;
    
    try {
        const data = JSON.parse(message);
        
        if (data.method === 'place_bet') {
            // Обновление статуса ставки
            await db.collection('bets').updateOne(
                { txHash: tx.hash },
                { $set: { status: 'confirmed' } }
            );
            
            // Уведомление пользователя
            const bet = await db.collection('bets').findOne({ txHash: tx.hash });
            if (bet && bot) {
                bot.sendMessage(
                    bet.userId,
                    `Your bet of ${bet.amount} TON has been confirmed!`
                );
            }
        }
    } catch (e) {
        console.error('Error processing transaction:', e);
    }
}

// Запуск сервера
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});