// server.js — Refactored by Security & Architecture Audit
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');

const app = express();

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://mongo:IyJfyncoxZBZGMbkEnCJHlbPtcBPxTQR@autorack.proxy.rlwy.net:56739';

const BOT_TOKEN = '8670832422:AAEsEmdus8vpA2CHHasbfe9fVdbecnLgCQQ';
const CHANNEL_CHAT_ID = '@TestChanneeellll'; 

const CLICK_COOLDOWN_MS   = 1000;
const AUTO_MAX_SECONDS    = 3600;
const DOUBLE_BOOST_COST   = 5000;
const DOUBLE_BOOST_HOURS  = 24;
const MIN_WITHDRAW        = 5;
const REFERRAL_BONUS      = 0.005;
const LEVEL_UP_BONUS_BASE = 0.01;
const BASE_PASSIVE        = 0.0001;

// БАГ ИСПРАВЛЕН: Теперь награды соразмерны центам, а не тысячам долларов!
const TASK_REWARDS = Object.freeze({ subscribe: 0.01, share: 0.005 });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getLevelReward  = (level) => 0.001 + (level - 1) * 0.0008;
const getXpNeeded     = (level) => 100  + (level - 1) * 50;
const isDoubleActive  = (user)  =>
  user.doubleIncome &&
  (!user.doubleIncomeExpires || new Date(user.doubleIncomeExpires) > new Date());

async function generateUniqueReferralCode() {
  for (let attempts = 0; attempts < 20; attempts++) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not generate unique referral code after 20 attempts');
}

async function checkTelegramSubscription(userId) {
  if (userId === 'demo_dev_local') return true;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_CHAT_ID}&user_id=${userId}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.ok) return false;
    const status = data.result?.status;
    return ['creator', 'administrator', 'member'].includes(status);
  } catch (err) {
    return false;
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    userId:               { type: String, unique: true, required: true },
    username:             { type: String, default: 'User' },
    firstName:            { type: String, default: '' },
    lastName:             { type: String, default: '' },
    avatarUrl:            { type: String, default: '' },
    balance:              { type: Number, default: 0, min: 0 },
    totalEarned:          { type: Number, default: 0, min: 0 },
    level:                { type: Number, default: 1, min: 1 },
    xp:                   { type: Number, default: 0, min: 0 },
    autoMode:             { type: Boolean, default: false },
    doubleIncome:         { type: Boolean, default: false },
    doubleIncomeExpires:  { type: Date,    default: null },
    referralCode:         { type: String, unique: true, sparse: true },
    referredBy:           { type: String, default: null },
    referrals:            [{ type: String }],
    completedTasks:       [{ type: String }],
    lastClickTime:        { type: Date, default: Date.now },
    passiveIncome:        { type: Number, default: BASE_PASSIVE },
    createdAt:            { type: Date,   default: Date.now },
    
    // Новое поле: История выводов средств с заморозкой баланса
    withdrawals: [{
      amount:         { type: Number, required: true },
      walletAddress:  { type: String, required: true },
      status:         { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      createdAt:      { type: Date, default: Date.now }
    }]
  },
  { versionKey: false }
);

userSchema.index({ totalEarned: -1 });
const User = mongoose.model('User', userSchema);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '16kb' }));
app.use(express.static('public'));

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests, please slow down.' },
});
app.use('/api/', globalLimiter);

function validateUserId(userId) {
  return typeof userId === 'string' && /^[\w\-]{1,64}$/.test(userId);
}

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.post('/api/user', asyncHandler(async (req, res) => {
  const { userId, username, firstName, lastName, avatarUrl, referredBy } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });

  let user = await User.findOne({ userId });
  if (!user) {
    const referralCode = await generateUniqueReferralCode();
    user = new User({
      userId,
      username: username || firstName || 'User',
      firstName: firstName || '',
      lastName:  lastName  || '',
      avatarUrl: avatarUrl || `https://i.pravatar.cc/100?u=${userId}`,
      referralCode,
      referredBy: referredBy || null,
      passiveIncome: BASE_PASSIVE,
    });

    if (referredBy && typeof referredBy === 'string') {
      const referrer = await User.findOne({ referralCode: referredBy });
      if (referrer && referrer.userId !== userId) {
        await User.updateOne(
          { _id: referrer._id },
          { $inc: { balance: REFERRAL_BONUS, totalEarned: REFERRAL_BONUS }, $push: { referrals: userId } }
        );
      }
    }
    await user.save();
  }
  res.json(user);
}));

