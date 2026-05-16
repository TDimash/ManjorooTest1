// js/script.js — Full Original Logic with Fixes
'use strict';

const API_URL = 'https://manjorootest1-production.up.railway.app';
const BOT_USERNAME = 'ManjorooTestBot';
const MIN_WITHDRAW = 5;

let tg = window.Telegram?.WebApp ?? null;
let currentUser = null;
let autoCollectInterval = null;
let autoWatchInterval = null;
let isWatchingAd = false;

if (tg) {
  try {
    tg.expand();
    tg.enableClosingConfirmation();
  } catch (e) {
    console.error('[tg] init error:', e);
  }
}

const getXpNeeded = (level) => 100 + (level - 1) * 50;
const formatMoney = (value) => `$${Number(value).toFixed(4)}`;

function tgAlert(msg) {
  if (tg?.showAlert) tg.showAlert(msg);
  else alert(msg);
}

// Корректное извлечение аватарки прямо из Telegram WebApp
function getTelegramUser() {
  let user = tg?.initDataUnsafe?.user;
  if (user?.id) {
    return {
      userId: String(user.id),
      username: user.username || `${user.first_name}`,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      // Забираем оригинальный photo_url, если Telegram его отдал
      avatarUrl: user.photo_url || '' 
    };
  }
  return { userId: 'demo_dev_local', username: 'Demo User', firstName: 'Demo', lastName: 'User', avatarUrl: '' };
}

async function apiCall(endpoint, data = {}) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    return null;
  }
}

async function initUser() {
  const tgUser = getTelegramUser();
  const startParam = tg?.initDataUnsafe?.start_param || null;

  const result = await apiCall('/api/user', {
    userId: tgUser.userId,
    username: tgUser.username,
    firstName: tgUser.firstName,
    lastName: tgUser.lastName,
    avatarUrl: tgUser.avatarUrl,
    referredBy: startParam
  });

  if (result && !result.error) {
    currentUser = result;
    updateUI();
    startAutoCollect();
    updateAdBlocksUI();
    startAdTimersUpdate();
    return true;
  }
  return false;
}

function updateUI() {
  if (!currentUser) return;

  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  setText('username', currentUser.username);
  setText('userid', `ID: ${String(currentUser.userId).slice(-6)}`);
  
  const formatted = formatMoney(currentUser.balance);
  setText('balance', formatted);
  setText('balanceTop', formatted);
  setText('walletBalance', formatted);

  // Обновляем аватарку в шапке приложения
  const userAvatarImg = document.getElementById('userAvatar');
  if (userAvatarImg && currentUser.avatarUrl) {
    userAvatarImg.src = currentUser.avatarUrl;
  }

  const xpNeeded = getXpNeeded(currentUser.level);
  setText('level', `Level ${currentUser.level} • ${currentUser.xp}/${xpNeeded}`);
  
  const fill = document.getElementById('xpFill');
  if (fill) fill.style.width = `${Math.min((currentUser.xp / xpNeeded) * 100, 100)}%`;

  const autoBtn = document.getElementById('autoBtn');
  if (autoBtn) {
    autoBtn.textContent = currentUser.autoMode ? '🤖 AUTO ON' : '🤖 AUTO OFF';
    autoBtn.className = currentUser.autoMode ? 'btn auto-active' : 'btn';
  }

  const refCount = document.getElementById('referralCount');
  if (refCount && currentUser.referrals) {
    refCount.textContent = `Приглашено друзей: ${currentUser.referrals.length}`;
  }
}

// Клик по главному балансу
async function handleClick() {
  if (!currentUser) return;
  const res = await apiCall('/api/click', { userId: currentUser.userId });
  if (res && res.success) {
    currentUser.balance = res.balance;
    currentUser.level = res.level;
    currentUser.xp = res.xp;
    updateUI();
  }
}

// Автоматический сбор монет
function startAutoCollect() {
  if (autoCollectInterval) clearInterval(autoCollectInterval);
  autoCollectInterval = setInterval(async () => {
    if (currentUser && currentUser.autoMode) {
      const res = await apiCall('/api/auto-collect', { userId: currentUser.userId, seconds: 5 });
      if (res && res.success && res.earnings > 0) {
        currentUser.balance = res.balance;
        updateUI();
      }
    }
  }, 5000);
}

async function toggleAutoMode() {
  if (!currentUser) return;
  const res = await apiCall('/api/toggle-auto', { userId: currentUser.userId });
  if (res) {
    currentUser.autoMode = res.autoMode;
    updateUI();
  }
}

// ОРИГИНАЛЬНАЯ ИНТЕГРАЦИЯ КНОПОК РЕКЛАМЫ ИЗ ТВОЕГО ФАЙЛА
function updateAdBlocksUI() {
  if (!currentUser || !currentUser.adBlocksData) return;

  currentUser.adBlocksData.forEach(block => {
    const btn = document.querySelector(`.watch-ad-btn[data-block="${block.id}"]`);
    const timerEl = document.getElementById(`ad-timer-${block.id}`);
    if (!btn) return;

    const limits = { 1: 10, 2: 5, 3: 3 };
    const maxViews = limits[block.id] || 5;

    // Ищем контейнер с текстом статистики внутри родительской карточки
    const card = btn.closest('.card');
    if (card) {
      const statsEl = card.querySelector('.stats span:first-child');
      if (statsEl) statsEl.textContent = `Посмотрено: ${block.views}/${maxViews}`;
      
      const smallFill = card.querySelector('.small-fill');
      if (smallFill) smallFill.style.width = `${(block.views / maxViews) * 100}%`;
    }

    if (block.nextReset && new Date() < new Date(block.nextReset)) {
      btn.disabled = true;
      btn.textContent = '⏳ Недоступно';
      if (timerEl) {
        const diff = new Date(block.nextReset) - new Date();
        const mins = Math.ceil(diff / 60000);
        timerEl.textContent = `Доступно через ${mins} мин.`;
        timerEl.style.display = 'block';
      }
    } else {
      btn.disabled = false;
      btn.textContent = '🎬 Смотреть рекламу';
      if (timerEl) timerEl.style.display = 'none';
    }
  });
}

