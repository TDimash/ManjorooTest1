'use strict';

const API_URL = 'https://manjorootest1-production.up.railway.app';
const MIN_WITHDRAW = 5;

const tg = window.Telegram?.WebApp ?? null;
let currentUser = null;
let isClickPending = false;

const AD_BLOCKS_CONFIG = [
  { id: 1, baseReward: 0.002, limit: 10, cooldownHours: 2 },
  { id: 2, baseReward: 0.003, limit: 5,  cooldownHours: 4 },
  { id: 3, baseReward: 0.005, limit: 3,  cooldownHours: 6 }
];

if (tg) {
  try { tg.expand(); tg.enableClosingConfirmation(); } catch (e) {}
}

const formatMoney = (value) => `$${Number(value).toFixed(4)}`;

function tgAlert(msg) {
  if (tg?.showAlert) tg.showAlert(msg);
  else alert(msg);
}

function getTelegramUser() {
  const user = tg?.initDataUnsafe?.user;
  if (user?.id) {
    return {
      userId: String(user.id),
      username: user.username || `${user.first_name}`,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      avatarUrl: user.photo_url || null // Сервер сам докачает через бота, если тут пусто
    };
  }
  return { userId: 'demo_dev_local', username: 'Demo User', avatarUrl: '' };
}

async function apiCall(endpoint, data = {}) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (err) { return null; }
}

async function initUser() {
  const tgUser = getTelegramUser();
  const result = await apiCall('/api/user', tgUser);
  if (result && !result.error) {
    currentUser = result;
    updateUI();
    generateCards();
    return true;
  }
  return false;
}

function updateUI() {
  if (!currentUser) return;
  
  // Установка аватарки
  const avatarImg = document.getElementById('avatarImg') || document.querySelector('.avatar');
  if (avatarImg && currentUser.avatarUrl) {
    avatarImg.src = currentUser.avatarUrl;
  }

  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const balanceFormatted = formatMoney(currentUser.balance);
  
  setText('username', currentUser.username);
  setText('balance', balanceFormatted);
  setText('balanceTop', balanceFormatted);
  setText('walletBalance', balanceFormatted);
  setText('level', `Level ${currentUser.level}`);
}

function watchAdBlock(blockId) {
  if (!currentUser) return;

  const blockData = currentUser.adBlocksData?.find(b => b.id === blockId) || { views: 0, nextReset: null };
  if (blockData.nextReset && new Date() < new Date(blockData.nextReset)) {
    tgAlert("⏳ Этот рекламный блок временно заблокирован по лимиту таймера.");
    return;
  }

  if (typeof window.showGigapubVideoAd !== 'function') {
    tgAlert("⏳ Рекламная сеть GigaPub загружается, повторите попытку.");
    return;
  }

  // Запуск нативного рекламного плеера GigaPub из оригинального кода
  window.showGigapubVideoAd({
    onClose: async function(success) {
      if (success) {
        const res = await apiCall('/api/watch-ad', { userId: currentUser.userId, blockId });
        if (res?.success) {
          currentUser.balance = res.balance;
          currentUser.adBlocksData = res.adBlocksData;
          updateUI();
          generateCards();
          tgAlert(`🎬 Реклама завершена! Получено: +${formatMoney(res.reward)}`);
        }
      } else {
        tgAlert("❌ Вы закрыли видеоролик раньше времени.");
      }
    }
  });
}

function generateCards() {
  const container = document.getElementById('cards');
  if (!container) return;
  container.innerHTML = '';

  AD_BLOCKS_CONFIG.forEach((c) => {
    const blockData = currentUser?.adBlocksData?.find(b => b.id === c.id) || { views: 0, nextReset: null };
    let progressPercent = (blockData.views / c.limit) * 100;
    let statusText = `Просмотры: ${blockData.views}/${c.limit}`;
    let isLocked = false;

    if (blockData.nextReset && new Date() < new Date(blockData.nextReset)) {
      isLocked = true;
      const diffMins = Math.ceil((new Date(blockData.nextReset) - new Date()) / 60000);
      statusText = `Доступно через ${diffMins} мин.`;
      progressPercent = 100;
    }

    const div = document.createElement('div');
    div.className = 'card';
    if (isLocked) div.style.opacity = '0.4';

    div.innerHTML = `
      <div class="card-title">
        <span>🔥 Рекламный блок №${c.id}</span>
        <span style="color:#4ade80">+${formatMoney(c.baseReward)}</span>
      </div>
      <div class="stats">
        <span>${statusText}</span>
      </div>
      <div class="small-bar">
        <div class="small-fill" style="width:${progressPercent}%; background:${isLocked ? '#ef4444' : '#2AABEE'}"></div>
      </div>
    `;

    div.addEventListener('click', () => watchAdBlock(c.id));
    container.appendChild(div);
  });
}

async function init() {
  document.getElementById('balance')?.addEventListener('click', async () => {
    if (isClickPending) return;
    isClickPending = true;
    const r = await apiCall('/api/click', { userId: currentUser?.userId });
    if (r?.success) {
      currentUser.balance = r.balance;
      updateUI();
    }
    isClickPending = false;
  });

  document.getElementById('withdrawBtn')?.addEventListener('click', async () => {
    if (!currentUser || currentUser.balance < MIN_WITHDRAW) return tgAlert(`Минимум $${MIN_WITHDRAW}`);
    const wallet = prompt("Введите TON адрес кошелька:");
    if (!wallet) return;
    
    const r = await apiCall('/api/withdraw', { userId: currentUser.userId, amount: currentUser.balance, walletAddress: wallet });
    if (r?.success) {
      currentUser.balance = r.balance;
      updateUI();
      tgAlert("Заявка создана и заморожена до проверки!");
    }
  });

  await initUser();
}

init();
