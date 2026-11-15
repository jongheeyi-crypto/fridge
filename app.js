/* 인성이네 냉장고 — read-only mobile dashboard */
(function () {
  'use strict';

  var TZ = 'Asia/Seoul';
  var CATEGORIES = ['전체', '밀키트', '생선·고기', '유제품·빵', '채소·과일', '아이 맞춤'];
  var TABS = [
    { id: 'all', emoji: '🏠', label: '전체 보기' },
    { id: 'fridge', emoji: '❄️', label: '냉장실' },
    { id: 'freezer', emoji: '🧊', label: '냉동실' },
    { id: 'meals', emoji: '🍳', label: '간단 식단' },
    { id: 'shop', emoji: '🛒', label: '장보기' }
  ];

  var state = {
    data: null,
    tab: 'all',
    q: '',
    cat: '전체',
    error: null
  };

  function el(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function norm(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase(); }

  /* ---------------- dates ---------------- */

  function todayParts() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    var get = function (t) {
      for (var i = 0; i < parts.length; i++) { if (parts[i].type === t) { return Number(parts[i].value); } }
      return 0;
    };
    return { y: get('year'), m: get('month'), d: get('day') };
  }

  function todayUTC() {
    var t = todayParts();
    return Date.UTC(t.y, t.m - 1, t.d);
  }

  function parseYMD(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) { return null; }
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function daysLeft(item) {
    var t = parseYMD(item && item.expiryDate);
    if (t === null) { return null; }
    return Math.round((t - todayUTC()) / 86400000);
  }

  function expiryLabel(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) { return ''; }
    return Number(m[1]) + '년 ' + Number(m[2]) + '월 ' + Number(m[3]) + '일';
  }

  function formatUpdated(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) { return '업데이트 시간 정보가 없어요'; }
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short',
        hour: 'numeric', minute: '2-digit'
      }).format(d);
    } catch (e) {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  /* ---------------- storage badge / D-day ---------------- */
  /* expiryDate가 없으면 날짜를 지어내지 않고 보관 위치만 알려줘요. */

  function storageBadge(item, storage) {
    var n = daysLeft(item);
    if (n === null) {
      if (storage === 'freezer') { return '<span class="dday keep-frozen">냉동 보관</span>'; }
      return '<span class="dday keep-cold">냉장 보관</span>';
    }
    var cls, label;
    if (n < 0) { cls = 'past'; label = 'D+' + Math.abs(n); }
    else if (n === 0) { cls = 'urgent'; label = 'D-day'; }
    else if (n <= 1) { cls = 'urgent'; label = 'D-' + n; }
    else if (n <= 3) { cls = 'warn'; label = 'D-' + n; }
    else { cls = 'fresh'; label = 'D-' + n; }
    var title = expiryLabel(item.expiryDate) + '까지';
    return '<span class="dday ' + cls + '" title="' + esc(title) + '">' + label + '</span>';
  }

  /* ---------------- data helpers ---------------- */

  function itemsOf(storage) {
    var list = state.data && state.data[storage];
    return Array.isArray(list) ? list : [];
  }

  function allItems() {
    return itemsOf('fridge').map(function (i) { return { item: i, storage: 'fridge' }; })
      .concat(itemsOf('freezer').map(function (i) { return { item: i, storage: 'freezer' }; }));
  }

  function matchesQuery(item) {
    var q = norm(state.q);
    if (!q) { return true; }
    var hay = norm([item.name, item.memo, item.category, item.qty].join(' '));
    return hay.indexOf(q) !== -1;
  }

  function matchesCat(item) {
    return state.cat === '전체' || item.category === state.cat;
  }

  function filtered(storage) {
    return itemsOf(storage).filter(function (i) {
      return matchesQuery(i) && matchesCat(i);
    }).sort(function (a, b) {
      var da = daysLeft(a), db = daysLeft(b);
      if (da === null && db === null) { return 0; }
      if (da === null) { return 1; }
      if (db === null) { return -1; }
      return da - db;
    });
  }

  function urgentCount() {
    return allItems().filter(function (x) {
      var n = daysLeft(x.item);
      return n !== null && n <= 3;
    }).length;
  }

  /* 재료 이름과 식단의 uses 표기를 느슨하게 맞춥니다.
     (예: "우유 식빵" ↔ "클래식 우유 식빵 420g") */
  function inStock() {
    var names = allItems().map(function (x) { return norm(x.item.name); });
    return { names: names, exact: names.reduce(function (a, n) { a[n] = true; return a; }, {}) };
  }

  function hasStock(label, stock) {
    var k = norm(label);
    if (!k) { return false; }
    if (stock.exact[k]) { return true; }
    for (var i = 0; i < stock.names.length; i++) {
      var n = stock.names[i];
      if (n.indexOf(k) !== -1 || k.indexOf(n) !== -1) { return true; }
    }
    return false;
  }

  /* ---------------- 점심 식단표 연동 (미리 자리만 만들어 둔 구조) ---------------- */

  function lunchInfo() {
    var lm = state.data && state.data.lunchMenu;
    if (!lm || typeof lm !== 'object') { return null; }
    var today = typeof lm.todayLunch === 'string' ? lm.todayLunch.trim() : '';
    return {
      active: !!lm.active && !!today,
      note: lm.note || '인성이 점심 식단표 보내주시면 겹치지 않게 아침·저녁을 맞춰 추천해요!',
      today: today
    };
  }

  function mealTokens(meal) {
    var out = [];
    ['keywords', 'avoidTags'].forEach(function (key) {
      var arr = Array.isArray(meal[key]) ? meal[key] : [];
      arr.forEach(function (t) {
        var n = norm(t);
        if (n && out.indexOf(n) === -1) { out.push(n); }
      });
    });
    return out;
  }

  function overlapsLunch(meal, lunch) {
    if (!lunch || !lunch.active) { return false; }
    var text = norm(lunch.today);
    if (!text) { return false; }
    return mealTokens(meal).some(function (t) { return text.indexOf(t) !== -1; });
  }

  /* ---------------- partial renders ---------------- */

  function itemCard(item, storage) {
    var qty = item.qty ? '<span class="qty">' + esc(item.qty) + '</span>' : '';
    var cat = item.category ? '<span class="tag">' + esc(item.category) + '</span>' : '';
    var memo = item.memo ? '<p class="card-memo">' + esc(item.memo) + '</p>' : '';
    return '' +
      '<article class="item-card ' + (storage === 'freezer' ? 'is-frozen' : 'is-cold') + '">' +
        '<div class="card-top">' +
          '<span class="card-emoji" aria-hidden="true">' + esc(item.emoji || '🍽') + '</span>' +
          storageBadge(item, storage) +
        '</div>' +
        '<h3 class="card-name">' + esc(item.name) + '</h3>' +
        '<div class="card-meta">' + qty + cat + '</div>' +
        memo +
      '</article>';
  }

  function itemsSection(storage, hideEmpty) {
    var list = filtered(storage);
    if (hideEmpty && list.length === 0) { return ''; }
    var isFridge = storage === 'fridge';
    var title = isFridge ? '❄️ 냉장실' : '🧊 냉동실';
    var body;
    if (list.length === 0) {
      body = '<div class="empty"><span class="big">' + (isFridge ? '🧺' : '🥶') + '</span>' +
        '조건에 맞는 재료가 없어요</div>';
    } else {
      body = '<div class="item-list">' +
        list.map(function (i) { return itemCard(i, storage); }).join('') +
        '</div>';
    }
    return '' +
      '<section class="section">' +
        '<div class="sec-head">' +
          '<h2 class="sec-title">' + title + '</h2>' +
          '<span class="sec-count">' + list.length + '개</span>' +
        '</div>' +
        '<div class="panel' + (isFridge ? '' : ' frozen') + '">' + body + '</div>' +
      '</section>';
  }

  function mealCard(meal, stock, lunch) {
    var uses = Array.isArray(meal.uses) ? meal.uses : [];
    var ings = uses.map(function (u) {
      var has = hasStock(u, stock);
      return '<span class="ing ' + (has ? 'ok' : 'need') + '">' +
        (has ? '✅ ' : '🛒 ') + esc(u) + '</span>';
    }).join('');
    var steps = (Array.isArray(meal.steps) ? meal.steps : []).map(function (s, idx) {
      return '<li><span class="n">' + (idx + 1) + '</span><span>' + esc(s) + '</span></li>';
    }).join('');
    var isDinner = meal.mealTime === '저녁';
    var when = meal.mealTime
      ? '<span class="meal-when ' + (isDinner ? 'evening' : 'morning') + '">' +
          (isDinner ? '🌙 저녁 추천' : '🌅 아침 추천') + '</span>'
      : '';
    var who = meal.who ? '<span class="meal-who">' + esc(meal.who) + '</span>' : '';
    var clash = overlapsLunch(meal, lunch)
      ? '<span class="meal-clash">⚠️ 점심과 겹침</span>'
      : '';
    return '' +
      '<article class="meal' + (clash ? ' is-clash' : '') + '">' +
        '<div class="meal-top">' +
          '<div class="meal-emoji" aria-hidden="true">' + esc(meal.emoji || '🍳') + '</div>' +
          '<div class="meal-head">' +
            '<h3 class="meal-title">' + esc(meal.title) + '</h3>' +
            '<div class="meal-sub">' +
              when + who +
              '<span class="mini">⏱ ' + esc(meal.time || '') + '</span>' +
              '<span class="mini">' + esc(meal.difficulty || '') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        clash +
        (ings ? '<div class="ings">' + ings + '</div>' : '') +
        (steps ? '<ol class="steps">' + steps + '</ol>' : '') +
      '</article>';
  }

  function mealsFor() {
    var list = Array.isArray(state.data.meals) ? state.data.meals.slice() : [];
    var q = norm(state.q);
    if (q) {
      list = list.filter(function (m) {
        return norm([m.title, m.mealTime, m.who, (m.uses || []).join(' '), (m.keywords || []).join(' ')].join(' '))
          .indexOf(q) !== -1;
      });
    }
    var stock = inStock();
    var lunch = lunchInfo();
    list.sort(function (a, b) {
      var ca = overlapsLunch(a, lunch) ? 1 : 0;
      var cb = overlapsLunch(b, lunch) ? 1 : 0;
      if (ca !== cb) { return ca - cb; }
      var sa = (a.uses || []).filter(function (u) { return hasStock(u, stock); }).length;
      var sb = (b.uses || []).filter(function (u) { return hasStock(u, stock); }).length;
      if (sb !== sa) { return sb - sa; }
      var ta = a.mealTime === '아침' ? 0 : 1;
      var tb = b.mealTime === '아침' ? 0 : 1;
      return ta - tb;
    });
    return list;
  }

  function lunchBanner() {
    var lm = lunchInfo();
    if (!lm) { return ''; }
    if (lm.active) {
      return '' +
        '<div class="lunch-banner on">' +
          '<div class="lunch-top">' +
            '<span class="lunch-emoji" aria-hidden="true">🍱</span>' +
            '<span class="lunch-title">인성이 점심 식단 연동됨</span>' +
            '<span class="lunch-state">자동 회피 중</span>' +
          '</div>' +
          '<p class="lunch-today">오늘 점심 · ' + esc(lm.today) + '</p>' +
          '<p class="lunch-note">점심과 겹치는 메뉴는 ⚠️ 표시하고 아래로 내려뒀어요.</p>' +
        '</div>';
    }
    return '' +
      '<div class="lunch-banner">' +
        '<div class="lunch-top">' +
          '<span class="lunch-emoji" aria-hidden="true">🍱</span>' +
          '<span class="lunch-title">인성이 점심 식단 연동</span>' +
          '<span class="lunch-state">대기 중</span>' +
        '</div>' +
        '<p class="lunch-note">' + esc(lm.note) + '</p>' +
      '</div>';
  }

  function mealGroup(time, list, stock, lunch) {
    if (list.length === 0) { return ''; }
    var isDinner = time === '저녁';
    return '' +
      '<div class="meal-group">' +
        '<div class="sec-head">' +
          '<h2 class="sec-title">' + (isDinner ? '🌙 저녁 추천' : '🌅 아침 추천') + '</h2>' +
          '<span class="sec-count">' + list.length + '개</span>' +
        '</div>' +
        list.map(function (m) { return mealCard(m, stock, lunch); }).join('') +
      '</div>';
  }

  function mealsSection(limit) {
    var lunch = lunchInfo();
    var stock = inStock();
    var isAll = state.tab === 'all';
    var list = mealsFor();
    if (list.length === 0) {
      if (isAll) { return ''; }
      return '<section class="section">' + lunchBanner() +
        '<div class="empty"><span class="big">🍳</span>' +
        '지금은 추천할 식단이 없어요<br>재료가 들어오면 바로 채워드릴게요</div></section>';
    }

    if (isAll) {
      /* 홈 하이라이트: 아침 하나 + 저녁 하나 */
      var morning = list.filter(function (m) { return m.mealTime === '아침'; })[0];
      var dinner = list.filter(function (m) { return m.mealTime === '저녁'; })[0];
      var picks = [morning, dinner].filter(Boolean);
      if (picks.length === 0) { picks = list.slice(0, 2); }
      return '' +
        '<section class="section">' +
          '<div class="sec-head">' +
            '<h2 class="sec-title">🍳 오늘 뭐 먹지?</h2>' +
            '<span class="sec-count">' + picks.length + '개</span>' +
            '<button type="button" class="sec-more" data-goto="meals">전체 보기 ›</button>' +
          '</div>' +
          '<p class="sec-sub">냉장고에 있는 재료로 바로 되는 메뉴만 골랐어요</p>' +
          picks.map(function (m) { return mealCard(m, stock, lunch); }).join('') +
        '</section>';
    }

    var mornings = list.filter(function (m) { return m.mealTime !== '저녁'; });
    var dinners = list.filter(function (m) { return m.mealTime === '저녁'; });
    var body = mealGroup('아침', mornings, stock, lunch) + mealGroup('저녁', dinners, stock, lunch);
    return '' +
      '<section class="section">' +
        lunchBanner() +
        '<div class="sec-head">' +
          '<h2 class="sec-title">🍳 간단 식단</h2>' +
          '<span class="sec-count">' + list.length + '개</span>' +
        '</div>' +
        '<p class="sec-sub">아침·저녁으로 나눠서, 지금 있는 재료로 바로 되는 메뉴예요</p>' +
        body +
      '</section>';
  }

  function shoppingSection() {
    var list = Array.isArray(state.data.shopping) ? state.data.shopping : [];
    var rows = list.map(function (s) {
      return '' +
        '<div class="shop-item">' +
          '<span class="shop-check" aria-hidden="true"></span>' +
          '<div class="shop-body">' +
            '<div class="shop-name">' + esc(s.name) + '</div>' +
            (s.reason ? '<div class="shop-reason">' + esc(s.reason) + '</div>' : '') +
          '</div>' +
          '<span class="shop-emoji" aria-hidden="true">' + esc(s.emoji || '🛒') + '</span>' +
        '</div>';
    }).join('');
    var inner = list.length
      ? rows
      : '<div class="empty"><span class="big">🧺</span>지금은 장볼 게 없어요!<br>떨어지면 바로 담아둘게요.</div>';
    return '' +
      '<section class="section">' +
        '<div class="sec-head">' +
          '<h2 class="sec-title">🛒 장보기</h2>' +
          '<span class="sec-count">' + list.length + '개</span>' +
        '</div>' +
        inner +
      '</section>';
  }

  function emptyAll() {
    return '<div class="empty"><span class="big">🔍</span>' +
      '“' + esc(state.q) + '” 검색 결과가 없어요<br>다른 이름으로 찾아보세요</div>';
  }

  /* ---------------- main renders ---------------- */

  function renderHeader() {
    var d = state.data;
    el('updated').textContent = d && d.updatedAt
      ? '🕐 마지막 업데이트 ' + formatUpdated(d.updatedAt)
      : '🕐 마지막 업데이트 정보 없음';

    if (!d) {
      el('heroSub').textContent = '냉장실 · 냉동실 재료 한눈에';
      el('pills').innerHTML = '';
      return;
    }

    var cold = itemsOf('fridge').length;
    var frozen = itemsOf('freezer').length;
    var soon = urgentCount();

    el('heroSub').textContent = '냉장실 재료와 냉동실 재료를 한 번에 볼 수 있어요';
    el('pills').innerHTML = '' +
      '<span class="pill cold">❄️ 냉장 <b>' + cold + '</b></span>' +
      '<span class="pill frozen">🧊 냉동 <b>' + frozen + '</b></span>' +
      '<span class="pill soon">⏰ 임박 <b>' + soon + '</b></span>';

    var banner = el('sampleBanner');
    if (d.isSample) {
      banner.innerHTML = '<div class="sample-banner"><span aria-hidden="true">✨</span><span>' +
        esc(d.sampleNotice || '예시 화면이에요. 장보기 캡처나 사진을 보내주시면 우리 집 재료로 채워져요!') +
        '</span></div>';
    } else {
      banner.innerHTML = '';
    }
  }

  function renderTabs() {
    el('tabs').innerHTML = TABS.map(function (t) {
      var active = state.tab === t.id ? ' active' : '';
      return '<button type="button" class="tab' + active + '" data-tab="' + t.id + '"' +
        (active ? ' aria-current="page"' : '') + '>' +
        '<span class="tab-emoji" aria-hidden="true">' + t.emoji + '</span>' + esc(t.label) +
        '</button>';
    }).join('');
  }

  function renderToolbar() {
    var showSearch = state.tab !== 'shop';
    var showChips = state.tab === 'all' || state.tab === 'fridge' || state.tab === 'freezer';
    el('toolbar').hidden = !showSearch;
    el('chips').hidden = !showChips;
    el('searchClear').hidden = !state.q;

    el('chips').innerHTML = CATEGORIES.map(function (c) {
      var active = state.cat === c ? ' active' : '';
      return '<button type="button" class="chip' + active + '" data-cat="' + esc(c) + '"' +
        (active ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + esc(c) + '</button>';
    }).join('');
  }

  function renderContent() {
    var c = el('content');
    if (state.error) {
      c.innerHTML = '<div class="empty"><span class="big">😵</span>' +
        '냉장고 문이 잠깐 안 열렸어요<br>' + esc(state.error) +
        '<br><br>잠시 뒤 새로고침 해주세요</div>';
      return;
    }
    if (!state.data) {
      c.innerHTML = '<div class="empty"><span class="big">🧊</span>재료를 불러오는 중…</div>';
      return;
    }

    var parts = [];

    if (state.tab === 'meals') {
      parts.push(mealsSection(0));
    } else if (state.tab === 'shop') {
      parts.push(shoppingSection());
    } else if (state.tab === 'fridge') {
      parts.push(itemsSection('fridge', false));
    } else if (state.tab === 'freezer') {
      parts.push(itemsSection('freezer', false));
    } else {
      var coldList = filtered('fridge');
      var frozenList = filtered('freezer');
      var searching = !!norm(state.q) || state.cat !== '전체';
      var mealCount = mealsFor().length;

      if (searching && coldList.length === 0 && frozenList.length === 0 && mealCount === 0) {
        c.innerHTML = emptyAll();
        return;
      }
      if (!searching) { parts.push(mealsSection(2)); }
      else if (mealCount > 0) { parts.push(mealsSection(2)); }
      parts.push(itemsSection('fridge', true));
      parts.push(itemsSection('freezer', true));
    }

    c.innerHTML = parts.join('') || emptyAll();
  }

  function render() {
    renderHeader();
    renderTabs();
    renderToolbar();
    renderContent();
  }

  /* ---------------- events ---------------- */

  function bind() {
    el('tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tab]');
      if (!btn) { return; }
      state.tab = btn.getAttribute('data-tab');
      state.cat = '전체';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    el('chips').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cat]');
      if (!btn) { return; }
      var cat = btn.getAttribute('data-cat');
      state.cat = state.cat === cat ? '전체' : cat;
      renderToolbar();
      renderContent();
    });

    el('content').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-goto]');
      if (!btn) { return; }
      state.tab = btn.getAttribute('data-goto');
      state.cat = '전체';
      state.q = '';
      el('search').value = '';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    var search = el('search');
    search.addEventListener('input', function () {
      state.q = search.value.trim();
      el('searchClear').hidden = !state.q;
      renderContent();
    });

    el('searchClear').addEventListener('click', function () {
      state.q = '';
      el('search').value = '';
      el('searchClear').hidden = true;
      renderContent();
      el('search').focus();
    });
  }

  /* ---------------- boot ---------------- */

  function boot() {
    bind();
    render();

    fetch('./data.json', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) { throw new Error('data.json (' + res.status + ')'); }
        return res.json();
      })
      .then(function (json) {
        state.data = json;
        state.error = null;
        render();
      })
      .catch(function (err) {
        state.error = (err && err.message) ? err.message : '데이터를 불러오지 못했어요';
        render();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
