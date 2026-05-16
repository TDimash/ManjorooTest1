'use strict';

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();

const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:IyJfyncoxZBZGMbkEnCJHlbPtcBPxTQR@autorack.proxy.rlwy.net:56739';

const CLICK_COOLDOWN_MS   = 1000;
const AUTO_MAX_SECONDS    = 3600;
const DOUBLE_BOOST_COST   = 5000;
const DOUBLE_BOOST_HOURS  = 24;
const MIN_WITHDRAW        = 5;
const REFERRAL_BONUS      = 0.005;
const LEVEL_UP_BONUS_BASE = 0.01;
const BASE_PASSIVE        = 0.0001;
const TASK_REWARDS = Object.freeze({ subscribe: 1000, share: 500 });

const getLevelReward = (level) => 0.001 + (level - 1) * 0.0008;
const getXpNeeded    = (level) => 100  + (level - 1) * 50;
const isDoubleActive = (user)  =>
  user.doubleIncome &&
  (!user.doubleIncomeExpires || new Date(user.doubleIncomeExpires) > new Date());

async function generateUniqueReferralCode() {
  for (let i = 0; i < 20; i++) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not generate unique referral code');
}

const userSchema = new mongoose.Schema({
  userId:              { type: String, unique: true, required: true },
  username:            { type: String, default: 'User' },
  firstName:           { type: String, default: '' },
  lastName:            { type: String, default: '' },
  avatarUrl:           { type: String, default: '' },
  balance:             { type: Number, default: 0, min: 0 },
  totalEarned:         { type: Number, default: 0, min: 0 },
  level:               { type: Number, default: 1, min: 1 },
  xp:                  { type: Number, default: 0, min: 0 },
  autoMode:            { type: Boolean, default: false },
  doubleIncome:        { type: Boolean, default: false },
  doubleIncomeExpires: { type: Date, default: null },
  referralCode:        { type: String, unique: true, sparse: true },
  referredBy:          { type: String, default: null },
  referrals:           [{ type: String }],
  completedTasks:      [{ type: String }],
  lastClickTime:       { type: Date, default: Date.now },
  passiveIncome:       { type: Number, default: BASE_PASSIVE },
  createdAt:           { type: Date, default: Date.now },
}, { versionKey: false });

userSchema.index({ totalEarned: -1 });
const User = mongoose.model('User', userSchema);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '16kb' }));
app.use(express.static('public'));

const globalLimiter = rateLimit({ windowMs: 60*1000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimiter  = rateLimit({ windowMs: 10*1000, max: 20 });
app.use('/api/', globalLimiter);

function validateUserId(userId) {
  return typeof userId === 'string' && /^[\w\-]{1,64}$/.test(userId);
}

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date(), mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.post('/api/user', writeLimiter, asyncHandler(async (req, res) => {
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
        await User.updateOne({ _id: referrer._id }, {
          $inc:  { balance: REFERRAL_BONUS, totalEarned: REFERRAL_BONUS },
          $push: { referrals: userId },
        });
      }
    }
    await user.save();
    console.log(`[user] New user: ${userId}`);
  }
  res.json(user);
}));

app.post('/api/click', writeLimiter, asyncHandler(async (req, res) => {
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

  user.balance     += reward;
  user.totalEarned += reward;
  user.xp          += 1;
  user.lastClickTime = new Date();

  let xpNeeded = getXpNeeded(user.level);
  while (user.xp >= xpNeeded) {
    user.xp    -= xpNeeded;
    user.level += 1;
    user.passiveIncome = getLevelReward(user.level);
    const bonus = LEVEL_UP_BONUS_BASE * user.level;
    user.balance     += bonus;
    user.totalEarned += bonus;
    xpNeeded = getXpNeeded(user.level);
  }

  await user.save();
  res.json({ success: true, reward, balance: user.balance, level: user.level, xp: user.xp, xpToNext: getXpNeeded(user.level), passiveIncome: user.passiveIncome, doubleIncomeActive: isDoubleActive(user) });
}));