// Запуск оригинального плеера GigaPub при клике на кнопки
async function watchAd(blockId) {
  if (isWatchingAd || !currentUser) return;

  if (typeof window.showGigapubVideoAd !== 'function') {
    tgAlert('⏳ Рекламная сеть загружается, подождите пару секунд...');
    return;
  }

  isWatchingAd = true;

  window.showGigapubVideoAd({
    onClose: async function(status) {
      isWatchingAd = false;
      if (status) {
        const res = await apiCall('/api/watch-ad', { userId: currentUser.userId, blockId });
        if (res && res.success) {
          currentUser.balance = res.balance;
          currentUser.adBlocksData = res.adBlocksData;
          updateUI();
          updateAdBlocksUI();
          tgAlert(`🎬 Реклама успешно просмотрена! +$${res.reward}`);
        } else if (res) {
          tgAlert(res.message || 'Ошибка начисления');
        }
      } else {
        tgAlert('❌ Вы закрыли рекламу раньше времени.');
      }
    }
  });
}

function startAdTimersUpdate() {
  if (autoWatchInterval) clearInterval(autoWatchInterval);
  autoWatchInterval = setInterval(() => {
    updateAdBlocksUI();
  }, 30000);
}

// Вывод средств с ТГ-диалогом адреса кошелька
async function withdraw() {
  if (!currentUser) return;
  if (currentUser.balance < MIN_WITHDRAW) {
    tgAlert(`❌ Минимальная сумма вывода $${MIN_WITHDRAW}`);
    return;
  }

  const wallet = prompt("Введите адрес вашего TON/USDT кошелька для выплаты:");
  if (!wallet || wallet.trim() === "") {
    tgAlert("❌ Вывод отменен: кошелек не указан.");
    return;
  }

  const res = await apiCall('/api/withdraw', {
    userId: currentUser.userId,
    amount: currentUser.balance,
    walletAddress: wallet.trim()
  });

  if (res && res.success) {
    currentUser.balance = res.balance;
    updateUI();
    tgAlert('✅ Заявка успешно отправлена! Деньги заморожены и будут выплачены после проверки админом.');
  } else if (res) {
    tgAlert(res.message || 'Ошибка вывода средств');
  }
}

// Навигация по табам Mini App
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const pages = document.querySelectorAll('.page');

  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      const pageId = item.getAttribute('data-page');
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      pages.forEach(p => p.classList.remove('active'));
      const target = document.getElementById(pageId);
      if (target) target.classList.add('active');

      if (pageId === 'friends') loadLeaderboard();
    });
  });
}

async function loadLeaderboard() {
  const content = document.getElementById('leaderboardContent');
  if (!content) return;
  content.innerHTML = '<div style="text-align:center; padding:20px;">Загрузка топа...</div>';

  try {
    const res = await fetch(`${API_URL}/api/leaderboard`);
    const data = await res.json();
    content.innerHTML = '';

    data.forEach((user, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05);';
      row.innerHTML = `
        <div style="display:flex; gap:10px; align-items:center;">
          <span style="font-weight:700; width:20px;">${idx + 1}</span>
          <img src="${user.avatarUrl}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;" onerror="this.src='https://ui-avatars.com/api/?name=U'"/>
          <span>${user.username}</span>
        </div>
        <div>
          <span style="color:#4ade80; font-weight:600;">${formatMoney(user.totalEarned)}</span>
          <span style="font-size:11px; color:#8EA2B1; margin-left:5px;">Lvl ${user.level}</span>
        </div>
      `;
      content.appendChild(row);
    });
  } catch (e) {
    content.innerHTML = '<div style="text-align:center; padding:20px; color:#ef4444;">Ошибка загрузки</div>';
  }
}

function shareReferral() {
  if (!currentUser) return;
  const link = `https://t.me/${BOT_USERNAME}?start=${currentUser.referralCode}`;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Зарабатывай на просмотре рекламы вместе со мной! 🚀')}`);
  }
}

function initEventListeners() {
  document.getElementById('balance')?.addEventListener('click', handleClick);
  document.getElementById('autoBtn')?.addEventListener('click', toggleAutoMode);
  document.getElementById('inviteBtn')?.addEventListener('click', shareReferral);
  document.getElementById('withdrawBtn')?.addEventListener('click', withdraw);

  // Навешиваем обработчик клика на ТВОИ ОРИГИНАЛЬНЫЕ КНОПКИ РЕКЛАМЫ из разметки HTML
  document.querySelectorAll('.watch-ad-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const blockId = Number(btn.getAttribute('data-block'));
      watchAd(blockId);
    });
  });
}

async function init() {
  setupNavigation();
  initEventListeners();
  await initUser();
}

init();
