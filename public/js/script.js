'use strict';

const API_URL     = 'https://manjorootest1-production.up.railway.app';
const BOT_USERNAME = 'ManjorooTestBot';
const MIN_WITHDRAW = 5;

const tg = window.Telegram?.WebApp ?? null;
let currentUser        = null;
let autoCollectInterval = null;
let isClickPending     = false;

if (tg) {
  try { tg.expand(); tg.enableClosingConfirmation(); } catch (e) {}
}

const getXpNeeded      = (level) => 100 + (level - 1) * 50;
const getNextLevelReward = (level) => 0.001 + level * 0.0008;
const formatMoney      = (value)  => `$${Number(value).toFixed(4)}`;

function isDoubleActive(user) {
  return user.doubleIncome && (!user.doubleIncomeExpires || new Date(user.doubleIncomeExpires) > new Date());
}

function tgAlert(msg) {
  if (tg?.showAlert) tg.showAlert(msg);
  else alert(msg);
}

function showError(message) {
  if (document.querySelector('.twa-error-toast')) return;
  const div = document.createElement('div');
  div.className = 'twa-error-toast';
  div.textContent = message;
  div.style.cssText = 'position:fixed;bottom:100px;left:20px;right:20px;background:#ef4444;color:#fff;padding:10px;border-radius:10px;text-align:center;z-index:1000;';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

function getTelegramUser() {
  try {
    const user = tg?.initDataUnsafe?.user;
    if (user?.id) {
      return {
        userId:    String(user.id),
        username:  user.username || `${user.first_name}`,
        firstName: user.first_name  || '',
        lastName:  user.last_name   || '',
        avatarUrl: user.photo_url   || `https://i.pravatar.cc/100?u=${user.id}`,
      };
    }
  } catch (e) {}
  return { userId: 'demo_dev_local', username: 'Demo User', firstName: 'Demo', lastName: 'User', avatarUrl: 'https://i.pravatar.cc/100?u=demo' };
}

function getReferralCode() {
  return tg?.initDataUnsafe?.start_param || new URLSearchParams(window.location.search).get('ref') || null;
}

async function apiCall(endpoint, data = {}) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    return await res.json();
  } catch (err) {
    showError('Ошибка соединения');
    return null;
  }
}

async function initUser() {
  const telegramUser = getTelegramUser();
  const result = await apiCall('/api/user', {
    userId: telegramUser.userId,
    username: telegramUser.username,
    firstName: telegramUser.firstName,
    lastName: telegramUser.lastName,
    avatarUrl: telegramUser.avatarUrl,
    referredBy: getReferralCode(),
  });
  if (result && !result.error) {
    currentUser = result;
    updateUI();
    if (currentUser.autoMode) setInterval(async () => {
      const r = await apiCall('/api/auto-collect', { userId: currentUser.userId });
      if (r?.success && r.earnings > 0) { currentUser.balance = r.balance; updateUI(); }
    }, 5000);
    return true;
  }
  return false;
}

function updateUI() {
  if (!currentUser) return;
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  
  const balanceFormatted = formatMoney(currentUser.balance);
  setText('username', currentUser.username);
  setText('userid', `ID: ${String(currentUser.userId).slice(-6)}`);
  setText('balance', balanceFormatted);
  setText('balanceTop', balanceFormatted);
  setText('walletBalance', balanceFormatted);

  const xpNeeded = getXpNeeded(currentUser.level);
  setText('level', `Level ${currentUser.level} • ${currentUser.xp}/${xpNeeded}`);
  const fillEl = document.getElementById('xpFill');
  if (fillEl) fillEl.style.width = `${Math.min((currentUser.xp / xpNeeded) * 100, 100)}%`;
  setText('nextRewardValue', `+${formatMoney(getNextLevelReward(currentUser.level))}`);

  const autoBtn = document.getElementById('autoBtn');
  if (autoBtn) {
    autoBtn.textContent = currentUser.autoMode ? 'AUTO OFF' : 'AUTO ON';
    autoBtn.style.background = currentUser.autoMode ? '#ef4444' : '#2AABEE';
  }
  
  if (isDoubleActive(currentUser)) {
    const b = document.getElementById('boostDoubleBtn');
    if (b) { b.textContent = 'ACTIVE ✓'; b.disabled = true; b.style.background = '#4ade80'; }
  }
  const refCount = document.getElementById('referralCount');
  if (refCount && currentUser.referrals) refCount.textContent = `Приглашено друзей: ${currentUser.referrals.length}`;

  if (currentUser.completedTasks) {
    currentUser.completedTasks.forEach((id) => {
      const btn = document.querySelector(`.task-btn[data-task="${id}"]`);
      if (btn) { btn.disabled = true; btn.textContent = '✓ Выполнено'; }
    });
  }
}

async function handleClick() {
  if (isClickPending || !currentUser) return;
  isClickPending = true;
  try {
    const r = await apiCall('/api/click', { userId: currentUser.userId });
    if (r?.success) {
      currentUser.balance = r.balance; currentUser.level = r.level; currentUser.xp = r.xp; currentUser.passiveIncome = r.passiveIncome;
      updateUI();
      const b = document.getElementById('balance');
      if (b) {
        const rect = b.getBoundingClientRect();
        const el = document.createElement('div');
        el.textContent = `+${formatMoney(r.reward)}`;
        el.style.cssText = `position:fixed;left:${rect.left + rect.width/2}px;top:${rect.top}px;color:#4ade80;font-size:20px;font-weight:bold;transition:all 1s ease-out;opacity:1;transform:translate(-50%,0);`;
        document.body.appendChild(el);
        requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transform = 'translate(-50%,-50px)'; el.style.opacity = '0'; setTimeout(() => el.remove(), 1000); }));
      }
    }
  } finally { isClickPending = false; }
}

