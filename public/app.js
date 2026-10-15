const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let token = '';
try { token = localStorage.getItem('adminToken') || ''; } catch {}

const state = { ingredients: [], menus: [] };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('토큰이 올바르지 않습니다'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

async function run(fn) {
  try { await fn(); } catch (e) { toast('⚠️ ' + e.message); }
}

function showLogin() {
  $('#login').hidden = false;
  $$('[data-panel]').forEach((p) => (p.hidden = true));
}

// ── 탭 ──────────────────────────────────────────────
function openTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  try { localStorage.setItem('tab', name); } catch {}
  run(loaders[name]);
}
$$('#tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));

const loaders = {
  stock: loadStock,
  ingredients: loadIngredients,
  menus: loadMenus,
  history: loadHistory,
  settings: loadSettings,
};

// ── 재고 ────────────────────────────────────────────
const unitLabel = (i) => (i.unit === 'ml' ? i.container_label : i.container_label || '개');

async function loadStock() {
  state.ingredients = await api('/ingredients');
  $('#stock-rows').innerHTML = state.ingredients.length
    ? state.ingredients.map((i) => `
      <tr class="${i.low ? 'low' : ''}">
        <td>${esc(i.name)}</td>
        <td>${esc(i.display)}</td>
        <td>${esc(i.reorder_point)}${esc(unitLabel(i))} 이하</td>
        <td class="row">
          <button class="small secondary" data-act="restock" data-id="${i.id}">입고</button>
          <button class="small secondary" data-act="count" data-id="${i.id}">실사</button>
          <button class="small danger" data-act="waste" data-id="${i.id}">폐기</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="muted">재료 탭에서 재료를 먼저 등록하세요.</td></tr>';
}

$('#stock-rows').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const ing = state.ingredients.find((i) => i.id === Number(b.dataset.id));
  const prompts = {
    restock: `${ing.name} 입고 수량 (${unitLabel(ing)} 단위${ing.unit === 'ml' ? ', 또는 350ml' : ''})`,
    count: `${ing.name} 실제 남은 양 (예: 1.5${ing.unit === 'ml' ? ' 또는 1050ml' : ''})`,
    waste: `${ing.name} 폐기 수량`,
  };
  const q = prompt(prompts[b.dataset.act]);
  if (!q) return;
  run(async () => {
    const r = await api(`/ingredients/${ing.id}/${b.dataset.act}`, { method: 'POST', body: { quantity: q } });
    toast(`${r.name}: ${r.display}`);
    loadStock();
  });
});

$('#btn-reorder').addEventListener('click', () => run(async () => {
  const r = await api('/purchase-orders', { method: 'POST' });
  toast(r.id ? `발주서 #${r.id}를 텔레그램으로 보냈습니다` : '기준 이하인 재료가 없습니다');
}));

// ── 재료 ────────────────────────────────────────────
const ingForm = $('#ing-form');

function syncUnitFields() {
  const unit = ingForm.unit.value;
  $$('.ml-only', ingForm).forEach((el) => (el.hidden = unit !== 'ml'));
  $$('.ea-only', ingForm).forEach((el) => (el.hidden = unit !== 'ea'));
  if (!ingForm.container_label.value || ['병', '개'].includes(ingForm.container_label.value)) {
    ingForm.container_label.value = unit === 'ml' ? '병' : '개';
  }
}
ingForm.unit.addEventListener('change', syncUnitFields);

function resetIngForm() {
  ingForm.reset();
  ingForm.id.value = '';
  $('#ing-form-title').textContent = '재료 추가';
  $$('.new-only', ingForm).forEach((el) => (el.hidden = false));
  syncUnitFields();
}
$('#ing-reset').addEventListener('click', resetIngForm);

ingForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(ingForm));
  const id = body.id;
  delete body.id;
  run(async () => {
    await api(id ? `/ingredients/${id}` : '/ingredients', { method: id ? 'PUT' : 'POST', body });
    toast('저장했습니다');
    resetIngForm();
    loadIngredients();
  });
});

async function loadIngredients() {
  state.ingredients = await api('/ingredients');
  $('#ing-rows').innerHTML = state.ingredients.map((i) => `
    <tr>
      <td>${esc(i.name)}</td>
      <td>${i.unit === 'ml' ? `${esc(i.container_size)}ml/${esc(i.container_label)}` : esc(i.container_label)}${i.yield_ml ? ` · 즙 ${esc(i.yield_ml)}ml` : ''}</td>
      <td>${esc(i.reorder_point)} / ${esc(i.par_level ?? '-')}</td>
      <td>${esc(i.order_alias || i.name)}${i.supplier === 'coupang' ? ' (쿠팡)' : ''}</td>
      <td class="row">
        <button class="small secondary" data-edit="${i.id}">수정</button>
        <button class="small danger" data-del="${i.id}">삭제</button>
      </td>
    </tr>`).join('');
  syncUnitFields();
}

