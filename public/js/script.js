'use strict';

const API_URL     = 'https://manjorootest1-production.up.railway.app';
const BOT_USERNAME = 'ManjorooTestBot';
const MIN_WITHDRAW = 5;

const tg = window.Telegram?.WebApp ?? null;
let currentUser        = null;
let isClickPending     = false;

const AD_BLOCKS_CONFIG = [
  { id: 1, baseReward: 0.002, limit: 10, cooldownHours: 2 },
  { id: 2, baseReward: 0.003, limit: 5,  cooldownHours: 4 },
  { id: 3, baseReward: 0.005, limit: 3,  cooldownHours: 6 }
];

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

async function apiCall(endpoint, data = {}) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    return await res.json();
  } catch (err) {
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
    referredBy: tg?.initDataUnsafe?.start_param || null,
  });
  if (result && !result.error) {
    currentUser = result;
    updateUI();
    generateCards(); // Генерируем карточки рекламы на основе данных юзера
    
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

// РЕКЛАМА: Интеграция вызова плеера GigaPub при клике на блок рекламы
function watchAdBlock(blockId) {
  if (!currentUser) return;
  
  const config = AD_BLOCKS_CONFIG.find(c => c.id === blockId);
  const blockData = currentUser.adBlocksData?.find(b => b.id === blockId) || { views: 0, nextReset: null };

  if (blockData.nextReset && new Date() < new Date(blockData.nextReset)) {
    tgAlert("⏳ Лимит этого блока исчерпан! Посмотрите другие блоки или зайдите позже.");
    return;
  }

  // Проверяем наличие рекламного SDK GigaPub
  if (typeof window.showGigapubVideoAd !== 'function') {
    tgAlert("⏳ Реклама временно подгружается, попробуйте еще раз через секунду.");
    return;
  }

  // Вызываем нативное окно плеера рекламы
  window.showGigapubVideoAd({
    onClose: async function(success) {
      if (success) {
        // Реклама досмотрена до конца — шлем запрос бэкенду на деньги
        const res = await apiCall('/api/watch-ad', { userId: currentUser.userId, blockId: blockId });
        if (res?.success) {
          currentUser.balance = res.balance;
          currentUser.adBlocksData = res.adBlocksData;
          updateUI();
          generateCards(); // Перерисовываем карточки, обновляя прогресс-бары
          tgAlert(`🎬 Реклама просмотрена! Начислено: +${formatMoney(res.reward)}`);
        } else if (res) {
          tgAlert(res.message);
        }
      } else {
        tgAlert("❌ Вы закрыли рекламу слишком рано! Награда не начислена.");
      }
    }
  });
}

// РЕКЛАМА: Генерация динамических рекламных карточек с прогресс-барами
function generateCards() {
  const container = document.getElementById('cards');
  if (!container) return;
  container.innerHTML = '';

  AD_BLOCKS_CONFIG.forEach((c) => {
    const blockData = currentUser?.adBlocksData?.find(b => b.id === c.id) || { views: 0, nextReset: null };
    
    let progressPercent = (blockData.views / c.limit) * 100;
    let titleStatus = `Посмотрено: ${blockData.views}/${c.limit}`;
    let isLocked = false;

    if (blockData.nextReset && new Date() < new Date(blockData.nextReset)) {
      isLocked = true;
      const diffMs = new Date(blockData.nextReset) - new Date();
      const diffMins = Math.ceil(diffMs / 60000);
      titleStatus = `Блок заблокирован на ${diffMins} мин.`;
      progressPercent = 100;
    }

    const div = document.createElement('div');
    div.className = 'card';
    div.style.cursor = 'pointer';
    if (isLocked) div.style.opacity = '0.5';

    let currentReward = c.baseReward;
    if (currentUser && isDoubleActive(currentUser)) currentReward *= 2;

    div.innerHTML = `
      <div class="card-title">
        <span>🔥 Рекламный блок ${c.id}</span>
        <span style="color:#4ade80">+${formatMoney(currentReward)}</span>
      </div>
      <div class="stats">
        <span>${titleStatus}</span>
      </div>
      <div class="small-bar">
        <div class="small-fill" style="width:${progressPercent}%; background: ${isLocked ? '#ef4444' : '#2AABEE'}"></div>
      </div>
    `;

    div.addEventListener('click', () => watchAdBlock(c.id));
    container.appendChild(div);
  });
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

async function withdraw() {
  if (!currentUser) return;
  if (currentUser.balance < MIN_WITHDRAW) {
    tgAlert(`❌ Минимальная сумма вывода $${MIN_WITHDRAW}`);
    return;
  }

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

  await initUser();
}

init();
