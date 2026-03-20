// ============================================================
// app.js — Frontend completo com cardápio, carrinho e pedidos
// ============================================================

// --- Cart state (in-memory) ---
let cart = [];
let catalogAll = [];
let allUsersCache = [];

// ============================================================
// SISTEMA DE NOTIFICAÇÃO SONORA — Admin
// Usa Web Audio API (sem arquivo externo necessário)
// ============================================================
let _audioCtx = null;
let _notifEnabled = true;
let _knownOrderIds = new Set();
let _pollingInterval = null;

function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playOrderSound() {
  if (!_notifEnabled) return;
  try {
    const ctx = _getAudioCtx();
    [
      { freq: 880,  start: 0.00, dur: 0.12 },
      { freq: 880,  start: 0.18, dur: 0.12 },
      { freq: 1100, start: 0.36, dur: 0.22 },
    ].forEach(({ freq, start, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.45, ctx.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    });
  } catch(e) { console.warn('Web Audio indisponível:', e); }
}

function startOrderPolling() {
  if (_pollingInterval) return;
  _pollingInterval = setInterval(async () => {
    try {
      const { data } = await api('GET', '/api/orders');
      if (!data.ok) return;
      const orders = data.orders || [];
      const newOrders = orders.filter(o => !_knownOrderIds.has(o.id));
      if (newOrders.length > 0) {
        orders.forEach(o => _knownOrderIds.add(o.id));
        playOrderSound();
        const qty = newOrders.length;
        showToast(`🔔 ${qty} novo${qty > 1 ? 's pedidos chegaram' : ' pedido chegou'}!`, 'success');
        flashOrderTab();
        renderAdminStats(orders, allUsersCache);
        renderAdminOrders(orders);
      } else {
        orders.forEach(o => _knownOrderIds.add(o.id));
      }
    } catch { /* rede instável — ignora */ }
  }, 8000);
  console.log('[Admin] Polling iniciado (8s).');
}

function stopOrderPolling() {
  if (_pollingInterval) { clearInterval(_pollingInterval); _pollingInterval = null; }
}

function flashOrderTab() {
  const btn = document.querySelector('#page-admin [data-tab="atab-orders"]');
  if (!btn) return;
  let n = 0;
  const iv = setInterval(() => {
    btn.style.background = n % 2 === 0 ? 'rgba(247,183,49,0.35)' : '';
    if (++n >= 8) { clearInterval(iv); btn.style.background = ''; }
  }, 280);
}

function updateSoundBtn() {
  const btn = document.getElementById('btn-toggle-sound');
  if (!btn) return;
  btn.textContent  = _notifEnabled ? '🔔 Som: ON' : '🔕 Som: OFF';
  btn.style.opacity = _notifEnabled ? '1' : '0.55';
}

function toggleSound() {
  _getAudioCtx(); // desbloqueia AudioContext na 1ª interação
  _notifEnabled = !_notifEnabled;
  updateSoundBtn();
  if (_notifEnabled) playOrderSound();
  showToast(_notifEnabled ? '🔔 Som ativado' : '🔕 Som desativado', 'info');
}


// ---- Utils ----
function fmt(cents){return'R$ '+(cents/100).toFixed(2).replace('.',',')}
function fmtPhone(v){const d=v.replace(/\D/g,'').slice(0,11);if(d.length<=2)return`(${d}`;if(d.length<=7)return`(${d.slice(0,2)}) ${d.slice(2)}`;return`(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`}
function fmtDate(s){if(!s||s==='Primeiro acesso')return s||'—';try{return new Date(s.replace(' ','T')).toLocaleString('pt-BR')}catch{return s}}
function fmtDateShort(s){if(!s)return'—';try{return new Date(s.replace(' ','T')).toLocaleDateString('pt-BR')}catch{return s}}

function showToast(msg,type='info'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`toast toast-${type} show`;
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),3200);
}
function shakeForm(id){const f=document.getElementById(id);f?.classList.add('shake');setTimeout(()=>f?.classList.remove('shake'),480)}
function setLoading(id,on){const b=document.getElementById(id);if(!b)return;b.disabled=on;b.dataset.og=b.dataset.og||b.textContent;b.textContent=on?'Aguarde…':b.dataset.og}

// ---- Router ----
const Router={
  show(id){
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active','visible'));
    const page=document.getElementById(id);
    if(!page)return;
    page.classList.add('active');
    requestAnimationFrame(()=>page.classList.add('visible'));
  }
};
function goToRegister(){Router.show('page-register')}
function goToLogin(){Router.show('page-login')}
function goToAdminLogin(){Router.show('page-admin-login')}

// ---- API ----
async function api(method,endpoint,body=null){
  const opts={method,headers:{'Content-Type':'application/json'},credentials:'same-origin'};
  if(body)opts.body=JSON.stringify(body);
  const res=await fetch(endpoint,opts);
  const data=await res.json();
  return{status:res.status,data};
}

// ============================================================
// ACESSO ADMIN — triplo clique no logo da tela de login
// ============================================================
(function(){
  let _clicks=0,_timer=null;
  document.addEventListener('DOMContentLoaded',()=>{
    const logo=document.getElementById('login-logo');
    if(!logo)return;
    logo.addEventListener('click',()=>{
      _clicks++;
      clearTimeout(_timer);
      _timer=setTimeout(()=>{_clicks=0;},600);
      if(_clicks>=3){_clicks=0;clearTimeout(_timer);Router.show('page-admin-login');}
    });
  });
})();

