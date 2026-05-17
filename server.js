// server.js
'use strict';

const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT        || 8080;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:IyJfyncoxZBZGMbkEnCJHlbPtcBPxTQR@autorack.proxy.rlwy.net:56739';

const MAX_LEVEL      = 5;
const MAX_AD_VIEWS   = 15;          // views per block per cycle
const AD_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFERRAL_BONUS = 0.005;
const MIN_WITHDRAW   = 5;

// Level formula — must exactly match frontend getLevelReward()
function getLevelReward(level) {
  return parseFloat((Math.min(level, MAX_LEVEL) * 0.0009).toFixed(4));
}

// XP needed per level — must exactly match frontend getXpNeeded()
function getXpNeeded(level) {
  return level * 100;
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  userId:         { type: String, unique: true, required: true, index: true },
  username:       { type: String, default: 'User' },
  firstName:      { type: String, default: '' },
  lastName:       { type: String, default: '' },
  avatarUrl:      { type: String, default: '' },
  balance:        { type: Number, default: 0 },
  totalEarned:    { type: Number, default: 0 },
  level:          { type: Number, default: 1 },
  xp:             { type: Number, default: 0 },
  autoMode:       { type: Boolean, default: false },
  isBanned:       { type: Boolean, default: false },
  referralCode:   { type: String, unique: true, index: true },
  referredBy:     { type: String, default: null },
  referrals:      [{ type: String }],
  completedTasks: [{ type: String }],

  adBlocksData: [{
    id:         Number,
    views:      { type: Number, default: 0 },
    nextReset:  { type: Date,   default: null },
    lastAdTime: { type: Date,   default: null }
  }],

  // Admin withdrawal system (kept intact)
  withdrawals: [{
    amount:        { type: Number, required: true },
    walletAddress: { type: String, default: 'Не указан' },
    status:        { type: String, default: 'pending' },
    createdAt:     { type: Date,   default: Date.now }
  }],

  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Unique referral code with collision check
async function generateReferralCode() {
  let code, exists = true;
  while (exists) {
    code  = Math.random().toString(36).substring(2, 8).toUpperCase();
    exists = await User.findOne({ referralCode: code }).lean();
  }
  return code;
}

// Default ad blocks — matches frontend adBlocks array (ids 1,2,3)
function defaultAdBlocks() {
  return [
    { id: 1, views: 0, nextReset: null, lastAdTime: null },
    { id: 2, views: 0, nextReset: null, lastAdTime: null },
    { id: 3, views: 0, nextReset: null, lastAdTime: null }
  ];
}

// Precise float arithmetic to avoid floating point drift
function addFloat(a, b) {
  return parseFloat((a + b).toFixed(6));
}

// Ban check middleware
async function checkBanStatus(req, res, next) {
  const { userId } = req.body;
  if (!userId) return next();
  try {
    const user = await User.findOne({ userId }).lean();
    if (user && user.isBanned) {
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован за нарушение правил!' });
    }
    next();
  } catch (err) {
    next();
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ─── GET / CREATE USER ────────────────────────────────────────────────────────
app.post('/api/user', async (req, res) => {
  try {
    const { userId, username, firstName, lastName, avatarUrl, referredBy } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    let user = await User.findOne({ userId });

    if (!user) {
      const referralCode = await generateReferralCode();

      user = new User({
        userId,
        username:  username || firstName || 'User',
        firstName: firstName || '',
        lastName:  lastName  || '',
        avatarUrl: avatarUrl || `https://i.pravatar.cc/100?u=${userId}`,
        referralCode,
        referredBy: referredBy || null,
        adBlocksData: defaultAdBlocks()
      });

      // Referral bonus to referrer
      if (referredBy) {
        const referrer = await User.findOne({ referralCode: referredBy });
        if (referrer && referrer.userId !== userId) {
          referrer.balance     = addFloat(referrer.balance, REFERRAL_BONUS);
          referrer.totalEarned = addFloat(referrer.totalEarned, REFERRAL_BONUS);
          referrer.referrals.push(userId);
          await referrer.save();
        }
      }
      await user.save();

    } else {
      // Update avatar if changed and valid
      if (avatarUrl && avatarUrl !== user.avatarUrl && !avatarUrl.includes('pravatar.cc')) {
        user.avatarUrl = avatarUrl;
        await user.save();
      }

      // Migrate old users who have no adBlocksData
      if (!user.adBlocksData || user.adBlocksData.length === 0) {
        user.adBlocksData = defaultAdBlocks();
        await user.save();
      }
    }

    res.json(user);
  } catch (err) {
    console.error('POST /api/user error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ADD REWARD (called after watching an ad) ─────────────────────────────────
// Frontend manages ad-block state locally and sends it here.
// Server validates the reward amount, applies XP/level-up, and persists block state.
app.post('/api/add-reward', checkBanStatus, async (req, res) => {
  try {
    const { userId, amount, adBlockId, adBlocksData } = req.body;

    if (!userId || amount === undefined) {
      return res.status(400).json({ error: 'userId and amount required' });
    }

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // ── Server-side reward validation ──────────────────────────────────────────
    // Accept the reward if it matches the expected level reward (with small float tolerance)
    // OR if it's less (never more than allowed).
    const expectedReward = getLevelReward(user.level);
    const parsedAmount   = parseFloat(amount);

    if (
      isNaN(parsedAmount) ||
      parsedAmount <= 0   ||
      parsedAmount > expectedReward + 0.0001   // strict upper bound
    ) {
      return res.json({ success: false, message: 'Invalid reward amount' });
    }

    // ── Persist ad block states sent from frontend ─────────────────────────────
    if (Array.isArray(adBlocksData)) {
      adBlocksData.forEach(incoming => {
        const block = user.adBlocksData.find(b => b.id === incoming.id);
        if (block) {
          block.views      = typeof incoming.views === 'number' ? incoming.views : block.views;
          block.nextReset  = incoming.nextReset  || null;
          block.lastAdTime = incoming.lastAdTime || null;
        }
      });
    }

    // ── Balance ───────────────────────────────────────────────────────────────
    user.balance     = addFloat(user.balance, parsedAmount);
    user.totalEarned = addFloat(user.totalEarned, parsedAmount);

    // ── XP & Level-up ─────────────────────────────────────────────────────────
    user.xp += 1;
    let leveled = false;
    while (user.level < MAX_LEVEL && user.xp >= getXpNeeded(user.level)) {
      user.xp    -= getXpNeeded(user.level);
      user.level += 1;
      leveled     = true;
    }
    // Cap XP at max level
    if (user.level >= MAX_LEVEL) {
      user.xp = Math.min(user.xp, getXpNeeded(MAX_LEVEL));
    }

    await user.save();

    res.json({
      success:     true,
      balance:     user.balance,
      totalEarned: user.totalEarned,
      level:       user.level,
      xp:          user.xp,
      xpToNext:    getXpNeeded(user.level),
      levelReward: getLevelReward(user.level),
      leveled,
      adBlocksData: user.adBlocksData
    });
  } catch (err) {
    console.error('POST /api/add-reward error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE AD BLOCKS (save block state without giving reward) ────────────────
// Used when cooldown kicks in or user closes app mid-session.
app.post('/api/update-adblocks', checkBanStatus, async (req, res) => {
  try {
    const { userId, adBlocks } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (Array.isArray(adBlocks)) {
      adBlocks.forEach(incoming => {
        const block = user.adBlocksData.find(b => b.id === incoming.id);
        if (block) {
          block.views      = typeof incoming.views === 'number' ? incoming.views : block.views;
          block.nextReset  = incoming.nextReset  || null;
          block.lastAdTime = incoming.lastAdTime || null;
        }
      });
    }

    await user.save();
    res.json({ success: true, adBlocksData: user.adBlocksData });
  } catch (err) {
    console.error('POST /api/update-adblocks error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── CLICK ────────────────────────────────────────────────────────────────────
// Clicking the balance gives a small reward without XP (no level progression via click)
app.post('/api/click', checkBanStatus, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const reward      = getLevelReward(user.level);
    user.balance      = addFloat(user.balance, reward);
    user.totalEarned  = addFloat(user.totalEarned, reward);
    await user.save();

    res.json({
      success: true,
      reward,
      balance: user.balance,
      level:   user.level,
      xp:      user.xp
    });
  } catch (err) {
    console.error('POST /api/click error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── TOGGLE AUTO MODE ─────────────────────────────────────────────────────────
app.post('/api/toggle-auto', checkBanStatus, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.autoMode = !user.autoMode;
    await user.save();
    res.json({ autoMode: user.autoMode });
  } catch (err) {
    console.error('POST /api/toggle-auto error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── AUTO COLLECT (passive income stub — auto mode = watching ads on frontend) ─
app.post('/api/auto-collect', checkBanStatus, async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findOne({ userId }).lean();
    if (!user || !user.autoMode) return res.json({ success: false });
    // Passive income is handled on frontend via auto ad watching — no server-side ticking
    res.json({ success: false, earnings: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  try {
    const top = await User.find({ isBanned: false })
      .sort({ totalEarned: -1 })
      .limit(50)
      .select('userId username avatarUrl totalEarned level')
      .lean();
    res.json(top);
  } catch (err) {
    console.error('GET /api/leaderboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── REFERRALS ────────────────────────────────────────────────────────────────
app.get('/api/referrals/:userId', async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId })
      .select('referrals referralCode')
      .lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      referrals:    user.referrals,
      referralCode: user.referralCode,
      count:        user.referrals.length
    });
  } catch (err) {
    console.error('GET /api/referrals error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── COMPLETE TASK ────────────────────────────────────────────────────────────
app.post('/api/complete-task', checkBanStatus, async (req, res) => {
  try {
    const { userId, taskId } = req.body;
    if (!userId || !taskId) return res.status(400).json({ error: 'userId and taskId required' });

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.completedTasks.includes(taskId)) {
      return res.json({ success: false, message: 'Already completed' });
    }

    const rewards = { subscribe: 0.001, share: 0.0005 };
    const reward  = rewards[taskId] || 0;

    user.completedTasks.push(taskId);
    user.balance     = addFloat(user.balance, reward);
    user.totalEarned = addFloat(user.totalEarned, reward);
    await user.save();

    res.json({
      success:        true,
      reward,
      balance:        user.balance,
      completedTasks: user.completedTasks
    });
  } catch (err) {
    console.error('POST /api/complete-task error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── WITHDRAW ─────────────────────────────────────────────────────────────────
app.post('/api/withdraw', checkBanStatus, async (req, res) => {
  try {
    const { userId, amount, walletAddress } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.json({ success: false, message: 'Invalid amount' });
    }
    if (parsedAmount < MIN_WITHDRAW) {
      return res.json({ success: false, message: `Min $${MIN_WITHDRAW}` });
    }
    if (user.balance < parsedAmount) {
      return res.json({ success: false, message: 'Insufficient balance' });
    }

    user.balance = addFloat(user.balance, -parsedAmount);
    user.withdrawals.push({
      amount:        parsedAmount,
      walletAddress: walletAddress || 'Не указан',
      status:        'pending'
    });
    await user.save();

    res.json({
      success: true,
      message: 'Заявка отправлена на модерацию!',
      balance: user.balance
    });
  } catch (err) {
    console.error('POST /api/withdraw error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
const ADMIN_ID = process.env.ADMIN_ID || '8772464641';

function verifyAdmin(req, res, next) {
  const { adminId } = req.body;
  if (adminId !== ADMIN_ID) {
    return res.status(403).json({ error: 'Критическая ошибка безопасности: Доступ запрещен!' });
  }
  next();
}

app.post('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const balanceAgg = await User.aggregate([{ $group: { _id: null, sum: { $sum: '$balance' } } }]);
    const totalBalance = balanceAgg[0]?.sum || 0;

    const pendingWithdrawals = await User.aggregate([
      { $unwind: '$withdrawals' },
      { $match: { 'withdrawals.status': 'pending' } },
      { $project: {
        _id: 0,
        userId: '$userId',
        username: '$username',
        withdrawalId: '$withdrawals._id',
        amount: '$withdrawals.amount',
        walletAddress: '$withdrawals.walletAddress',
        createdAt: '$withdrawals.createdAt'
      }}
    ]);

    res.json({ totalUsers, totalBalance, pendingWithdrawals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/withdrawal-action', verifyAdmin, async (req, res) => {
  try {
    const { userId, withdrawalId, action } = req.body;
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const item = user.withdrawals.id(withdrawalId);
    if (!item || item.status !== 'pending') {
      return res.status(400).json({ error: 'Заявка не найдена или уже обработана!' });
    }

    if (action === 'approve') {
      item.status = 'approved';
    } else if (action === 'reject') {
      item.status  = 'rejected';
      user.balance = addFloat(user.balance, item.amount);
    }

    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/user-search', verifyAdmin, async (req, res) => {
  try {
    const { query } = req.body;
    const user = await User.findOne({ $or: [{ userId: query }, { username: query }] });
    if (!user) return res.json({ success: false, message: 'Пользователь не найден' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/user-update', verifyAdmin, async (req, res) => {
  try {
    const { targetUserId, balance, isBanned } = req.body;
    const user = await User.findOne({ userId: targetUserId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (balance  !== undefined) user.balance  = parseFloat(balance);
    if (isBanned !== undefined) user.isBanned = Boolean(isBanned);

    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000
})
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

module.exports = app;
