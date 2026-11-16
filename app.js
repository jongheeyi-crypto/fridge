/* 인성이네 냉장고 — read-only mobile dashboard */
(function () {
  'use strict';

  var TZ = 'Asia/Seoul';
  var CATEGORIES = ['전체', '밀키트', '생선·고기', '유제품·빵', '채소·과일', '반찬·소스', '아이 맞춤'];
  var TABS = [
    { id: 'all', emoji: '🏠', label: '전체 보기' },
    { id: 'week', emoji: '📅', label: '주간 식단' },
    { id: 'fridge', emoji: '❄️', label: '냉장실' },
    { id: 'freezer', emoji: '🧊', label: '냉동실' },
    { id: 'roomTemp', emoji: '🧺', label: '실온' },
    { id: 'meals', emoji: '🍳', label: '간단 식단' },
    { id: 'shop', emoji: '🛒', label: '장보기' }
  ];

  var COURSE_META = {
    breakfast: { title: '🌅 아침 식단 (인성이 전용)', sub: '인성이 아침으로 먹기 좋은 메뉴만 모았어요' },
    lunch: { title: '🥗 엄마 점심 (혼밥)', sub: '엄마가 집에서 혼자 가볍게 먹는 1인분이에요 · 3가족 저녁과는 따로예요' },
    dinner: { title: '🌙 저녁 식단 (세 가족 함께)', sub: '3가족이 같이 먹어요 · 매운 메뉴는 인성이 몫을 따로 챙겨요' },
    salad: { title: '🥗 어른 간편 샐러드', sub: '엄마·아빠 간편 한 끼나 저녁 곁들임용이에요' }
  };

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

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

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

  function isoToday() {
    var t = todayParts();
    return t.y + '-' + pad2(t.m) + '-' + pad2(t.d);
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

  function daysUntil(iso) {
    var t = parseYMD(iso);
    if (t === null) { return null; }
    return Math.round((t - todayUTC()) / 86400000);
  }

  /* '2026-11-16' + 1 → '2026-11-17' (KST 기준 날짜만 더해요) */
  function isoAdd(iso, n) {
    var t = parseYMD(iso);
    if (t === null) { return null; }
    var d = new Date(t + n * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function expiryLabel(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) { return ''; }
    return Number(m[1]) + '년 ' + Number(m[2]) + '월 ' + Number(m[3]) + '일';
  }

  function monthDay(iso, dayLabel) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) { return ''; }
    return Number(m[2]) + '/' + Number(m[3]) + (dayLabel ? '(' + dayLabel + ')' : '');
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

  /* ---------------- 보관 배지 / D-day / 도착 예정 ---------------- */
  /* expiryDate가 없으면 날짜를 지어내지 않고 보관 위치만 알려줘요. */

  function storageBadge(item, storage) {
    var n = daysLeft(item);
    if (n === null) {
      if (storage === 'freezer') { return '<span class="dday keep-frozen">냉동 보관</span>'; }
      if (storage === 'roomTemp') { return '<span class="dday keep-room">실온 보관</span>'; }
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

  /* 주문 도착 예정 — 도착일이 지나면 자동으로 사라져요. */
  function arrivingPill(item) {
    var n = daysUntil(item && item.arriving);
    if (n === null || n < 0) { return ''; }
    var label;
    if (n === 0) { label = '📦 오늘 도착'; }
    else if (n === 1) { label = '📦 내일 도착'; }
    else { label = '📦 ' + monthDay(item.arriving) + ' 도착'; }
    var full = monthDay(item.arriving) + ' 도착 예정';
    return '<p class="card-arriving" title="' + esc(full) + '">' + label + '</p>';
  }

  /* ---------------- data helpers ---------------- */

  function itemsOf(storage) {
    var list = state.data && state.data[storage];
    return Array.isArray(list) ? list : [];
  }

  function allItems() {
    return itemsOf('fridge').map(function (i) { return { item: i, storage: 'fridge' }; })
      .concat(itemsOf('freezer').map(function (i) { return { item: i, storage: 'freezer' }; }))
      .concat(itemsOf('roomTemp').map(function (i) { return { item: i, storage: 'roomTemp' }; }));
  }

  /* 🧂 조미료·부재료 중 '보유'로 표시된 이름 (미보유 쌈장은 빼요) */
  function pantryStockNames() {
    var out = [];
    pantryGroups().forEach(function (g) {
      (g.items || []).forEach(function (it) {
        if (it && it.name && it.checked !== false) { out.push(it.name); }
      });
    });
    return out;
  }

  /* 먹는 재료 매칭용 전체 목록 — 🧺 실온 + 🧂 조미료(보유)까지 포함해요.
     allItems()는 상단 배지 숫자에 쓰니까 조미료를 절대 섞지 않아요. */
  function stockEntries() {
    var out = allItems().map(function (x) {
      return { name: x.item.name, storage: x.storage, item: x.item };
    });
    pantryStockNames().forEach(function (n) {
      out.push({ name: n, storage: 'pantry', item: { name: n, pantry: true } });
    });
    return out;
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
      /* 냉장고 파먹기 1순위(기존 보유 · 우선 소진)를 맨 앞으로, 도착 예정 재료보다 먼저 */
      var pa = isPriority(a) ? 0 : 1;
      var pb = isPriority(b) ? 0 : 1;
      if (pa !== pb) { return pa - pb; }
      var da = daysLeft(a), db = daysLeft(b);
      if (da === null && db === null) { return 0; }
      if (da === null) { return 1; }
      if (db === null) { return -1; }
      return da - db;
    });
  }

  /* 기존에 있던 재료 중 먼저 비워야 하는 것 (냉장고 파먹기 1순위) */
  function isPriority(x) {
    return !!x && (x.priority === 1 || x.clearFirst === true);
  }

  function priorityCount() {
    return allItems().filter(function (x) { return isPriority(x.item); }).length;
  }

  function urgentCount() {
    return allItems().filter(function (x) {
      var n = daysLeft(x.item);
      return n !== null && n <= 3;
    }).length;
  }

  function arrivingCount() {
    return allItems().filter(function (x) {
      var n = daysUntil(x.item.arriving);
      return n !== null && n >= 0;
    }).length;
  }

  /* 재료 이름과 식단의 uses 표기를 느슨하게 맞춥니다.
     (예: "우유 식빵" ↔ "클래식 우유 식빵 420g") */
  function inStock() {
    /* 실온(roomTemp) 식품도 '지금 집에 있는 재료'로 봐요.
       이게 없으면 마녀스프·장조림처럼 실온에 둔 재료가
       식단 카드에서 🛒(없음)으로 잘못 떠요. */
    var list = stockEntries().map(function (x) {
      return { key: norm(x.name), arriving: x.item.arriving || null };
    });
    return { list: list };
  }

  /* ok: 지금 냉장고에 있음 · soon: 내일(예정일) 도착 · need: 없음 */
  function stockState(label, stock) {
    var k = norm(label);
    if (!k) { return 'need'; }
    var hit = null, i;
    for (i = 0; i < stock.list.length; i++) {
      if (stock.list[i].key === k) { hit = stock.list[i]; break; }
    }
    if (!hit) {
      for (i = 0; i < stock.list.length; i++) {
        var n = stock.list[i].key;
        if (n.indexOf(k) !== -1 || k.indexOf(n) !== -1) { hit = stock.list[i]; break; }
      }
    }
    if (!hit) { return 'need'; }
    var d = daysUntil(hit.arriving);
    if (d !== null && d >= 0) { return 'soon'; }
    return 'ok';
  }

  function stockScore(meal, stock) {
    return (meal.uses || []).reduce(function (a, u) {
      var s = stockState(u, stock);
      return a + (s === 'ok' ? 2 : s === 'soon' ? 1 : 0);
    }, 0);
  }

  /* ---------------- 인성이 점심 식단표 ---------------- */

  function lunchData() {
    var lm = state.data && state.data.lunchMenu;
    if (!lm || typeof lm !== 'object' || !Array.isArray(lm.schedule)) { return null; }
    return lm;
  }

  /* 오늘이 식단표에 있으면 오늘, 없으면 가장 가까운 다음 급식일. */
  function targetLunch() {
    var lm = lunchData();
    if (!lm) { return null; }
    var today = isoToday();
    var entry = null, next = null;
    lm.schedule.forEach(function (e) {
      if (!e || !parseYMD(e.date)) { return; }
      if (e.date === today) { entry = e; }
      else if (e.date > today && (!next || e.date < next.date)) { next = e; }
    });
    var isToday = !!entry;
    if (!entry) { entry = next; }
    if (!entry) { return { active: false, schoolName: lm.schoolName, note: lm.note, schedule: lm.schedule }; }
    if (!lm.active) { return { active: false, schoolName: lm.schoolName, note: lm.note, schedule: lm.schedule }; }

    var diff = daysUntil(entry.date);
    var md = monthDay(entry.date, entry.dayLabel);            // 11/16(월)
    var human = md.replace('(', ' ').replace(')', '');        // 11/16 월
    var label, dayText;
    if (isToday) { label = '오늘 유치원 점심'; dayText = '오늘 점심'; }
    else if (diff === 1) { label = '내일(' + human + ') 유치원 점심'; dayText = '내일(' + human + ') 점심'; }
    else { label = md + ' 유치원 점심'; dayText = md + ' 점심'; }

    return {
      active: true,
      entry: entry,
      diff: diff,
      label: label,
      dayText: dayText,
      isToday: isToday,
      shortDate: md,
      schoolName: lm.schoolName,
      note: lm.note,
      schedule: lm.schedule
    };
  }

  function mealTags(meal) {
    var out = [];
    (Array.isArray(meal.avoidTags) ? meal.avoidTags : []).forEach(function (t) {
      var n = norm(t);
      if (n && out.indexOf(n) === -1) { out.push(n); }
    });
    return out;
  }

  /* 점심과 겹치는 메뉴 이름을 찾아 '11/16(월) 점심 ‘어묵국’과 겹침' 형태로 돌려줘요. */
  function findClash(tags, lunch) {
    if (!lunch || !lunch.active) { return null; }
    var items = Array.isArray(lunch.entry.items) ? lunch.entry.items : [];
    var avoid = Array.isArray(lunch.entry.avoidTags) ? lunch.entry.avoidTags : [];
    var hit = null, i, j;

    for (i = 0; i < tags.length && !hit; i++) {
      for (j = 0; j < items.length; j++) {
        if (norm(items[j]).indexOf(tags[i]) !== -1) { hit = items[j]; break; }
      }
    }
    if (!hit) {
      for (i = 0; i < tags.length && !hit; i++) {
        for (j = 0; j < avoid.length; j++) {
          if (norm(avoid[j]) === tags[i]) { hit = avoid[j]; break; }
        }
      }
    }
    return hit;
  }

  function clashOf(meal, lunch) {
    var hit = findClash(mealTags(meal), lunch);
    if (!hit) { return null; }
    return { menu: hit, text: lunch.shortDate + ' 점심·오후 간식 ‘' + hit + '’과 겹침' };
  }

  function kidClashOf(meal, lunch) {
    if (!meal || !meal.kidMenu) { return null; }
    var hit = findClash(mealTags(meal.kidMenu), lunch);
    if (!hit) { return null; }
    return { menu: hit, text: '인성이 별도 메뉴 ‘' + hit + '’도 ' + lunch.shortDate + ' 점심·오후 간식과 겹침' };
  }

  /* ---------------- partial renders ---------------- */

  function itemCard(item, storage) {
    var qty = item.qty ? '<span class="qty">' + esc(item.qty) + '</span>' : '';
    var cat = item.category ? '<span class="tag">' + esc(item.category) + '</span>' : '';
    var memo = item.memo ? '<p class="card-memo">' + esc(item.memo) + '</p>' : '';
    var prio = isPriority(item) ? '<p class="card-priority">🔥 우선 소진</p>' : '';
    var storageCls = storage === 'freezer' ? 'is-frozen' : (storage === 'roomTemp' ? 'is-room' : 'is-cold');
    return '' +
      '<article class="item-card ' + storageCls +
        (isPriority(item) ? ' is-priority' : '') +
        (arrivingPill(item) ? ' is-arriving' : '') + '">' +
        '<div class="card-top">' +
          '<span class="card-emoji" aria-hidden="true">' + esc(item.emoji || '🍽') + '</span>' +
          storageBadge(item, storage) +
          (item.needsThaw ? '<span class="thaw-chip">🧊 전날 해동</span>' : '') +
        '</div>' +
        prio +
        arrivingPill(item) +
        '<h3 class="card-name">' + esc(item.name) + '</h3>' +
        '<div class="card-meta">' + qty + cat + '</div>' +
        memo +
        (item.needsThaw && item.thawTip ? '<p class="card-thaw">🌙 ' + esc(item.thawTip) + '</p>' : '') +
      '</article>';
  }

  /* 보관 위치별 제목·패널 톤 — 실온은 냉장·냉동과 똑같은 재고 카드 레이아웃을 써요 */
  var STORAGE_META = {
    fridge: { title: '❄️ 냉장실', panel: '', empty: '🧺', sub: '' },
    freezer: { title: '🧊 냉동실', panel: ' frozen', empty: '🥶', sub: '' },
    roomTemp: { title: '🧺 실온', panel: ' room', empty: '📦', sub: '찬장에 두는 즉석밥·통조림·건어물 같은 실온 식품이에요' }
  };

  function itemsSection(storage, hideEmpty) {
    var list = filtered(storage);
    if (hideEmpty && list.length === 0) { return ''; }
    var meta = STORAGE_META[storage] || STORAGE_META.fridge;
    var prio = list.filter(isPriority).length;
    var body;
    if (list.length === 0) {
      body = '<div class="empty"><span class="big">' + meta.empty + '</span>' +
        '조건에 맞는 재료가 없어요</div>';
    } else {
      body = '<div class="item-list">' +
        list.map(function (i) { return itemCard(i, storage); }).join('') +
        '</div>';
    }
    return '' +
      '<section class="section">' +
        '<div class="sec-head">' +
          '<h2 class="sec-title">' + meta.title + '</h2>' +
          '<span class="sec-count">' + list.length + '개</span>' +
        '</div>' +
        (meta.sub ? '<p class="sec-sub">' + esc(meta.sub) + '</p>' : '') +
        (prio ? '<p class="sec-sub">🔥 우선 소진 ' + prio + '개를 맨 앞에 뒀어요</p>' : '') +
        '<div class="panel' + meta.panel + '">' + body + '</div>' +
      '</section>';
  }

  function courseOf(meal) {
    if (meal.course === 'salad') { return 'salad'; }
    if (meal.course === 'lunch' || meal.mealTime === '점심') { return 'lunch'; }
    if (meal.course === 'dinner' || meal.mealTime === '저녁') { return 'dinner'; }
    return 'breakfast';
  }

  function ingChips(uses, stock) {
    return (Array.isArray(uses) ? uses : []).map(function (u) {
      var st = stockState(u, stock);
      return '<span class="ing ' + st + '">' +
        (st === 'ok' ? '✅ ' : st === 'soon' ? '📦 ' : '🛒 ') + esc(u) + '</span>';
    }).join('');
  }

  function mealCard(meal, stock, lunch) {
    var course = courseOf(meal);
    var whenCls = course === 'dinner' ? 'evening' : (course === 'salad' ? 'salad' : (course === 'lunch' ? 'lunch' : 'morning'));
    var whenTxt = course === 'salad' ? '🥗 샐러드' : (course === 'dinner' ? '🌙 저녁' : (course === 'lunch' ? '🍚 엄마 점심' : '🌅 아침'));
    var who = meal.who ? '<span class="meal-who">' + esc(meal.who) + '</span>' : '';
    var steps = (Array.isArray(meal.steps) ? meal.steps : []).map(function (s, idx) {
      return '<li><span class="n">' + (idx + 1) + '</span><span>' + esc(s) + '</span></li>';
    }).join('');
    var ings = ingChips(meal.uses, stock);
    var adult = clashOf(meal, lunch);
    var kid = kidClashOf(meal, lunch);
    var pairLine = '';
    if (meal.pair && (meal.pair.side || meal.pair.soup)) {
      pairLine = '<p class="pair-line">' +
        (meal.pair.side ? '<span class="pl-side">🥬 ' + esc(meal.pair.side) + '</span>' : '') +
        (meal.pair.soup ? '<span class="pl-soup">🥣 ' + esc(meal.pair.soup) + '</span>' : '') +
      '</p>';
    }
    var marks = '';
    if (isPriority(meal)) { marks += '<span class="meal-priority">🔥 냉장고 파먹기 1순위</span>'; }
    if (lunch && lunch.active) {
      if (adult) { marks += '<span class="meal-clash">⚠️ ' + esc(adult.text) + '</span>'; }
      if (kid) { marks += '<span class="meal-clash">⚠️ ' + esc(kid.text) + '</span>'; }
      if (!adult && !kid) { marks += '<span class="meal-away">✨ 점심과 안 겹쳐요</span>'; }
    }
    var kidBox = '';
    if (meal.kidMenu) {
      var kidIngs = ingChips(meal.kidMenu.uses, stock);
      kidBox = '<div class="kid-menu">' +
        '<p class="kid-label">👶 인성이 별도 메뉴</p>' +
        '<p class="kid-title">' + esc(meal.kidMenu.title || '') + '</p>' +
        (kidIngs ? '<div class="ings">' + kidIngs + '</div>' : '') +
        '</div>';
    }
    return '' +
      '<article class="meal meal-' + course +
        (isPriority(meal) ? ' is-priority' : '') +
        (adult || kid ? ' is-clash' : '') + '">' +
        '<div class="meal-top">' +
          '<div class="meal-emoji" aria-hidden="true">' + esc(meal.emoji || '🍳') + '</div>' +
          '<div class="meal-head">' +
            '<h3 class="meal-title">' + esc(meal.title) + '</h3>' +
            '<div class="meal-sub">' +
              '<span class="meal-when ' + whenCls + '">' + whenTxt + '</span>' +
              who +
              '<span class="mini">⏱ ' + esc(meal.time || '') + '</span>' +
              '<span class="mini">' + esc(meal.difficulty || '') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        (marks ? '<div class="meal-mark">' + marks + '</div>' : '') +
        (meal.memo ? '<p class="meal-memo">📝 ' + esc(meal.memo) + '</p>' : '') +
        (ings ? '<div class="ings">' + ings + '</div>' : '') +
        pairLine +
        kidBox +
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
    var lunch = targetLunch();
    var ranked = list.map(function (m) {
      var clash = (clashOf(m, lunch) ? 1 : 0) + (kidClashOf(m, lunch) ? 1 : 0);
      return { meal: m, clash: clash, clear: isPriority(m) ? 1 : 0, score: stockScore(m, stock) };
    });
    var order = { breakfast: 0, lunch: 1, dinner: 2, salad: 3 };
    ranked.sort(function (a, b) {
      /* 1순위: 점심과 안 겹치는 ‘냉장고 파먹기’ 식단 → 그다음 안 겹치는 식단 → 겹치는 식단 */
      var ga = a.clash === 0 ? (a.clear ? 0 : 1) : 2;
      var gb = b.clash === 0 ? (b.clear ? 0 : 1) : 2;
      if (ga !== gb) { return ga - gb; }
      if (a.clash !== b.clash) { return a.clash - b.clash; }
      if (b.score !== a.score) { return b.score - a.score; }
      return order[courseOf(a.meal)] - order[courseOf(b.meal)];
    });
    return ranked.map(function (r) { return r.meal; });
  }

  function lunchBanner(lunch) {
    if (!lunch) { return ''; }
    if (!lunch.active) {
      return '' +
        '<div class="lunch-banner">' +
          '<div class="lunch-top">' +
            '<span class="lunch-emoji" aria-hidden="true">🏫</span>' +
            '<span class="lunch-title">라이즈 점심 식단 연동</span>' +
            '<span class="lunch-state">대기 중</span>' +
          '</div>' +
          '<p class="lunch-note">' + esc(lunch.note || '인성이 점심 식단표 보내주시면 겹치지 않게 아침·저녁을 맞춰 추천해요!') + '</p>' +
        '</div>';
    }
    var entry = lunch.entry;
    var items = Array.isArray(entry.items) ? entry.items : [];
    var rows = lunch.schedule.map(function (e) {
      var isTarget = e.date === entry.date;
      var snackLine = e.afternoonSnack ? ' / 오후 간식 ' + e.afternoonSnack : '';
      return '<div class="menu-row' + (isTarget ? ' is-target' : '') + '">' +
        '<span class="menu-date">' + esc(monthDay(e.date, e.dayLabel)) + '</span>' +
        '<span class="menu-items">' + esc((e.items || []).join(' · ') + snackLine) + '</span>' +
        '</div>';
    }).join('');
    return '' +
      '<div class="lunch-banner on">' +
        '<div class="lunch-top">' +
          '<span class="lunch-emoji" aria-hidden="true">🏫</span>' +
          '<span class="lunch-title">라이즈 점심 식단 연동</span>' +
          '<span class="lunch-state">연동됨</span>' +
        '</div>' +
        '<p class="lunch-day">' + esc(lunch.dayText) + '</p>' +
        '<p class="lunch-today">' + esc(items.join(' · ')) + '</p>' +
        (entry.afternoonSnack ? '<p class="lunch-after">🍪 오후 간식 ' + esc(entry.afternoonSnack) + '</p>' : '') +
        '<p class="lunch-note">' +
          (entry.snack ? '간식 ' + esc(entry.snack) + ' · ' : '') +
          '겹치는 메뉴는 ⚠️ 표시하고 아래로 내려뒀어요' +
        '</p>' +
        '<details class="menu-more">' +
          '<summary>' + esc((lunch.schoolName || '11월 식단') + ' 전체 보기') + ' · ' + lunch.schedule.length + '일</summary>' +
          '<div class="menu-list">' + rows + '</div>' +
        '</details>' +
      '</div>';
  }

  function homeLunchLine(lunch) {
    if (!lunch || !lunch.active) {
      return '<p class="home-lunch off">🍱 점심 식단표를 보내주시면 겹치지 않게 맞춰드려요</p>';
    }
    var items = Array.isArray(lunch.entry.items) ? lunch.entry.items : [];
    var head = items.slice(0, 3).join(' · ');
    var rest = items.length > 3 ? ' 외 ' + (items.length - 3) : '';
    return '<p class="home-lunch">🍱 ' + esc(lunch.dayText) + ' · ' +
      esc(head + rest) + '<span>겹치지 않는 메뉴 먼저</span></p>';
  }

  /* ---------------- 📅 주간 식단 ---------------- */

  function weekPlan() {
    var w = state.data && state.data.weekPlan;
    if (!w || typeof w !== 'object' || !Array.isArray(w.days) || w.days.length === 0) { return null; }
    return w;
  }

  function weekRange(w) {
    var first = w.days[0];
    var last = w.days[w.days.length - 1];
    return monthDay(w.startDate || first.date, first.dayLabel) + ' ~ ' +
      monthDay(w.endDate || last.date, last.dayLabel);
  }

  function findWeekDay(w, date) {
    var days = (w && w.days) || [];
    for (var i = 0; i < days.length; i++) {
      if (days[i] && days[i].date === date) { return days[i]; }
    }
    return null;
  }

  /* ---------------- 🧊 전날 해동 알림 ---------------- */
  /* 냉동실 품목 중 data.json에서 needsThaw: true 인 것만 해동 대상이에요.
     식빵·돈가스·볶음밥처럼 해동 없이 바로 조리하는 건 붙이지 않았어요. */

  var THAW_COURSES = [
    { key: 'breakfast', label: '아침' },
    { key: 'lunch', label: '점심' },
    { key: 'dinner', label: '저녁' }
  ];

  function thawItems() {
    return itemsOf('freezer').filter(function (it) { return !!(it && it.needsThaw); });
  }

  function thawMatch(label) {
    var k = norm(label);
    if (!k) { return null; }
    var list = thawItems(), i, n;
    for (i = 0; i < list.length; i++) {
      if (norm(list[i].name) === k) { return list[i]; }
    }
    for (i = 0; i < list.length; i++) {
      n = norm(list[i].name);
      if (n.indexOf(k) !== -1 || k.indexOf(n) !== -1) { return list[i]; }
    }
    return null;
  }

  /* 한 끼니(메인·서브반찬·국·인성이 별도 + thawNotes)에서 해동할 냉동 재료를 모아요. */
  function thawOfMeal(meal) {
    if (!meal) { return []; }
    var out = [], seen = {};
    function add(name, tip) {
      var k = norm(name);
      if (!k || seen[k]) { return; }
      seen[k] = true;
      out.push({ name: name, tip: tip || '' });
    }
    [meal, meal.side, meal.soup, meal.kidMenu].forEach(function (m) {
      if (!m) { return; }
      (Array.isArray(m.uses) ? m.uses : []).forEach(function (u) {
        var hit = thawMatch(u);
        if (hit) { add(hit.name, hit.thawTip); }
      });
    });
    (Array.isArray(meal.thawNotes) ? meal.thawNotes : []).forEach(function (t) {
      if (t && t.name) { add(t.name, t.tip); }
    });
    return out;
  }

  /* 그날 실제로 먹는 끼니(❌ 패스·⏭️ 스킵·↪️ 밀려 들어온 메뉴 반영) 기준 해동 목록 */
  function dayThawList(day, view) {
    if (!day) { return []; }
    var slots = (view && view[day.date]) || {};
    var out = [], seen = {};
    THAW_COURSES.forEach(function (c) {
      var orig = day[c.key];
      if (!orig || orig.skipped) { return; }
      var sv = slots[c.key] || null;
      if (sv && sv.state === 'passed') { return; }
      var meal = (sv && sv.incoming && sv.incoming.meal) ? sv.incoming.meal : orig;
      thawOfMeal(meal).forEach(function (t) {
        var k = norm(t.name);
        if (seen[k]) { return; }
        seen[k] = true;
        out.push({ name: t.name, tip: t.tip, course: c.key, courseLabel: c.label });
      });
    });
    return out;
  }

  /* 오늘 밤 → 내일 식단의 해동 목록 */
  function nextDayThaw(w, model, date) {
    var next = findWeekDay(w, isoAdd(date, 1));
    if (!next) { return null; }
    var list = dayThawList(next, model.view);
    if (!list.length) { return null; }
    return { day: next, list: list };
  }

  /* 홈 상단 배너: 내일 해동할 재료가 있을 때만 떠요. */
  function thawBanner() {
    var w = weekPlan();
    if (!w || !w.days.length) { return ''; }
    var tomorrow = isoAdd(isoToday(), 1);
    var day = findWeekDay(w, tomorrow);
    var whenLabel = '내일';
    if (!day) {
      if (tomorrow > w.days[0].date) { return ''; }
      day = w.days[0];
      whenLabel = monthDay(day.date, day.dayLabel);
    }
    var list = dayThawList(day, computeWeekView(w).view);
    if (!list.length) { return ''; }
    var stamp = monthDay(day.date, day.dayLabel);
    var rows = list.map(function (t) {
      return '<li class="thaw-item">' +
        '<span class="thaw-name">' + esc(t.name) + '</span>' +
        '<span class="thaw-when">' + (whenLabel === '내일' ? '내일 ' : stamp + ' ') + esc(t.courseLabel) + '용</span>' +
        (t.tip ? '<span class="thaw-tip">' + esc(t.tip) + '</span>' : '') +
      '</li>';
    }).join('');
    var head = whenLabel === '내일' ? '내일 식단 해동 알림' : stamp + ' 식단 해동 알림';
    return '' +
      '<section class="section thaw-banner" id="thawBanner">' +
        '<div class="thaw-head">' +
          '<span class="thaw-emoji" aria-hidden="true">🧊</span>' +
          '<span class="thaw-title">' + esc(head) + '</span>' +
          '<span class="thaw-sub">🌙 오늘 밤 냉장실로!</span>' +
        '</div>' +
        '<ul class="thaw-list">' + rows + '</ul>' +
        '<p class="thaw-note">냉동실에서 내려 두면 내일 조리가 3~8분이면 끝나요</p>' +
      '</section>';
  }

  function schoolEntry(date) {
    var lm = lunchData();
    if (!lm) { return null; }
    for (var i = 0; i < lm.schedule.length; i++) {
      if (lm.schedule[i] && lm.schedule[i].date === date) { return lm.schedule[i]; }
    }
    return null;
  }

  function dayBadge(iso) {
    var n = daysUntil(iso);
    if (n === null) { return ''; }
    if (n === 0) { return '<span class="day-badge today">오늘</span>'; }
    if (n === 1) { return '<span class="day-badge tomorrow">내일</span>'; }
    if (n < 0) { return '<span class="day-badge past">지난</span>'; }
    return '';
  }

  /* 식단의 재료 이름을 냉장고 재료와 느슨하게 맞춰 찾아요. */
  function findStockItem(label) {
    var k = norm(label);
    if (!k) { return null; }
    var list = stockEntries(), i, n;
    for (i = 0; i < list.length; i++) {
      if (norm(list[i].name) === k) { return list[i].item; }
    }
    for (i = 0; i < list.length; i++) {
      n = norm(list[i].name);
      if (n.indexOf(k) !== -1 || k.indexOf(n) !== -1) { return list[i].item; }
    }
    return null;
  }

  function weekChips(uses) {
    var stock = inStock();
    return (Array.isArray(uses) ? uses : []).map(function (u) {
      var st = stockState(u, stock);
      var item = findStockItem(u);
      var prio = !!item && isPriority(item);
      var icon = prio ? '🔥' : (st === 'ok' ? '✅' : st === 'soon' ? '📦' : '🛒');
      return '<span class="ing ' + st + (prio ? ' prio' : '') + '">' + icon + ' ' + esc(u) + '</span>';
    }).join('');
  }

  /* 메인 + 서브반찬 + 국의 겹침 태그를 한데 모아요 (이동·겹침 검사용) */
  function allMealTags(meal) {
    if (!meal) { return []; }
    var out = [];
    [meal, meal.side, meal.soup].forEach(function (m) {
      if (!m) { return; }
      mealTags(m).forEach(function (t) { if (out.indexOf(t) === -1) { out.push(t); } });
    });
    return out;
  }

  /* 그날 라이즈 점심과 겹치는 메뉴 이름 (없으면 null) */
  function clashWithEntry(meal, entry) {
    if (!meal || !entry) { return null; }
    var tags = allMealTags(meal);
    if (!tags.length) { return null; }
    var fake = { active: true, entry: entry, shortDate: monthDay(entry.date, entry.dayLabel) };
    return findClash(tags, fake);
  }

  function weekKidBox(kid, entry) {
    if (!kid) { return ''; }
    var clash = clashWithEntry(kid, entry);
    return '' +
      '<div class="kid-menu">' +
        '<p class="kid-label">👶 인성이 별도 메뉴</p>' +
        '<p class="kid-title">' + esc(kid.title || '') + '</p>' +
        (kid.uses ? '<div class="ings">' + weekChips(kid.uses) + '</div>' : '') +
        (clash ? '<p class="kid-warn">⚠️ ' + esc(clash) + ' 겹침</p>' : '') +
        (kid.memo ? '<p class="slot-memo">' + esc(kid.memo) + '</p>' : '') +
      '</div>';
  }

  /* ---------------- ⭕/❌ 체크 & 자동 미루기 ---------------- */
  /* 웹에서 누른 체크는 이 폰의 localStorage에만 저장하고, 남편 폰·냉장고 재고는
     '📋 피클에 보낼 내용 복사'로 옮겨요. data.json은 건드리지 않아요. */

  var OX_KEY = 'insung_fridge_ox_v1';
  var OX_COURSES = ['breakfast', 'lunch', 'dinner'];
  var OX_LABEL = { breakfast: '아침', lunch: '점심', dinner: '저녁' };
  var oxStore = null;

  function oxSlotKey(date, course) { return date + '|' + course; }

  function loadOX() {
    var all = {};
    try {
      var raw = window.localStorage.getItem(OX_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { all = parsed; }
    } catch (e) {
      all = {};
    }
    oxStore = all;
    return all;
  }

  function oxAll() {
    if (!oxStore) { loadOX(); }
    return oxStore || {};
  }

  /* 주간 식단은 startDate별로 따로 저장해요. */
  function weekOX(w) {
    var all = oxAll();
    var key = (w && w.startDate) ? w.startDate : 'week';
    if (!all[key] || typeof all[key] !== 'object' || Array.isArray(all[key])) { all[key] = {}; }
    return all[key];
  }

  function saveOX() {
    try {
      window.localStorage.setItem(OX_KEY, JSON.stringify(oxAll()));
    } catch (e) {
      /* 저장이 막힌 브라우저에서는 이번 화면에서만 반영돼요 */
    }
  }

  function setOX(date, course, value) {
    var w = weekPlan();
    if (!w || !date || OX_COURSES.indexOf(course) === -1) { return; }
    var map = weekOX(w);
    var k = oxSlotKey(date, course);
    if (value === 'eaten' || value === 'passed') { map[k] = value; }
    else { delete map[k]; }
    saveOX();
  }

  function clearOX() {
    var w = weekPlan();
    if (!w) { return; }
    var all = oxAll();
    all[(w.startDate || 'week')] = {};
    saveOX();
  }

  function oxCounts(w) {
    var map = weekOX(w);
    var out = { eaten: 0, passed: 0, total: 0 };
    Object.keys(map).forEach(function (k) {
      if (map[k] === 'eaten') { out.eaten++; }
      else if (map[k] === 'passed') { out.passed++; }
    });
    out.total = out.eaten + out.passed;
    return out;
  }

  function weekDayLabel(w, date) {
    var days = (w && w.days) || [];
    for (var i = 0; i < days.length; i++) {
      if (days[i].date === date) { return days[i].dayLabel || ''; }
    }
    return '';
  }

  /* 11/17(화) 저녁 */
  function slotStamp(w, date, course) {
    return monthDay(date, weekDayLabel(w, date)) + ' ' + (OX_LABEL[course] || '');
  }

  function destText(w, spot) {
    if (!spot) { return '뒤'; }
    if (spot.next) { return '다음 주로'; }
    return slotStamp(w, spot.date, spot.course) + '으로';
  }

  /* 미룰 끼니가 그날 라이즈 점심과 겹치는지 볼 때 쓰는 태그
     (매운 저녁은 인성이 별도 메뉴 기준, 그 밖엔 메뉴 자체 기준) */
  function deferTags(meal, course) {
    var out = [];
    function merge(list) {
      (list || []).forEach(function (t) { if (out.indexOf(t) === -1) { out.push(t); } });
    }
    if (course === 'dinner' && meal && meal.kidMenu) { merge(mealTags(meal.kidMenu)); }
    else { merge(mealTags(meal)); }
    /* 서브반찬·국도 인성이 같이 먹으면 그날 점심과 겹치면 안 돼요 */
    if (meal && meal.side) { merge(mealTags(meal.side)); }
    if (meal && meal.soup) { merge(mealTags(meal.soup)); }
    return out;
  }

  function entryClash(tags, entry) {
    if (!entry || !tags || !tags.length) { return null; }
    var probe = { active: true, entry: entry, shortDate: monthDay(entry.date, entry.dayLabel) };
    return findClash(tags, probe);
  }

  /* ❌ 패스한 끼니를 같은 코스의 뒤 날짜로 순연(cascade) 배치한 결과를 계산해요.
     - data.json에서 이미 패스한 끼니와 ⭕ 먹음은 자리를 지켜요.
     - 미룰 메뉴는 그런 자리를 건너뛰고 다음 자리에 들어가며, 원래 그 자리에 있던 메뉴는
       한 칸씩 뒤로 밀려요.
     - 평일 아침·저녁이 그날 라이즈 점심과 겹치면 그날은 건너뛰고 다음 날로 보내요.
     - 일요일 뒤로 밀려 남은 메뉴는 '다음 주로 미뤄진 메뉴'로 모아요. */
  function computeWeekView(w) {
    var map = weekOX(w);
    var view = {};
    var placedAt = {};
    var nextWeek = [];

    w.days.forEach(function (d) { view[d.date] = {}; });

    OX_COURSES.forEach(function (course) {
      var carry = [];

      w.days.forEach(function (d) {
        var orig = d[course];
        var token = oxSlotKey(d.date, course);
        var st = map[token] || null;
    var sv = { date: d.date, course: course, state: st, incoming: null, movedTo: null, fixed: false, original: orig || null };
        view[d.date][course] = sv;

        if (orig && orig.skipped) {
          sv.fixed = true;
          placedAt[token] = { here: true };
          return;
        }
        if (orig && st === 'eaten') {
          placedAt[token] = { here: true };
          return;
        }
        if (orig && st === 'passed') {
          carry.push({ meal: orig, from: d.date, course: course, token: token });
          return;
        }

        if (carry.length) {
          var head = carry[0];
          var entry = schoolEntry(d.date);
          var blocked = false;
          if (entry && !d.weekend && (course === 'breakfast' || course === 'dinner')) {
            if (entryClash(deferTags(head.meal, course), entry)) { blocked = true; }
          }
          if (!blocked) {
            carry.shift();
            sv.incoming = head;
            placedAt[head.token] = { date: d.date, course: course };
            if (orig) { carry.push({ meal: orig, from: d.date, course: course, token: token }); }
            return;
          }
        }

        if (orig) { placedAt[token] = { here: true }; }
      });

      carry.forEach(function (c) {
        placedAt[c.token] = { next: true };
        nextWeek.push(c);
      });
    });

    w.days.forEach(function (d) {
      OX_COURSES.forEach(function (course) {
        var sv = view[d.date][course];
        if (!sv || sv.fixed) { return; }
        var spot = placedAt[oxSlotKey(d.date, course)];
        sv.movedTo = (spot && !spot.here) ? spot : null;
      });
    });

    return { view: view, nextWeek: nextWeek, counts: oxCounts(w) };
  }

  function oxButtons(date, course, state) {
    var k = oxSlotKey(date, course);
    var name = OX_LABEL[course] || '';
    return '' +
      '<div class="ox-row" role="group" aria-label="' + esc(name) + ' 체크">' +
        '<button type="button" class="ox-btn eat' + (state === 'eaten' ? ' on' : '') +
          '" data-ox="' + esc(k) + '" data-val="eaten" aria-pressed="' + (state === 'eaten' ? 'true' : 'false') +
          '">⭕ 먹음</button>' +
        '<button type="button" class="ox-btn pass' + (state === 'passed' ? ' on' : '') +
          '" data-ox="' + esc(k) + '" data-val="passed" aria-pressed="' + (state === 'passed' ? 'true' : 'false') +
          '">❌ 패스</button>' +
      '</div>';
  }

  function oxBar(w, counts) {
    var hint = '각 끼니의 ⭕/❌를 누르면 내 폰에서 바로 미뤄지고, 복사해서 피클에 보내면 남편 폰·재고도 같이 맞춰져요';
    var live = '';
    if (counts.total > 0) {
      live = '' +
        '<div class="ox-bar-live">' +
          '<div class="ox-count">' +
            '<b class="eat">⭕ 먹음 ' + counts.eaten + '</b>' +
            '<b class="pass">❌ 미룸 ' + counts.passed + '</b>' +
          '</div>' +
          '<div class="ox-actions">' +
            '<button type="button" class="ox-copy" id="oxCopy">📋 피클에 보낼 내용 복사</button>' +
            '<button type="button" class="ox-reset" id="oxReset">↺ 초기화</button>' +
          '</div>' +
        '</div>';
    }
    return '' +
      '<div class="ox-bar' + (counts.total > 0 ? ' is-live' : '') + '" id="oxBar">' +
        '<p class="ox-hint">💡 ' + esc(hint) + '</p>' +
        live +
      '</div>';
  }

  function nextWeekCard(w, list) {
    if (!list.length) { return ''; }
    return '' +
      '<div class="wnext" id="weekNext">' +
        '<p class="wnext-title">📦 다음 주로 미뤄진 메뉴</p>' +
        '<ul class="wnext-list">' +
          list.map(function (c) {
            var m = c.meal || {};
            return '<li>' +
              '<span class="wn-emoji" aria-hidden="true">' + esc(m.emoji || '🍽') + '</span>' +
              '<span class="wn-body">' +
                '<b>' + esc(m.title || '') + '</b>' +
                '<span class="wn-from">← ' + esc(slotStamp(w, c.from, c.course)) + '에서</span>' +
              '</span>' +
            '</li>';
          }).join('') +
        '</ul>' +
        '<p class="wnext-note">이번 주 안에 자리가 없어서 다음 주 식단으로 넘겨뒀어요 · 재료는 그대로 남아 있어요</p>' +
      '</div>';
  }

  /* 피클에 붙여넣을 한국어 요약 */
  function oxCopyText(w, model) {
    var map = weekOX(w);
    var rows = [];
    w.days.forEach(function (d) {
      OX_COURSES.forEach(function (course) {
        var st = map[oxSlotKey(d.date, course)];
        if (st !== 'eaten' && st !== 'passed') { return; }
        var sv = model.view[d.date][course];
        var meal = (sv && sv.original) ? sv.original : (d[course] || {});
        rows.push({
          date: d.date,
          course: course,
          st: st,
          title: meal.title || '',
          stamp: slotStamp(w, d.date, course),
          dest: (sv && sv.movedTo) ? destText(w, sv.movedTo) : ''
        });
      });
    });
    rows.sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? -1 : 1; }
      return OX_COURSES.indexOf(a.course) - OX_COURSES.indexOf(b.course);
    });

    var lines = ['[인성이네 냉장고 식단 체크]'];
    rows.forEach(function (r) {
      var line = '- ' + r.stamp + ': ' + (r.st === 'eaten' ? '⭕ 먹음' : '❌ 패스·미룸');
      if (r.title) { line += ' (' + r.title + ')'; }
      if (r.st === 'passed' && r.dest) { line += ' → ' + r.dest; }
      lines.push(line);
    });
    lines.push('→ 확인 후 남편 화면이랑 냉장고 재고에도 반영해 줘!');
    return lines.join('\n');
  }

  function copyText(text, done) {
    var fallback = function () {
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) {
        ok = false;
      }
      done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function oxToast(text) {
    var old = document.getElementById('oxToast');
    if (old && old.parentNode) { old.parentNode.removeChild(old); }
    var box = document.createElement('div');
    box.className = 'ox-toast';
    box.id = 'oxToast';
    box.setAttribute('role', 'status');
    box.textContent = text;
    document.body.appendChild(box);
    window.setTimeout(function () {
      if (box && box.parentNode) { box.parentNode.removeChild(box); }
    }, 1900);
  }

  function copyWeek() {
    var w = weekPlan();
    if (!w) { return; }
    var text = oxCopyText(w, computeWeekView(w));
    copyText(text, function (ok) {
      var btn = document.getElementById('oxCopy');
      if (btn) {
        btn.textContent = ok ? '✅ 복사됐어요! 톡에 붙여넣기' : '복사가 안 됐어요 · 다시 눌러 주세요';
        btn.classList.toggle('is-done', ok);
        window.setTimeout(function () {
          var again = document.getElementById('oxCopy');
          if (again) {
            again.textContent = '📋 피클에 보낼 내용 복사';
            again.classList.remove('is-done');
          }
        }, 2000);
      }
      if (!ok) { oxToast('복사가 막혔어요 · 브라우저 설정을 확인해 주세요'); }
    });
  }

  function resetWeek() {
    clearOX();
    renderContent();
    oxToast('↺ 이번 주 체크를 모두 지웠어요');
  }

  /* ---------------- 🧂 우리 집 조미료 · 부재료 (읽기 전용) ---------------- */
  /* 종희 님 요청으로 조미료는 이제 체크하지 않아요.
     data.json의 pantry.groups[].items[].checked 를 '보유(true)/미보유(false)' 표시로만 읽어
     보유 목록을 깔끔하게 보여주고, 없는 것(쌈장)만 따로 표시해요.
     조미료는 냉장·냉동·실온 재고 숫자에 넣지 않습니다. */

  var pantryFolded = true;   /* 기본은 접힌 컴팩트 요약 */

  function pantryData() {
    var p = state.data && state.data.pantry;
    if (!p || !Array.isArray(p.groups)) { return null; }
    return p;
  }

  /* 조미료·부재료 그룹 */
  function pantryGroups() {
    var p = pantryData();
    return (p && Array.isArray(p.groups)) ? p.groups : [];
  }

  function eachPantryItem(groups, fn) {
    groups.forEach(function (g) {
      (g.items || []).forEach(function (it) { if (it && it.name) { fn(it, g); } });
    });
  }

  function pantryHas(item) {
    return !item || item.checked !== false;
  }

  function pantryCounts(groups) {
    var out = { on: 0, total: 0 };
    eachPantryItem(groups, function (it) {
      out.total++;
      if (pantryHas(it)) { out.on++; }
    });
    return out;
  }

  /* 없는 것(미보유) 목록 — 지금은 쌈장 하나 */
  function pantryMissing(groups) {
    var miss = [];
    eachPantryItem(groups, function (it) { if (!pantryHas(it)) { miss.push(it.name); } });
    return miss;
  }

  /* 접힌 상태 한 줄 요약: 보유 37종 · 없는 것 1종(쌈장) */
  function pantrySummaryText() {
    var c = pantryCounts(pantryGroups());
    var miss = pantryMissing(pantryGroups());
    return '보유 ' + c.on + '종 · 없는 것 ' + miss.length + '종' +
      (miss.length ? '(' + miss.join('·') + ')' : '');
  }

  /* 체크박스 없는 정적 칩 — 보유 조미료만 */
  function pantryChip(it) {
    return '<span class="pantry-item on">' +
        '<span class="pi-name">' + esc(it.name) + '</span>' +
      '</span>';
  }

  function pantryGroupBlock(g) {
    var kept = (g.items || []).filter(pantryHas);
    return '' +
      '<p class="pantry-group">' + esc((g.emoji ? g.emoji + ' ' : '') + (g.label || '')) +
        '<span class="pantry-group-count">' + kept.length + '종</span>' +
      '</p>' +
      '<div class="pantry-grid">' + kept.map(pantryChip).join('') + '</div>';
  }

  /* 없는 것만 흐린 점선 태그로 한 줄 */
  function pantryMissingBlock() {
    var miss = pantryMissing(pantryGroups());
    if (!miss.length) { return ''; }
    return '' +
      '<div class="pantry-miss">' +
        '<span class="pantry-miss-head">없는 것</span>' +
        miss.map(function (n) {
          return '<span class="pantry-item off">미보유: ' + esc(n) + '</span>';
        }).join('') +
      '</div>';
  }

  function pantrySection() {
    var p = pantryData();
    if (!p) { return ''; }
    var c = pantryCounts(pantryGroups());
    return '' +
      '<section class="section pantry-sec' + (pantryFolded ? ' is-folded' : '') + '" id="pantrySec">' +
        '<div class="sec-head">' +
          '<h2 class="sec-title">' + esc(p.title || '🧂 우리 집 조미료 · 부재료') + '</h2>' +
          '<span class="sec-count" id="pantryCount">' + c.on + '종</span>' +
          '<button type="button" class="pantry-fold" id="pantryFold" aria-expanded="' +
            (pantryFolded ? 'false' : 'true') + '">' +
            (pantryFolded ? '목록 보기 ▾' : '접기 ▴') + '</button>' +
        '</div>' +
        '<p class="pantry-summary" id="pantrySummary">' + esc(pantrySummaryText()) + '</p>' +
        (p.note ? '<p class="sec-sub">' + esc(p.note) + '</p>' : '') +
        '<div class="pantry-body">' +
          pantryGroups().map(pantryGroupBlock).join('') +
          pantryMissingBlock() +
        '</div>' +
      '</section>';
  }

  function togglePantryFold() {
    pantryFolded = !pantryFolded;
    var sec = document.getElementById('pantrySec');
    if (sec) { sec.classList.toggle('is-folded', pantryFolded); }
    var btn = document.getElementById('pantryFold');
    if (btn) {
      btn.setAttribute('aria-expanded', pantryFolded ? 'false' : 'true');
      btn.textContent = pantryFolded ? '목록 보기 ▾' : '접기 ▴';
    }
  }

  /* 🥬 서브반찬 · 🥣 국 두 칸 박스 (주간 식단 슬롯용) */
  function pairChips(uses) {
    var list = Array.isArray(uses) ? uses : [];
    if (!list.length) { return ''; }
    var stock = inStock();
    return '<span class="pair-ings">' + list.map(function (u) {
      var st = stockState(u, stock);
      return '<span class="pi ' + st + '">' +
        (st === 'ok' ? '✅ ' : st === 'soon' ? '📦 ' : '🛒 ') + esc(u) + '</span>';
    }).join('') + '</span>';
  }

  function pairCell(kind, c) {
    if (!c || !c.title) { return ''; }
    var isSoup = kind === 'soup';
    return '<div class="pair-cell ' + (isSoup ? 'pc-soup' : 'pc-side') + '"' +
      (c.note ? ' title="' + esc(c.note) + '"' : '') + '>' +
      '<span class="pair-k">' + (isSoup ? '🥣 국' : '🥬 서브반찬') + '</span>' +
      '<span class="pair-v">' + esc(c.title) + '</span>' +
      pairChips(c.uses) +
    '</div>';
  }

  function slotPair(meal) {
    if (!meal) { return ''; }
    var cells = pairCell('side', meal.side) + pairCell('soup', meal.soup);
    return cells ? '<div class="slot-pair">' + cells + '</div>' : '';
  }

  function weekSlot(kind, label, meal, entry, check, sv, w) {
    var incoming = (sv && sv.incoming && sv.incoming.meal) ? sv.incoming.meal : null;
    if (!meal && !incoming) { return ''; }
    var isOX = OX_COURSES.indexOf(kind) !== -1;
    var state = (sv && isOX && meal) ? sv.state : null;

    if (meal && meal.skipped) {
      /* 외출·패스한 끼: 흐리게 표시하고 겹침 검증·재료 칩은 건너뛰어요. */
      return '' +
        '<div class="slot slot-' + kind + ' slot-skipped">' +
          '<div class="slot-head">' +
            '<span class="slot-label">' + label + '</span>' +
            '<span class="skip-badge">' + esc(meal.who || '⏭️ 외출 · 패스') + '</span>' +
          '</div>' +
          '<p class="slot-title">' + (meal.emoji ? esc(meal.emoji) + ' ' : '') + esc(meal.title || '이 끼니는 안 먹어요') + '</p>' +
          (meal.memo ? '<p class="slot-memo">' + esc(meal.memo) + '</p>' : '') +
        '</div>';
    }

    if (state === 'passed') {
      var movedTo = (sv && sv.movedTo) ? sv.movedTo : null;
      return '' +
        '<div class="slot slot-' + kind + ' slot-passed">' +
          '<div class="slot-head">' +
            '<span class="slot-label">' + label + '</span>' +
            '<span class="pass-badge">⏭️ 패스 · 뒤로 미룸</span>' +
          '</div>' +
          '<p class="slot-title">' + (meal.emoji ? esc(meal.emoji) + ' ' : '') + esc(meal.title || '') + '</p>' +
          '<p class="slot-move">↪ ' + esc(destText(w, movedTo)) + ' 미뤘어요</p>' +
          (isOX ? oxButtons(sv.date, kind, 'passed') : '') +
        '</div>';
    }

    var shown = (sv && sv.incoming && sv.incoming.meal) ? sv.incoming.meal : meal;
    var fromDate = (sv && sv.incoming) ? sv.incoming.from : null;
    var clash = (check && entry) ? clashWithEntry(shown, entry) : null;
    var kidClash = (check && entry && shown.kidMenu) ? clashWithEntry(shown.kidMenu, entry) : null;
    var chips = weekChips(shown.uses);
    var pairBox = slotPair(shown);
    var thawList = thawOfMeal(shown);
    var thawLine = thawList.length
      ? '<p class="slot-thaw">🧊 전날 해동 필요 · ' +
        esc(thawList.map(function (t) { return t.name; }).join(' · ')) + '</p>'
      : '';
    var mark = '';
    if (check && entry) {
      mark = (clash || kidClash)
        ? '<span class="wmark warn">⚠️ ' + esc(clash || kidClash) + ' 겹침</span>'
        : '<span class="wmark ok">✅ 라이즈 점심과 안 겹쳐요</span>';
    }
    var who = (shown.who && kind !== 'lunch' && kind !== 'snack')
      ? '<span class="slot-who">' + esc(shown.who) + '</span>' : '';
    var movedIn = fromDate
      ? '<div class="moved-row"><span class="moved-badge">↪️ ' + esc(slotStamp(w, fromDate, kind)) + '에서 미룸</span></div>'
      : '';
    return '' +
      '<div class="slot slot-' + kind +
        (state === 'eaten' ? ' slot-eaten' : '') +
        (fromDate ? ' slot-moved' : '') + '">' +
        '<div class="slot-head">' +
          '<span class="slot-label">' + label + '</span>' +
          who +
          (shown.time ? '<span class="slot-time">⏱ ' + esc(shown.time) + '</span>' : '') +
        '</div>' +
        '<p class="slot-title">' + (shown.emoji ? esc(shown.emoji) + ' ' : '') + esc(shown.title || '') + '</p>' +
        movedIn +
        thawLine +
        pairBox +
        (state === 'eaten' ? '<p class="ox-eaten">⭕ 먹었어요</p>' : '') +
        (chips ? '<div class="ings">' + chips + '</div>' : '') +
        (mark ? '<div class="wmark-row">' + mark + '</div>' : '') +
        (shown.memo ? '<p class="slot-memo">' + esc(shown.memo) + '</p>' : '') +
        weekKidBox(shown.kidMenu, entry) +
        (isOX ? oxButtons(sv ? sv.date : '', kind, state) : '') +
      '</div>';
  }

  function schoolSlot(entry) {
    if (!entry) { return ''; }
    var items = Array.isArray(entry.items) ? entry.items : [];
    var avoid = Array.isArray(entry.avoidTags) ? entry.avoidTags : [];
    return '' +
      '<div class="slot slot-school">' +
        '<div class="slot-head">' +
          '<span class="slot-label">🏫 라이즈 점심 (인성이 유치원)</span>' +
          (entry.snack ? '<span class="slot-time">간식 ' + esc(entry.snack) + '</span>' : '') +
        '</div>' +
        '<p class="slot-title small">' + esc(items.join(' · ')) + '</p>' +
        (entry.afternoonSnack
          ? '<p class="slot-after">🍪 오후 간식 ' + esc(entry.afternoonSnack) + '</p>'
          : '') +
        (avoid.length
          ? '<p class="slot-memo school-avoid">이날 인성이 아침·저녁엔 점심·오후 간식에 나온 ' + esc(avoid.join(' · ')) + ' 안 써요</p>'
          : '') +
      '</div>';
  }

  /* 날짜 카드 하단 띠: 오늘 밤 해동할 게 있으면 알려줘요 */
  function thawStrip(nd) {
    var names = nd.list.slice(0, 2).map(function (t) { return t.name; }).join(' · ') +
      (nd.list.length > 2 ? ' 외 ' + (nd.list.length - 2) : '');
    return '<p class="thaw-strip">🧊 오늘 밤 냉장 해동 → 내일(' +
      esc(nd.day.dayLabel || '') + ') ' + esc(names) + '</p>';
  }

  function weekDayCard(day, w, model) {
    if (!day || !parseYMD(day.date)) { return ''; }
    var entry = schoolEntry(day.date);
    var n = daysUntil(day.date);
    var cls = 'day-card' + (n === 0 ? ' is-today' : '') + (n !== null && n < 0 ? ' is-past' : '');
    var v = (model && model.view[day.date]) || {};
    var out = [];
    out.push('<article class="' + cls + '" id="day-' + esc(day.date) + '">');
    out.push('<div class="day-head">' +
      '<span class="dd-num">' + esc(monthDay(day.date)) + '</span>' +
      '<span class="dd-wd">' + esc(day.dayLabel || '') + '요일</span>' +
      dayBadge(day.date) +
      '<span class="day-flag">' + (entry ? '평일 · 유치원 점심 연동' : '주말 · 3가족') + '</span>' +
      '</div>');
    out.push(weekSlot('breakfast', '🌅 인성이 아침', day.breakfast, entry, true, v.breakfast, w));
    out.push(weekSlot('lunch', day.weekend ? '🍱 주말 점심' : '🥗 엄마 점심', day.lunch, entry, false, v.lunch, w));
    out.push(schoolSlot(entry));
    out.push(weekSlot('dinner', '🌙 세 가족 저녁', day.dinner, entry, true, v.dinner, w));
    out.push(weekSlot('snack', '🍪 주말 간식 (유치원 쉬는 날)', day.snack, entry, false, v.snack, w));
    var thawNext = nextDayThaw(w, model, day.date);
    if (thawNext) { out.push(thawStrip(thawNext)); }
    if (day.dayMemo) { out.push('<p class="day-memo">📝 ' + esc(day.dayMemo) + '</p>'); }
    out.push('</article>');
    return out.join('');
  }

  function weekStats(w) {
    var total = 0, used = {}, names = {};
    allItems().forEach(function (x) { if (isPriority(x.item)) { total++; } });
    w.days.forEach(function (d) {
      [d.breakfast, d.lunch, d.snack, d.dinner].forEach(function (m) {
        if (!m) { return; }
        [m.uses, m.kidMenu ? m.kidMenu.uses : null].forEach(function (uses) {
          (Array.isArray(uses) ? uses : []).forEach(function (u) {
            var it = findStockItem(u);
            if (!it) { return; }
            names[it.name] = true;
            if (isPriority(it)) { used[it.name] = true; }
          });
        });
      });
    });
    return {
      days: w.days.length,
      prioTotal: total,
      prioUsed: Object.keys(used).length,
      items: Object.keys(names).length
    };
  }

  function weekTeaser() {
    var w = weekPlan();
    if (!w) { return ''; }
    var s = weekStats(w);
    return '' +
      '<button type="button" class="week-teaser" data-goto="week">' +
        '<span class="wt-emoji" aria-hidden="true">📅</span>' +
        '<span class="wt-body">' +
          '<span class="wt-title">' + esc(w.title || '이번 주 식단') + '</span>' +
          '<span class="wt-sub">' + esc(weekRange(w)) + ' · 7일 식단 보기' +
            (s.prioTotal ? ' · 🔥 우선 소진 ' + s.prioUsed + '/' + s.prioTotal + '종' : '') +
            ' ›</span>' +
        '</span>' +
      '</button>';
  }

  /* ---------------- 🍳 오늘 뭐 먹지? (주간 식단 연동) ---------------- */
  /* 홈 카드가 meals 카탈로그에서 임의로 뽑지 않고, 주간 식단(weekPlan)에서 오늘(KST) 끼니를
     그대로 가져와요. O/X 미루기(insung_fridge_ox_v1)까지 반영한 결과로 보여주려고
     주간 식단과 똑같은 computeWeekView를 다시 써요. */

  function homeWeekDay(w) {
    if (!w || !w.days || !w.days.length) { return null; }
    var today = isoToday();
    var first = w.days[0];
    var last = w.days[w.days.length - 1];
    var i;
    for (i = 0; i < w.days.length; i++) {
      if (w.days[i] && w.days[i].date === today) { return { day: w.days[i], mode: 'today' }; }
    }
    if (first.date > today) { return { day: first, mode: 'upcoming' }; }
    if (last.date < today) { return { day: last, mode: 'past' }; }
    /* 기간 안이지만 그 날짜가 없을 때 — 다음 날 → 없으면 마지막 날 */
    for (i = 0; i < w.days.length; i++) {
      if (w.days[i] && w.days[i].date > today) { return { day: w.days[i], mode: 'upcoming' }; }
    }
    return { day: last, mode: 'past' };
  }

  function homeDayBadge(pick) {
    var d = pick.day;
    var stamp = monthDay(d.date, d.dayLabel);
    if (pick.mode === 'today') { return '오늘 ' + stamp + ' 식단'; }
    if (pick.mode === 'upcoming') { return '다가오는 ' + stamp + ' 식단'; }
    return '지난 ' + stamp + ' 식단';
  }

  /* 그날 한 끼를 콤팩트한 한 줄로: 메뉴 + 시간 + ⭕먹음/❌미룸/↪️미룸들어옴/⏭️패스 + 인성이 별도 */
  function homeMealRow(kind, label, meal, sv, w) {
    var st = (sv && sv.state) ? sv.state : null;
    var inc = (sv && sv.incoming) ? sv.incoming : null;
    var shown = inc ? inc.meal : meal;
    var cls = 'ht-row ht-' + kind;
    var tags = '';
    if (st === 'eaten') { tags += '<span class="ht-badge eat">⭕ 먹음</span>'; }
    if (st === 'passed') {
      tags += '<span class="ht-badge pass">❌ 미룸' +
        (sv && sv.movedTo ? ' → ' + esc(destText(w, sv.movedTo)) : '') + '</span>';
    }
    if (inc) { tags += '<span class="ht-badge moved">↪️ ' + esc(slotStamp(w, inc.from, kind)) + '에서</span>'; }

    if (!shown) {
      return '<li class="' + cls + ' is-none">' +
        '<span class="ht-label">' + esc(label) + '</span>' +
        '<span class="ht-main">' +
          '<span class="ht-title muted">아직 정한 메뉴가 없어요</span>' +
          (tags ? '<span class="ht-tags">' + tags + '</span>' : '') +
        '</span>' +
      '</li>';
    }

    var skip = !!shown.skipped;
    if (skip) { cls += ' is-skip'; }
    var emoji = shown.emoji ? '<span class="ht-emoji" aria-hidden="true">' + esc(shown.emoji) + '</span>' : '';
    var time = (!skip && shown.time && shown.time !== '-') ? '<span class="ht-mini">⏱ ' + esc(shown.time) + '</span>' : '';
    var kid = (shown.kidMenu && shown.kidMenu.title)
      ? '<span class="ht-kid">' + esc(shown.kidMenu.title) + '</span>' : '';
    var pairLines = '';
    if (!skip && shown.side && shown.side.title) {
      pairLines += '<span class="ht-pair"><span class="htp-k">🥬 반찬</span>' + esc(shown.side.title) + '</span>';
    }
    if (!skip && shown.soup && shown.soup.title) {
      pairLines += '<span class="ht-pair"><span class="htp-k">🥣 국</span>' + esc(shown.soup.title) + '</span>';
    }
    return '<li class="' + cls + '">' +
      '<span class="ht-label">' + esc(label) + '</span>' +
      '<span class="ht-main">' +
        '<span class="ht-line">' + emoji + '<span class="ht-title">' + esc(shown.title || '') + '</span></span>' +
        pairLines +
        ((time || tags) ? '<span class="ht-tags">' + time + tags + '</span>' : '') +
        kid +
      '</span>' +
    '</li>';
  }

  function homeTodaySection() {
    var w = weekPlan();
    if (!w) { return ''; }
    var pick = homeWeekDay(w);
    if (!pick || !pick.day) { return ''; }
    var day = pick.day;
    var view = computeWeekView(w).view;
    var v = (view && view[day.date]) || {};
    var rows = homeMealRow('breakfast', '🌅 인성이 아침', day.breakfast, v.breakfast, w) +
      homeMealRow('lunch', day.weekend ? '🍱 주말 점심' : '🥗 엄마 점심', day.lunch, v.lunch, w) +
      homeMealRow('dinner', '🌙 세 가족 저녁', day.dinner, v.dinner, w);
    var note = '';
    if (pick.mode === 'upcoming') {
      note = '<p class="ht-note">이번 주 식단이 아직 시작 전이라 가장 가까운 날로 보여드려요</p>';
    } else if (pick.mode === 'past') {
      note = '<p class="ht-note">이번 주 식단이 끝나서 마지막 날 식단으로 보여드려요</p>';
    }
    return '' +
      '<section class="section home-today" id="homeToday">' +
        '<div class="sec-head">' +
          '<h2 class="sec-title">🍳 오늘 뭐 먹지?</h2>' +
          '<span class="ht-day">' + esc(homeDayBadge(pick)) + '</span>' +
        '</div>' +
        '<div class="ht-card">' +
          '<ul class="ht-list">' + rows + '</ul>' +
          note +
          '<button type="button" class="ht-go" data-goto="week">📅 주간 식단에서 O/X 체크하기 →</button>' +
        '</div>' +
      '</section>';
  }

  function weekSection() {
    var w = weekPlan();
    if (!w) {
      return '<section class="section"><div class="empty"><span class="big">📅</span>' +
        '아직 주간 식단표가 없어요</div></section>';
    }
    var s = weekStats(w);
    var model = computeWeekView(w);
    var head = '' +
      '<div class="week-hero">' +
        '<p class="week-kicker">🍽 7일 냉장고 파먹기</p>' +
        '<h2 class="week-title">' + esc(w.title || '이번 주 식단') + '</h2>' +
        '<p class="week-range">' + esc(weekRange(w)) + '</p>' +
        (w.note ? '<p class="week-note">' + esc(w.note) + '</p>' : '') +
        '<div class="week-stats">' +
          '<span class="wstat">📅 ' + s.days + '일</span>' +
          '<span class="wstat">🍽 하루 세 끼</span>' +
          (s.prioTotal ? '<span class="wstat">🔥 우선 소진 <b>' + s.prioUsed + '/' + s.prioTotal + '</b>종</span>' : '') +
          '<span class="wstat">🧺 재료 ' + s.items + '가지</span>' +
        '</div>' +
      '</div>';

    var jump = '<div class="day-jump" id="dayJump">' +
      '<button type="button" class="dchip active" data-day="top">전체</button>' +
      w.days.map(function (d) {
        var n = daysUntil(d.date);
        return '<button type="button" class="dchip' + (n === 0 ? ' is-today' : '') +
          (n !== null && n < 0 ? ' is-past' : '') + '" data-day="' + esc(d.date) + '">' +
          (d.dayLabel || '') + ' <span class="dn">' + esc(monthDay(d.date)) + '</span></button>';
      }).join('') +
      '</div>';

    var leftover = '';
    if (Array.isArray(w.leftovers) && w.leftovers.length) {
      leftover = '<div class="wleft">' +
        '<p class="wleft-title">🧺 이번 주에 다 못 쓴 재료 · 다음 주 후보</p>' +
        '<ul class="wleft-list">' + w.leftovers.map(function (x) {
          return '<li><b>' + esc(x.name) + '</b> · ' + esc(x.memo || '') + '</li>';
        }).join('') + '</ul>' +
        '</div>';
    }

    return '<section class="section week-page">' + head + jump + oxBar(w, model.counts) +
      w.days.map(function (d) { return weekDayCard(d, w, model); }).join('') +
      nextWeekCard(w, model.nextWeek) + leftover + '</section>';
  }
  function courseSection(course, list, stock, lunch) {
    if (list.length === 0) { return ''; }
    var meta = COURSE_META[course];
    var body = '';
    if (course === 'dinner') {
      var mild = list.filter(function (m) { return !m.kidMenu; });
      var spicy = list.filter(function (m) { return !!m.kidMenu; });
      if (mild.length) {
        body += '<p class="sub-group">👨‍👩‍👦 3가족 함께 먹는 날</p>' +
          mild.map(function (m) { return mealCard(m, stock, lunch); }).join('');
      }
      if (spicy.length) {
        body += '<p class="sub-group spicy">🌶️ 어른 매운메뉴 + 👶 인성이 별도</p>' +
          spicy.map(function (m) { return mealCard(m, stock, lunch); }).join('');
      }
    } else {
      body = list.map(function (m) { return mealCard(m, stock, lunch); }).join('');
    }
    return '' +
      '<div class="meal-group">' +
        '<div class="sec-head">' +
          '<h2 class="sec-title">' + meta.title + '</h2>' +
          '<span class="sec-count">' + list.length + '개</span>' +
        '</div>' +
        '<p class="sec-sub course-sub">' + meta.sub + '</p>' +
        body +
      '</div>';
  }

  function mealsSection(limit) {
    var lunch = targetLunch();
    var stock = inStock();
    var isAll = state.tab === 'all';
    var list = mealsFor();

    /* 홈: 주간 식단에 오늘(또는 가장 가까운 날) 식단이 있으면 그대로 연동해서 보여줘요.
       검색 중이 아니면 주간 식단 카드가 우선이고, 없을 때만 예전 추천으로 폴백해요. */
    if (isAll && !norm(state.q)) {
      var linked = homeTodaySection();
      if (linked) { return linked; }
    }

    if (list.length === 0) {
      if (isAll) { return ''; }
      return '<section class="section">' + lunchBanner(lunch) +
        '<div class="empty"><span class="big">🍳</span>' +
        '지금은 추천할 식단이 없어요<br>재료가 들어오면 바로 채워드릴게요</div></section>';
    }

    var breakfasts = list.filter(function (m) { return courseOf(m) === 'breakfast'; });
    var lunches = list.filter(function (m) { return courseOf(m) === 'lunch'; });
    var dinners = list.filter(function (m) { return courseOf(m) === 'dinner'; });
    var salads = list.filter(function (m) { return courseOf(m) === 'salad'; });
    var clean = function (m) { return !clashOf(m, lunch) && !kidClashOf(m, lunch); };

    if (isAll) {
      /* 홈 폴백(주간 식단이 없거나 검색 중): 인성이 아침 1개 + 세 가족 저녁 1~2개 (점심과 안 겹치는 것 우선) */
      var bf = breakfasts.filter(clean)[0] || breakfasts[0];
      var din = dinners.filter(clean).slice(0, 2);
      if (din.length === 0) { din = dinners.slice(0, 2); }
      var blocks = '';
      if (bf) {
        blocks += '<p class="pick-label">🌅 인성이 아침</p>' + mealCard(bf, stock, lunch);
      }
      if (din.length) {
        blocks += '<p class="pick-label">🌙 세 가족 저녁</p>' +
          din.map(function (m) { return mealCard(m, stock, lunch); }).join('');
      }
      var count = (bf ? 1 : 0) + din.length;
      return '' +
        '<section class="section">' +
          '<div class="sec-head">' +
            '<h2 class="sec-title">🍳 오늘 뭐 먹지?</h2>' +
            '<span class="sec-count">' + count + '개</span>' +
            '<button type="button" class="sec-more" data-goto="meals">전체 보기 ›</button>' +
          '</div>' +
          homeLunchLine(lunch) +
          (priorityCount() ? '<p class="home-clear">🔥 냉장고 파먹기 1순위 · 냉동실에 있던 재료부터 써요</p>' : '') +
          blocks +
        '</section>';
    }

    return '' +
      '<section class="section">' +
        lunchBanner(lunch) +
        '<div class="sec-head">' +
          '<h2 class="sec-title">🍳 간단 식단</h2>' +
          '<span class="sec-count">' + list.length + '개</span>' +
        '</div>' +
        '<p class="sec-sub">아침은 인성이 전용, 점심은 엄마 혼자, 저녁은 세 가족 기준이에요 · 🔥 냉장고 파먹기 1순위 → 라이즈 점심과 안 겹치는 메뉴 순서예요</p>' +
        courseSection('breakfast', breakfasts, stock, lunch) +
        courseSection('lunch', lunches, stock, lunch) +
        courseSection('dinner', dinners, stock, lunch) +
        courseSection('salad', salads, stock, lunch) +
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
      el('heroSub').textContent = '냉장실 · 냉동실 · 실온 재료 한눈에';
      el('pills').innerHTML = '';
      return;
    }

    var cold = itemsOf('fridge').length;
    var frozen = itemsOf('freezer').length;
    var room = itemsOf('roomTemp').length;
    var soon = urgentCount();
    var coming = arrivingCount();
    var clearing = priorityCount();

    el('heroSub').textContent = '냉장실 · 냉동실 · 실온 재료를 한 번에 볼 수 있어요';
    el('pills').innerHTML = '' +
      '<span class="pill cold">❄️ 냉장 <b>' + cold + '</b></span>' +
      '<span class="pill frozen">🧊 냉동 <b>' + frozen + '</b></span>' +
      '<span class="pill room">🧺 실온 <b>' + room + '</b></span>' +
      (coming ? '<span class="pill coming">📦 도착 예정 <b>' + coming + '</b></span>' : '') +
      (clearing ? '<span class="pill clear">🔥 우선 소진 <b>' + clearing + '</b></span>' : '') +
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
    var showSearch = state.tab !== 'shop' && state.tab !== 'week';
    var showChips = state.tab === 'all' || state.tab === 'fridge' ||
      state.tab === 'freezer' || state.tab === 'roomTemp';
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

    if (state.tab === 'week') {
      parts.push(weekSection());
    } else if (state.tab === 'meals') {
      parts.push(weekTeaser());
      parts.push(mealsSection(0));
    } else if (state.tab === 'shop') {
      parts.push(shoppingSection());
    } else if (state.tab === 'fridge') {
      parts.push(itemsSection('fridge', false));
    } else if (state.tab === 'freezer') {
      parts.push(itemsSection('freezer', false));
    } else if (state.tab === 'roomTemp') {
      parts.push(itemsSection('roomTemp', false));
    } else {
      var coldList = filtered('fridge');
      var frozenList = filtered('freezer');
      var roomList = filtered('roomTemp');
      var searching = !!norm(state.q) || state.cat !== '전체';
      var mealCount = mealsFor().length;

      if (searching && coldList.length === 0 && frozenList.length === 0 &&
          roomList.length === 0 && mealCount === 0) {
        c.innerHTML = emptyAll();
        return;
      }
      if (!searching) { parts.push(thawBanner()); parts.push(mealsSection(2)); }
      else if (mealCount > 0) { parts.push(mealsSection(2)); }
      if (!searching) { parts.push(weekTeaser()); }
      parts.push(itemsSection('fridge', true));
      parts.push(itemsSection('freezer', true));
      /* 🧺 실온은 냉장·냉동과 같은 재고 카드로, 🧂 조미료는 그 아래 읽기 전용으로 */
      parts.push(itemsSection('roomTemp', true));
      if (!searching) { parts.push(pantrySection()); }
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
      var oxBtn = e.target.closest('[data-ox]');
      if (oxBtn) {
        var oxRaw = oxBtn.getAttribute('data-ox') || '';
        var oxParts = oxRaw.split('|');
        var oxVal = oxBtn.getAttribute('data-val');
        var oxNow = weekOX(weekPlan())[oxRaw] || null;
        var card = oxBtn.closest('.day-card');
        var topBefore = card ? card.getBoundingClientRect().top : null;
        setOX(oxParts[0], oxParts[1], oxNow === oxVal ? null : oxVal);
        renderContent();
        /* 누른 날짜 카드가 화면에서 같은 자리에 있도록 스크롤을 맞춰요 */
        if (card && topBefore !== null) {
          var same = document.getElementById(card.id);
          if (same) {
            var delta = same.getBoundingClientRect().top - topBefore;
            if (Math.abs(delta) > 1) { window.scrollBy(0, delta); }
          }
        }
        return;
      }
      if (e.target.closest('#oxCopy')) { copyWeek(); return; }
      if (e.target.closest('#oxReset')) { resetWeek(); return; }
      /* 🧂 조미료 섹션은 읽기 전용 — 접기/펼치기만 반응해요 */
      if (e.target.closest('#pantryFold')) { togglePantryFold(); return; }
      var dayBtn = e.target.closest('[data-day]');
      if (dayBtn) {
        var jump = el('dayJump');
        if (jump) {
          Array.prototype.forEach.call(jump.querySelectorAll('[data-day]'), function (b) {
            b.classList.toggle('active', b === dayBtn);
          });
        }
        var target = dayBtn.getAttribute('data-day');
        var card = target === 'top' ? el('content') : document.getElementById('day-' + target);
        if (card && card.scrollIntoView) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        return;
      }
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
