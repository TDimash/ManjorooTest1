'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
const API_URL     = 'https://manjorootest1-production.up.railway.app';
const BOT_USERNAME = 'ManjorooTestBot';
const MIN_WITHDRAW = 5;

// ─── State ────────────────────────────────────────────────────────────────────
const tg = window.Telegram?.WebApp ?? null;
let currentUser        = null;
let autoCollectInterval = null;
let isClickPending     = false;

// ─── Telegram WebApp Init ─────────────────────────────────────────────────────
if (tg) {
  try {
    tg.expand();
    tg.enableClosingConfirmation();
  } catch (e) {
    console.error('[tg] init error:', e);
  }
} else {
  console.warn('[tg] Telegram WebApp SDK not available');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getXpNeeded      = (level) => 100 + (level - 1) * 50;
const getNextLevelReward = (level) => 0.001 + level * 0.0008;
const formatMoney      = (value)  => `$${Number(value).toFixed(4)}`;

function isDoubleActive(user) {
  return user.doubleIncome &&
    (!user.doubleIncomeExpires || new Date(user.doubleIncomeExpires) > new Date());
}

function tgAlert(msg) {
  if (tg?.showAlert) tg.showAlert(msg);
  else alert(msg);
}

// ─── Error Toast ──────────────────────────────────────────────────────────────
function showError(message) {
  if (document.querySelector('.twa-error-toast')) return;
  const div = document.createElement('div');
  div.className = 'twa-error-toast';
  div.textContent = message;
  div.style.cssText = `
    position:fixed;bottom:100px;left:20px;right:20px;
    background:#ef4444;color:#fff;padding:10px;
    border-radius:10px;text-align:center;z-index:1000;
  `;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── Telegram User ────────────────────────────────────────────────────────────
function getTelegramUser() {
  try {
    const user = tg?.initDataUnsafe?.user;
    if (user?.id) {
      return {
        userId:    String(user.id),
        username:  user.username || `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`,
        firstName: user.first_name  || '',
        lastName:  user.last_name   || '',
        avatarUrl: user.photo_url   || `https://i.pravatar.cc/100?u=${user.id}`,
      };
    }
  } catch (e) {
    console.error('[tg] getTelegramUser:', e);
  }

  const DEMO_ID = 'demo_dev_local';
  console.warn('[tg] No Telegram user — using fixed demo ID:', DEMO_ID);
  return {
    userId:    DEMO_ID,
    username:  'Demo User',
    firstName: 'Demo',
    lastName:  'User',
    avatarUrl: 'https://i.pravatar.cc/100?u=demo',
  };
}

function getReferralCode() {
  const startParam = tg?.initDataUnsafe?.start_param;
  if (startParam) return startParam;
  return new URLSearchParams(window.location.search).get('ref') || null;
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function apiCall(endpoint, data = {}) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`[api] POST ${endpoint}:`, err);
    showError(`Ошибка соединения: ${err.message}`);
    return null;
  }
}

async function apiGet(endpoint) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`[api] GET ${endpoint}:`, err);
    return null;
  }
}

// ─── User Init ────────────────────────────────────────────────────────────────
async function initUser() {
  const telegramUser = getTelegramUser();
  const referralCode = getReferralCode();

  const result = await apiCall('/api/user', {
    userId:    telegramUser.userId,
    username:  telegramUser.username,
    firstName: telegramUser.firstName,
    lastName:  telegramUser.lastName,
    avatarUrl: telegramUser.avatarUrl,
    referredBy: referralCode,
  });

  if (result && !result.error) {
    currentUser = result;
    updateUI();
    startAutoCollect();
    return true;
  }

  showError('Не удалось загрузить пользователя');
  return false;
}