$('#ing-rows').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  if (edit) {
    const i = state.ingredients.find((x) => x.id === Number(edit.dataset.edit));
    for (const el of ingForm.elements) if (el.name && el.name in i) el.value = i[el.name] ?? '';
    ingForm.id.value = i.id;
    $('#ing-form-title').textContent = `재료 수정: ${i.name}`;
    $$('.new-only', ingForm).forEach((el) => (el.hidden = true));
    syncUnitFields();
    ingForm.scrollIntoView({ behavior: 'smooth' });
  }
  if (del && confirm('삭제하면 이 재료의 레시피와 기록도 지워집니다. 삭제할까요?')) {
    run(async () => { await api(`/ingredients/${del.dataset.del}`, { method: 'DELETE' }); loadIngredients(); });
  }
});

// ── 메뉴 / 레시피 ───────────────────────────────────
$('#menu-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  run(async () => { await api('/menu-items', { method: 'POST', body }); e.target.reset(); loadMenus(); });
});

function recipeUnits(ingredientId) {
  const i = state.ingredients.find((x) => x.id === Number(ingredientId));
  if (!i) return ['ml'];
  if (i.unit === 'ea' && i.yield_ml) return ['ml', 'ea'];
  return [i.unit];
}

function recipeLineHtml(line = {}) {
  const ingId = line.ingredient_id ?? state.ingredients[0]?.id;
  const units = recipeUnits(ingId);
  return `<div class="recipe-line">
    <select data-f="ingredient_id">${state.ingredients.map((i) => `<option value="${i.id}" ${i.id === Number(ingId) ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
    <input data-f="amount" type="number" step="any" value="${esc(line.amount ?? '')}" placeholder="양" />
    <select data-f="unit">${units.map((u) => `<option value="${u}" ${u === line.unit ? 'selected' : ''}>${u === 'ea' ? '개' : u === 'ml' && units.includes('ea') ? 'ml(즙)' : u}</option>`).join('')}</select>
    <button type="button" class="small danger" data-rm>✕</button>
  </div>`;
}

async function loadMenus() {
  [state.ingredients, state.menus] = await Promise.all([api('/ingredients'), api('/menu-items')]);
  $('#menu-list').innerHTML = state.menus.map((m) => `
    <div class="menu-card" data-menu="${m.id}">
      <header>
        <strong>${esc(m.name)}</strong>
        <span class="muted">${m.toss_item_id ? `토스 ID ${esc(m.toss_item_id)}` : '이름 매칭'}</span>
        <button class="small danger" data-del-menu>삭제</button>
      </header>
      <div class="lines">${m.recipe.map(recipeLineHtml).join('')}</div>
      <div class="row" style="margin-top:8px">
        <button type="button" class="small secondary" data-add-line>+ 재료</button>
        <button type="button" class="small" data-save-recipe>레시피 저장</button>
      </div>
    </div>`).join('') || '<p class="muted">등록된 메뉴가 없습니다.</p>';
}

$('#menu-list').addEventListener('change', (e) => {
  if (e.target.dataset.f !== 'ingredient_id') return;
  const lineEl = e.target.closest('.recipe-line');
  lineEl.outerHTML = recipeLineHtml({ ingredient_id: e.target.value, amount: $('[data-f=amount]', lineEl).value });
});

$('#menu-list').addEventListener('click', (e) => {
  const card = e.target.closest('[data-menu]');
  if (!card) return;
  const id = card.dataset.menu;
  if (e.target.matches('[data-add-line]')) {
    if (!state.ingredients.length) return toast('재료를 먼저 등록하세요');
    $('.lines', card).insertAdjacentHTML('beforeend', recipeLineHtml());
  }
  if (e.target.matches('[data-rm]')) e.target.closest('.recipe-line').remove();
  if (e.target.matches('[data-save-recipe]')) {
    const lines = $$('.recipe-line', card).map((l) => ({
      ingredient_id: Number($('[data-f=ingredient_id]', l).value),
      amount: Number($('[data-f=amount]', l).value),
      unit: $('[data-f=unit]', l).value,
    }));
    run(async () => { await api(`/menu-items/${id}/recipe`, { method: 'PUT', body: { lines } }); toast('레시피를 저장했습니다'); });
  }
  if (e.target.matches('[data-del-menu]') && confirm('메뉴를 삭제할까요?')) {
    run(async () => { await api(`/menu-items/${id}`, { method: 'DELETE' }); loadMenus(); });
  }
});

// ── 기록 / 발주 ─────────────────────────────────────
const reasonLabel = { SALE: '판매', CANCEL: '취소', RESTOCK: '입고', ADJUST: '실사', WASTE: '폐기' };
const poStatus = { DRAFT: '발주 전', SENT: '발주 완료', RECEIVED: '입고 완료' };

async function loadHistory() {
  const [unmapped, pos, mv] = await Promise.all([api('/unmapped'), api('/purchase-orders'), api('/movements?limit=200')]);
  $('#unmapped-rows').innerHTML = unmapped.map((u) => `
    <tr><td>${esc(u.name)}</td><td>${esc(u.toss_item_id ?? '-')}</td><td>${esc(u.count)}</td>
    <td><button class="small secondary" data-unmapped="${esc(u.key)}">확인</button></td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">없음</td></tr>';
  $('#po-list').innerHTML = pos.map((p) => `
    <div class="po"><strong>#${p.id}</strong> <span class="muted">${esc(p.created_at)} · ${poStatus[p.status] ?? esc(p.status)}</span>
    <pre>${p.lines.map((l) => `${esc(l.name)} ${esc(l.qty)}`).join('\n')}</pre></div>`).join('')
    || '<p class="muted">없음</p>';
  $('#mv-rows').innerHTML = mv.map((m) => `
    <tr><td>${esc(m.created_at)}</td><td>${esc(m.ingredient_name)}</td>
    <td>${m.delta > 0 ? '+' : ''}${Math.round(m.delta * 100) / 100}</td>
    <td>${reasonLabel[m.reason] ?? esc(m.reason)}${m.note ? ` · ${esc(m.note)}` : ''}</td><td>${esc(m.ref ?? '')}</td></tr>`).join('');
}

$('#unmapped-rows').addEventListener('click', (e) => {
  const b = e.target.closest('[data-unmapped]');
  if (b) run(async () => { await api(`/unmapped/${encodeURIComponent(b.dataset.unmapped)}`, { method: 'DELETE' }); loadHistory(); });
});

// ── 설정 ────────────────────────────────────────────
function output(data) {
  const o = $('#output');
  o.hidden = false;
  o.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function loadSettings() {
  const [status, menus] = await Promise.all([api('/status'), api('/menu-items')]);
  const s = status.settings;
  const ok = (v) => (v ? '✅' : '❌');
  $('#status').innerHTML = `
    <li>${ok(status.toss)} 토스 API 키</li>
    <li>${ok(status.tossWebhookSecret)} 토스 웹훅 서명 secret</li>
    <li>${ok(status.telegram)} 텔레그램 봇</li>
    <li class="muted">마지막 토스 동기화: ${esc(s.last_sync_at || '없음')} · 마지막 리포트: ${esc(s.last_report_day || '없음')}</li>`;
  const f = $('#settings-form');
  f.closing_time.value = s.closing_time || '';
  f.business_day_start.value = s.business_day_start || '';
  $('#manual-menu').innerHTML = menus.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  run(async () => { await api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('저장했습니다'); });
});
$('#btn-report').addEventListener('click', () => run(async () => { await api('/report/send', { method: 'POST' }); toast('리포트를 보냈습니다'); }));
$('#btn-tg-setup').addEventListener('click', () => run(async () => output(await api('/telegram/setup', { method: 'POST' }))));
$('#btn-sync').addEventListener('click', () => run(async () => output(await api('/toss/sync', { method: 'POST' }))));
$('#btn-toss-sample').addEventListener('click', () => run(async () => output(await api('/toss/orders?size=3'))));
$('#btn-logout').addEventListener('click', () => { try { localStorage.removeItem('adminToken'); } catch {} token = ''; showLogin(); });

$('#manual-sale').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  run(async () => output(await api('/sales/manual', { method: 'POST', body: { menu_item_id: Number(body.menu_item_id), quantity: Number(body.quantity) } })));
});

// ── 시작 ────────────────────────────────────────────
$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  token = $('#token').value.trim();
  try { localStorage.setItem('adminToken', token); } catch {}
  $('#login').hidden = true;
  let tab = 'stock';
  try { tab = localStorage.getItem('tab') || 'stock'; } catch {}
  openTab(tab);
});

if (!token) showLogin();
else {
  let tab = 'stock';
  try { tab = localStorage.getItem('tab') || 'stock'; } catch {}
  openTab(tab);
}
