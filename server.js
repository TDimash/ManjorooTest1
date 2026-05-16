'use strict';

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:IyJfyncoxZBZGMbkEnCJHlbPtcBPxTQR@autorack.proxy.rlwy.net:56739';

const BOT_TOKEN = '8670832422:AAEsEmdus8vpA2CHHasbfe9fVdbecnLgCQQ';
const CHANNEL_CHAT_ID = '@TestChanneeellll'; 

const MIN_WITHDRAW        = 5;
const REFERRAL_BONUS      = 0.005;
const LEVEL_UP_BONUS_BASE = 0.01;
const BASE_PASSIVE        = 0.0001;

const TASK_REWARDS = Object.freeze({ subscribe: 0.01, share: 0.005 });

const AD_BLOCKS_CONFIG = [
  { id: 1, baseReward: 0.002, limit: 10, cooldownHours: 2 },
  { id: 2, baseReward: 0.003, limit: 5,  cooldownHours: 4 },
  { id: 3, baseReward: 0.005, limit: 3,  cooldownHours: 6 }
];

const getLevelReward  = (level) => 0.001 + (level - 1) * 0.0008;
const getXpNeeded     = (level) => 100  + (level - 1) * 50;
const isDoubleActive  = (user)  => user.doubleIncome && (!user.doubleIncomeExpires || new Date(user.doubleIncomeExpires) > new Date());

async function checkTelegramSubscription(userId) {
  if (userId === 'demo_dev_local') return true;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_CHAT_ID}&user_id=${userId}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.ok && ['creator', 'administrator', 'member'].includes(data.result?.status);
  } catch (err) {
    return false;
  }
}

async function fetchTelegramAvatar(userId) {
  if (!userId || userId === 'demo_dev_local') return null;
  try {
    const photosUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${userId}&limit=1`;
    const resPhotos = await fetch(photosUrl);
    const dataPhotos = await resPhotos.json();
    if (!dataPhotos.ok || !dataPhotos.result || dataPhotos.result.total_count === 0) return null;
    
    const fileId = dataPhotos.result.photos[0][0].file_id; 
    const fileUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`;
    const resFile = await fetch(fileUrl);
    const dataFile = await resFile.json();
    if (!dataFile.ok || !dataFile.result?.file_path) return null;
    
    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${dataFile.result.file_path}`;
  } catch (err) {
    return null;
  }
}

const userSchema = new mongoose.Schema({
  userId:               { type: String, unique: true, required: true },
  username:             { type: String, default: 'User' },
  firstName:            { type: String, default: '' },
  lastName:             { type: String, default: '' },
  avatarUrl:            { type: String, default: '' },
  balance:              { type: Number, default: 0 },
  totalEarned:          { type: Number, default: 0 },
  level:                { type: Number, default: 1 },
  xp:                   { type: Number, default: 0 },
  autoMode:             { type: Boolean, default: false },
  doubleIncome:         { type: Boolean, default: false },
  doubleIncomeExpires:  { type: Date,    default: null },
  referralCode:         { type: String, unique: true, sparse: true },
  referredBy:           { type: String, default: null },
  referrals:            [{ type: String }],
  completedTasks:       [{ type: String }],
  lastClickTime:        { type: Date, default: Date.now },
  passiveIncome:        { type: Number, default: BASE_PASSIVE },
  adBlocksData: [{
    id:        Number,
    views:     { type: Number, default: 0 },
    nextReset: { type: Date, default: null },
    lastAdTime:{ type: Date, default: null }
  }],
  withdrawals: [{
    amount:         { type: Number, required: true },
    walletAddress:  { type: String, required: true },
    status:         { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    createdAt:      { type: Date, default: Date.now }
  }]
}, { versionKey: false });

const User = mongoose.model('User', userSchema);

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public'));

app.post('/api/user', async (req, res) => {
  try {
    const { userId, username, firstName, lastName, avatarUrl, referredBy } = req.body;
    let user = await User.findOne({ userId });
    
    // Пытаемся взять аватарку из WebApp, если нет — дёргаем бота напрямую
    let finalAvatar = avatarUrl || await fetchTelegramAvatar(userId) || `https://i.pravatar.cc/100?u=${userId}`;

    if (!user) {
      const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const initialAdBlocks = AD_BLOCKS_CONFIG.map(b => ({ id: b.id, views: 0, nextReset: null, lastAdTime: null }));

      user = new User({
        userId,
        username: username || firstName || 'User',
        firstName: firstName || '',
        lastName:  lastName  || '',
        avatarUrl: finalAvatar,
        referralCode,
        referredBy: referredBy || null,
        adBlocksData: initialAdBlocks
      });
      await user.save();
    } else {
      // Принудительно чиним поля, если они поломаны в старой базе
      let updated = false;
      if (!user.adBlocksData || user.adBlocksData.length === 0) {
        user.adBlocksData = AD_BLOCKS_CONFIG.map(b => ({ id: b.id, views: 0, nextReset: null, lastAdTime: null }));
        updated = true;
      }
      if (finalAvatar && user.avatarUrl !== finalAvatar && !user.avatarUrl.includes('pravatar')) {
        user.avatarUrl = finalAvatar;
        updated = true;
      }
      if (updated) await user.save();
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/click', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let reward = user.passiveIncome || BASE_PASSIVE;
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
      user.balance      += LEVEL_UP_BONUS_BASE * user.level;
      xpNeeded           = getXpNeeded(user.level);
    }

    await user.save();
    res.json({ success: true, reward, balance: user.balance, level: user.level, xp: user.xp });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/watch-ad', async (req, res) => {
  try {
    const { userId, blockId } = req.body;
    const bId = Number(blockId);
    const config = AD_BLOCKS_CONFIG.find(c => c.id === bId);
    if (!config) return res.status(400).json({ error: 'Unknown block' });

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
      return res.json({ success: false, message: 'Лимит исчерпан!' });
    }

    let reward = config.baseReward;
    if (isDoubleActive(user)) reward *= 2;

    block.views += 1;
    block.lastAdTime = now;

    if (block.views >= config.limit) {
      block.nextReset = new Date(now.getTime() + config.cooldownHours * 60 * 60 * 1000);
    }

    user.balance += reward;
    user.totalEarned += reward;
    await user.save();

    res.json({ success: true, reward, balance: user.balance, adBlocksData: user.adBlocksData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/leaderboard', async (req, res) => {
  const list = await User.find().sort({ totalEarned: -1 }).limit(50).select('username avatarUrl totalEarned level').lean();
  res.json(list);
});

app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, walletAddress } = req.body;
  const user = await User.findOne({ userId });
  if (!user || user.balance < amount || amount < MIN_WITHDRAW) return res.json({ success: false });

  user.balance -= Number(amount);
  user.withdrawals.push({ amount: Number(amount), walletAddress, status: 'pending' });
  await user.save();
  res.json({ success: true, balance: user.balance });
});

mongoose.connect(MONGODB_URI).then(() => app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`)));
