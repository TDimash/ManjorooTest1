// js/script.js — Fixed Farms, Corrected Auto-Mode & Clean Corporate Admin Style
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

function getTelegramUser() {
  let user = tg?.initDataUnsafe?.user;
  if (user?.id) {
    return {
      userId: String(user.id),
      username: user.username || `${user.first_name}`,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
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
    if (res.status === 403) {
      const errData = await res.json();
      tgAlert(errData.error || 'Доступ запрещен');
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    return null;
  }
}

// Генерация рекламных блоков на главной
function generateCards() {
  const container = document.getElementById('adBlocksContainer');
  if (!container) return;

  const blocks = [
    { id: 1, title: 'GigaPub Video Light', desc: 'Быстрый просмотр короткого ролика' },
    { id: 2, title: 'GigaPub Video Medium', desc: 'Стандартное рекламное видео' },
    { id: 3, title: 'GigaPub Video Ultra', desc: 'Максимальное вознаграждение' }
  ];

  container.innerHTML = '';
  blocks.forEach(b => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title">
        <span>${b.title}</span>
      </div>
      <div class="stats">
        <span>Посмотрено: 0/0</span>
        <span id="ad-timer-${b.id}" class="ad-timer" style="display:none; color:#ef4444; margin:0;"></span>
      </div>
      <div class="small-bar">
        <div class="small-fill" style="width: 0%"></div>
      </div>
      <button class="btn watch-ad-btn" data-block="${b.id}">🎬 Смотреть рекламу</button>
    `;
    container.appendChild(card);
  });
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
    checkAndInjectAdminPanel();
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

function updateAdBlocksUI() {
  if (!currentUser || !currentUser.adBlocksData) return;

  currentUser.adBlocksData.forEach(block => {
    const btn = document.querySelector(`.watch-ad-btn[data-block="${block.id}"]`);
    const timerEl = document.getElementById(`ad-timer-${block.id}`);
    if (!btn) return;

    const limits = { 1: 10, 2: 5, 3: 3 };
    const maxViews = limits[block.id] || 5;

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
        timerEl.textContent = `${mins} мин.`;
        timerEl.style.display = 'inline';
      }
    } else {
      btn.disabled = false;
      btn.textContent = '🎬 Смотреть рекламу';
      if (timerEl) timerEl.style.display = 'none';
    }
  });
}

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

function setupNavigation() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;

  nav.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;

    const pageId = item.getAttribute('data-page');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) target.classList.add('active');

    if (pageId === 'friends') loadLeaderboard();
    if (pageId === 'adminPage') loadAdminStats();
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

// ВНЕДРЕНИЕ СТРОГОЙ АДМИНКИ (СТИЛЬ TELEGRAM BLUE БЕЗ ЗОЛОТА И СМАЙЛИКОВ)
function checkAndInjectAdminPanel() {
  if (!currentUser || currentUser.userId !== '8772464641') return;

  const nav = document.querySelector('.bottom-nav');
  if (nav && !document.getElementById('adminTabBtn')) {
    const adminBtn = document.createElement('div');
    adminBtn.className = 'nav-item';
    adminBtn.id = 'adminTabBtn';
    adminBtn.setAttribute('data-page', 'adminPage');
    adminBtn.innerHTML = `
      <svg class="nav-icon" viewBox="0 0 24 24" style="stroke:#2AABEE;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <div style="color:#2AABEE; font-weight:600;">Админ</div>
    `;
    nav.appendChild(adminBtn);
  }

  const appContainer = document.querySelector('.app');
  if (appContainer && !document.getElementById('adminPage')) {
    const adminPage = document.createElement('div');
    adminPage.id = 'adminPage';
    adminPage.className = 'page';
    adminPage.innerHTML = `
      <div class="card" style="border:1px solid #243242; padding:15px; border-radius:14px; background:#17212B; margin-bottom:20px;">
        <h3 style="color:#2AABEE; font-weight:800; margin-bottom:12px; text-align:center; text-transform: uppercase; letter-spacing: 0.5px;">Панель управления</h3>
        
        <div id="adminStatsBlock" style="font-size:13px; background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; margin-bottom:15px; line-height:1.7; border: 1px solid rgba(255,255,255,0.02);">
          Загрузка метрик...
        </div>
        
        <button class="btn" id="refreshAdminStats" style="background:#2AABEE; padding:10px; font-size:13px; margin-bottom:20px;">Обновить статистику</button>

        <h4 style="color:#4ade80; margin-bottom:10px; font-weight:700; font-size:14px;">Активные заявки на вывод:</h4>
        <div id="adminWithdrawalsList" style="display:flex; flex-direction:column; gap:8px; max-height:180px; overflow-y:auto; margin-bottom:20px; padding-right:4px;">
          Нет заявок
        </div>

        <h4 style="color:#8EA2B1; margin-bottom:10px; font-weight:700; font-size:14px;">Поиск игрока:</h4>
        <input type="text" id="adminSearchInput" placeholder="Введите ID или Username юзера" style="width:100%; padding:11px; background:#101820; border:1px solid #243242; color:#fff; border-radius:8px; font-size:13px; margin-bottom:10px;">
        <button class="btn" id="adminSearchBtn" style="background:#243242; padding:10px; font-size:13px;">Найти</button>

        <div id="adminUserResult" style="margin-top:12px; background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; font-size:12px; display:none; line-height:1.6; border:1px solid rgba(255,255,255,0.05);"></div>
      </div>
    `;
    appContainer.appendChild(adminPage);

    document.getElementById('refreshAdminStats').addEventListener('click', loadAdminStats);
    document.getElementById('adminSearchBtn').addEventListener('click', adminSearchUser);
  }
}

async function loadAdminStats() {
  if (!currentUser) return;
  const res = await apiCall('/api/admin/stats', { adminId: currentUser.userId });
  if (!res) return;

  document.getElementById('adminStatsBlock').innerHTML = `
    Всего игроков в базе: <b style="color:#fff;">${res.totalUsers}</b><br>
    Баланс всех кошельков: <b style="color:#4ade80;">$${res.totalBalance.toFixed(4)}</b><br>
    Заявок на модерации: <b style="color:#2AABEE;">${res.pendingWithdrawals.length} шт.</b>
  `;

  const list = document.getElementById('adminWithdrawalsList');
  if (res.pendingWithdrawals.length === 0) {
    list.innerHTML = '<div style="color:#8EA2B1; text-align:center; font-size:12px; padding:10px;">Все заявки обработаны.</div>';
  } else {
    list.innerHTML = '';
    res.pendingWithdrawals.forEach(w => {
      const row = document.createElement('div');
      row.style.cssText = 'background:rgba(255,255,255,0.03); padding:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid rgba(255,255,255,0.05);';
      row.innerHTML = `
        <div style="font-size:11px; max-width:70%;">
          <span style="font-weight:700; color:#fff;">@${w.username}</span> (${w.userId})<br>
          Сумма: <b style="color:#4ade80; font-size:12px;">$${w.amount.toFixed(4)}</b><br>
          Кошелек: <span style="color:#8EA2B1; word-break:break-all;">${w.walletAddress}</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="adm-act-btn" data-user="${w.userId}" data-wid="${w.withdrawalId}" data-act="approve" style="background:#4ade80; border:none; padding:6px 10px; border-radius:6px; font-weight:bold; cursor:pointer;">✅</button>
          <button class="adm-act-btn" data-user="${w.userId}" data-wid="${w.withdrawalId}" data-act="reject" style="background:#ef4444; border:none; padding:6px 10px; border-radius:6px; font-weight:bold; color:#fff; cursor:pointer;">❌</button>
        </div>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('.adm-act-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uId = btn.getAttribute('data-user');
        const wId = btn.getAttribute('data-wid');
        const act = btn.getAttribute('data-act');
        
        const confirmAct = confirm(act === 'approve' ? 'Подтвердить выплату?' : 'Отклонить заявку и вернуть баланс игроку?');
        if (!confirmAct) return;

        const actionRes = await apiCall('/api/admin/withdrawal-action', {
          adminId: currentUser.userId,
          userId: uId,
          withdrawalId: wId,
          action: act
        });

        if (actionRes && actionRes.success) {
          loadAdminStats();
        }
      });
    });
  }
}