// ============================================================
// INIT
// ============================================================
async function init(){
  try{
    const{data}=await api('GET','/api/me');
    if(data.ok&&data.role==='admin'){
      await loadAdminDashboard();
      Router.show('page-admin');
    }else if(data.ok&&data.role==='user'){
      fillProfile(data.user);
      await loadCatalog();
      Router.show('page-dashboard');
    }else{
      Router.show('page-login');
    }
  }catch{Router.show('page-login')}
}

// ============================================================
// AUTH FORMS
// ============================================================
document.getElementById('form-login')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const phone=e.target.phone.value.replace(/\D/g,''), pass=e.target.password.value;
  setLoading('btn-login',true);
  try{
    const{data}=await api('POST','/api/login',{phone,password:pass});
    if(data.ok){
      showToast('Bem-vindo de volta! 👋','success');
      setTimeout(async()=>{
        const{data:me}=await api('GET','/api/me');
        fillProfile(me.user); await loadCatalog(); Router.show('page-dashboard');
      },700);
    }else{showToast(data.message,'error');shakeForm('form-login')}
  }catch{showToast('Erro de conexão.','error')}
  finally{setLoading('btn-login',false)}
});

document.getElementById('form-register')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const name=e.target.name.value.trim(),phone=e.target.phone.value.replace(/\D/g,''),
        address=e.target.address.value.trim(),pass=e.target.password.value,confirm=e.target.confirm.value;
  if(pass!==confirm){showToast('Senhas não coincidem!','error');return}
  if(phone.length<10){showToast('Número inválido!','error');return}
  setLoading('btn-register',true);
  try{
    const{data}=await api('POST','/api/register',{name,phone,address,password:pass});
    if(data.ok){
      showToast('Conta criada! 🎉','success');
      setTimeout(async()=>{
        const{data:me}=await api('GET','/api/me');
        fillProfile(me.user); await loadCatalog(); Router.show('page-dashboard');
      },800);
    }else{showToast(data.message,'error');shakeForm('form-register')}
  }catch{showToast('Erro de conexão.','error')}
  finally{setLoading('btn-register',false)}
});

document.getElementById('form-admin-login')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const email=document.getElementById('admin-email-field').value.trim(), pass=e.target.password.value;
  setLoading('btn-admin-login',true);
  try{
    const{data}=await api('POST','/api/admin/login',{email,password:pass});
    if(data.ok){
      showToast('Acesso concedido ✓','success');
      setTimeout(async()=>{await loadAdminDashboard();Router.show('page-admin')},600);
    }else{showToast(data.message,'error');shakeForm('form-admin-login')}
  }catch{showToast('Erro de conexão.','error')}
  finally{setLoading('btn-admin-login',false)}
});

document.querySelectorAll('.btn-logout').forEach(btn=>btn.addEventListener('click',async()=>{
  await api('POST','/api/logout');
  cart=[];updateCartBadge();
  showToast('Sessão encerrada.','info');
  setTimeout(()=>Router.show('page-login'),500);
}));

