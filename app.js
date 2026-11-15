/* 인성이네 냉장고 — read-only mobile dashboard */
(function () {
  'use strict';

  var TZ = 'Asia/Seoul';
  var CATEGORIES = ['전체', '밀키트', '생선·고기', '유제품·빵', '채소·과일', '반찬·소스', '아이 맞춤'];
  var TABS = [
    { id: 'all', emoji: '🏠', label: '전체 보기' },
    { id: 'fridge', emoji: '❄️', label: '냉장실' },
    { id: 'freezer', emoji: '🧊', label: '냉동실' },
    { id: 'meals', emoji: '🍳', label: '간단 식단' },
    { id: 'shop', emoji: '🛒', label: '장보기' }
  ];

  var COURSE_META = {
    breakfast: { title: '🌅 아침 식단 (인성이 전용)', sub: '인성이 아침으로 먹기 좋은 메뉴만 모았어요' },
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

  function arrivingCount() {
    return allItems().filter(function (x) {
      var n = daysUntil(x.item.arriving);
      return n !== null && n >= 0;
    }).length;
  }

  /* 재료 이름과 식단의 uses 표기를 느슨하게 맞춥니다.
     (예: "우유 식빵" ↔ "클래식 우유 식빵 420g") */
  function inStock() {
    var list = allItems().map(function (x) {
      return { key: norm(x.item.name), arriving: x.item.arriving || null };
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
    return { menu: hit, text: lunch.shortDate + ' 점심 ‘' + hit + '’과 겹침' };
  }

  function kidClashOf(meal, lunch) {
    if (!meal || !meal.kidMenu) { return null; }
    var hit = findClash(mealTags(meal.kidMenu), lunch);
    if (!hit) { return null; }
    return { menu: hit, text: '인성이 별도 메뉴 ‘' + hit + '’도 ' + lunch.shortDate + ' 점심과 겹침' };
  }

  /* ---------------- partial renders ---------------- */

  function itemCard(item, storage) {
    var qty = item.qty ? '<span class="qty">' + esc(item.qty) + '</span>' : '';
    var cat = item.category ? '<span class="tag">' + esc(item.category) + '</span>' : '';
    var memo = item.memo ? '<p class="card-memo">' + esc(item.memo) + '</p>' : '';
    return '' +
      '<article class="item-card ' + (storage === 'freezer' ? 'is-frozen' : 'is-cold') +
        (arrivingPill(item) ? ' is-arriving' : '') + '">' +
        '<div class="card-top">' +
          '<span class="card-emoji" aria-hidden="true">' + esc(item.emoji || '🍽') + '</span>' +
          storageBadge(item, storage) +
        '</div>' +
        arrivingPill(item) +
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

  function courseOf(meal) {
    if (meal.course === 'salad') { return 'salad'; }
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
    var whenCls = course === 'dinner' ? 'evening' : (course === 'salad' ? 'salad' : 'morning');
    var whenTxt = course === 'salad' ? '🥗 샐러드' : (course === 'dinner' ? '🌙 저녁' : '🌅 아침');
    var who = meal.who ? '<span class="meal-who">' + esc(meal.who) + '</span>' : '';
    var steps = (Array.isArray(meal.steps) ? meal.steps : []).map(function (s, idx) {
      return '<li><span class="n">' + (idx + 1) + '</span><span>' + esc(s) + '</span></li>';
    }).join('');
    var ings = ingChips(meal.uses, stock);
    var adult = clashOf(meal, lunch);
    var kid = kidClashOf(meal, lunch);
    var marks = '';
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
      '<article class="meal meal-' + course + (adult || kid ? ' is-clash' : '') + '">' +
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
    list.sort(function (a, b) {
      var ca = (clashOf(a, lunch) ? 1 : 0) + (kidClashOf(a, lunch) ? 1 : 0);
      var cb = (clashOf(b, lunch) ? 1 : 0) + (kidClashOf(b, lunch) ? 1 : 0);
      if (ca !== cb) { return ca - cb; }
      var sa = stockScore(a, stock);
      var sb = stockScore(b, stock);
      if (sb !== sa) { return sb - sa; }
      var order = { breakfast: 0, dinner: 1, salad: 2 };
      return order[courseOf(a)] - order[courseOf(b)];
    });
    return list;
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
      return '<div class="menu-row' + (isTarget ? ' is-target' : '') + '">' +
        '<span class="menu-date">' + esc(monthDay(e.date, e.dayLabel)) + '</span>' +
        '<span class="menu-items">' + esc((e.items || []).join(' · ')) + '</span>' +
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

  function courseSection(course, list, stock, lunch) {
    if (list.length === 0) { return ''; }
    var meta = COURSE_META[course];
    return '' +
      '<div class="meal-group">' +
        '<div class="sec-head">' +
          '<h2 class="sec-title">' + meta.title + '</h2>' +
          '<span class="sec-count">' + list.length + '개</span>' +
        '</div>' +
        '<p class="sec-sub course-sub">' + meta.sub + '</p>' +
        list.map(function (m) { return mealCard(m, stock, lunch); }).join('') +
      '</div>';
  }

  function mealsSection(limit) {
    var lunch = targetLunch();
    var stock = inStock();
    var isAll = state.tab === 'all';
    var list = mealsFor();
    if (list.length === 0) {
      if (isAll) { return ''; }
      return '<section class="section">' + lunchBanner(lunch) +
        '<div class="empty"><span class="big">🍳</span>' +
        '지금은 추천할 식단이 없어요<br>재료가 들어오면 바로 채워드릴게요</div></section>';
    }

    var breakfasts = list.filter(function (m) { return courseOf(m) === 'breakfast'; });
    var dinners = list.filter(function (m) { return courseOf(m) === 'dinner'; });
    var salads = list.filter(function (m) { return courseOf(m) === 'salad'; });
    var clean = function (m) { return !clashOf(m, lunch) && !kidClashOf(m, lunch); };

    if (isAll) {
      /* 홈: 인성이 아침 1개 + 세 가족 저녁 1~2개 (점심과 안 겹치는 것 우선) */
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
        '<p class="sec-sub">아침은 인성이 전용, 저녁은 세 가족 기준이에요 · 라이즈 점심과 겹치지 않는 메뉴부터 보여드려요</p>' +
        courseSection('breakfast', breakfasts, stock, lunch) +
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
      el('heroSub').textContent = '냉장실 · 냉동실 재료 한눈에';
      el('pills').innerHTML = '';
      return;
    }

    var cold = itemsOf('fridge').length;
    var frozen = itemsOf('freezer').length;
    var soon = urgentCount();
    var coming = arrivingCount();

    el('heroSub').textContent = '냉장실 재료와 냉동실 재료를 한 번에 볼 수 있어요';
    el('pills').innerHTML = '' +
      '<span class="pill cold">❄️ 냉장 <b>' + cold + '</b></span>' +
      '<span class="pill frozen">🧊 냉동 <b>' + frozen + '</b></span>' +
      (coming ? '<span class="pill coming">📦 도착 예정 <b>' + coming + '</b></span>' : '') +
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
