const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let token = '';
try { token = localStorage.getItem('adminToken') || ''; } catch {}

const state = { ingredients: [], menus: [] };
const reasonLabel = { SALE: '판매', CANCEL: '취소', RESTOCK: '입고', ADJUST: '현재 양 입력', WASTE: '폐기' };

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
const statusText = { empty: '재고 없음', low: '발주 필요', ok: '충분' };
const kst = (utc) => new Date(String(utc).replace(' ', 'T') + 'Z')
  .toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** 수량 입력 창. ml 재료는 "병 + ml", 나머지는 개수. 결과는 API에 보낼 문자열 */
function askQuantity(ing, title, hint) {
  const dlg = $('#qty-dialog');
  const f = $('#qty-form');
  const isMl = ing.unit === 'ml' && ing.container_size > 1;
  $('#qty-title').textContent = title;
  $('#qty-hint').textContent = hint || '';
  $('#qty-label').textContent = isMl ? ing.container_label : unitLabel(ing);
  $('.ml-extra', f).hidden = !isMl;
  f.bottles.value = '';
  f.ml.value = '';
  dlg.showModal();
  f.bottles.focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      const b = Number(f.bottles.value || 0);
      const ml = Number(f.ml.value || 0);
      if (!b && !ml && f.bottles.value === '' && f.ml.value === '') return resolve(null);
      resolve(isMl ? `${b}병+${ml}ml` : String(b));
    }, { once: true });
  });
}

async function loadStock() {
  state.ingredients = await api('/ingredients');
  const list = state.ingredients;
  const order = { empty: 0, low: 1, ok: 2 };
  const sorted = [...list].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const count = (st) => list.filter((i) => i.status === st).length;
  $('#stock-summary').innerHTML = list.length
    ? `<span>전체 ${list.length}</span><span class="danger">재고 없음 ${count('empty')}</span><span class="warn">발주 필요 ${count('low')}</span><span>충분 ${count('ok')}</span>`
    : '';
  $('#stock-cards').innerHTML = sorted.length ? sorted.map(stockCard).join('') : '<p class="muted">재료 탭에서 재료를 먼저 등록하세요.</p>';
}

function stockCard(i) {
  const isMl = i.unit === 'ml' && i.container_size > 1;
  const sub = isMl && i.status !== 'empty' ? `<small>${i.containers}${esc(i.container_label)}</small>` : '';
  const ref = `발주 기준 ${esc(i.reorder_point)}${esc(unitLabel(i))} 이하${i.par_level != null ? ` · 적정 ${esc(i.par_level)}${esc(unitLabel(i))}` : ''}`;
  const notice = i.status === 'empty'
    ? `<div class="notice">${i.shortage ? `장부상 ${esc(i.shortage)} 더 사용됨. ` : ''}지금 남은 양을 <b>현재 양 입력</b>으로 맞춰 주세요.</div>`
    : '';
  return `
    <div class="card ${i.status}" data-id="${i.id}">
      <div class="card-head"><span class="card-name">${esc(i.name)}</span><span class="chip ${i.status}">${statusText[i.status]}</span></div>
      <div class="amount">${esc(i.display)}${sub}</div>
      <div class="gauge"><i style="width:${i.gauge.percent}%"></i><b style="left:${i.gauge.reorderPercent}%" title="발주 기준"></b></div>
      <div class="muted">${ref}</div>
      ${notice}
      <div class="row">
        <button class="small" data-act="restock">입고</button>
        <button class="small secondary" data-act="count">현재 양 입력</button>
        <button class="small secondary" data-act="waste">폐기</button>
        <button class="small secondary" data-act="history">기록</button>
      </div>
      <div class="card-history" hidden></div>
    </div>`;
}