async function adminSearchUser() {
  const query = document.getElementById('adminSearchInput').value.trim();
  if (!query) return;

  const res = await apiCall('/api/admin/user-search', { adminId: currentUser.userId, query });
  const block = document.getElementById('adminUserResult');
  block.style.display = 'block';

  if (!res || !res.success) {
    block.innerHTML = '<div style="color:#ef4444; text-align:center;">Игрок не найден</div>';
    return;
  }

  const u = res.user;
  block.innerHTML = `
    👤 Имя: <b>${u.username}</b> (${u.userId})<br>
    💵 Баланс: <b>$${u.balance.toFixed(4)}</b><br>
    📊 Уровень: <b>${u.level} (xp: ${u.xp})</b><br>
    🛑 Статус бана: <b style="color:${u.isBanned ? '#ef4444' : '#4ade80'}">${u.isBanned ? 'ЗАБАНЕН' : 'АКТИВЕН'}</b><br><br>
    <div style="display:flex; gap:8px;">
      <button class="btn" id="admUpdateBan" style="background:${u.isBanned ? '#4ade80' : '#ef4444'}; padding:6px; font-size:11px;">${u.isBanned ? 'Разбанить' : 'Забанить'}</button>
      <button class="btn" id="admGiveBonus" style="background:#2AABEE; padding:6px; font-size:11px;">Выдать +$1.00</button>
    </div>
  `;

  document.getElementById('admUpdateBan').addEventListener('click', async () => {
    const updateRes = await apiCall('/api/admin/user-update', {
      adminId: currentUser.userId,
      targetUserId: u.userId,
      isBanned: !u.isBanned
    });
    if (updateRes && updateRes.success) adminSearchUser();
  });

  document.getElementById('admGiveBonus').addEventListener('click', async () => {
    const updateRes = await apiCall('/api/admin/user-update', {
      adminId: currentUser.userId,
      targetUserId: u.userId,
      balance: u.balance + 1.00
    });
    if (updateRes && updateRes.success) adminSearchUser();
  });
}

function initEventListeners() {
  // Вешаем обработчик на баланс и остальные кнопки
  const balanceEl = document.getElementById('balance');
  if (balanceEl) {
    balanceEl.style.cursor = 'pointer';
    balanceEl.addEventListener('click', handleClick);
  }
  
  document.getElementById('autoBtn')?.addEventListener('click', toggleAutoMode);
  document.getElementById('inviteBtn')?.addEventListener('click', shareReferral);
  document.getElementById('withdrawBtn')?.addEventListener('click', withdraw);

  // Делегирование кликов по кнопкам рекламы
  document.body.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('watch-ad-btn')) {
      const blockId = Number(e.target.getAttribute('data-block'));
      watchAd(blockId);
    }
  });
}

async function init() {
  setupNavigation();
  generateCards(); // Возвращаем отрисовку рекламных карточек!
  initEventListeners();
  await initUser();
}

init();