// ─── UI Update ────────────────────────────────────────────────────────────────
function updateUI() {
  if (!currentUser) return;

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('username', currentUser.username || 'User');
  setText('userid',   `ID: ${String(currentUser.userId).slice(-6)}`);

  const avatarEl = document.getElementById('avatar');
  if (avatarEl) {
    avatarEl.src = /^https:\/\//.test(currentUser.avatarUrl)
      ? currentUser.avatarUrl
      : `https://i.pravatar.cc/100?u=${currentUser.userId}`;
  }

  const balanceFormatted = formatMoney(currentUser.balance);
  setText('balance',      balanceFormatted);
  setText('balanceTop',   balanceFormatted);
  setText('walletBalance', balanceFormatted);

  const xpNeeded = getXpNeeded(currentUser.level);
  setText('level', `Level ${currentUser.level} • ${currentUser.xp}/${xpNeeded}`);

  const fillEl = document.getElementById('xpFill');
  if (fillEl) fillEl.style.width = `${Math.min((currentUser.xp / xpNeeded) * 100, 100)}%`;

  setText('nextRewardValue', `+${formatMoney(getNextLevelReward(currentUser.level))}`);

  const autoBtn = document.getElementById('autoBtn');
  if (autoBtn) {
    autoBtn.textContent       = currentUser.autoMode ? 'AUTO OFF' : 'AUTO ON';
    autoBtn.style.background  = currentUser.autoMode ? '#ef4444' : '#2AABEE';
  }

  if (isDoubleActive(currentUser)) {
    const boostBtn = document.getElementById('boostDoubleBtn');
    if (boostBtn) {
      boostBtn.textContent      = 'ACTIVE ✓';
      boostBtn.disabled         = true;
      boostBtn.style.background = '#4ade80';
    }
  }

  const referralCountEl = document.getElementById('referralCount');
  if (referralCountEl && Array.isArray(currentUser.referrals)) {
    referralCountEl.textContent = `Приглашено друзей: ${currentUser.referrals.length}`;
  }

  if (Array.isArray(currentUser.completedTasks)) {
    currentUser.completedTasks.forEach((taskId) => {
      const btn = document.querySelector(`.task-btn[data-task="${taskId}"]`);
      if (btn) {
        btn.disabled    = true;
        btn.textContent = '✓ Выполнено';
      }
    });
  }
}

// ─── Click ────────────────────────────────────────────────────────────────────
async function handleClick() {
  if (isClickPending || !currentUser) return;
  isClickPending = true;

  try {
    const result = await apiCall('/api/click', { userId: currentUser.userId });
    if (result?.success) {
      currentUser.balance      = result.balance;
      currentUser.level        = result.level;
      currentUser.xp           = result.xp;
      currentUser.passiveIncome = result.passiveIncome;
      updateUI();
      showClickAnimation(result.reward);
    }
  } finally {
    isClickPending = false;
  }
}

function showClickAnimation(reward) {
  const balanceEl = document.getElementById('balance');
  if (!balanceEl) return;

  const rect = balanceEl.getBoundingClientRect();
  const el   = document.createElement('div');
  el.textContent = `+${formatMoney(reward)}`;
  el.style.cssText = `
    position:fixed;
    left:${rect.left + rect.width / 2}px;
    top:${rect.top}px;
    color:#4ade80;font-size:20px;font-weight:bold;
    pointer-events:none;z-index:1000;
    transition:all 1s ease-out;opacity:1;
    transform:translate(-50%,0);
  `;
  document.body.appendChild(el);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = 'translate(-50%,-50px)';
    el.style.opacity   = '0';
    setTimeout(() => el.remove(), 1000);
  }));
}

// ─── Auto Collect ─────────────────────────────────────────────────────────────
async function collectAutoIncome() {
  if (!currentUser?.autoMode) return;
  const result = await apiCall('/api/auto-collect', { userId: currentUser.userId });
  if (result?.success && result.earnings > 0) {
    currentUser.balance = result.balance;
    updateUI();
  }
}

function startAutoCollect() {
  if (autoCollectInterval) clearInterval(autoCollectInterval);
  autoCollectInterval = setInterval(collectAutoIncome, 5000);
}

// ─── Toggle Auto ──────────────────────────────────────────────────────────────
async function toggleAutoMode() {
  if (!currentUser) return;
  const result = await apiCall('/api/toggle-auto', { userId: currentUser.userId });
  if (result) {
    currentUser.autoMode = result.autoMode;
    updateUI();
  }
}