$('#stock-cards').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const card = b.closest('.card');
  const ing = state.ingredients.find((i) => i.id === Number(card.dataset.id));
  const act = b.dataset.act;
  if (act === 'history') {
    const box = $('.card-history', card);
    if (!box.hidden) return (box.hidden = true);
    return run(async () => {
      const mv = await api(`/movements?ingredient_id=${ing.id}&limit=10`);
      box.innerHTML = mv.length
        ? mv.map((m) => `<div><span>${kst(m.created_at)} ${reasonLabel[m.reason] ?? ''}</span><span class="${m.delta > 0 ? 'plus' : 'minus'}">${esc(m.delta_display)}</span><span>→ ${esc(m.balance_display)}</span></div>`).join('')
        : '<div class="muted">기록 없음</div>';
      box.hidden = false;
    });
  }
  const isMl = ing.unit === 'ml' && ing.container_size > 1;
  const titles = {
    restock: [`${ing.name} 입고`, isMl ? `새로 들어온 양 (예: 2병, 또는 0병 + 350ml)` : '새로 들어온 개수'],
    count: [`${ing.name} 현재 양 입력`, isMl ? `지금 실제로 남은 양 (예: 1병 + 300ml, 따놓은 병은 ml로)` : '지금 실제로 남은 개수'],
    waste: [`${ing.name} 폐기`, '버린 양'],
  };
  const q = await askQuantity(ing, ...titles[act]);
  if (q === null) return;
  run(async () => {
    const r = await api(`/ingredients/${ing.id}/${act}`, { method: 'POST', body: { quantity: q } });
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
let menuFilter = 'todo';
let openMenuId = null;

$('#menu-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  run(async () => { await api('/menu-items', { method: 'POST', body }); e.target.reset(); loadMenus(); });
});

async function importMenus(source) {
  const r = await api(`/toss/import-menus?source=${source}`, { method: 'POST' });
  toast(`메뉴 ${r.total}개 확인 · 새로 추가 ${r.added.length}개 · 갱신 ${r.updated}개`);
  menuFilter = 'todo';
  loadMenus();
}
$('#btn-import-catalog').addEventListener('click', () => run(() => importMenus('catalog')));
$('#btn-import-orders').addEventListener('click', () => run(() => importMenus('orders')));

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

const menuStateText = { todo: '레시피 필요', done: '레시피 완료', ignored: '차감 안 함' };

async function loadMenus() {
  [state.ingredients, state.menus] = await Promise.all([api('/ingredients'), api('/menu-items')]);
  renderMenus();
}

function renderMenus() {
  const counts = { todo: 0, done: 0, ignored: 0 };
  state.menus.forEach((m) => counts[m.state]++);
  $('#menu-filters').innerHTML = ['todo', 'done', 'ignored', 'all']
    .map((f) => `<button data-filter="${f}" class="${menuFilter === f ? 'active' : ''}">${f === 'all' ? `전체 ${state.menus.length}` : `${menuStateText[f]} ${counts[f]}`}</button>`)
    .join('');
  const q = $('#menu-search').value.trim().toLowerCase();
  const list = state.menus.filter((m) => (menuFilter === 'all' || m.state === menuFilter) && (!q || m.name.toLowerCase().includes(q)));
  if (!state.menus.length) {
    $('#menu-list').innerHTML = '<p class="muted">아직 메뉴가 없습니다. <b>토스 메뉴 불러오기</b>를 눌러 주세요.</p>';
    return;
  }
  $('#menu-list').innerHTML = list.map((m) => `
    <div class="menu-row" data-menu="${m.id}">
      <div class="menu-head">
        <div class="grow">
          <div>${esc(m.name)} ${m.kind === 'option' ? '<span class="muted">(옵션)</span>' : ''}</div>
          <div class="sub ${m.state === 'todo' ? 'todo' : ''}">${m.state === 'done' ? esc(m.recipe_summary) : m.state === 'ignored' ? '재고 차감 안 함' : '레시피를 입력해 주세요'}${m.category ? ` · ${esc(m.category)}` : ''}</div>
        </div>
        <span class="chip ${m.state === 'done' ? 'ok' : m.state === 'todo' ? 'low' : ''}">${menuStateText[m.state]}</span>
      </div>
      ${openMenuId === m.id ? menuBody(m) : ''}
    </div>`).join('') || '<p class="muted">해당하는 메뉴가 없습니다.</p>';
}

function menuBody(m) {
  return `<div class="menu-body">
    <div class="lines">${m.recipe.map(recipeLineHtml).join('')}</div>
    <div class="row">
      <button type="button" class="small secondary" data-add-line>+ 재료</button>
      <button type="button" class="small" data-save-recipe>레시피 저장</button>
      <span class="grow"></span>
      <button type="button" class="small secondary" data-toggle-active>${m.active ? '재고 차감 안 함으로' : '재고 차감 다시 켜기'}</button>
      <button type="button" class="small danger" data-del-menu>삭제</button>
    </div>
    <div class="muted" style="margin-top:6px">${m.toss_item_id ? `토스 상품 ID ${esc(m.toss_item_id)}` : '토스 ID 없음 · 이름으로 매칭'}</div>
  </div>`;
}

$('#menu-search').addEventListener('input', renderMenus);
$('#menu-filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (b) { menuFilter = b.dataset.filter; renderMenus(); }
});

