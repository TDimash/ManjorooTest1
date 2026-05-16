// server.js — Original Ads Logic + Secure Balancing & Withdrawal
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:IyJfyncoxZBZGMbkEnCJHlbPtcBPxTQR@autorack.proxy.rlwy.net:56739';

const MIN_WITHDRAW        = 5;
const REFERRAL_BONUS      = 0.005;
const LEVEL_UP_BONUS_BASE = 0.01;
const BASE_PASSIVE        = 0.0001;

// Награды в долларах соразмерно кликам!
const AD_BLOCKS_CONFIG = {
  1: { reward: 0.002, limit: 10, cooldown: 2 * 60 * 60 * 1000 },
  2: { reward: 0.003, limit: 5,  cooldown: 4 * 60 * 60 * 1000 },
  3: { reward: 0.005, limit: 3,  cooldown: 6 * 60 * 60 * 1000 }
};

// ─── Schema ───────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  userId:              { type: String, unique: true, required: true, index: true },
  username:            { type: String, default: 'User' },
  firstName:           { type: String, default: '' },
  lastName:            { type: String, default: '' },
  avatarUrl:           { type: String, default: '' },
  balance:             { type: Number, default: 0 },
  totalEarned:         { type: Number, default: 0 },
  level:               { type: Number, default: 1 },
  xp:                  { type: Number, default: 0 },
  autoMode:            { type: Boolean, default: false },
  referralCode:        { type: String, unique: true, index: true },
  referredBy:          { type: String, default: null },
  referrals:           [{ type: String }],
  completedTasks:      [{ type: String }],
  
  // Сохраняем оригинальную структуру блоков рекламы
  adBlocksData: [{
    id:        Number,
    views:     { type: Number, default: 0 },
    nextReset: { type: Date, default: null },
    lastAdTime:{ type: Date, default: null }
  }],
  
  withdrawals: [{
    amount:        { type: Number, required: true },
    walletAddress: { type: String, required: true },
    status:        { type: String, default: 'pending' },
    createdAt:     { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getLevelReward = (level) => 0.001 + (level - 1) * 0.0008;
const getXpNeeded    = (level) => 100 + (level - 1) * 50;

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/user', async (req, res) => {
  try {
    const { userId, username, firstName, lastName, avatarUrl, referredBy } = req.body;
    let user = await User.findOne({ userId });

    // Самая надежная генерация ссылки на аватарку (если нет родной, берем красивую по UI букв имени или юзернейму)
    let finalAvatar = avatarUrl;
    if (!finalAvatar || finalAvatar.includes('pravatar.cc')) {
      finalAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username || firstName || 'U')}&background=2AABEE&color=fff&size=128`;
    }

    if (!user) {
      const refCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      const initialBlocks = [
        { id: 1, views: 0, nextReset: null, lastAdTime: null },
        { id: 2, views: 0, nextReset: null, lastAdTime: null },
        { id: 3, views: 0, nextReset: null, lastAdTime: null }
      ];

      user = new User({
        userId, username, firstName, lastName,
        avatarUrl: finalAvatar,
        referralCode: refCode,
        referredBy: referredBy || null,
        adBlocksData: initialBlocks
      });

      if (referredBy) {
        const rUser = await User.findOne({ referralCode: referredBy });
        if (rUser && rUser.userId !== userId) {
          rUser.balance += REFERRAL_BONUS;
          rUser.totalEarned += REFERRAL_BONUS;
          rUser.referrals.push(userId);
          await rUser.save();
        }
      }
      await user.save();
    } else {
      // Если аватарка обновилась на стороне клиента или была дефолтной — перезаписываем
      if (avatarUrl && user.avatarUrl !== avatarUrl && !avatarUrl.includes('pravatar.cc')) {
        user.avatarUrl = avatarUrl;
        await user.save();
      }
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Клик
app.post('/api/click', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const reward = getLevelReward(user.level);
    user.balance += reward;
    user.totalEarned += reward;
    user.xp += 1;

    let xpNeeded = getXpNeeded(user.level);
    if (user.xp >= xpNeeded) {
      user.xp -= xpNeeded;
      user.level += 1;
      const lvlBonus = LEVEL_UP_BONUS_BASE * user.level;
      user.balance += lvlBonus;
      user.totalEarned += lvlBonus;
    }

    await user.save();
    res.json({ success: true, reward, balance: user.balance, level: user.level, xp: user.xp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Пассивный сбор авто-режима
app.post('/api/auto-collect', async (req, res) => {
  try {
    const { userId, seconds } = req.body;
    const user = await User.findOne({ userId });
    if (!user || !user.autoMode) return res.json({ success: false });

    const sec = Math.min(Number(seconds) || 0, 3600);
    if (sec <= 0) return res.json({ success: false, earnings: 0 });

    const rate = getLevelReward(user.level) * BASE_PASSIVE;
    const earnings = rate * sec;

    user.balance += earnings;
    user.totalEarned += earnings;
    await user.save();

    res.json({ success: true, earnings, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/toggle-auto', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.autoMode = !user.autoMode;
    await user.save();
    res.json({ autoMode: user.autoMode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ОРИГИНАЛЬНЫЙ РОУТ ДЛЯ ПРОСМОТРА РЕКЛАМЫ (С ИСПРАВЛЕННЫМ ЦЕНТОВЫМ БАЛАНСОМ)
app.post('/api/watch-ad', async (req, res) => {
  try {
    const { userId, blockId } = req.body;
    const bId = Number(blockId);
    const config = AD_BLOCKS_CONFIG[bId];

    if (!config) return res.status(400).json({ error: 'Invalid block ID' });

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let block = user.adBlocksData.find(b => b.id === bId);
    if (!block) {
      block = { id: bId, views: 0, nextReset: null, lastAdTime: null };
      user.adBlocksData.push(block);
    }

    const now = new Date();
    if (block.nextReset && now > new Date(block.nextReset)) {
      block.views = 0;
      block.nextReset = null;
    }

    if (block.views >= config.limit) {
      return res.json({ success: false, message: 'Limit reached' });
    }

    block.views += 1;
    block.lastAdTime = now;

    if (block.views >= config.limit) {
      block.nextReset = new Date(now.getTime() + config.cooldown);
    }

    user.balance += config.reward;
    user.totalEarned += config.reward;

    await user.save();
    res.json({ success: true, reward: config.reward, balance: user.balance, adBlocksData: user.adBlocksData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const top = await User.find().sort({ totalEarned: -1 }).limit(50).select('username avatarUrl totalEarned level');
    res.json(top);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Заморозка выплат с запросом кошелька
app.post('/api/withdraw', async (req, res) => {
  try {
    const { userId, amount, walletAddress } = req.body;
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const parsedAmount = Number(amount);
    if (parsedAmount < MIN_WITHDRAW) return res.json({ success: false, message: `Min $${MIN_WITHDRAW}` });
    if (user.balance < parsedAmount) return res.json({ success: false, message: 'Insufficient balance' });

    user.balance -= parsedAmount;
    user.withdrawals.push({
      amount: parsedAmount,
      walletAddress: walletAddress || 'Не указан',
      status: 'pending'
    });
    
    await user.save();
    res.json({ success: true, message: 'Заявка отправлена на модерацию!', balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

mongoose.connect(MONGODB_URI).then(() => {
  app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
});