// ─── Referral & Share ─────────────────────────────────────────────────────────
function generateReferralLink() {
  if (!currentUser?.referralCode) return '';
  return `https://t.me/${BOT_USERNAME}?start=${currentUser.referralCode}`;
}

async function shareReferral() {
  const link = generateReferralLink();
  if (!link) return;

  if (tg?.openTelegramLink) {
    const text = encodeURIComponent(`Присоединяйся к Duck Ads и зарабатывай! 🚀`);
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
    return;
  }

  try {
    await navigator.clipboard.writeText(link);
    tgAlert('Ссылка скопирована!');
  } catch {
    tgAlert(`Ваша ссылка: ${link}`);
  }
}

// ─── Buy Double Boost ─────────────────────────────────────────────────────────
async function buyDoubleBoost() {
  if (!currentUser) return;
  const result = await apiCall('/api/buy-double', { userId: currentUser.userId });
  if (result?.success) {
    currentUser.balance             = result.balance;
    currentUser.doubleIncome        = result.doubleIncomeActive;
    currentUser.doubleIncomeExpires = result.expiresAt;
    updateUI();
    tgAlert('✅ Удвоение дохода активировано на 24 часа!');
  } else if (result && !result.success) {
    tgAlert('❌ Недостаточно средств! Нужно $5000.0000');
  }
}

// ─── Задания (Tasks) с реальной логикой подписки и шаринга ────────────────────
async function handleTaskClick(btn) {
  const taskId = btn.getAttribute('data-task');
  if (!currentUser || !taskId) return;

  // 1. Сценарий: ПОДПИСКА НА КАНАЛ
  if (taskId === 'subscribe') {
    // Сначала перекидываем юзера в канал
    if (tg?.openTelegramLink) {
      tg.openTelegramLink('https://t.me/TestChanneeellll');
    } else {
      window.open('https://t.me/TestChanneeellll', '_blank');
    }

    // Показываем подтверждение, давая пользователю время подписаться
    setTimeout(async () => {
      const result = await apiCall('/api/complete-task', { userId: currentUser.userId, taskId });
      if (result?.success) {
        currentUser.balance        = result.balance;
        currentUser.completedTasks = result.completedTasks;
        updateUI();
        tgAlert(`✅ Успешно! Награда за подписку получена: +${formatMoney(result.reward)}`);
      } else if (result) {
        tgAlert(result.message || 'Ошибка проверки подписки.');
      }
    }, 2000);
  } 
  
  // 2. Сценарий: ПОДЕЛИТЬСЯ С ДРУГОМ
  else if (taskId === 'share') {
    const link = generateReferralLink();
    if (tg?.openTelegramLink) {
      const text = encodeURIComponent(`Смотри, какую игру нашел! Кликай и зарабатывай 💰`);
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
    } else {
      try { await navigator.clipboard.writeText(link); } catch(e){}
    }

    // За шаринг даем награду сразу через секунду
    setTimeout(async () => {
      const result = await apiCall('/api/complete-task', { userId: currentUser.userId, taskId });
      if (result?.success) {
        currentUser.balance        = result.balance;
        currentUser.completedTasks = result.completedTasks;
        updateUI();
        tgAlert(`✅ Задание выполнено! Награда начислена: +${formatMoney(result.reward)}`);
      }
    }, 1500);
  }
}