async function handleTaskClick(btn) {
  const taskId = btn.getAttribute('data-task');
  if (!currentUser || !taskId) return;

  if (taskId === 'subscribe') {
    if (tg?.openTelegramLink) tg.openTelegramLink('https://t.me/TestChanneeellll');
    else window.open('https://t.me/TestChanneeellll', '_blank');

    setTimeout(async () => {
      const r = await apiCall('/api/complete-task', { userId: currentUser.userId, taskId });
      if (r?.success) { currentUser.balance = r.balance; currentUser.completedTasks = r.completedTasks; updateUI(); tgAlert(`✅ +${formatMoney(r.reward)}`); }
      else if (r) tgAlert(r.message);
    }, 2000);
  } else if (taskId === 'share') {
    const link = `https://t.me/${BOT_USERNAME}?start=${currentUser.referralCode}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Кликай и зарабатывай! 🚀')}`);
    setTimeout(async () => {
      const r = await apiCall('/api/complete-task', { userId: currentUser.userId, taskId });
      if (r?.success) { currentUser.balance = r.balance; currentUser.completedTasks = r.completedTasks; updateUI(); tgAlert(`✅ +${formatMoney(r.reward)}`); }
    }, 1500);
  }
}

// ФУНКЦИЯ ВЫВОДА СРЕДСТВ ИЗМЕНЕНА: Запрашивает кошелек перед созданием заявки
async function withdraw() {
  if (!currentUser) return;
  if (currentUser.balance < MIN_WITHDRAW) {
    tgAlert(`❌ Минимальная сумма вывода $${MIN_WITHDRAW}`);
    return;
  }

  // Спрашиваем адрес кошелька у пользователя
  const wallet = prompt("Введите адрес вашего TON/USDT кошелька для вывода:");
  if (!wallet || wallet.trim() === "") {
    tgAlert("❌ Вывод отменен: необходимо указать кошелек.");
    return;
  }

  const result = await apiCall('/api/withdraw', {
    userId:        currentUser.userId,
    amount:        currentUser.balance, 
    walletAddress: wallet.trim(),
  });

  if (result?.success) {
    currentUser.balance = result.balance;
    updateUI();
    tgAlert('✅ Заявка создана! Деньги заморожены и будут выплачены после проверки администратором.');
  } else if (result) {
    tgAlert(result.message || 'Ошибка создания заявки');
  }
}

function generateCards() {
  const container = document.getElementById('cards');
  if (!container) return;
  const cards = [{ title: '🔥 Рекламный блок 1', income: 0.002, progress: 45 }, { title: '⚡ Рекламный блок 2', income: 0.003, progress: 23 }, { title: '💎 Рекламный блок 3', income: 0.005, progress: 67 }];
  container.innerHTML = '';
  cards.forEach((c) => {
    const div = document.createElement('div'); div.className = 'card'; div.style.cursor = 'pointer';
    div.innerHTML = `<div class="card-title"><span>${c.title}</span><span style="color:#4ade80">${formatMoney(c.income)}</span></div><div class="small-bar"><div class="small-fill" style="width:${c.progress}%"></div></div>`;
    div.addEventListener('click', handleClick); container.appendChild(div);
  });
}

async function init() {
  document.getElementById('balance')?.addEventListener('click', handleClick);
  document.getElementById('autoBtn')?.addEventListener('click', async () => {
    const r = await apiCall('/api/toggle-auto', { userId: currentUser.userId });
    if (r) { currentUser.autoMode = r.autoMode; updateUI(); }
  });
  document.getElementById('inviteBtn')?.addEventListener('click', () => {
    const link = `https://t.me/${BOT_USERNAME}?start=${currentUser.referralCode}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(' Duck Ads!')}`);
  });
  document.getElementById('boostDoubleBtn')?.addEventListener('click', async () => {
    const r = await apiCall('/api/buy-double', { userId: currentUser.userId });
    if (r?.success) { currentUser.balance = r.balance; currentUser.doubleIncome = r.doubleIncomeActive; currentUser.doubleIncomeExpires = r.expiresAt; updateUI(); tgAlert('✅ Активировано!'); }
  });
  document.getElementById('withdrawBtn')?.addEventListener('click', withdraw);
  document.querySelectorAll('.task-btn').forEach((b) => b.addEventListener('click', () => handleTaskClick(b)));
  
  const nav = document.querySelectorAll('.nav-item'), pages = document.querySelectorAll('.page');
  nav.forEach((n) => n.addEventListener('click', async () => {
    const id = n.getAttribute('data-page');
    nav.forEach((i) => i.classList.remove('active')); n.classList.add('active');
    pages.forEach((p) => p.classList.remove('active')); const target = document.getElementById(id); if (target) target.classList.add('active');
    if (id === 'friends') {
      const c = document.getElementById('leaderboardContent'); if (c) {
        c.textContent = 'Загрузка...'; const res = await fetch(`${API_URL}/api/leaderboard`); const list = await res.json(); c.textContent = '';
        list.forEach((u, i) => {
          const r = document.createElement('div'); r.style.cssText = 'display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)';
          r.innerHTML = `<div style="display:flex;gap:10px;align-items:center"><span style="font-weight:700;width:25px">${i+1}</span><img src="${u.avatarUrl}" style="width:30px;height:30px;border-radius:50%"/><span>${u.username}</span></div><div><span style="color:#4ade80">${formatMoney(u.totalEarned)}</span><span style="font-size:10px;color:#8EA2B1;margin-left:5px">Lvl ${u.level}</span></div>`;
          c.appendChild(r);
        });
      }
    }
  }));

  generateCards();
  await initUser();
}

init();