$('#menu-list').addEventListener('change', (e) => {
  if (e.target.dataset.f !== 'ingredient_id') return;
  const lineEl = e.target.closest('.recipe-line');
  lineEl.outerHTML = recipeLineHtml({ ingredient_id: e.target.value, amount: $('[data-f=amount]', lineEl).value });
});

$('#menu-list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-menu]');
  if (!row) return;
  const id = Number(row.dataset.menu);
  const m = state.menus.find((x) => x.id === id);
  if (e.target.closest('.menu-head')) {
    openMenuId = openMenuId === id ? null : id;
    renderMenus();
    if (openMenuId && !m.recipe.length && state.ingredients.length) $('.lines', $(`[data-menu="${id}"]`)).insertAdjacentHTML('beforeend', recipeLineHtml());
    return;
  }
  if (e.target.matches('[data-add-line]')) {
    if (!state.ingredients.length) return toast('재료 탭에서 재료를 먼저 등록하세요');
    $('.lines', row).insertAdjacentHTML('beforeend', recipeLineHtml());
  }
  if (e.target.matches('[data-rm]')) e.target.closest('.recipe-line').remove();
  if (e.target.matches('[data-save-recipe]')) {
    const lines = $$('.recipe-line', row)
      .map((l) => ({
        ingredient_id: Number($('[data-f=ingredient_id]', l).value),
        amount: Number($('[data-f=amount]', l).value),
        unit: $('[data-f=unit]', l).value,
      }))
      .filter((l) => l.amount > 0);
    run(async () => {
      await api(`/menu-items/${id}/recipe`, { method: 'PUT', body: { lines } });
      toast(`${m.name} 레시피를 저장했습니다`);
      openMenuId = null;
      loadMenus();
    });
  }
  if (e.target.matches('[data-toggle-active]')) {
    run(async () => { await api(`/menu-items/${id}`, { method: 'PATCH', body: { active: !m.active } }); loadMenus(); });
  }
  if (e.target.matches('[data-del-menu]') && confirm('메뉴를 삭제할까요?')) {
    run(async () => { await api(`/menu-items/${id}`, { method: 'DELETE' }); loadMenus(); });
  }
});

// ── 기록 / 발주 ─────────────────────────────────────

const poStatus = { DRAFT: '발주 전', SENT: '발주 완료', RECEIVED: '입고 완료' };

async function loadHistory() {
  const [unmapped, pos, mv] = await Promise.all([api('/unmapped'), api('/purchase-orders'), api('/movements?limit=200')]);
  $('#unmapped-rows').innerHTML = unmapped.map((u) => `
    <tr><td>${esc(u.name)}</td><td>${esc(u.toss_item_id ?? '-')}</td><td>${esc(u.count)}</td>
    <td class="row"><button class="small" data-register="${esc(u.key)}">메뉴로 등록</button>
    <button class="small secondary" data-unmapped="${esc(u.key)}">무시</button></td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">없음</td></tr>';
  $('#po-list').innerHTML = pos.map((p) => `
    <div class="po"><strong>#${p.id}</strong> <span class="muted">${kst(p.created_at)} · ${poStatus[p.status] ?? esc(p.status)}</span>
    <pre>${p.lines.map((l) => `${esc(l.name)} ${esc(l.qty)}`).join('\n')}</pre></div>`).join('')
    || '<p class="muted">없음</p>';
  $('#mv-rows').innerHTML = mv.map((m) => `
    <tr><td>${kst(m.created_at)}</td><td>${esc(m.ingredient_name)}</td>
    <td class="${m.delta > 0 ? 'plus' : 'minus'}">${esc(m.delta_display)}</td>
    <td>${esc(m.balance_display)}</td>
    <td>${reasonLabel[m.reason] ?? esc(m.reason)}${m.note ? ` · ${esc(m.note)}` : ''}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">없음</td></tr>';
}

$('#unmapped-rows').addEventListener('click', (e) => {
  const ignore = e.target.closest('[data-unmapped]');
  const reg = e.target.closest('[data-register]');
  if (ignore) run(async () => { await api(`/unmapped/${encodeURIComponent(ignore.dataset.unmapped)}`, { method: 'DELETE' }); loadHistory(); });
  if (reg) run(async () => {
    await api(`/unmapped/${encodeURIComponent(reg.dataset.register)}/register`, { method: 'POST' });
    toast('메뉴로 등록했습니다. 메뉴·레시피 탭에서 레시피를 입력하세요');
    loadHistory();
  });
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
