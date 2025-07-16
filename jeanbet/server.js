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
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

// Инициализация клиентов
const tonClient = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: "3378b0905d1a437a13a0e8413803b53dfcbbc555a3b62515bf431542ae8a5668"
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

// Middleware для аутентификации администратора
const adminAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Authorization header missing' });
        }
        
        // В реальном приложении используйте JWT или другой метод аутентификации
        const user = JSON.parse(authHeader);
        if (user.username !== ADMIN_USERNAME) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        next();
    } catch (error) {
        console.error('Admin auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
};

// API для ставок
app.post('/api/bets', async (req, res) => {
    try {
        const { userId, amount, racerId, currency, txHash, raceId } = req.body;
        
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
            raceId: raceId || 'default',
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

// API для депозита Stars
app.post('/api/deposit/stars', async (req, res) => {
    try {
        const { userId, amount, paymentId } = req.body;
        
        if (amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        
        // В реальном приложении здесь должна быть проверка платежа через Telegram API
        // Для демо просто добавляем баланс
        
        await db.collection('users').updateOne(
            { telegramId: userId },
            { $inc: { balance: amount } },
            { upsert: true }
        );
        
        // Запись транзакции
        await db.collection('transactions').insertOne({
            userId,
            type: 'deposit',
            amount,
            currency: 'stars',
            status: 'completed',
            paymentId,
            createdAt: new Date()
        });
        
        res.status(200).json({ success: true });
        
    } catch (error) {
        console.error('Deposit error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API для вывода Stars
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        
        // Проверка баланса
        const user = await db.collection('users').findOne({ telegramId: userId });
        if (!user || user.balance < amount) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        
        // Создание запроса на вывод
        const withdrawal = {
            userId,
            amount,
            currency: 'stars',
            status: 'pending',
            createdAt: new Date()
        };
        
        await db.collection('withdrawals').insertOne(withdrawal);
        
        // Резервирование средств
        await db.collection('users').updateOne(
            { telegramId: userId },
            { $inc: { balance: -amount } }
        );
        
        // В реальном приложении здесь будет обработка вывода
        // Для демо просто отмечаем как выполненный
        setTimeout(async () => {
            await db.collection('withdrawals').updateOne(
                { _id: withdrawal._id },
                { $set: { status: 'completed', completedAt: new Date() } }
            );
            
            if (bot) {
                bot.sendMessage(
                    userId,
                    `Your withdrawal of ${amount} Stars has been processed!`
                );
            }
        }, 5000);
        
        res.status(200).json({ 
            success: true,
            message: `Withdrawal request for ${amount} Stars received`
        });
        
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API для админа - объявление победителя
app.post('/api/admin/declare-winner', adminAuth, async (req, res) => {
    try {
        const { raceId, winner } = req.body;
        
        // Получаем все ставки для этой гонки
        const bets = await db.collection('bets')
            .find({ raceId, status: 'pending' })
            .toArray();
        
        // Обрабатываем каждую ставку
        for (const bet of bets) {
            if (bet.racerId === winner) {
                // Расчет выигрыша
                const odds = bet.racerId === '1' ? 1.85 : 2.10;
                const winAmount = Math.floor(bet.amount * odds);
                
                // Начисление выигрыша
                await db.collection('users').updateOne(
                    { telegramId: bet.userId },
                    { $inc: { balance: winAmount } }
                );
                
                // Обновление статуса ставки
                await db.collection('bets').updateOne(
                    { _id: bet._id },
                    { $set: { status: 'won', winAmount, updatedAt: new Date() } }
                );
                
                // Уведомление пользователя
                if (bot) {
                    bot.sendMessage(
                        bet.userId,
                        `🎉 You won ${winAmount} Stars on race ${raceId}!`
                    );
                }
            } else {
                // Отмечаем как проигранную
                await db.collection('bets').updateOne(
                    { _id: bet._id },
                    { $set: { status: 'lost', updatedAt: new Date() } }
                );
                
                if (bot) {
                    bot.sendMessage(
                        bet.userId,
                        `😢 Your bet on race ${raceId} didn't win. Better luck next time!`
                    );
                }
            }
        }
        
        res.status(200).json({ 
            success: true,
            message: `Winner for race ${raceId} declared successfully`
        });
        
    } catch (error) {
        console.error('Error declaring winner:', error);
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

// API для получения баланса
app.get('/api/balance/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await db.collection('users').findOne({ telegramId: userId });
        const balance = user ? user.balance : 0;
        
        res.status(200).json({ balance });
    } catch (error) {
        console.error('Error fetching balance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Запуск сервера
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});