app.post('/api/click', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });

  const user = await User.findOne({ userId });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = Date.now();
  if (now - (user.lastClickTime?.getTime() || 0) < CLICK_COOLDOWN_MS) {
    return res.json({ success: false, message: 'Too fast!', balance: user.balance });
  }

  let reward = user.passiveIncome;
  if (isDoubleActive(user)) reward *= 2;

  user.balance      += reward;
  user.totalEarned  += reward;
  user.xp           += 1;
  user.lastClickTime = new Date();

  let xpNeeded = getXpNeeded(user.level);
  while (user.xp >= xpNeeded) {
    user.xp           -= xpNeeded;
    user.level        += 1;
    user.passiveIncome = getLevelReward(user.level);
    const bonus        = LEVEL_UP_BONUS_BASE * user.level;
    user.balance      += bonus;
    user.totalEarned  += bonus;
    xpNeeded           = getXpNeeded(user.level);
  }

  await user.save();
  res.json({ success: true, reward, balance: user.balance, level: user.level, xp: user.xp, passiveIncome: user.passiveIncome });
}));

app.post('/api/auto-collect', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });

  const user = await User.findOne({ userId });
  if (!user || !user.autoMode) return res.json({ success: false });

  const now = Date.now();
  const secondsPassed = Math.min(Math.floor((now - (user.lastClickTime?.getTime() || now)) / 1000), AUTO_MAX_SECONDS);
  if (secondsPassed < 1) return res.json({ success: false, earnings: 0 });

  let earnings = user.passiveIncome * secondsPassed;
  if (isDoubleActive(user)) earnings *= 2;

  user.balance      += earnings;
  user.totalEarned  += earnings;
  user.lastClickTime = new Date();
  await user.save();

  res.json({ success: true, earnings, balance: user.balance });
}));

app.post('/api/toggle-auto', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const user = await User.findOne({ userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.autoMode = !user.autoMode;
  await user.save();
  res.json({ autoMode: user.autoMode });
}));

app.post('/api/buy-double', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const user = await User.findOne({ userId });
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.balance < DOUBLE_BOOST_COST) return res.json({ success: false });

  user.balance             -= DOUBLE_BOOST_COST;
  user.doubleIncome         = true;
  user.doubleIncomeExpires  = new Date(Date.now() + DOUBLE_BOOST_HOURS * 3600 * 1000);
  await user.save();

  res.json({ success: true, balance: user.balance, doubleIncomeActive: true, expiresAt: user.doubleIncomeExpires });
}));

app.post('/api/complete-task', asyncHandler(async (req, res) => {
  const { userId, taskId } = req.body;
  if (!Object.prototype.hasOwnProperty.call(TASK_REWARDS, taskId)) return res.status(400).json({ error: 'Unknown task' });

  const user = await User.findOne({ userId });
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.completedTasks.includes(taskId)) return res.json({ success: false, message: 'Задание уже выполнено' });

  if (taskId === 'subscribe') {
    const isSubscribed = await checkTelegramSubscription(userId);
    if (!isSubscribed) return res.json({ success: false, message: 'Вы не подписаны на канал!' });
  }

  const reward = TASK_REWARDS[taskId];
  user.completedTasks.push(taskId);
  user.balance     += reward;
  user.totalEarned += reward;
  await user.save();

  res.json({ success: true, reward, balance: user.balance, completedTasks: user.completedTasks });
}));

app.get('/api/leaderboard', asyncHandler(async (req, res) => {
  const leaderboard = await User.find().sort({ totalEarned: -1 }).limit(50).select('userId username avatarUrl totalEarned level').lean();
  res.json(leaderboard);
}));

// ЛОГИКА ИЗМЕНЕНА: Деньги не списываются вникуда, а «замораживаются» до одобрения админом
app.post('/api/withdraw', asyncHandler(async (req, res) => {
  const { userId, amount, walletAddress } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const user = await User.findOne({ userId });
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (parsedAmount < MIN_WITHDRAW) return res.json({ success: false, message: `Минимум для вывода: $${MIN_WITHDRAW}` });
  if (user.balance < parsedAmount) return res.json({ success: false, message: 'Недостаточно средств на балансе' });

  // Списываем с баланса и кладем в массив выводов со статусом pending
  user.balance -= parsedAmount;
  user.withdrawals.push({
    amount: parsedAmount,
    walletAddress: walletAddress || 'Не указан',
    status: 'pending'
  });

  await user.save();
  console.log(`[Заявка на вывод] Игрок ${userId} запросил $${parsedAmount} на кошелек ${walletAddress}`);

  res.json({ success: true, message: 'Заявка отправлена администратору на проверку!', balance: user.balance });
}));

app.use((err, req, res, _next) => {
  res.status(500).json({ error: 'Internal server error' });
});

mongoose.connect(MONGODB_URI).then(() => {
  app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
});

module.exports = app;