// ============================================================
// TABS
// ============================================================
function switchTab(btn){
  const tabId=btn.dataset.tab;
  document.querySelectorAll('#page-dashboard .nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('#page-dashboard .tab-content').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId)?.classList.add('active');
  if(tabId==='tab-orders')loadMyOrders();
}
function switchTabById(id){
  const btn=document.querySelector(`[data-tab="${id}"]`);
  if(btn)switchTab(btn);
}
function switchAdminTab(btn){
  const tabId=btn.dataset.tab;
  document.querySelectorAll('#page-admin .nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('#page-admin .tab-content').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId)?.classList.add('active');
  if(tabId==='atab-users')renderAdminUsers();
  if(tabId==='atab-catalog')loadAdminCatalog();
  if(tabId==='atab-entregadores')loadEntregadores();
}

// ============================================================
// CATÁLOGO
// ============================================================
async function loadCatalog(){
  const{data}=await api('GET','/api/catalog');
  if(!data.ok)return;
  catalogAll=data.items;
  buildCategoryBar(data.items);
  renderMenu(data.items);
}

function buildCategoryBar(items){
  const cats=[...new Set(items.map(i=>i.category))];
  const bar=document.getElementById('category-bar');
  bar.innerHTML=`<button class="cat-pill active" onclick="filterCategory(this,'')">Todos</button>`+
    cats.map(c=>`<button class="cat-pill" onclick="filterCategory(this,'${c}')">${c}</button>`).join('');
}

function filterCategory(btn,cat){
  document.querySelectorAll('.cat-pill').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  renderMenu(cat?catalogAll.filter(i=>i.category===cat):catalogAll);
}

function renderMenu(items){
  const grid=document.getElementById('menu-grid');
  if(!items.length){grid.innerHTML='<div class="loading-msg">Nenhum item disponível.</div>';return}
  grid.innerHTML=items.map(item=>{
    const inCart=cart.find(c=>c.id===item.id);
    const imgSlug=item.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const hasImage = item.image && item.image.trim() !== '';
    return`<div class="menu-item${inCart?' item-in-cart':''}" id="mi-${item.id}">
      ${hasImage
        ? `<div class="menu-item-img" style="background-image:url('${item.image}')"><div class="menu-item-img-overlay"></div></div>`
        : `<div class="item-emoji">${item.emoji||'🍽️'}</div>`
      }
      <div class="item-name" onclick="openItemImage('${imgSlug}','${item.id}','${item.name.replace(/'/g,"\\'")}',this)" title="Clique para ver a imagem">${item.name}${inCart?`<span class="item-qty-badge" style="margin-left:8px">×${inCart.qty}</span>`:''}</div>
      <div class="item-desc">${item.desc}</div>
      <div class="item-bottom">
        <span class="item-price">${fmt(item.price)}</span>
        <button class="btn-add-cart" onclick="addToCart(${item.id})" title="Adicionar ao carrinho">+</button>
      </div>
    </div>`;
  }).join('');
}

// Abre lightbox com a imagem do item
// Tenta /img/{slug}.jpg, /img/{slug}.png, /img/{id}.jpg, /img/{id}.png em sequência
function openItemImage(slug, id, name) {
  const candidates = [
    `/img/${slug}.jpg`, `/img/${slug}.jpeg`, `/img/${slug}.png`, `/img/${slug}.webp`,
    `/img/${id}.jpg`,   `/img/${id}.jpeg`,   `/img/${id}.png`,   `/img/${id}.webp`,
  ];
  let tried = 0;
  const lb   = document.getElementById('img-lightbox');
  const lbImg = document.getElementById('lb-img');
  const lbTitle = document.getElementById('lb-title');

  lbTitle.textContent = name;
  lbImg.alt  = name;
  lbImg.src  = '';
  lb.classList.add('open');

  function tryNext() {
    if (tried >= candidates.length) {
      lbImg.src = ''; // sem imagem — mostra mensagem
      lbImg.style.display = 'none';
      document.getElementById('lb-no-img').style.display = 'block';
      return;
    }
    lbImg.style.display = 'block';
    document.getElementById('lb-no-img').style.display = 'none';
    lbImg.src = candidates[tried++];
  }
  lbImg.onerror = tryNext;
  lbImg.onload  = () => { document.getElementById('lb-no-img').style.display='none'; lbImg.style.display='block'; };
  tryNext();
}

function closeItemImage(e) {
  if (e && e.target !== document.getElementById('img-lightbox')) return;
  document.getElementById('img-lightbox').classList.remove('open');
}

// ============================================================
// CARRINHO
// ============================================================
function addToCart(itemId){
  const item=catalogAll.find(i=>i.id===itemId);
  if(!item)return;
  const existing=cart.find(c=>c.id===itemId);
  if(existing){existing.qty++}else{cart.push({id:item.id,name:item.name,emoji:item.emoji||'🍽️',price:item.price,qty:1})}
  updateCartBadge();
  renderMenu(catalogAll.filter(i=>{
    const activePill=document.querySelector('.cat-pill.active');
    const cat=activePill?.textContent==='Todos'?'':activePill?.textContent||'';
    return cat?i.category===cat:true;
  }));
  showToast(`${item.name} adicionado! 🛒`,'success');
}

function changeQty(itemId,delta){
  const idx=cart.findIndex(c=>c.id===itemId);
  if(idx===-1)return;
  cart[idx].qty+=delta;
  if(cart[idx].qty<=0)cart.splice(idx,1);
  updateCartBadge();
  renderCart();
  renderMenu(catalogAll);
}

function updateCartBadge(){
  const total=cart.reduce((s,c)=>s+c.qty,0);
  const badge=document.getElementById('cart-badge');
  badge.textContent=total;
  badge.style.display=total?'inline':'none';
}

function renderCart(){
  const list=document.getElementById('cart-items-list');
  const footer=document.getElementById('cart-footer');
  const empty=document.getElementById('cart-empty');
  if(!cart.length){
    list.innerHTML=''; footer.style.display='none'; empty.style.display='block'; return;
  }
  empty.style.display='none'; footer.style.display='block';
  list.innerHTML=cart.map(c=>`
    <div class="cart-item-row">
      <div class="cart-item-emoji">${c.emoji}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${c.name}</div>
        <div class="cart-item-price">${fmt(c.price)} un.</div>
      </div>
      <div class="cart-qty-ctrl">
        <button class="qty-btn" onclick="changeQty(${c.id},-1)">−</button>
        <span class="qty-num">${c.qty}</span>
        <button class="qty-btn" onclick="changeQty(${c.id},1)">+</button>
      </div>
      <div class="cart-item-subtotal">${fmt(c.price*c.qty)}</div>
    </div>`).join('');
  const total=cart.reduce((s,c)=>s+c.price*c.qty,0);
  document.getElementById('cart-total-val').textContent=fmt(total);
}

// Renderiza carrinho quando a tab é aberta
document.querySelector('[data-tab="tab-cart"]')?.addEventListener('click',()=>renderCart());

async function checkout(){
  const address=document.getElementById('cart-address').value.trim();
  const note=document.getElementById('cart-note').value.trim();
  if(!address){showToast('Informe o endereço de entrega!','error');return}
  if(!cart.length){showToast('Carrinho vazio.','error');return}
  const btn=document.getElementById('btn-checkout');
  btn.disabled=true; btn.textContent='Enviando…';
  try{
    const items=cart.map(c=>({id:c.id,name:c.name,emoji:c.emoji,price:c.price,qty:c.qty}));
    const{data}=await api('POST','/api/orders',{items,address,note});
    if(data.ok){
      showToast('Pedido realizado com sucesso! 🎉','success');
      cart=[]; updateCartBadge(); renderCart();
      document.getElementById('cart-address').value='';
      document.getElementById('cart-note').value='';
      showDeliveryTokenModal(data.order_id, data.delivery_token);
    }else{showToast(data.message,'error')}
  }catch{showToast('Erro ao enviar pedido.','error')}
  finally{btn.disabled=false;btn.textContent='Fazer Pedido 🚀'}
}

// ── NOVO: exibe modal com os 4 dígitos do token ──
function showDeliveryTokenModal(orderId, token) {
  const modal = document.getElementById('delivery-token-modal');
  document.getElementById('dtoken-order-id').textContent = `#${orderId}`;
  const digitsEl = document.getElementById('dtoken-digits');
  digitsEl.innerHTML = (token || '????').split('').map(d =>
    `<span class="dtoken-digit">${d}</span>`
  ).join('');
  modal.classList.add('open');
}

// ── NOVO: fecha modal e vai para Meus Pedidos ──
function closeDeliveryTokenModal() {
  document.getElementById('delivery-token-modal').classList.remove('open');
  switchTabById('tab-orders');
}

// ============================================================
// MEUS PEDIDOS
// ============================================================
async function loadMyOrders(){
  const el=document.getElementById('orders-list');
  el.innerHTML='<div class="loading-msg">Carregando…</div>';
  const{data}=await api('GET','/api/orders/mine');
  if(!data.ok){el.innerHTML='<div class="loading-msg">Erro ao carregar.</div>';return}
  if(!data.orders.length){
    el.innerHTML=`<div class="cart-empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhum pedido ainda</div><div class="empty-sub">Faça seu primeiro pedido no cardápio</div><button class="btn-secondary" onclick="switchTabById('tab-menu')">Ver Cardápio</button></div>`;
    return;
  }
  el.innerHTML=data.orders.map(o=>`
    <div class="order-card">
      <div class="order-card-header">
        <div><div class="order-id">#${o.id}</div><div class="order-date">${fmtDate(o.created_at)}</div></div>
        <span class="status-pill s-${o.status}">${statusLabel(o.status)}</span>
      </div>
      <div class="order-items-list">
        ${o.items.map(i=>`<div class="order-item-line"><span>${i.emoji} ${i.name} ×${i.qty}</span><span>${fmt(i.price*i.qty)}</span></div>`).join('')}
      </div>
      <div class="order-footer">
        <div><div class="order-total">Total: ${fmt(o.total)}</div><div class="order-address">📍 ${o.address}</div>${o.note?`<div class="order-address">💬 ${o.note}</div>`:''}</div>
        ${o.status !== 'entregue' && o.status !== 'cancelado' ? `
        <div class="order-token-wrap" title="Mostre este código ao entregador">
          <div class="order-token-label">🔑 Código de entrega</div>
          <div class="order-token-digits">
            ${(o.delivery_token||'????').split('').map(d=>`<span class="order-token-digit">${d}</span>`).join('')}
          </div>
        </div>` : ''}
      </div>
    </div>`).join('');
}

// ============================================================
// PERFIL
// ============================================================
function fillProfile(user){
  document.getElementById('hero-greeting').textContent=`Olá, ${user.name.split(' ')[0]}! 👋`;
  // Avatar: exibe foto salva no localStorage ou inicial do nome
  const avatarEl=document.getElementById('profile-avatar');
  const savedPhoto=localStorage.getItem(`avatar_${user.phone}`);
  if(savedPhoto){
    avatarEl.textContent='';
    let img=avatarEl.querySelector('img');
    if(!img){img=document.createElement('img');avatarEl.appendChild(img);}
    img.src=savedPhoto;
  }else{
    const img=avatarEl.querySelector('img');
    if(img)img.remove();
    avatarEl.textContent=user.name.charAt(0).toUpperCase();
  }
  document.getElementById('profile-name').textContent=user.name;
  document.getElementById('profile-phone').textContent=fmtPhone(user.phone);
  document.getElementById('profile-created').textContent=fmtDateShort(user.created_at);
  document.getElementById('profile-last').textContent=fmtDate(user.last_login);
  if(user.address) document.getElementById('cart-address').value=user.address;
  // Preenche o formulário de edição
  document.getElementById('edit-name').value    = user.name    || '';
  document.getElementById('edit-phone').value   = fmtPhone(user.phone || '');
  document.getElementById('edit-address').value = user.address || '';
}

// ---- Foto de perfil ----
document.getElementById('avatar-input')?.addEventListener('change',async e=>{
  const file=e.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=async()=>{
    const base64=reader.result;
    try{
      const{data}=await api('GET','/api/me');
      if(data.ok&&data.user){
        localStorage.setItem(`avatar_${data.user.phone}`,base64);
        const avatarEl=document.getElementById('profile-avatar');
        avatarEl.textContent='';
        let img=avatarEl.querySelector('img');
        if(!img){img=document.createElement('img');avatarEl.appendChild(img);}
        img.src=base64;
        showToast('Foto atualizada! 📸','success');
      }
    }catch{showToast('Erro ao salvar foto.','error');}
  };
  reader.readAsDataURL(file);
  e.target.value='';
});

document.getElementById('form-edit-profile')?.addEventListener('submit', async e => {
  e.preventDefault();
  const name    = document.getElementById('edit-name').value.trim();
  const phone   = document.getElementById('edit-phone').value.replace(/\D/g,'');
  const address = document.getElementById('edit-address').value.trim();
  const currPass = document.getElementById('edit-curr-pass').value;
  const newPass  = document.getElementById('edit-new-pass').value;

  if(!name)          { showToast('Nome não pode ficar vazio.','error'); return; }
  if(phone.length<10){ showToast('Celular inválido.','error'); return; }
  if(newPass && !currPass){ showToast('Informe sua senha atual para alterá-la.','error'); return; }

  setLoading('btn-save-profile', true);
  try {
    const body = { name, phone, address };
    if(newPass){ body.current_password = currPass; body.new_password = newPass; }
    const { data } = await api('PATCH', '/api/users/me', body);
    if(data.ok){
      showToast('Dados atualizados com sucesso! ✅','success');
      fillProfile(data.user);
      document.getElementById('edit-curr-pass').value = '';
      document.getElementById('edit-new-pass').value  = '';
    } else {
      showToast(data.message,'error');
    }
  } catch { showToast('Erro de conexão.','error'); }
  finally { setLoading('btn-save-profile', false); }
});

// ============================================================
// ADMIN — DASHBOARD
// ============================================================
async function loadAdminDashboard(){
  const[ordRes,usrRes]=await Promise.all([api('GET','/api/orders'),api('GET','/api/users')]);
  allUsersCache=usrRes.data.users||[];
  const orders=ordRes.data.orders||[];

  // Registra todos os pedidos JÁ existentes como "conhecidos"
  // (não toca som para pedidos antigos ao entrar no painel)
  orders.forEach(o=>_knownOrderIds.add(o.id));

  renderAdminStats(orders,allUsersCache);
  renderAdminOrders(orders);
  renderAdminUsers(allUsersCache);

  // Inicia monitoramento de novos pedidos
  startOrderPolling();
  updateSoundBtn();
}

async function loadAdminOrders(){
  const{data}=await api('GET','/api/orders');
  renderAdminStats(data.orders||[],allUsersCache);
  renderAdminOrders(data.orders||[]);
}

function renderAdminStats(orders,users){
  const pending=orders.filter(o=>!['entregue','cancelado'].includes(o.status)).length;
  const revenue=orders.filter(o=>o.status==='entregue').reduce((s,o)=>s+o.total,0);
  document.getElementById('admin-stats-row').innerHTML=`
    <div class="stat-card stat-pending"><div class="stat-num">${pending}</div><div class="stat-label">Ativos</div></div>
    <div class="stat-card stat-total"><div class="stat-num">${fmt(revenue)}</div><div class="stat-label">Faturamento</div></div>
    <div class="stat-card stat-users"><div class="stat-num">${users.length}</div><div class="stat-label">Usuários</div></div>
    <div class="stat-card"><div class="stat-num">${orders.length}</div><div class="stat-label">Pedidos total</div></div>`;
}

function renderAdminOrders(orders){
  const el=document.getElementById('admin-orders-list');
  if(!orders.length){el.innerHTML='<div class="loading-msg">Nenhum pedido ainda.</div>';return}
  el.innerHTML=orders.map(o=>`
    <div class="admin-order-card">
      <div class="admin-order-top">
        <div class="admin-order-meta">
          <div class="order-id">#${o.id} — ${fmtDate(o.created_at)}</div>
          <div class="user-info">👤 <strong>${o.user_name}</strong> · ${fmtPhone(o.user_phone)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="admin-token-badge" title="Código de confirmação de entrega">
            🔑 <span class="admin-token-val">${o.delivery_token||'—'}</span>
          </div>
          <select class="status-select" data-prev="${o.status}" onchange="updateOrderStatus(${o.id},this.value,this)">
            ${['pendente','confirmado','preparando','pronto','entregue','cancelado']
              .map(s=>`<option value="${s}"${s===o.status?' selected':''}>${statusLabel(s)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="admin-order-items">
        ${o.items.map(i=>`<div class="order-item-line"><span>${i.emoji} ${i.name} ×${i.qty}</span><span>${fmt(i.price*i.qty)}</span></div>`).join('')}
      </div>
      <div class="admin-order-footer">
        <div class="admin-order-address">📍 ${o.address}${o.note?` · 💬 ${o.note}`:''}</div>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="admin-order-total">${fmt(o.total)}</div>
          <button class="btn-delete" onclick="deleteOrder(${o.id})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/></svg>
            Excluir
          </button>
        </div>
      </div>
    </div>`).join('');
}

async function updateOrderStatus(orderId,newStatus,selectEl){
  // Guarda o valor ANTERIOR antes de qualquer coisa (dataset.prev é setado no sucesso anterior)
  const prevStatus = selectEl ? (selectEl.dataset.prev || newStatus) : newStatus;
  const{data}=await api('PATCH',`/api/orders/${orderId}/status`,{status:newStatus});
  if(data.ok){
    // Só salva o novo valor como "anterior" após sucesso confirmado
    if(selectEl) selectEl.dataset.prev = newStatus;
    showToast(`Status atualizado: ${statusLabel(newStatus)}`,'success');
    // ── Quando pronto: exibe modal com entregador escalado automaticamente ──
    if(newStatus==='pronto'){
      if(data.entregador){
        // Pequeno delay para garantir que o modal abre após qualquer re-render
        setTimeout(()=>showEntregadorModal(orderId, data.entregador), 150);
      } else {
        showToast('⚠️ Nenhum entregador cadastrado na fila.','error');
      }
    }
  }else{
    // Reverte o select visualmente para o status anterior confirmado
    if(selectEl){
      selectEl.value = prevStatus;
    }
    showToast(data.message||'Erro ao atualizar.','error');
  }
}

// ── Modal de entregador escalado ──
function showEntregadorModal(orderId, ent){
  document.getElementById('ent-modal-order').textContent = `#${orderId}`;
  document.getElementById('ent-modal-name').textContent  = ent.name;
  document.getElementById('ent-modal-phone').textContent = fmtPhone(ent.phone);
  document.getElementById('ent-modal-email').textContent = ent.email || '—';
  document.getElementById('modal-entregador').classList.add('open');
}

function closeEntregadorModal(){
  document.getElementById('modal-entregador').classList.remove('open');
}

async function deleteOrder(orderId) {
  if (!confirm(`Excluir o pedido #${orderId} permanentemente?`)) return;
  const { data } = await api('DELETE', `/api/orders/${orderId}`);
  if (data.ok) {
    showToast(`Pedido #${orderId} excluído.`, 'info');
    loadAdminOrders();
  } else {
    showToast('Erro ao excluir pedido.', 'error');
  }
}

// ---- Admin Usuários ----
function renderAdminUsers(users){
  const list=users||allUsersCache;
  const tbody=document.getElementById('users-tbody');
  if(!tbody)return;
  if(!list.length){tbody.innerHTML='<tr><td colspan="6" class="empty-row">Nenhum usuário.</td></tr>';return}
  tbody.innerHTML=list.map(u=>`<tr>
    <td><div class="user-avatar">${(()=>{const p=localStorage.getItem(`avatar_${u.phone}`);return p?`<img src="${p}" style="width:100%;height:100%;object-fit:cover;border-radius:9px;display:block"/>`:`${u.name.charAt(0).toUpperCase()}`})()}</div><span>${u.name}</span></td>
    <td><span class="phone-badge">${fmtPhone(u.phone)}</span></td>
    <td class="td-address">${u.address && u.address.trim() ? u.address : '<span class="never">Não informado</span>'}</td>
    <td style="font-size:.8rem">${fmtDateShort(u.created_at)}</td>
    <td style="font-size:.8rem">${u.last_login?fmtDate(u.last_login):'<span class="never">—</span>'}</td>
    <td class="td-actions">
      <button class="btn-view" onclick="openUserModal(${u.id})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        Ver
      </button>
      <button class="btn-delete" onclick="deleteUser(${u.id})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/></svg>
        Excluir
      </button>
    </td>
  </tr>`).join('');
}

// ---- Modal de detalhes do usuário ----
async function openUserModal(userId){
  const u = allUsersCache.find(x=>x.id===userId);
  if(!u) return;

  const modalAv=document.getElementById('modal-avatar');
  const savedPhotoModal=localStorage.getItem(`avatar_${u.phone}`);
  if(savedPhotoModal){
    modalAv.textContent='';
    let mImg=modalAv.querySelector('img');
    if(!mImg){mImg=document.createElement('img');modalAv.appendChild(mImg);}
    mImg.src=savedPhotoModal;
    mImg.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:14px;display:block';
  }else{
    const mImg=modalAv.querySelector('img');
    if(mImg)mImg.remove();
    modalAv.textContent=u.name.charAt(0).toUpperCase();
  }
  document.getElementById('modal-name').textContent    = u.name;
  document.getElementById('modal-phone').textContent   = fmtPhone(u.phone);
  document.getElementById('modal-address').textContent = u.address && u.address.trim() ? u.address : 'Não informado';
  document.getElementById('modal-created').textContent = fmtDate(u.created_at);
  document.getElementById('modal-last').textContent    = u.last_login ? fmtDate(u.last_login) : 'Nunca';
  document.getElementById('modal-orders').innerHTML    = '<div class="loading-msg" style="padding:16px">Carregando…</div>';
  document.getElementById('modal-user').classList.add('open');

  // Busca pedidos de todos e filtra pelo user_id
  try {
    const {data} = await api('GET','/api/orders');
    const userOrders = (data.orders||[]).filter(o=>o.user_id===userId);
    const el = document.getElementById('modal-orders');
    if(!userOrders.length){
      el.innerHTML='<div style="color:var(--muted);font-size:.84rem;padding:8px 0">Nenhum pedido realizado.</div>';
      return;
    }
    el.innerHTML = userOrders.map(o=>`
      <div class="modal-order-row">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:.78rem;color:var(--muted)">#${o.id} · ${fmtDate(o.created_at)}</span>
          <span class="status-pill s-${o.status}" style="font-size:.65rem">${statusLabel(o.status)}</span>
        </div>
        <div style="font-size:.8rem;margin-bottom:2px">${o.items.map(i=>`${i.emoji} ${i.name} ×${i.qty}`).join(', ')}</div>
        <div style="display:flex;justify-content:space-between;font-size:.78rem;color:var(--muted)">
          <span>📍 ${o.address}</span><span style="color:var(--accent3);font-weight:700">${fmt(o.total)}</span>
        </div>
      </div>`).join('');
  } catch { document.getElementById('modal-orders').innerHTML='<div style="color:var(--danger);font-size:.84rem">Erro ao carregar pedidos.</div>'; }
}

function closeUserModal(e){
  if(e && e.target !== document.getElementById('modal-user')) return;
  document.getElementById('modal-user').classList.remove('open');
}

function filterAdminUsers(val){
  const f=val.toLowerCase();
  const filtered=allUsersCache.filter(u=>u.name.toLowerCase().includes(f)||u.phone.includes(val.replace(/\D/g,'')));
  renderAdminUsers(filtered);
}

async function deleteUser(id){
  if(!confirm('Excluir este usuário permanentemente?'))return;
  const{data}=await api('DELETE',`/api/users/${id}`);
  if(data.ok){
    showToast('Usuário removido.','info');
    allUsersCache=allUsersCache.filter(u=>u.id!==id);
    renderAdminUsers();
  }
}

// ---- Admin Catálogo ----
async function loadAdminCatalog(){
  const{data}=await api('GET','/api/catalog/all');
  if(!data.ok)return;
  const tbody=document.getElementById('catalog-tbody');
  tbody.innerHTML=data.items.map(item=>`<tr id="cat-row-${item.id}">
    <td id="cat-info-cell-${item.id}">
      <div class="info-display" id="info-display-${item.id}" style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1.3rem">${item.emoji}</span>
        <div>
          <div id="info-name-display-${item.id}" style="font-weight:600;font-size:.86rem">${item.name}</div>
          <div id="info-desc-display-${item.id}" style="font-size:.74rem;color:var(--muted)">${item.desc}</div>
        </div>
        <button class="btn-edit-price" onclick="startEditInfo(${item.id})" title="Editar nome e descrição" style="margin-left:4px;flex-shrink:0">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
      <div class="info-edit" id="info-edit-${item.id}" style="display:none;flex-direction:column;gap:5px;min-width:200px">
        <input class="info-input" id="info-name-${item.id}" type="text" placeholder="Nome do item"
          value="${item.name.replace(/"/g,'&quot;')}"
          onkeydown="handleInfoKey(event,${item.id})"/>
        <input class="info-input info-input-desc" id="info-desc-${item.id}" type="text" placeholder="Descrição"
          value="${item.desc.replace(/"/g,'&quot;')}"
          onkeydown="handleInfoKey(event,${item.id})"/>
        <div style="display:flex;gap:4px;margin-top:2px">
          <button class="btn-price-save" style="width:auto;padding:0 10px;font-size:.75rem;height:26px" onclick="saveInfo(${item.id})">✓ Salvar</button>
          <button class="btn-price-cancel" style="width:auto;padding:0 10px;font-size:.75rem;height:26px" onclick="cancelEditInfo(${item.id})">✕ Cancelar</button>
        </div>
      </div>
    </td>
    <td><span class="phone-badge">${item.category}</span></td>
    <td id="cat-price-cell-${item.id}">
      <div class="price-display" id="price-display-${item.id}">
        <span class="price-val" style="font-family:var(--font-head);font-weight:700;color:var(--accent3)">${fmt(item.price)}</span>
        <button class="btn-edit-price" onclick="startEditPrice(${item.id},${item.price})" title="Editar valor">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
      <div class="price-edit" id="price-edit-${item.id}" style="display:none">
        <span style="font-size:.72rem;color:var(--muted);margin-right:2px">R$</span>
        <input class="price-input" id="price-input-${item.id}" type="text" inputmode="decimal"
          value="${(item.price/100).toFixed(2).replace('.',',')}"
          onkeydown="handlePriceKey(event,${item.id})"
          onfocus="this.select()"/>
        <button class="btn-price-save" onclick="savePrice(${item.id})" title="Salvar">✓</button>
        <button class="btn-price-cancel" onclick="cancelEditPrice(${item.id})" title="Cancelar">✕</button>
      </div>
    </td>
    <td><span class="status-pill ${item.active?'s-pronto':'s-cancelado'}">${item.active?'Ativo':'Inativo'}</span></td>
    <td><button class="catalog-toggle ${item.active?'active-item':'inactive-item'}" onclick="toggleCatalogItem(${item.id},this)">
      ${item.active?'Desativar':'Ativar'}</button></td>
  </tr>`).join('');
}

async function toggleCatalogItem(id,btn){
  const{data}=await api('PATCH',`/api/catalog/${id}/toggle`,{});
  if(data.ok){showToast('Item atualizado.','success');loadAdminCatalog()}
}

function startEditPrice(id, currentCents){
  document.getElementById(`price-display-${id}`).style.display='none';
  const editEl = document.getElementById(`price-edit-${id}`);
  editEl.style.display='flex';
  const input = document.getElementById(`price-input-${id}`);
  input.value = (currentCents/100).toFixed(2).replace('.', ',');
  input.focus();
  input.select();
}

function cancelEditPrice(id){
  document.getElementById(`price-edit-${id}`).style.display='none';
  document.getElementById(`price-display-${id}`).style.display='flex';
}

function handlePriceKey(e, id){
  if(e.key==='Enter')  savePrice(id);
  if(e.key==='Escape') cancelEditPrice(id);
}

async function savePrice(id){
  const input = document.getElementById(`price-input-${id}`);
  // Normaliza separador decimal: pt-BR usa vírgula, parseFloat precisa de ponto
  const raw = input.value.replace(',', '.');
  const val = parseFloat(raw);
  if(isNaN(val) || val <= 0){ showToast('Valor inválido.','error'); return; }

  const btn = document.querySelector(`#price-edit-${id} .btn-price-save`);
  btn.disabled = true; btn.textContent='…';

  const{data}=await api('PATCH',`/api/catalog/${id}/price`,{price: val});
  btn.disabled=false; btn.textContent='✓';

  if(data.ok){
    const displayEl = document.getElementById(`price-display-${id}`);
    displayEl.querySelector('.price-val').textContent = fmt(data.price);
    cancelEditPrice(id);
    showToast('Valor atualizado! ✅','success');
  } else {
    showToast(data.message||'Erro ao salvar.','error');
  }
}

// ---- Edição de nome/descrição do catálogo ----
function startEditInfo(id){
  document.getElementById(`info-display-${id}`).style.display='none';
  const editEl = document.getElementById(`info-edit-${id}`);
  editEl.style.display='flex';
  document.getElementById(`info-name-${id}`).focus();
}

function cancelEditInfo(id){
  document.getElementById(`info-edit-${id}`).style.display='none';
  document.getElementById(`info-display-${id}`).style.display='flex';
}

function handleInfoKey(e, id){
  if(e.key==='Escape') cancelEditInfo(id);
  // Enter só salva se não for o campo de descrição (para permitir Tab)
  if(e.key==='Enter') saveInfo(id);
}

async function saveInfo(id){
  const nameEl = document.getElementById(`info-name-${id}`);
  const descEl = document.getElementById(`info-desc-${id}`);
  const name = nameEl.value.trim();
  const desc = descEl.value.trim();

  if(!name){ showToast('Nome não pode ficar vazio.','error'); nameEl.focus(); return; }

  const saveBtn = document.querySelector(`#info-edit-${id} .btn-price-save`);
  saveBtn.disabled=true; saveBtn.textContent='…';

  const{data}=await api('PATCH',`/api/catalog/${id}/info`,{name, desc});
  saveBtn.disabled=false; saveBtn.innerHTML='✓ Salvar';

  if(data.ok){
    // Atualiza o display sem recarregar a tabela
    document.getElementById(`info-name-display-${id}`).textContent = data.name;
    document.getElementById(`info-desc-display-${id}`).textContent = data.desc;
    cancelEditInfo(id);
    showToast('Item atualizado! ✅','success');
  } else {
    showToast(data.message||'Erro ao salvar.','error');
  }
}

// ---- Admin Entregadores ----
async function loadEntregadores(){
  const tbody=document.getElementById('entregadores-tbody');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="8" class="empty-row">Carregando…</td></tr>';
  const{data}=await api('GET','/api/entregadores');
  if(!data.ok){tbody.innerHTML='<tr><td colspan="8" class="empty-row">Erro ao carregar.</td></tr>';return}
  if(!data.entregadores.length){tbody.innerHTML='<tr><td colspan="8" class="empty-row">Nenhum entregador cadastrado.</td></tr>';return}
  tbody.innerHTML=data.entregadores.map(e=>{
    const online = (e.online === undefined || e.online === null) ? 1 : e.online;
    return `<tr id="ent-row-${e.id}">
      <td style="display:table-cell"><strong style="font-size:.86rem">${e.name}</strong></td>
      <td><span class="phone-badge">${fmtPhone(e.phone)}</span></td>
      <td style="font-size:.8rem">${e.email||'<span class="never">—</span>'}</td>
      <td style="font-size:.8rem;font-family:monospace">${e.cpf||'<span class="never">—</span>'}</td>
      <td class="td-address">${e.address&&e.address.trim()?e.address:'<span class="never">Não informado</span>'}</td>
      <td style="font-size:.8rem">${fmtDateShort(e.created_at)}</td>
      <td>
        <button class="ent-online-btn ${online?'ent-online':'ent-offline'}" id="ent-online-btn-${e.id}" onclick="toggleEntregadorOnline(${e.id})">
          ${online?'🟢 Online':'🔴 Offline'}
        </button>
      </td>
      <td class="td-actions">
        <button class="btn-delete" onclick="deleteEntregador(${e.id})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/></svg>
          Excluir
        </button>
      </td>
    </tr>`;
  }).join('');
}

async function toggleEntregadorOnline(id){
  const{data}=await api('PATCH',`/api/entregadores/${id}/online`,{});
  if(data.ok){
    const btn=document.getElementById(`ent-online-btn-${id}`);
    if(!btn)return;
    const isOnline = data.online === 1;
    btn.className=`ent-online-btn ${isOnline?'ent-online':'ent-offline'}`;
    btn.textContent=isOnline?'🟢 Online':'🔴 Offline';
    showToast(isOnline?'Entregador Online ✅':'Entregador Offline 🔴','info');
  }else{showToast('Erro ao atualizar status.','error')}
}
async function saveEntregador(){
  const name    = document.getElementById('ent-name').value.trim();
  const phone   = document.getElementById('ent-phone').value.replace(/\D/g,'');
  const email   = document.getElementById('ent-email').value.trim();
  const cpf     = document.getElementById('ent-cpf').value.trim();
  const address = document.getElementById('ent-address').value.trim();
  if(!name){showToast('Informe o nome do entregador.','error');return}
  if(phone.length<10){showToast('Celular inv\u00e1lido.','error');return}
  const btn=document.getElementById('btn-save-entregador');
  btn.disabled=true; btn.textContent='Salvando\u2026';
  try{
    const{data}=await api('POST','/api/entregadores',{name,phone,email,address,cpf});
    if(data.ok){
      showToast('Entregador cadastrado! \u2705','success');
      document.getElementById('ent-name').value='';
      document.getElementById('ent-phone').value='';
      document.getElementById('ent-email').value='';
      document.getElementById('ent-cpf').value='';
      document.getElementById('ent-address').value='';
      loadEntregadores();
    }else{showToast(data.message,'error')}
  }catch{showToast('Erro de conex\u00e3o.','error')}
  finally{btn.disabled=false;btn.textContent='Cadastrar Entregador'}
}

async function deleteEntregador(id){
  if(!confirm('Excluir este entregador permanentemente?'))return;
  const{data}=await api('DELETE',`/api/entregadores/${id}`);
  if(data.ok){showToast('Entregador removido.','info');loadEntregadores();}
  else{showToast('Erro ao excluir.','error')}
}

// ---- Helpers ----
function statusLabel(s){
  return{pendente:'⏳ Pendente',confirmado:'✅ Confirmado',preparando:'👨‍🍳 Preparando',pronto:'🎯 Pronto',entregue:'🚀 Entregue',cancelado:'❌ Cancelado'}[s]||s;
}

// ---- Masks ----
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.phone-input').forEach(input=>{
    input.addEventListener('input',e=>e.target.value=fmtPhone(e.target.value));
  });
  init();
});