// ─── Withdraw ─────────────────────────────────────────────────────────────────
async function withdraw() {
  if (!currentUser) return;
  if (currentUser.balance < MIN_WITHDRAW) {
    tgAlert(`❌ Минимальная сумма вывода $${MIN_WITHDRAW}`);
    return;
  }
  const result = await apiCall('/api/withdraw', {
    userId:        currentUser.userId,
    amount:        currentUser.balance,
    walletAddress: 'user_wallet',
  });
  if (result?.success) {
    currentUser.balance = result.balance;
    updateUI();
    tgAlert('✅ Заявка на вывод отправлена!');
  }
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
async function loadLeaderboard() {
  const container = document.getElementById('leaderboardContent');
  if (!container) return;

  container.textContent = 'Загрузка...';
  const leaderboard = await apiGet('/api/leaderboard');

  if (!leaderboard?.length) {
    container.textContent = 'Нет данных';
    return;
  }

  const fragment = document.createDocumentFragment();
  leaderboard.forEach((user, index) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)';

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;gap:10px;align-items:center';

    const rank = document.createElement('span');
    rank.style.cssText = 'font-weight:700;width:25px';
    rank.textContent = String(index + 1);

    const img = document.createElement('img');
    img.src = /^https:\/\//.test(user.avatarUrl) ? user.avatarUrl : `https://i.pravatar.cc/100?u=${user.userId}`;
    img.style.cssText = 'width:30px;height:30px;border-radius:50%';
    img.alt = '';

    const name = document.createElement('span');
    name.textContent = user.username || 'User';

    left.append(rank, img, name);

    const right = document.createElement('div');
    const earned = document.createElement('span');
    earned.style.color = '#4ade80';
    earned.textContent = formatMoney(user.totalEarned);

    const lvl = document.createElement('span');
    lvl.style.cssText = 'font-size:10px;color:#8EA2B1;margin-left:5px';
    lvl.textContent = `Lvl ${user.level}`;

    right.append(earned, lvl);
    row.append(left, right);
    fragment.appendChild(row);
  });

  container.textContent = '';
  container.appendChild(fragment);
}

// ─── Ad Cards ─────────────────────────────────────────────────────────────────
function generateCards() {
  const container = document.getElementById('cards');
  if (!container) return;

  const adCards = [
    { title: '🔥 Рекламный блок 1', income: 0.002, progress: 45 },
    { title: '⚡ Рекламный блок 2', income: 0.003, progress: 23 },
    { title: '💎 Рекламный блок 3', income: 0.005, progress: 67 },
  ];

  const fragment = document.createDocumentFragment();
  adCards.forEach((card) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.cursor = 'pointer';

    const titleRow = document.createElement('div');
    titleRow.className = 'card-title';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = card.title;

    const incomeSpan = document.createElement('span');
    incomeSpan.style.color = '#4ade80';
    incomeSpan.textContent = formatMoney(card.income);

    titleRow.append(titleSpan, incomeSpan);

    const bar = document.createElement('div');
    bar.className = 'small-bar';
    const fill = document.createElement('div');
    fill.className = 'small-fill';
    fill.style.width = `${card.progress}%`;
    bar.appendChild(fill);

    div.append(titleRow, bar);
    div.addEventListener('click', handleClick);
    fragment.appendChild(div);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const pages    = document.querySelectorAll('.page');

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const pageId = item.getAttribute('data-page');
      navItems.forEach((n) => n.classList.remove('active'));
      item.classList.add('active');
      pages.forEach((p) => p.classList.remove('active'));
      const target = document.getElementById(pageId);
      if (target) target.classList.add('active');
      if (pageId === 'friends') loadLeaderboard();
    });
  });
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('balance')       ?.addEventListener('click', handleClick);
  document.getElementById('autoBtn')       ?.addEventListener('click', toggleAutoMode);
  document.getElementById('inviteBtn')     ?.addEventListener('click', shareReferral);
  document.getElementById('boostDoubleBtn')?.addEventListener('click', buyDoubleBoost);
  document.getElementById('withdrawBtn')   ?.addEventListener('click', withdraw);

  document.querySelectorAll('.task-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleTaskClick(btn));
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  setupNavigation();
  generateCards();

  fetch(`${API_URL}/health`)
    .then((r) => { if (!r.ok) console.error('[health] status:', r.status); })
    .catch((e) => {
      console.error('[health] server unreachable:', e);
      showError('Сервер недоступен. Проверьте соединение.');
    });

  const success = await initUser();
  if (success) {
    setupEventListeners();
  }
}

init();
