// ── 공통 ────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get: (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

let token = store.get('adminToken');

const CATS = [
  ['all', '전체'], ['liquor', '술'], ['beer', '맥주'], ['syrup', '시럽'], ['fruit', '과일'], ['etc', '기타'],
];
const CAT_LABEL = Object.fromEntries(CATS);
const CAT_ORDER = CATS.map(([k]) => k);
const REASON = { SALE: '판매', CANCEL: '취소', RESTOCK: '입고', ADJUST: '실사', WASTE: '폐기' };
const STATUS = { empty: '재고 없음', low: '발주 필요', ok: '정상' };

const state = { ingredients: [], menus: [] };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('로그인이 필요합니다'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

async function run(fn) {
  try { return await fn(); } catch (e) { toast(e.message); }
}

/** D1의 'YYYY-MM-DD HH:MM:SS'(UTC) 또는 ISO → 한국 시간 "10.16 23:40" */
function kst(v) {
  if (!v) return '';
  const d = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return `${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

const unitLabel = (i) => i.container_label || (i.unit === 'ml' ? '병' : '개');
const isBottle = (i) => i.unit === 'ml' && i.container_size > 1;
const byCategory = (list) => CAT_ORDER.slice(1)
  .map((c) => [c, list.filter((i) => i.category === c)])
  .concat([['other', list.filter((i) => !CAT_ORDER.includes(i.category))]])
  .filter(([, l]) => l.length);
const matches = (i, q) => !q || i.name.toLowerCase().includes(q) || (i.order_alias || '').toLowerCase().includes(q);

function chips(el, active, onPick, counts) {
  el.innerHTML = CATS.map(([k, label]) => {
    const n = counts?.[k];
    return `<button data-cat="${k}" class="${k === active ? 'active' : ''}">${label}${n != null ? ` ${n}` : ''}</button>`;
  }).join('');
  el.onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) onPick(b.dataset.cat); };
}

// ── 탭 ──────────────────────────────────────────────
const loaders = { stock: loadStock, entry: loadEntry, menus: loadMenus, history: loadHistory, settings: loadSettings };

function openTab(name) {
  if (!loaders[name]) name = 'stock';
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  $('#login').hidden = true;
  store.set('tab', name);
  window.scrollTo(0, 0);
  run(loaders[name]);
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) openTab(b.dataset.tab); });

function showLogin() {
  $('#login').hidden = false;
  $$('[data-panel]').forEach((p) => (p.hidden = true));
  $('#token').focus();
}

// ── 재고 ────────────────────────────────────────────
const stockView = { q: '', cat: 'all', lowOnly: false, open: null };

async function loadStock() {
  state.ingredients = await api('/ingredients');
  renderStock();
}

function renderStock() {
  const all = state.ingredients;
  const count = (s) => all.filter((i) => i.status === s).length;
  $('#stock-summary').innerHTML = `
    <button class="stat empty ${stockView.lowOnly ? 'active' : ''}" data-low><b>${count('empty')}</b><span>재고 없음</span></button>
    <button class="stat low ${stockView.lowOnly ? 'active' : ''}" data-low><b>${count('low')}</b><span>발주 필요</span></button>
    <button class="stat" data-all><b>${all.length}</b><span>전체 재료</span></button>`;
  const catCounts = Object.fromEntries(CATS.map(([k]) => [k, k === 'all' ? all.length : all.filter((i) => i.category === k).length]));
  chips($('#stock-cats'), stockView.cat, (c) => { stockView.cat = c; renderStock(); }, catCounts);
  $('#stock-low-only').checked = stockView.lowOnly;

  const q = stockView.q.toLowerCase();
  const rank = { empty: 0, low: 1, ok: 2 };
  const list = all
    .filter((i) => (stockView.cat === 'all' || i.category === stockView.cat) && (!stockView.lowOnly || i.status !== 'ok') && matches(i, q))
    .sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, 'ko'));

  if (!all.length) {
    $('#stock-list').innerHTML = '<div class="empty-state">등록된 재료가 없습니다. 메뉴 탭의 <b>가게 레시피 넣기</b>나 <b>재료 추가</b>로 시작하세요.</div>';
    return;
  }
  if (!list.length) {
    $('#stock-list').innerHTML = `<div class="empty-state">${stockView.lowOnly ? '부족한 재료가 없습니다.' : '조건에 맞는 재료가 없습니다.'}</div>`;
    return;
  }
  $('#stock-list').innerHTML = byCategory(list)
    .map(([c, items]) => `<div class="group-title">${CAT_LABEL[c] ?? '기타'} ${items.length}</div><div class="list two">${items.map(stockRow).join('')}</div>`)
    .join('');
}

function stockRow(i) {
  const empty = i.status === 'empty';
  const amount = empty ? `0${esc(unitLabel(i))}` : esc(i.display);
  const sub = isBottle(i) && !empty ? `<small>${i.containers}${esc(i.container_label)}</small>` : '';
  const par = i.par_level != null ? ` · 적정 ${esc(i.par_level)}${esc(unitLabel(i))}` : '';
  // 장부가 0 아래로 내려간 경우만 안내 (입력 전 판매 등)
  const notice = i.shortage ? `<div class="notice">장부상 ${esc(i.shortage)} 더 사용됨. 실제 남은 양을 실사로 맞춰 주세요.</div>` : '';
  const open = stockView.open === i.id;
  return `
    <div class="item stock-row" data-id="${i.id}">
      <div class="line">
        <div><div class="name">${esc(i.name)}</div><div class="meta">기준 ${esc(i.reorder_point)}${esc(unitLabel(i))} 이하${par}</div></div>
        <div class="amount">${amount}${sub}</div>
        <span class="pill ${i.status}">${STATUS[i.status]}</span>
      </div>
      <div class="bar ${i.status}"><i style="width:${i.gauge.percent}%"></i><b style="left:${i.gauge.reorderPercent}%"></b></div>
      ${notice}
      ${open ? `<div class="row-actions">
        <button class="sm primary" data-act="restock">입고</button>
        <button class="sm" data-act="count">실사</button>
        <button class="sm" data-act="waste">폐기</button>
        <button class="sm" data-act="history">기록</button>
        <button class="sm" data-act="edit">설정 수정</button>
      </div><div class="history-box" hidden></div>` : ''}
    </div>`;
}

$('#stock-search').addEventListener('input', (e) => { stockView.q = e.target.value; renderStock(); });
$('#stock-low-only').addEventListener('change', (e) => { stockView.lowOnly = e.target.checked; renderStock(); });
$('#stock-summary').addEventListener('click', (e) => {
  if (e.target.closest('[data-low]')) stockView.lowOnly = !stockView.lowOnly;
  else if (e.target.closest('[data-all]')) { stockView.lowOnly = false; stockView.cat = 'all'; stockView.q = ''; $('#stock-search').value = ''; }
  else return;
  renderStock();
});

$('#stock-list').addEventListener('click', async (e) => {
  const rowEl = e.target.closest('.stock-row');
  if (!rowEl) return;
  const ing = state.ingredients.find((i) => i.id === Number(rowEl.dataset.id));
  const btn = e.target.closest('[data-act]');
  if (!btn) {
    stockView.open = stockView.open === ing.id ? null : ing.id;
    return renderStock();
  }
  const act = btn.dataset.act;
  if (act === 'edit') return openIngredientDialog(ing);
  if (act === 'history') {
    const box = $('.history-box', rowEl);
    if (!box.hidden) return (box.hidden = true);
    return run(async () => {
      const mv = await api(`/movements?ingredient_id=${ing.id}&limit=10`);
      box.innerHTML = mv.length
        ? mv.map((m) => `<div class="h"><span class="muted">${kst(m.created_at)}</span><span>${REASON[m.reason] ?? ''} <span class="${m.delta > 0 ? 'plus' : 'minus'}">${esc(m.delta_display)}</span></span><span>${esc(m.balance_display)}</span></div>`).join('')
        : '<div class="muted">기록 없음</div>';
      box.hidden = false;
    });
  }
  const q = await askQuantity(ing, act);
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
$('#btn-add-ingredient').addEventListener('click', () => openIngredientDialog(null));

/** 수량 입력 창. 병 재료는 "병 + ml", 나머지는 개수. API에 보낼 문자열을 돌려줌 */
function askQuantity(ing, act) {
  const dlg = $('#qty-dialog');
  const f = $('#qty-form');
  const bottle = isBottle(ing);
  const titles = { restock: '입고', count: '실사 (지금 남은 양)', waste: '폐기' };
  const hints = {
    restock: bottle ? '새로 들어온 양. 예) 2병, 또는 0병 + 350ml' : '새로 들어온 개수',
    count: bottle ? '지금 실제로 남은 양. 따 놓은 병은 ml로' : '지금 실제로 남은 개수',
    waste: '버린 양',
  };
  $('#qty-title').textContent = `${ing.name} ${titles[act]}`;
  $('#qty-hint').textContent = `${hints[act]} · 현재 ${ing.display}`;
  $('#qty-label').textContent = bottle ? ing.container_label : unitLabel(ing);
  $('.ml-extra', f).hidden = !bottle;
  f.bottles.value = '';
  f.ml.value = '';
  dlg.showModal();
  f.bottles.focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok' || (f.bottles.value === '' && f.ml.value === '')) return resolve(null);
      const b = Number(f.bottles.value || 0);
      resolve(bottle ? `${b}병+${Number(f.ml.value || 0)}ml` : String(b));
    }, { once: true });
  });
}

// ── 재료 추가/수정 ──────────────────────────────────
const ingForm = $('#ing-form');
const ingDialog = $('#ing-dialog');

function syncUnitFields() {
  const unit = ingForm.unit.value;
  $$('.ml-only', ingForm).forEach((el) => (el.hidden = unit !== 'ml'));
  $$('.ea-only', ingForm).forEach((el) => (el.hidden = unit !== 'ea'));
  if (!ingForm.container_label.value || ['병', '개'].includes(ingForm.container_label.value)) {
    ingForm.container_label.value = unit === 'ml' ? '병' : '개';
  }
}
ingForm.unit.addEventListener('change', syncUnitFields);

function openIngredientDialog(ing) {
  ingForm.reset();
  ingForm.id.value = ing?.id ?? '';
  if (ing) for (const el of ingForm.elements) if (el.name && el.name in ing) el.value = ing[el.name] ?? '';
  $('#ing-title').textContent = ing ? `${ing.name} 설정` : '재료 추가';
  $('#ing-delete').hidden = !ing;
  $$('.new-only', ingForm).forEach((el) => (el.hidden = Boolean(ing)));
  syncUnitFields();
  ingDialog.showModal();
}
$('#ing-cancel').addEventListener('click', () => ingDialog.close());

ingForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(ingForm));
  const id = body.id;
  delete body.id;
  run(async () => {
    await api(id ? `/ingredients/${id}` : '/ingredients', { method: id ? 'PUT' : 'POST', body });
    ingDialog.close();
    toast('저장했습니다');
    loadStock();
  });
});

$('#ing-delete').addEventListener('click', () => {
  if (!confirm('이 재료를 삭제할까요? 레시피와 재고 기록도 함께 지워집니다.')) return;
  run(async () => {
    await api(`/ingredients/${ingForm.id.value}`, { method: 'DELETE' });
    ingDialog.close();
    loadStock();
  });
});

// ── 입고·실사 (여러 개 한 번에) ─────────────────────
const entry = { mode: 'restock', q: '', cat: 'all', values: new Map() };
const ENTRY_HINT = {
  restock: '물건이 들어오면 들어온 양만 적고 저장하세요. 병은 병 수, 따 놓은 양은 ml 칸에.',
  count: '마감 때 실제로 남은 양을 적으면 장부를 그 양으로 맞춥니다. 적지 않은 재료는 그대로 둡니다.',
  waste: '깨지거나 버린 양을 적으세요.',
};

async function loadEntry() {
  state.ingredients = await api('/ingredients');
  renderEntry();
}

function renderEntry() {
  $$('#entry-modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === entry.mode));
  $('#entry-hint').textContent = ENTRY_HINT[entry.mode];
  chips($('#entry-cats'), entry.cat, (c) => { entry.cat = c; renderEntry(); });
  const q = entry.q.toLowerCase();
  const list = state.ingredients
    .filter((i) => (entry.cat === 'all' || i.category === entry.cat) && matches(i, q))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  $('#entry-list').innerHTML = list.length
    ? byCategory(list).map(([c, items]) => `<div class="group-title">${CAT_LABEL[c] ?? '기타'}</div><div class="list">${items.map(entryRow).join('')}</div>`).join('')
    : '<div class="empty-state">재료가 없습니다.</div>';
  updateEntryBar();
}

function entryRow(i) {
  const v = entry.values.get(i.id) ?? {};
  const filled = (v.b ?? '') !== '' || (v.ml ?? '') !== '';
  return `
    <div class="item entry-row ${filled ? 'filled' : ''}" data-id="${i.id}">
      <div><div class="name">${esc(i.name)}</div><div class="meta">현재 ${esc(i.display)}</div></div>
      <div class="qty">
        <input data-k="b" type="number" min="0" step="any" inputmode="decimal" value="${esc(v.b ?? '')}" placeholder="0" aria-label="${esc(i.name)} ${esc(unitLabel(i))}" />
        <span>${esc(unitLabel(i))}</span>
        ${isBottle(i) ? `<input data-k="ml" type="number" min="0" step="any" inputmode="decimal" value="${esc(v.ml ?? '')}" placeholder="0" aria-label="${esc(i.name)} ml" /><span>ml</span>` : ''}
      </div>
    </div>`;
}

function entryItems() {
  const out = [];
  for (const [id, v] of entry.values) {
    if ((v.b ?? '') === '' && (v.ml ?? '') === '') continue;
    const ing = state.ingredients.find((i) => i.id === id);
    if (!ing) continue;
    const b = Number(v.b || 0);
    out.push({ id, quantity: isBottle(ing) ? `${b}병+${Number(v.ml || 0)}ml` : String(b) });
  }
  return out;
}

function updateEntryBar() {
  const n = entryItems().length;
  $('#entry-bar').hidden = n === 0;
  $('#entry-count').textContent = `${n}개 입력됨`;
  $('#entry-save').textContent = { restock: '입고 저장', count: '실사 저장', waste: '폐기 저장' }[entry.mode];
}

$('#entry-modes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === entry.mode) return;
  if (entry.values.size && !confirm('입력한 값을 지우고 바꿀까요?')) return;
  entry.mode = b.dataset.mode;
  entry.values.clear();
  renderEntry();
});
$('#entry-search').addEventListener('input', (e) => { entry.q = e.target.value; renderEntry(); });
$('#entry-list').addEventListener('input', (e) => {
  const inp = e.target.closest('input[data-k]');
  if (!inp) return;
  const row = inp.closest('.entry-row');
  const id = Number(row.dataset.id);
  const v = { ...(entry.values.get(id) ?? {}), [inp.dataset.k]: inp.value };
  entry.values.set(id, v);
  row.classList.toggle('filled', (v.b ?? '') !== '' || (v.ml ?? '') !== '');
  updateEntryBar();
});
$('#entry-clear').addEventListener('click', () => { entry.values.clear(); renderEntry(); });
$('#entry-save').addEventListener('click', () => run(async () => {
  const items = entryItems();
  const r = await api('/stock/bulk', { method: 'POST', body: { mode: entry.mode, items } });
  toast(`${r.changed}개 재료를 저장했습니다`);
  entry.values.clear();
  loadEntry();
}));

// ── 메뉴 / 레시피 ───────────────────────────────────
const menuView = { filter: 'todo', q: '', open: null };
const MENU_STATE = { todo: '레시피 필요', done: '완료', ignored: '차감 안 함' };

async function loadMenus() {
  [state.ingredients, state.menus] = await Promise.all([api('/ingredients'), api('/menu-items')]);
  renderMenus();
}

function recipeUnits(ingredientId) {
  const i = state.ingredients.find((x) => x.id === Number(ingredientId));
  if (!i) return ['ml'];
  if (i.unit === 'ea' && i.yield_ml) return ['ml', 'ea'];
  return [i.unit];
}

function recipeLineHtml(line = {}) {
  const ingId = line.ingredient_id ?? state.ingredients[0]?.id;
  const units = recipeUnits(ingId);
  const sorted = [...state.ingredients].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return `<div class="recipe-line">
    <select data-f="ingredient_id">${sorted.map((i) => `<option value="${i.id}" ${i.id === Number(ingId) ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
    <input data-f="amount" type="number" step="any" inputmode="decimal" value="${esc(line.amount ?? '')}" placeholder="양" />
    <select data-f="unit">${units.map((u) => `<option value="${u}" ${u === line.unit ? 'selected' : ''}>${u === 'ea' ? '개' : u === 'ml' && units.includes('ea') ? 'ml (즙)' : u}</option>`).join('')}</select>
    <button type="button" class="sm" data-rm>빼기</button>
  </div>`;
}

function renderMenus() {
  const counts = { todo: 0, done: 0, ignored: 0 };
  state.menus.forEach((m) => counts[m.state]++);
  $('#menu-filters').innerHTML = ['todo', 'done', 'ignored', 'all']
    .map((f) => `<button data-filter="${f}" class="${menuView.filter === f ? 'active' : ''}">${f === 'all' ? '전체' : MENU_STATE[f]} ${f === 'all' ? state.menus.length : counts[f]}</button>`)
    .join('');
  if (!state.menus.length) {
    $('#menu-list').innerHTML = '<div class="empty-state">메뉴가 없습니다. <b>토스 메뉴 불러오기</b>를 눌러 주세요.</div>';
    return;
  }
  const q = menuView.q.trim().toLowerCase();
  const list = state.menus
    .filter((m) => (menuView.filter === 'all' || m.state === menuView.filter) && (!q || m.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  $('#menu-list').innerHTML = list.length
    ? `<div class="list">${list.map(menuRow).join('')}</div>`
    : `<div class="empty-state">${menuView.filter === 'todo' ? '레시피가 필요한 메뉴가 없습니다.' : '해당하는 메뉴가 없습니다.'}</div>`;
}

function menuRow(m) {
  const sub = m.state === 'done' ? esc(m.recipe_summary) : m.state === 'ignored' ? '판매돼도 재고를 빼지 않음' : '레시피를 넣어 주세요';
  const pill = { done: 'ok', todo: 'low', ignored: 'neutral' }[m.state];
  return `
    <div class="item menu-row" data-menu="${m.id}">
      <div class="head">
        <div>
          <div class="name">${esc(m.name)}${m.kind === 'option' ? ' <span class="muted">옵션</span>' : ''}</div>
          <div class="sub ${m.state === 'todo' ? 'todo' : ''}">${sub}${m.category ? ` · ${esc(m.category)}` : ''}</div>
          ${m.toss_item_id ? '' : '<div class="sub bad">토스 상품 ID 없음: 판매와 연결되지 않습니다</div>'}
        </div>
        <span class="pill ${pill}">${MENU_STATE[m.state]}</span>
      </div>
      ${menuView.open === m.id ? `<div class="menu-body">
        <div class="lines">${(m.recipe.length ? m.recipe : [{}]).map(recipeLineHtml).join('')}</div>
        <div class="row-actions">
          <button type="button" class="sm" data-add-line>재료 추가</button>
          <span class="grow"></span>
          <button type="button" class="sm" data-toggle-active>${m.active ? '차감 안 함으로' : '차감 다시 켜기'}</button>
          <button type="button" class="sm primary" data-save-recipe>저장</button>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px">${m.toss_item_id ? `토스 상품 ID ${esc(m.toss_item_id)}` : ''}</div>
      </div>` : ''}
    </div>`;
}

$('#menu-search').addEventListener('input', (e) => { menuView.q = e.target.value; renderMenus(); });
$('#menu-filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (b) { menuView.filter = b.dataset.filter; renderMenus(); }
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
  if (e.target.closest('.head')) {
    if (!state.ingredients.length) return toast('재료가 없습니다. 가게 레시피 넣기나 재료 추가를 먼저 하세요');
    menuView.open = menuView.open === id ? null : id;
    return renderMenus();
  }
  if (e.target.matches('[data-add-line]')) $('.lines', row).insertAdjacentHTML('beforeend', recipeLineHtml());
  if (e.target.matches('[data-rm]')) e.target.closest('.recipe-line').remove();
  if (e.target.matches('[data-save-recipe]')) {
    const lines = $$('.recipe-line', row)
      .map((l) => ({ ingredient_id: Number($('[data-f=ingredient_id]', l).value), amount: Number($('[data-f=amount]', l).value), unit: $('[data-f=unit]', l).value }))
      .filter((l) => l.amount > 0);
    run(async () => {
      await api(`/menu-items/${id}/recipe`, { method: 'PUT', body: { lines } });
      toast(`${m.name} 레시피를 저장했습니다`);
      menuView.open = null;
      loadMenus();
    });
  }
  if (e.target.matches('[data-toggle-active]')) {
    run(async () => { await api(`/menu-items/${id}`, { method: 'PATCH', body: { active: !m.active } }); loadMenus(); });
  }
});

async function importMenus(source) {
  const r = await api(`/toss/import-menus?source=${source}`, { method: 'POST' });
  toast(`토스 메뉴 ${r.total}개 확인 · 새로 ${r.added.length}개 · 갱신 ${r.updated}개`);
  menuView.filter = 'todo';
  loadMenus();
}
$('#btn-import-catalog').addEventListener('click', () => run(() => importMenus('catalog')));

$('#btn-seed').addEventListener('click', () => {
  if (!confirm('가게 레시피를 토스 메뉴에 넣습니다. 이미 넣은 레시피와 재료는 그대로 둡니다. 진행할까요?')) return;
  run(async () => {
    const r = await api('/seed/house-recipes', { method: 'POST' });
    const sec = (title, items, cls = '') => (items.length ? `<h3 class="${cls}">${title}</h3><ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : '');
    const similar = r.recipesSet.filter((x) => x.similar || x.menu.replace(/\s/g, '') !== x.matched.replace(/\s/g, ''));
    $('#seed-result').innerHTML = [
      `<h3>레시피 ${r.recipesSet.length}개 연결 · 새 재료 ${r.ingredientsAdded.length}개</h3>`,
      sec('비슷한 이름으로 연결 (맞는지 확인)', similar.map((x) => `레시피 ${esc(x.menu)} → 토스 ${esc(x.matched)}`)),
      sec('토스에서 못 찾은 레시피', r.notFound.map((x) => `${esc(x.recipe)}${x.closest ? ` (비슷한 메뉴: ${esc(x.closest)})` : ''}`), 'warn'),
      sec('토스 ID가 없어 정리한 메뉴', r.removed.map((x) => `${esc(x.menu)}${x.movedTo ? ` → 레시피를 ${esc(x.movedTo)}로 옮김` : ''}`)),
      sec('맥주', r.beer.map((b) => `${esc(b.menu)}: ${esc(b.summary)}`)),
      sec('위스키 (700ml 병, 한 잔 30ml)', r.whisky.map((w) => `${esc(w.menu)} → ${esc(w.ingredient)} ${esc(w.amount)}${w.note ? ` (${esc(w.note)})` : ''}`)),
      sec('표준 레시피 적용 (가게 방식과 다르면 수정)', r.classics.map((c) => `${esc(c.menu)}: ${esc(c.summary)}`)),
      sec('아직 레시피가 없는 메뉴', r.remaining.map(esc), 'warn'),
      sec('확인할 것', [...r.todo.map(esc), '새 재료는 재고 0입니다. 입고·실사 탭의 실사로 지금 양을 넣어 주세요.']),
    ].join('');
    $('#seed-result').hidden = false;
    menuView.filter = 'all';
    loadMenus();
  });
});

// ── 기록 ────────────────────────────────────────────
let historySub = store.get('historySub', 'orders');
const ORDER_STATUS = { COMPLETED: '완료', CANCELED: '취소', PENDING: '진행 중', BASELINE: '시작 전 주문' };
const APPLIED = {
  deducted: '<span class="pill ok">차감됨</span>',
  restored: '<span class="pill neutral">취소로 되돌림</span>',
  baseline: '<span class="pill neutral">반영 안 함</span>',
  none: '',
};
const PO_STATUS = { DRAFT: ['발주 전', 'low'], SENT: ['발주 완료', 'neutral'], RECEIVED: ['입고 완료', 'ok'] };

async function loadHistory() {
  $$('#history-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.sub === historySub));
  const unmapped = await api('/unmapped');
  const tab = $('#history-tabs [data-sub="unmapped"]');
  tab.innerHTML = `미등록 판매${unmapped.length ? `<span class="badge">${unmapped.length}</span>` : ''}`;
  const body = $('#history-body');
  const hint = $('#history-hint');
  hint.textContent = '';

  if (historySub === 'orders') {
    const [orders, status] = await Promise.all([api('/orders?limit=50'), api('/status')]);
    const s = status.settings;
    hint.textContent = !status.toss
      ? '토스 API 키가 설정되지 않았습니다.'
      : s.sync_baseline_at
        ? `${kst(s.sync_baseline_at)} 이후 완료된 주문부터 재고에서 뺍니다. 마지막 동기화 ${kst(s.last_sync_at) || '-'}`
        : '토스 동기화를 누르면 지금까지의 주문은 기록만 하고, 이후 주문부터 재고에서 뺍니다.';
    body.innerHTML = orders.length
      ? `<div class="list">${orders.map((o) => `
        <div class="item rec clickable" data-order="${esc(o.order_id)}">
          <div class="top"><span class="what">${o.items ? esc(o.items) : '주문 내역 보기'}</span><span class="when">${kst(o.ordered_at || o.first_seen)}</span></div>
          <div class="detail">${ORDER_STATUS[o.status] ?? esc(o.status)} ${APPLIED[o.applied] ?? ''}</div>
        </div>`).join('')}</div>`
      : '<div class="empty-state">아직 가져온 주문이 없습니다.</div>';
  }

  if (historySub === 'moves') {
    const mv = await api('/movements?limit=200');
    body.innerHTML = mv.length
      ? `<div class="list">${mv.map((m) => `
        <div class="item rec">
          <div class="top"><span class="what">${esc(m.ingredient_name)} <span class="${m.delta > 0 ? 'plus' : 'minus'}">${esc(m.delta_display)}</span></span><span class="when">${kst(m.created_at)}</span></div>
          <div class="detail">${REASON[m.reason] ?? esc(m.reason)}${m.note ? ` · ${esc(m.note)}` : ''} · 남은 양 ${esc(m.balance_display)}</div>
        </div>`).join('')}</div>`
      : '<div class="empty-state">재고 변동 기록이 없습니다.</div>';
  }

  if (historySub === 'pos') {
    const pos = await api('/purchase-orders');
    body.innerHTML = pos.length
      ? `<div class="list">${pos.map((p) => {
        const [label, cls] = PO_STATUS[p.status] ?? [p.status, 'neutral'];
        const text = p.lines.map((l) => `${l.name} ${l.qty}`).join('\n');
        return `<div class="item rec" data-po="${p.id}">
          <div class="top"><span class="what">발주서 #${p.id} <span class="pill ${cls}">${label}</span></span><span class="when">${kst(p.created_at)}</span></div>
          <div class="po-lines">${esc(text)}</div>
          <div class="row-actions">
            <button class="sm" data-copy="${esc(text)}">복사</button>
            ${p.status === 'DRAFT' ? '<button class="sm" data-po-act="sent">발주 완료</button>' : ''}
            ${p.status !== 'RECEIVED' ? '<button class="sm primary" data-po-act="receive">입고 처리</button>' : ''}
          </div>
        </div>`;
      }).join('')}</div>`
      : '<div class="empty-state">발주서가 없습니다.</div>';
  }

  if (historySub === 'unmapped') {
    hint.textContent = '레시피가 없어 재고를 빼지 못한 판매입니다. 메뉴로 등록한 뒤 레시피를 넣거나, 상관없는 메뉴면 무시하세요.';
    body.innerHTML = unmapped.length
      ? `<div class="list">${unmapped.map((u) => `
        <div class="item rec">
          <div class="top"><span class="what">${esc(u.name)}</span><span class="when">${esc(u.count)}개 판매</span></div>
          <div class="row-actions">
            <button class="sm primary" data-register="${esc(u.key)}">메뉴로 등록</button>
            <button class="sm" data-ignore="${esc(u.key)}">무시</button>
          </div>
        </div>`).join('')}</div>`
      : '<div class="empty-state">레시피 없이 팔린 메뉴가 없습니다.</div>';
  }
}

$('#history-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sub]');
  if (!b) return;
  historySub = b.dataset.sub;
  store.set('historySub', historySub);
  run(loadHistory);
});

$('#history-body').addEventListener('click', (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    navigator.clipboard.writeText(copy.dataset.copy).then(() => toast('복사했습니다'), () => toast('복사하지 못했습니다'));
    return;
  }
  const poAct = e.target.closest('[data-po-act]');
  if (poAct) {
    const id = poAct.closest('[data-po]').dataset.po;
    return run(async () => {
      await api(`/purchase-orders/${id}/${poAct.dataset.poAct}`, { method: 'POST' });
      toast(poAct.dataset.poAct === 'sent' ? '발주 완료로 표시했습니다' : '입고 처리했습니다');
      loadHistory();
    });
  }
  const reg = e.target.closest('[data-register]');
  const ignore = e.target.closest('[data-ignore]');
  if (reg || ignore) {
    return run(async () => {
      if (reg) await api(`/unmapped/${encodeURIComponent(reg.dataset.register)}/register`, { method: 'POST' });
      else await api(`/unmapped/${encodeURIComponent(ignore.dataset.ignore)}`, { method: 'DELETE' });
      toast(reg ? '메뉴로 등록했습니다. 메뉴 탭에서 레시피를 넣어 주세요' : '목록에서 지웠습니다');
      loadHistory();
    });
  }
  const order = e.target.closest('[data-order]');
  if (!order || e.target.closest('.order-detail')) return;
  const open = $('.order-detail', order);
  if (open) return open.remove();
  run(async () => {
    const d = await api(`/toss/orders/${encodeURIComponent(order.dataset.order)}/detail`);
    const n = d.normalized;
    const how = n ? { COMPLETED: '완료 주문으로 인식', CANCELED: '취소 주문으로 인식', PENDING: '진행 중 주문 (차감 안 함)' }[n.status] : '';
    const items = n?.items?.length
      ? n.items.map((i) => `${esc(i.name)} × ${i.quantity}${i.options.length ? ` (${i.options.map((o) => esc(o.name)).join(', ')})` : ''}`).join('<br>')
      : '<span class="minus">메뉴를 읽지 못했습니다</span>';
    order.insertAdjacentHTML('beforeend', `<div class="order-detail">
      <div>${items}</div>
      <div class="muted">${esc(n?.state ?? '')} · ${how}${d.error ? ` · ${esc(d.error)}` : ''}</div>
      <details><summary class="muted">원본 응답</summary><pre class="code">${esc(JSON.stringify(d.raw, null, 2))}</pre></details>
    </div>`);
  });
});

$('#btn-sync-orders').addEventListener('click', () => run(async () => {
  const r = await api('/toss/sync', { method: 'POST' });
  const base = r.filter((x) => x.status === 'BASELINE').length;
  toast(base ? `기존 주문 ${base}건을 시작점으로 기록했습니다` : `새로 반영된 주문 ${r.length}건`);
  historySub = 'orders';
  loadHistory();
}));

// ── 설정 ────────────────────────────────────────────
function output(data) {
  const o = $('#output');
  o.hidden = false;
  o.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function loadSettings() {
  const [status, menus] = await Promise.all([api('/status'), api('/menu-items')]);
  const s = status.settings;
  const item = (k, ok, okText = '연결됨', noText = '설정 안 됨') =>
    `<div class="status-item"><span class="k">${k}</span><span class="pill ${ok ? 'ok' : 'neutral'}">${ok ? okText : noText}</span></div>`;
  $('#status').innerHTML = [
    item('토스 메뉴', status.tossMenu),
    item('토스 주문', status.toss),
    item('토스 웹훅', status.tossWebhookSecret),
    item('텔레그램 봇', status.telegram),
    `<div class="status-item"><span class="k">재고 반영 시작</span><span>${kst(s.sync_baseline_at) || '첫 동기화 때'}</span></div>`,
    `<div class="status-item"><span class="k">마지막 토스 동기화</span><span>${kst(s.last_sync_at) || '-'}</span></div>`,
    `<div class="status-item"><span class="k">마지막 마감 리포트</span><span>${esc(s.last_report_day || '-')}</span></div>`,
  ].join('');
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
$('#btn-tg-setup').addEventListener('click', () => run(async () => { const r = await api('/telegram/setup', { method: 'POST' }); toast(`웹훅을 등록했습니다: ${r.url}`); }));
$('#btn-sync').addEventListener('click', () => run(async () => { const r = await api('/toss/sync', { method: 'POST' }); toast(`동기화 완료: ${r.length}건`); loadSettings(); }));
$('#btn-baseline').addEventListener('click', () => {
  if (!confirm('지금까지의 토스 주문은 재고에서 빼지 않고, 이후 완료되는 주문부터 반영합니다. 진행할까요?')) return;
  run(async () => { const r = await api('/toss/baseline', { method: 'POST' }); toast(`시작점을 잡았습니다 (기존 주문 ${r.length}건)`); loadSettings(); });
});
$('#btn-import-orders').addEventListener('click', () => run(() => importMenus('orders')));
$('#btn-toss-sample').addEventListener('click', () => run(async () => output(await api('/toss/orders?size=3'))));
$('#btn-reset').addEventListener('click', () => {
  const typed = prompt('메뉴, 레시피, 재료, 재고 기록, 발주서를 모두 지웁니다. 토스 주문 기록과 설정은 남습니다.\n\n진행하려면 "초기화"라고 입력하세요.');
  if (typed === null) return;
  run(async () => {
    await api('/reset', { method: 'POST', body: { confirm: typed.trim() } });
    toast('초기화했습니다');
    loadSettings();
  });
});
$('#manual-sale').addEventListener('submit', (e) => {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target));
  run(async () => output(await api('/sales/manual', { method: 'POST', body: { menu_item_id: Number(b.menu_item_id), quantity: Number(b.quantity) } })));
});
$('#btn-logout').addEventListener('click', () => { store.del('adminToken'); token = ''; showLogin(); });

// ── 시작 ────────────────────────────────────────────
$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  token = $('#token').value.trim();
  store.set('adminToken', token);
  openTab(store.get('tab', 'stock'));
});

if (token) openTab(store.get('tab', 'stock'));
else showLogin();