app.post('/api/auto-collect', writeLimiter, asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });

  const user = await User.findOne({ userId });
  if (!user || !user.autoMode) return res.json({ success: false });

  const now = Date.now();
  const secondsPassed = Math.min(Math.floor((now - (user.lastClickTime?.getTime() || now)) / 1000), AUTO_MAX_SECONDS);
  if (secondsPassed < 1) return res.json({ success: false, earnings: 0 });

  let earnings = user.passiveIncome * secondsPassed;
  if (isDoubleActive(user)) earnings *= 2;

  user.balance     += earnings;
  user.totalEarned += earnings;
  user.lastClickTime = new Date();
  await user.save();
  res.json({ success: true, earnings, balance: user.balance, secondsPassed });
}));

app.post('/api/toggle-auto', writeLimiter, asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });
  const user = await User.findOne({ userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.autoMode = !user.autoMode;
  await user.save();
  res.json({ autoMode: user.autoMode });
}));

app.post('/api/buy-double', writeLimiter, asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });
  const user = await User.findOne({ userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.balance < DOUBLE_BOOST_COST) return res.json({ success: false, message: 'Not enough balance', balance: user.balance });
  user.balance -= DOUBLE_BOOST_COST;
  user.doubleIncome = true;
  user.doubleIncomeExpires = new Date(Date.now() + DOUBLE_BOOST_HOURS * 3600 * 1000);
  await user.save();
  res.json({ success: true, balance: user.balance, doubleIncomeActive: true, expiresAt: user.doubleIncomeExpires });
}));

app.post('/api/complete-task', writeLimiter, asyncHandler(async (req, res) => {
  const { userId, taskId } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });
  if (!taskId || typeof taskId !== 'string') return res.status(400).json({ error: 'taskId required' });
  if (!Object.prototype.hasOwnProperty.call(TASK_REWARDS, taskId)) return res.status(400).json({ error: 'Unknown task' });
  const user = await User.findOne({ userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.completedTasks.includes(taskId)) return res.json({ success: false, message: 'Task already completed' });
  const reward = TASK_REWARDS[taskId];
  user.completedTasks.push(taskId);
  user.balance     += reward;
  user.totalEarned += reward;
  await user.save();
  res.json({ success: true, reward, balance: user.balance, completedTasks: user.completedTasks });
}));

app.get('/api/leaderboard', asyncHandler(async (req, res) => {
  const leaderboard = await User.find().sort({ totalEarned: -1 }).limit(50)
    .select('userId username avatarUrl totalEarned level').lean();
  res.json(leaderboard);
}));

app.get('/api/referrals/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });
  const user = await User.findOne({ userId }).select('referrals referralCode').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ referrals: user.referrals, referralCode: user.referralCode, referralCount: user.referrals.length });
}));

app.post('/api/withdraw', writeLimiter, asyncHandler(async (req, res) => {
  const { userId, amount, walletAddress } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const user = await User.findOne({ userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (parsedAmount < MIN_WITHDRAW) return res.json({ success: false, message: `Minimum withdrawal is $${MIN_WITHDRAW}` });
  if (user.balance < parsedAmount) return res.json({ success: false, message: 'Insufficient balance' });
  user.balance -= parsedAmount;
  await user.save();
  console.log(`[withdraw] userId=${userId} amount=${parsedAmount} wallet=${walletAddress}`);
  res.json({ success: true, message: 'Withdrawal request submitted!', balance: user.balance });
}));

app.use((err, req, res, _next) => {
  console.error('[error]', err.stack || err.message);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({ error: isProd ? 'Internal server error' : err.message });
});

console.log('[db] Connecting to MongoDB...');
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 })
  .then(() => {
    console.log('[db] ✅ Connected to MongoDB successfully');
    app.listen(PORT, () => {
      console.log(`[server] 🚀 Running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[db] ❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

mongoose.connection.on('error',        (err) => console.error('[db] Runtime error:', err));
mongoose.connection.on('disconnected', ()    => console.warn('[db] Disconnected'));

module.exports = app;
