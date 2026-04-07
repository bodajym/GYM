/* ═══════════════════════════════════════════════════════
   PULSO PRO — app.js
   ─────────────────────────────────────────────────────
   Modules:
     Config     → constants, avatars, workout rotation
     Storage    → localStorage read/write
     State      → single source of truth
     Utils      → helpers
     Profiles   → create, select, render, delete
     Dashboard  → weight, deadline, adherence, balance
     Workout    → suggest, save, exercise builder
     Nutrition  → targets, track, AI mock
     Photos     → compress, slot, save
     Charts     → line charts + comparison
     ProfileScreen → profile form, prediction, history
     BodyLog    → daily body metrics save
     UI         → toast, modal, nav, animations
     bindEvents → all addEventListener (no onclick)
     init       → bootstrap
═══════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════ */
const Config = {
  STORAGE_KEY: 'pulso_pro_v3',
  ACTIVE_KEY:  'pulso_pro_active_v3',
  ACTIVITY_MULTS: {
    sedentario: 1.2, ligero: 1.375, moderado: 1.55, activo: 1.725, muy_activo: 1.9,
  },
  CARDIO_KCAL:  { bajo: 5, medio: 7, alto: 10 },
  STEP_KCAL:    0.04,
  AVATARS: [
    { emoji: '💪', bg: '#1A2200', border: '#C8FF00' },
    { emoji: '🔥', bg: '#220500', border: '#FF4500' },
    { emoji: '⚡', bg: '#001522', border: '#00C8FF' },
    { emoji: '🏋️', bg: '#1F1500', border: '#FFB800' },
    { emoji: '🚀', bg: '#1A0022', border: '#A855F7' },
    { emoji: '🎯', bg: '#220010', border: '#FF2B55' },
    { emoji: '🏃', bg: '#001F1F', border: '#00FFD1' },
    { emoji: '🥇', bg: '#1F1200', border: '#FF9500' },
  ],
  WORKOUT_ROTATION: {
    'Pecho/Hombro/Tríceps': 'Espalda/Bíceps',
    'Espalda/Bíceps':       'Piernas/Glúteos',
    'Piernas/Glúteos':      'Pecho/Hombro/Tríceps',
    'Cuerpo completo':      'Cuerpo completo',
    'Cardio':               'Pecho/Hombro/Tríceps',
  },
  WORKOUT_META: {
    'Pecho/Hombro/Tríceps': { icon: '💪', short: 'PUSH',    sub: 'Pecho · Hombro · Tríceps' },
    'Espalda/Bíceps':       { icon: '🏋️', short: 'PULL',    sub: 'Espalda · Bíceps' },
    'Piernas/Glúteos':      { icon: '🦵', short: 'PIERNAS', sub: 'Cuádriceps · Isquios · Glúteos' },
    'Cuerpo completo':      { icon: '🔥', short: 'FULL',    sub: 'Cuerpo completo' },
    'Cardio':               { icon: '🏃', short: 'CARDIO',  sub: 'Cardio y resistencia' },
  },
};

/* ══════════════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════════════ */
const Storage = {
  load() {
    try { const r = localStorage.getItem(Config.STORAGE_KEY); return r ? JSON.parse(r) : { profiles: [] }; }
    catch { return { profiles: [] }; }
  },
  save(data) { try { localStorage.setItem(Config.STORAGE_KEY, JSON.stringify(data)); } catch(e) {} },
  getActiveId()   { return localStorage.getItem(Config.ACTIVE_KEY) || null; },
  setActiveId(id) { localStorage.setItem(Config.ACTIVE_KEY, id); },
};

/* ══════════════════════════════════════════════════════
   STATE  (single source of truth)
══════════════════════════════════════════════════════ */
const State = {
  db: { profiles: [] },
  activeId: null,
  profile: null,
  advancedOpen:   false,
  activityOpen:   false,
  cardioIntensity:'medio',
  currentWorkoutType: 'Pecho/Hombro/Tríceps',
  exercises: [],
  photoSlot: null,
  aiResult:  null,
  selectedAvatarIdx: 0,
  selectedActivity:  'moderado',
  charts: {},
};

/* ══════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════ */
const Utils = {
  today()    { return new Date().toISOString().split('T')[0]; },
  formatDate(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  },
  formatDateLong(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  },
  weeksLeft(dateStr) {
    if (!dateStr) return null;
    return (new Date(dateStr + 'T00:00:00') - new Date()) / 604800000;
  },
  uid() { return 'p' + Date.now() + Math.random().toString(36).slice(2, 6); },
  pct(val, max) { return max > 0 ? Math.min(100, Math.round((val / max) * 100)) : 0; },
  compressImage(file, maxW = 800, q = 0.82) {
    return new Promise(res => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const sc = Math.min(1, maxW / img.width);
          const cv = document.createElement('canvas');
          cv.width = img.width * sc; cv.height = img.height * sc;
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          res(cv.toDataURL('image/jpeg', q));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  },
  calcBMR(w, h, a, g) {
    return g === 'hombre' ? 10*w + 6.25*h - 5*a + 5 : 10*w + 6.25*h - 5*a - 161;
  },
};

/* ══════════════════════════════════════════════════════
   PROFILES
══════════════════════════════════════════════════════ */
const Profiles = {
  create(data) {
    const profile = {
      id: Utils.uid(), avIdx: data.avIdx, name: data.name, email: data.email,
      pf: { h: data.height, e: data.age, g: data.gender, act: data.activity,
            obj: data.targetWeight, fechaObj: data.targetDate, startW: data.currentWeight },
      logs: [], ents: [], fotos: {}, nutLog: {},
    };
    profile.logs.push({ fecha: Utils.today(), peso: data.currentWeight, grasa: null, mus: null });
    return profile;
  },
  add(profile) { State.db.profiles.push(profile); Storage.save(State.db); this.setActive(profile.id); },
  setActive(id) { State.activeId = id; State.profile = State.db.profiles.find(p => p.id === id) || null; Storage.setActiveId(id); },
  delete(id)    { State.db.profiles = State.db.profiles.filter(p => p.id !== id); Storage.save(State.db); },
  get(id)       { return State.db.profiles.find(p => p.id === id) || null; },

  renderSelector() {
    const grid = document.getElementById('profile-grid');
    grid.innerHTML = '';
    State.db.profiles.forEach(pr => {
      const av  = Config.AVATARS[pr.avIdx] || Config.AVATARS[0];
      const goal = pr.pf.obj ? `Meta: ${pr.pf.obj} kg` : 'Sin objetivo';
      const wl   = pr.pf.fechaObj ? Utils.weeksLeft(pr.pf.fechaObj) : null;
      const wStr = wl !== null ? ` · ${Math.max(0, Math.round(wl))} sem` : '';
      const card = document.createElement('div');
      card.className = 'profile-card' + (pr.id === State.activeId ? ' is-active' : '');
      card.setAttribute('role', 'listitem'); card.setAttribute('tabindex', '0');
      card.innerHTML = `
        <div class="profile-card__avatar" style="background:${av.bg};border:2px solid ${av.border}">
          ${av.emoji}${pr.id === State.activeId ? '<div class="profile-card__active-dot"></div>' : ''}
        </div>
        <div class="profile-card__name">${pr.name}</div>
        <div class="profile-card__goal">${goal}${wStr}</div>`;
      card.addEventListener('click',   () => { Profiles.setActive(pr.id); Storage.save(State.db); UI.showApp(); });
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') card.click(); });
      grid.appendChild(card);
    });
    const add = document.createElement('div');
    add.className = 'profile-card profile-card--add';
    add.setAttribute('role', 'listitem'); add.setAttribute('tabindex', '0');
    add.innerHTML = `<div class="profile-card__avatar"><span>+</span></div><div class="profile-card__name">NUEVO PERFIL</div>`;
    add.addEventListener('click',   () => UI.showOnboard());
    add.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') add.click(); });
    grid.appendChild(add);
  },

  renderAvatarPicker() {
    const picker = document.getElementById('avatar-picker');
    picker.innerHTML = '';
    State.selectedAvatarIdx = Math.floor(Math.random() * Config.AVATARS.length);
    Config.AVATARS.forEach((av, i) => {
      const opt = document.createElement('div');
      opt.className = 'avatar-option' + (i === State.selectedAvatarIdx ? ' is-selected' : '');
      opt.style.background  = av.bg;
      opt.style.borderColor = i === State.selectedAvatarIdx ? av.border : 'transparent';
      opt.textContent = av.emoji;
      opt.setAttribute('role', 'radio'); opt.setAttribute('tabindex', '0');
      opt.setAttribute('aria-checked', i === State.selectedAvatarIdx ? 'true' : 'false');
      opt.addEventListener('click', () => {
        State.selectedAvatarIdx = i;
        document.querySelectorAll('.avatar-option').forEach((el, j) => {
          const av2 = Config.AVATARS[j];
          el.classList.toggle('is-selected', j === i);
          el.style.borderColor = j === i ? av2.border : 'transparent';
          el.setAttribute('aria-checked', j === i ? 'true' : 'false');
        });
      });
      picker.appendChild(opt);
    });
  },
};

/* ══════════════════════════════════════════════════════
   NUTRITION
══════════════════════════════════════════════════════ */
const Nutrition = {
  calcTargets(weight) {
    const P = State.profile;
    if (!P || !weight || !P.pf.h || !P.pf.e) return null;
    const bmr    = Utils.calcBMR(weight, P.pf.h, P.pf.e, P.pf.g);
    const tdee   = Math.round(bmr * (Config.ACTIVITY_MULTS[P.pf.act] || 1.55));
    const inDef  = P.pf.obj && weight > P.pf.obj;
    let deficit  = 400;
    if (inDef && P.pf.fechaObj) {
      const wl = Utils.weeksLeft(P.pf.fechaObj);
      if (wl !== null) { if (wl < 6) deficit = 550; else if (wl < 10) deficit = 450; else if (wl > 20) deficit = 300; }
    }
    const calories = Math.round(inDef ? tdee - deficit : tdee + 150);
    const protein  = Math.round(weight * 2.2);
    const fats     = Math.max(40, Math.round((calories * 0.25) / 9));
    const carbs    = Math.max(50, Math.round((calories - protein * 4 - fats * 9) / 4));
    return { calories, protein, carbs, fats, tdee, deficit, inDef };
  },

  calcBurned(weight) {
    const P = State.profile;
    if (!P || !weight) return null;
    const targets = this.calcTargets(weight);
    if (!targets) return null;
    const t = Utils.today(); const nl = P.nutLog[t] || {};
    const stepCals   = Math.round((nl.steps || 0) * Config.STEP_KCAL);
    const cardioCals = Math.round((nl.cardioMins || 0) * (Config.CARDIO_KCAL[nl.cardioInt || 'medio'] || 7));
    return { tdee: targets.tdee, stepCals, cardioCals, total: targets.tdee + stepCals + cardioCals };
  },

  refresh() {
    const P = State.profile; if (!P) return;
    const ul = P.logs[P.logs.length - 1];
    const targets = ul ? this.calcTargets(ul.peso) : null;
    const t  = Utils.today(); const nl = P.nutLog[t] || { cal: 0, prot: 0 };
    if (targets) {
      const pct = (v, mx) => Utils.pct(v, mx) + '%';
      document.getElementById('track-cal').style.width  = pct(nl.cal  || 0, targets.calories);
      document.getElementById('track-prot').style.width = pct(nl.prot || 0, targets.protein);
      document.getElementById('value-cal').textContent  = `${nl.cal || 0} / ${targets.calories}`;
      document.getElementById('value-prot').textContent = `${nl.prot || 0} / ${targets.protein}g`;
      document.getElementById('value-carb').textContent = `-- / ${targets.carbs}g`;
      document.getElementById('value-fat').textContent  = `-- / ${targets.fats}g`;
      document.getElementById('ql-cal').value  = nl.cal  || '';
      document.getElementById('ql-prot').value = nl.prot || '';
      this._renderFeedback(nl, targets, ul.peso);
      this._refreshBurnCard(ul.peso);
      const actNames = { sedentario:'sedentario', ligero:'ligero', moderado:'moderado', activo:'activo', muy_activo:'muy activo' };
      const defMsg   = targets.inDef && P.pf.fechaObj && Utils.weeksLeft(P.pf.fechaObj) < 6
        ? `<br><strong style="color:var(--amber)">Plazo ajustado:</strong> déficit de ${targets.deficit} kcal por fecha próxima.` : '';
      document.getElementById('calc-explanation').innerHTML =
        `Nivel <strong>${actNames[P.pf.act]}</strong> · Peso <strong>${ul.peso} kg</strong><br><br>` +
        `TDEE: <strong style="color:var(--lime)">${targets.tdee} kcal/día</strong>. ` +
        (targets.inDef ? `Déficit ${targets.deficit} kcal → pérdida ~0,5 kg/sem.` : 'Superávit +150 kcal → ganancia muscular.') +
        defMsg + `<br><br><strong>Proteína ${targets.protein}g:</strong> 2,2 g/kg.<br>` +
        `<strong>Grasas ${targets.fats}g:</strong> 25% del total.`;
    } else {
      ['track-cal','track-prot','track-carb','track-fat'].forEach(id => { document.getElementById(id).style.width = '0%'; });
      ['value-cal','value-prot','value-carb','value-fat'].forEach(id => { document.getElementById(id).textContent = '-- / --'; });
      document.getElementById('nutrition-feedback-card').classList.add('hidden');
      document.getElementById('calc-explanation').textContent = 'Completa tu perfil para ver objetivos personalizados.';
    }
  },

  _renderFeedback(nl, targets, weight) {
    const card = document.getElementById('nutrition-feedback-card');
    const text = document.getElementById('nutrition-feedback');
    const burned = this.calcBurned(weight);
    const totalBurned = burned ? burned.total : targets.tdee;
    const protDiff = targets.protein - (nl.prot || 0);
    const calOver  = (nl.cal || 0) - targets.calories;
    let msg = '';
    if (protDiff > 40)             msg = `🥩 <strong>Te faltan ${protDiff}g de proteína</strong> — necesitas ${targets.protein}g/día. Añade pollo, claras o proteína de suero.`;
    else if (protDiff > 15)        msg = `💪 <strong>Cerca del objetivo proteico</strong> — te faltan solo ${protDiff}g. ¡Casi!`;
    else if (calOver > 300)        msg = `🍕 <strong>Has superado el objetivo en ${calOver} kcal.</strong> Considera reducir carbohidratos en tu próxima comida.`;
    else if (calOver > 0)          msg = `⚠️ <strong>Ligeramente por encima</strong> (+${calOver} kcal). Mantén cenas ligeras.`;
    else if (nl.cal > 0 && protDiff <= 15) {
      const balance = (nl.cal || 0) - totalBurned;
      msg = `✅ <strong>¡Vas perfecto hoy!</strong> Llevas ${nl.cal} kcal · Balance: ${balance < 0 ? balance : '+' + balance} kcal.`;
    }
    if (msg) { text.innerHTML = msg; card.classList.remove('hidden'); }
    else card.classList.add('hidden');
  },

  _refreshBurnCard(weight) {
    const burned = this.calcBurned(weight);
    const card   = document.getElementById('burn-card');
    if (!burned) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    document.getElementById('burn-tdee').textContent   = `${burned.tdee} kcal`;
    document.getElementById('burn-steps').textContent  = `${burned.stepCals} kcal`;
    document.getElementById('burn-cardio').textContent = `${burned.cardioCals} kcal`;
    document.getElementById('burn-total').textContent  = `${burned.total} kcal`;
    document.getElementById('burn-steps-track').style.width  = Utils.pct(burned.stepCals, 800) + '%';
    document.getElementById('burn-cardio-track').style.width = Utils.pct(burned.cardioCals, 400) + '%';
  },

  save() {
    const cal  = parseInt(document.getElementById('ql-cal').value)  || 0;
    const prot = parseInt(document.getElementById('ql-prot').value) || 0;
    if (!cal && !prot) { UI.toast('INGRESA AL MENOS UN DATO', 'warn'); return false; }
    const t = Utils.today(); State.profile.nutLog[t] = { ...(State.profile.nutLog[t] || {}), cal, prot };
    Storage.save(State.db); this.refresh(); Dashboard.updateBalance();
    UI.saveAnim(document.getElementById('btn-save-nutrition'));
    UI.toast('NUTRICIÓN GUARDADA 🥗'); return true;
  },

  addAiResult() {
    const ai = State.aiResult; if (!ai) return;
    const t  = Utils.today(); const prev = State.profile.nutLog[t] || { cal: 0, prot: 0 };
    State.profile.nutLog[t] = { ...prev, cal: (prev.cal||0)+(ai.calorias||0), prot: (prev.prot||0)+(ai.proteinas||0) };
    Storage.save(State.db); this.refresh(); Dashboard.updateBalance();
    UI.toast('AÑADIDO AL REGISTRO ✓');
    document.getElementById('ql-cal').value  = State.profile.nutLog[t].cal;
    document.getElementById('ql-prot').value = State.profile.nutLog[t].prot;
  },

  /* TODO: Replace mock with real backend API call:
     POST /api/analyze-food { image: base64 }
     Returns: { descripcion, calorias, proteinas, carbohidratos, grasas, confianza, nota } */
  async analyzeFood(_base64) {
    await new Promise(r => setTimeout(r, 1800));
    const foods = [
      { descripcion:'Pollo a la plancha con arroz',   calorias:520, proteinas:42, carbohidratos:55, grasas:10, confianza:'alta',  nota:'Buena fuente de proteína magra. Porción estándar estimada.' },
      { descripcion:'Ensalada mixta con atún',         calorias:280, proteinas:28, carbohidratos:12, grasas:14, confianza:'media', nota:'Estimación basada en porción típica.' },
      { descripcion:'Pasta con salsa de tomate',       calorias:440, proteinas:14, carbohidratos:82, grasas:8,  confianza:'media', nota:'Alto en carbohidratos. Ideal pre-entrenamiento.' },
      { descripcion:'Tortilla de huevos y verduras',   calorias:310, proteinas:22, carbohidratos:8,  grasas:21, confianza:'alta',  nota:'Excelente perfil de proteínas. Bajo en carbos.' },
      { descripcion:'Salmón al horno con brócoli',     calorias:390, proteinas:38, carbohidratos:10, grasas:22, confianza:'alta',  nota:'Rico en omega-3. Muy buena elección nutricional.' },
    ];
    return foods[Math.floor(Math.random() * foods.length)];
  },
};

/* ══════════════════════════════════════════════════════
   WORKOUT
══════════════════════════════════════════════════════ */
const Workout = {
  suggestNext() {
    const P = State.profile;
    if (!P || !P.ents.length) return 'Pecho/Hombro/Tríceps';
    return Config.WORKOUT_ROTATION[P.ents[P.ents.length - 1].tipo] || 'Pecho/Hombro/Tríceps';
  },
  renderWODCard() {
    const tipo = this.suggestNext(); State.currentWorkoutType = tipo;
    const meta = Config.WORKOUT_META[tipo] || Config.WORKOUT_META['Pecho/Hombro/Tríceps'];
    document.getElementById('wod-icon').textContent     = meta.icon;
    document.getElementById('wod-type').textContent     = meta.short;
    document.getElementById('wod-subtitle').textContent = meta.sub;
  },
  getLastWeight(name) {
    const P = State.profile; if (!P) return null;
    for (let i = P.ents.length - 1; i >= 0; i--) {
      const ex = P.ents[i].ejercs.find(e => e.nm.toLowerCase() === name.toLowerCase());
      if (ex) { const s = ex.sets.find(s => s.p); if (s) return parseFloat(s.p); }
    }
    return null;
  },
  initTab() {
    State.exercises = []; const tipo = this.suggestNext(); State.currentWorkoutType = tipo;
    document.querySelectorAll('.workout-type-btn').forEach(b => b.classList.toggle('is-selected', b.dataset.workout === tipo));
    const P = State.profile;
    if (P && P.ents.length) {
      const lastType = P.ents[P.ents.length - 1].tipo;
      const nextMeta = Config.WORKOUT_META[tipo] || {};
      document.getElementById('smart-suggestion-text').textContent = `Última: ${(Config.WORKOUT_META[lastType]||{}).short||lastType} → Hoy: ${nextMeta.short||tipo}`;
      document.getElementById('smart-suggestion').classList.remove('hidden');
    } else { document.getElementById('smart-suggestion').classList.add('hidden'); }
    this.renderExercises();
  },
  repeatLast() {
    const P = State.profile;
    if (!P || !P.ents.length) { UI.toast('SIN ENTRENAMIENTO PREVIO', 'warn'); return; }
    const last = P.ents[P.ents.length - 1];
    State.currentWorkoutType = last.tipo;
    document.querySelectorAll('.workout-type-btn').forEach(b => b.classList.toggle('is-selected', b.dataset.workout === last.tipo));
    State.exercises = last.ejercs.map(ex => {
      const lp = this.getLastWeight(ex.nm);
      return { nm: ex.nm, sets: ex.sets.map(s => ({ r: s.r, p: s.p, ok: false })), sp: lp ? +(lp + 2.5).toFixed(1) : null };
    });
    this.renderExercises(); UI.toast('ENTRENAMIENTO CARGADO 🔁');
  },
  addExercise(name = '', sets = [{ r: '', p: '', ok: false }]) {
    const lp = name ? this.getLastWeight(name) : null;
    State.exercises.push({ nm: name, sets: sets.map(s => ({ r: s.r||'', p: s.p||'', ok: false })), sp: lp ? +(lp+2.5).toFixed(1) : null });
    this.renderExercises();
  },
  renderExercises() {
    const list = document.getElementById('exercise-list'); list.innerHTML = '';
    State.exercises.forEach((ex, ei) => {
      const card = document.createElement('div'); card.className = 'exercise-card';
      const hintHTML = ex.sp ? `<span class="exercise-card__hint">💡 Última: ${(ex.sp-2.5).toFixed(1)}kg → Sugerido: ${ex.sp}kg</span>` : '';
      const setsHTML = ex.sets.map((s, si) => `
        <div class="set-grid" style="margin-bottom:5px">
          <span class="set-grid__number">${si+1}</span>
          <input class="set-input" type="number" inputmode="numeric"  placeholder="Reps" value="${s.r}" data-ei="${ei}" data-si="${si}" data-field="r">
          <input class="set-input" type="number" inputmode="decimal" placeholder="kg"   value="${s.p}" data-ei="${ei}" data-si="${si}" data-field="p">
          <div class="set-checkbox ${s.ok?'is-done':''}" data-ei="${ei}" data-si="${si}" role="checkbox" aria-checked="${s.ok}" tabindex="0">${s.ok?'✓':''}</div>
        </div>`).join('');
      card.innerHTML = `
        <div class="exercise-card__header">
          <input class="exercise-card__name-input" type="text" placeholder="Nombre del ejercicio" value="${ex.nm}" data-ei="${ei}">
          <button class="exercise-card__remove" data-remove-ex="${ei}" aria-label="Eliminar">✕</button>
        </div>${hintHTML}
        <div class="set-grid" style="margin-bottom:5px">
          <span></span><span class="set-grid__header">REPS</span><span class="set-grid__header">KG</span><span></span>
        </div>${setsHTML}
        <button class="add-set-btn" data-add-set="${ei}">+ AÑADIR SERIE</button>`;
      list.appendChild(card);
    });
  },
  save() {
    if (!State.exercises.length) { UI.toast('AÑADE AL MENOS UN EJERCICIO', 'warn'); return; }
    const P = State.profile; const t = Utils.today();
    const entry = { fecha: t, tipo: State.currentWorkoutType, ejercs: JSON.parse(JSON.stringify(State.exercises)) };
    const idx = P.ents.findIndex(e => e.fecha === t);
    if (idx >= 0) P.ents[idx] = entry; else P.ents.push(entry);
    Storage.save(State.db);
    UI.saveAnim(document.getElementById('btn-save-workout'));
    UI.toast('ENTRENAMIENTO GUARDADO 💪');
    this.renderWODCard(); Dashboard.updateAdherence();
  },
};

/* ══════════════════════════════════════════════════════
   PHOTOS
══════════════════════════════════════════════════════ */
const Photos = {
  prefillSlots() {
    const t = Utils.today(); const p = State.profile.fotos[t] || {};
    ['frontal','lateral','espalda'].forEach(slot => this.setSlot(slot, p[slot] || null));
  },
  setSlot(slot, dataUrl) {
    const map = { frontal:'photo-front', lateral:'photo-side', espalda:'photo-back' };
    const el  = document.getElementById(map[slot]); if (!el) return;
    const old = el.querySelector('img'); if (old) old.remove();
    if (dataUrl) { const img = document.createElement('img'); img.src = dataUrl; img.alt = `Foto ${slot}`; el.insertBefore(img, el.firstChild); }
  },
  pick(slot) { State.photoSlot = slot; document.getElementById('photo-file-input').click(); },
  async handleFile(file) {
    const slot = State.photoSlot; if (!slot || !file) return;
    const dataUrl = await Utils.compressImage(file);
    const t = Utils.today(); if (!State.profile.fotos[t]) State.profile.fotos[t] = {};
    State.profile.fotos[t][slot] = dataUrl; this.setSlot(slot, dataUrl);
  },
  remove(slot) {
    const t = Utils.today(); if (State.profile.fotos[t]) State.profile.fotos[t][slot] = null;
    this.setSlot(slot, null);
  },
  save() { Storage.save(State.db); UI.toast('FOTOS GUARDADAS 📸'); Charts.fillCompareDates(); },
};

/* ══════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════ */
const Dashboard = {
  update() {
    const P = State.profile; if (!P) return;
    const av = Config.AVATARS[P.avIdx] || Config.AVATARS[0];
    const chip = document.getElementById('nav-avatar');
    chip.textContent = av.emoji; chip.style.background = av.bg; chip.style.borderColor = av.border;
    document.getElementById('dash-username').textContent = P.name.toUpperCase();
    if (!P.logs.length) { this.updateDeadline(null); Workout.renderWODCard(); this.updateAdherence(); return; }
    const ul = P.logs[P.logs.length - 1];
    this._renderWeightHero(ul); this.updateDeadline(ul); this.updateNutritionCard(ul);
    this._renderSmartFeedback(ul); this._renderRecentLogs(); Workout.renderWODCard();
    this.updateAdherence(); this.updateBalance();
  },
  _renderWeightHero(ul) {
    const P = State.profile;
    document.getElementById('hero-weight').textContent = ul.peso || '--';
    document.getElementById('hero-fat').textContent    = ul.grasa ? `${ul.grasa}%`  : '--%';
    document.getElementById('hero-muscle').textContent = ul.mus   ? `${ul.mus} kg`  : '-- kg';
    const delta = document.getElementById('hero-delta');
    if (P.logs.length >= 2) {
      const prev = P.logs[P.logs.length - 2]; const diff = +(ul.peso - prev.peso).toFixed(2);
      const sign = diff > 0 ? '+' : '';
      const wantLoss = P.pf.obj && ul.peso > P.pf.obj;
      const isGood   = wantLoss ? diff < 0 : diff > 0;
      delta.textContent = `${sign}${diff} kg vs último`;
      delta.className   = 'delta-pill ' + (diff === 0 ? 'delta-pill--neutral' : isGood ? 'delta-pill--good' : 'delta-pill--bad');
    } else { delta.textContent = '✓ Primer registro'; delta.className = 'delta-pill delta-pill--neutral'; }
  },
  updateDeadline(ul) {
    const P = State.profile; const fd = P.pf.fechaObj; const tw = P.pf.obj;
    if (!fd || !tw || !ul) {
      this._setDeadlineStatus('none', 'SIN FECHA LÍMITE');
      document.getElementById('deadline-date').textContent = '--';
      document.getElementById('deadline-sub').textContent  = 'Configura en Perfil';
      ['stat-weeks','stat-required','stat-actual'].forEach(id => document.getElementById(id).textContent = '--');
      document.getElementById('goal-progress').style.width = '0%';
      document.getElementById('goal-percent').textContent  = '0% COMPLETADO';
      document.getElementById('goal-eta').textContent      = ''; return;
    }
    const wl = Utils.weeksLeft(fd); const rr = this._requiredRate(ul); const ar = this._actualRate();
    document.getElementById('deadline-date').textContent = Utils.formatDateLong(fd);
    document.getElementById('stat-weeks').textContent    = wl < 0 ? '¡Vencido!' : `${Math.max(0,Math.round(wl))} sem`;
    document.getElementById('stat-required').textContent = rr !== null ? `${rr.toFixed(2)} kg/sem` : '--';
    document.getElementById('stat-actual').textContent   = ar !== null ? `${ar.toFixed(2)} kg/sem` : '--';
    const sw  = P.logs[0]?.peso || ul.peso; const tot = Math.abs(sw - tw); const done = Math.abs(sw - ul.peso);
    const pct = tot > 0 ? Math.min(100, Math.max(0, (done/tot)*100)) : 0;
    document.getElementById('goal-progress').style.width = `${pct.toFixed(1)}%`;
    document.getElementById('goal-percent').textContent  = `${pct.toFixed(0)}% COMPLETADO`;
    const etaEl = document.getElementById('goal-eta');
    if (ar !== null && Math.abs(ar) > 0.01 && Math.sign(ar) !== Math.sign(ul.peso - tw)) {
      const wn = Math.abs((ul.peso - tw) / ar);
      const d  = new Date(); d.setDate(d.getDate() + Math.round(wn * 7));
      etaEl.textContent = 'A este ritmo: ' + Utils.formatDate(d.toISOString().split('T')[0]);
    } else etaEl.textContent = '';
    if (wl < 0) this._setDeadlineStatus('bad', '⏰ PLAZO VENCIDO');
    else if (ar === null) this._setDeadlineStatus('none', '🎯 OBJETIVO');
    else if (Math.abs(ar) >= Math.abs(rr)*1.2) this._setDeadlineStatus('ok', '🚀 ADELANTADO');
    else if (Math.abs(ar) >= Math.abs(rr)*0.8) this._setDeadlineStatus('ok', '✅ EN CAMINO');
    else if (Math.abs(ar) < Math.abs(rr)*0.5)  this._setDeadlineStatus('bad', '⚠️ RETRASADO');
    else this._setDeadlineStatus('warn', '🟡 PROGRESO LENTO');
  },
  _setDeadlineStatus(type, text) {
    const el = document.getElementById('deadline-status');
    el.className = `deadline-status deadline-status--${type}`; el.textContent = text;
  },
  _renderSmartFeedback(ul) {
    const area = document.getElementById('smart-feedback-area'); area.innerHTML = '';
    const P = State.profile;
    if (!P.pf.obj || !P.pf.fechaObj || P.logs.length < 3) return;
    const rr = this._requiredRate(ul); const ar = this._actualRate();
    if (rr === null || ar === null) return;
    const wl = Utils.weeksLeft(P.pf.fechaObj);
    let type, icon, title, sub;
    if (wl < 0) { type='bad'; icon='⏰'; title='Plazo vencido'; sub='Tu fecha límite ha pasado. Actualiza tu objetivo en Perfil.'; }
    else if (Math.abs(ar) >= Math.abs(rr)*1.2) { type='ok'; icon='🚀'; title='¡Estás adelantado!'; sub=`Ritmo actual ${ar.toFixed(2)} kg/sem supera lo requerido (${rr.toFixed(2)} kg/sem). ¡Mantén el ritmo!`; }
    else if (Math.abs(ar) >= Math.abs(rr)*0.8) { type='ok'; icon='✅'; title='¡Vas en camino!'; sub=`Ritmo actual ${ar.toFixed(2)} kg/sem. Necesitas ${rr.toFixed(2)} kg/sem para llegar a tiempo.`; }
    else if (Math.abs(ar) < Math.abs(rr)*0.5)  {
      type='bad'; icon='⚠️'; title='No llegarás a tiempo con este ritmo';
      const wn = Math.abs(ar) > 0.01 ? Math.abs((ul.peso - P.pf.obj)/ar) : 9999;
      const eta = new Date(); eta.setDate(eta.getDate() + Math.round(Math.min(wn,520)*7));
      sub = `Ritmo actual: ${ar.toFixed(2)} kg/sem. Necesitas ${rr.toFixed(2)} kg/sem. A este ritmo: ${wn < 500 ? Utils.formatDateLong(eta.toISOString().split('T')[0]) : 'indeterminado'}.`;
    } else { type='warn'; icon='📊'; title='Progreso un poco lento'; sub=`Ritmo actual ${ar.toFixed(2)} kg/sem. Necesitas ${rr.toFixed(2)} kg/sem. Considera ajustar dieta.`; }
    const div = document.createElement('div');
    div.className = `smart-feedback smart-feedback--${type}`;
    div.innerHTML = `<div class="smart-feedback__icon">${icon}</div><div><div class="smart-feedback__title">${title}</div><div class="smart-feedback__sub">${sub}</div></div>`;
    area.appendChild(div);
  },
  updateNutritionCard(ul) {
    if (!ul) return; const targets = Nutrition.calcTargets(ul.peso); if (!targets) return;
    document.getElementById('nut-calories').textContent = targets.calories;
    document.getElementById('nut-protein').textContent  = targets.protein;
    document.getElementById('nut-carbs').textContent    = targets.carbs;
    document.getElementById('nut-fats').textContent     = targets.fats;
    const P = State.profile;
    let mode = ul.peso > (P.pf.obj || 0) ? 'Déficit 🔻' : 'Volumen 🔺';
    const wl = P.pf.fechaObj ? Utils.weeksLeft(P.pf.fechaObj) : null;
    if (wl !== null && wl < 6 && ul.peso > (P.pf.obj || 0)) mode = 'Déficit agresivo ⚡';
    document.getElementById('nut-mode').textContent = mode;
  },
  updateBalance() {
    const P = State.profile; if (!P) return;
    const ul = P.logs[P.logs.length - 1]; const t = Utils.today(); const nl = P.nutLog[t] || {};
    const card = document.getElementById('balance-card');
    if (!ul || !nl.cal) { card.classList.add('hidden'); return; }
    const burned = Nutrition.calcBurned(ul.peso);
    if (!burned) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const balance = (nl.cal || 0) - burned.total;
    document.getElementById('balance-value').textContent   = `${balance < 0 ? '' : '+'}${balance}`;
    document.getElementById('balance-consumed').textContent= nl.cal || 0;
    document.getElementById('balance-burned').textContent  = burned.total;
    document.getElementById('balance-tdee').textContent    = burned.tdee;
    const chip = document.getElementById('balance-chip'); const big = document.getElementById('balance-value');
    if (balance <= -100) { chip.className='balance-chip balance-chip--deficit'; chip.textContent='DÉFICIT ✓'; big.style.color='var(--lime)'; }
    else if (balance > 100) { chip.className='balance-chip balance-chip--surplus'; chip.textContent='SUPERÁVIT'; big.style.color='var(--red)'; }
    else { chip.className='balance-chip balance-chip--zero'; chip.textContent='EQUILIBRADO'; big.style.color='var(--tx2)'; }
  },
  updateAdherence() {
    const P = State.profile; if (!P) return;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      days.push({ ds, done: P.logs.some(l => l.fecha===ds) || P.ents.some(e => e.fecha===ds), day: ['D','L','M','X','J','V','S'][d.getDay()] });
    }
    const count = days.filter(d => d.done).length;
    document.getElementById('adherence-count').textContent = count;
    const fill = document.getElementById('adherence-fill');
    fill.style.width      = `${(count/7)*100}%`;
    fill.style.background = count>=6 ? 'linear-gradient(90deg,var(--lime2),var(--lime))' : count>=4 ? 'linear-gradient(90deg,var(--blue),var(--lime))' : 'linear-gradient(90deg,var(--amber),var(--red))';
    const badge = document.getElementById('adherence-badge');
    if (count===7) { badge.className='adherence-badge adherence-badge--perfect'; badge.textContent='¡PERFECTO! 🏆'; }
    else if (count>=5) { badge.className='adherence-badge adherence-badge--good'; badge.textContent='MUY BIEN 🔥'; }
    else { badge.className='adherence-badge adherence-badge--poor'; badge.textContent=count>=3?'CONSTANCIA':'ESFUÉRZATE'; }
    const dotsEl = document.getElementById('adherence-dots'); dotsEl.innerHTML = '';
    const today  = Utils.today();
    days.forEach(d => {
      const dot = document.createElement('div'); dot.className = 'adherence-dot';
      dot.style.background = d.ds===today ? (d.done?'var(--lime)':'rgba(200,255,0,.2)') : (d.done?'rgba(200,255,0,.7)':'var(--c3)');
      dotsEl.appendChild(dot);
    });
  },
  _renderRecentLogs() {
    const P = State.profile; const card = document.getElementById('recent-logs-card');
    if (!P.logs.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    document.getElementById('recent-logs-list').innerHTML = P.logs.slice(-4).reverse().map(l =>
      `<div class="log-item"><span class="log-item__date">${Utils.formatDate(l.fecha)}</span><div class="log-item__values"><span class="log-item__val">${l.peso} kg</span>${l.grasa?`<span class="log-item__val log-item__val--muted">${l.grasa}%</span>`:''}</div></div>`
    ).join('');
  },
  _requiredRate(ul) {
    const P = State.profile;
    if (!P.pf.obj || !P.pf.fechaObj || !ul) return null;
    const wl = Utils.weeksLeft(P.pf.fechaObj); if (wl === null || wl <= 0) return null;
    return (ul.peso - P.pf.obj) / wl;
  },
  _actualRate() {
    const P = State.profile; if (!P || P.logs.length < 2) return null;
    const f = P.logs[0]; const l = P.logs[P.logs.length-1];
    const days = (new Date(l.fecha) - new Date(f.fecha)) / 86400000; if (!days) return null;
    return ((l.peso - f.peso) / days) * 7;
  },
};

/* ══════════════════════════════════════════════════════
   CHARTS
══════════════════════════════════════════════════════ */
const Charts = {
  OPTS: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor:'#18181D', titleColor:'#80808F', bodyColor:'#EFEFF5', borderColor:'rgba(255,255,255,.06)', borderWidth:1, padding:11, cornerRadius:8, displayColors:false } },
    scales: { x: { grid:{color:'rgba(255,255,255,.03)'}, ticks:{color:'#40404F',font:{family:'Nunito Sans',size:10},maxTicksLimit:7} }, y: { grid:{color:'rgba(255,255,255,.03)'}, ticks:{color:'#40404F',font:{family:'Nunito Sans',size:10}} } },
  },
  render() {
    const P = State.profile; if (!P || !P.logs.length) return;
    const labels = P.logs.map(l => Utils.formatDate(l.fecha)); const ul = P.logs[P.logs.length-1];
    const ptR = P.logs.length > 14 ? 0 : 4;
    document.getElementById('chart-weight-latest').textContent = ul.peso  ? `${ul.peso} kg`  : '--';
    document.getElementById('chart-fat-latest').textContent    = ul.grasa ? `${ul.grasa}%`   : '--';
    document.getElementById('chart-muscle-latest').textContent = ul.mus   ? `${ul.mus} kg`   : '--';
    this._build('chart-weight', 'weight', P.logs.map(l=>l.peso),  '#C8FF00', ptR, labels, P.pf.obj);
    this._build('chart-fat',    'fat',    P.logs.map(l=>l.grasa), '#00C8FF', ptR, labels, null);
    this._build('chart-muscle', 'muscle', P.logs.map(l=>l.mus),   '#FF2B55', ptR, labels, null);
  },
  _build(id, key, data, color, ptR, labels, goal) {
    if (State.charts[key]) State.charts[key].destroy();
    const ctx = document.getElementById(id).getContext('2d');
    const g   = ctx.createLinearGradient(0,0,0,140); g.addColorStop(0, color+'22'); g.addColorStop(1, color+'00');
    const datasets = [{ data, borderColor:color, backgroundColor:g, fill:true, tension:.4, pointBackgroundColor:color, pointRadius:ptR, pointHoverRadius:5, borderWidth:2 }];
    if (goal !== null && key === 'weight') datasets.push({ data:data.map(()=>goal), borderColor:'rgba(255,255,255,.12)', borderDash:[4,4], fill:false, pointRadius:0, borderWidth:1.5 });
    State.charts[key] = new Chart(ctx, { type:'line', data:{ labels, datasets }, options:this.OPTS });
  },
  fillCompareDates() {
    const P = State.profile; if (!P) return;
    const dates = Object.keys(P.fotos).filter(d=>{ const p=P.fotos[d]; return p&&(p.frontal||p.lateral||p.espalda); }).sort();
    ['compare-date-1','compare-date-2'].forEach((id,i)=>{
      const sel=document.getElementById(id); const cur=sel.value;
      sel.innerHTML=`<option value="">${i===0?'Fecha antes':'Fecha después'}</option>`;
      dates.forEach(d=>{ sel.innerHTML+=`<option value="${d}">${Utils.formatDate(d)}</option>`; });
      if (cur) sel.value=cur;
    });
  },
  renderComparison() {
    const d1=document.getElementById('compare-date-1').value; const d2=document.getElementById('compare-date-2').value;
    const out=document.getElementById('compare-output');
    if (!d1||!d2) { out.innerHTML='<span style="color:var(--tx3);font-size:12px">Selecciona dos fechas</span>'; return; }
    const P=State.profile; const p1=P.fotos[d1]||{}; const p2=P.fotos[d2]||{};
    const slots=['frontal','lateral','espalda'];
    if (!slots.some(s=>p1[s]||p2[s])) { out.innerHTML='<span style="color:var(--tx3);font-size:12px">Sin fotos para estas fechas</span>'; return; }
    out.innerHTML = '<div style="display:grid;gap:10px">' +
      slots.filter(s=>p1[s]||p2[s]).map(s=>`<div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">${s.toUpperCase()}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${this._cell(p1[s],Utils.formatDate(d1))}${this._cell(p2[s],Utils.formatDate(d2))}</div>
      </div>`).join('') + '</div>';
  },
  _cell(src, label) {
    const content = src
      ? `<img src="${src}" style="width:100%;border-radius:8px;aspect-ratio:3/4;object-fit:cover;display:block" alt="Progreso">`
      : `<div style="aspect-ratio:3/4;background:var(--c2);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--tx3);font-size:11px">Sin foto</div>`;
    return `<div style="position:relative">${content}<div style="position:absolute;bottom:5px;left:5px;background:rgba(0,0,0,.8);border-radius:4px;padding:2px 7px;font-size:9px;font-weight:800;color:#fff">${label}</div></div>`;
  },
};

/* ══════════════════════════════════════════════════════
   PROFILE SCREEN
══════════════════════════════════════════════════════ */
const ProfileScreen = {
  render() {
    const P = State.profile; if (!P) return;
    const av = Config.AVATARS[P.avIdx] || Config.AVATARS[0];
    const pfAv = document.getElementById('pf-avatar');
    pfAv.textContent = av.emoji; pfAv.style.background = av.bg; pfAv.style.border = `2px solid ${av.border}`;
    document.getElementById('pf-name').textContent  = P.name;
    document.getElementById('pf-email').textContent = P.email || '';
    document.getElementById('pf-height').value  = P.pf.h   || '';
    document.getElementById('pf-age').value     = P.pf.e   || '';
    document.getElementById('pf-gender').value  = P.pf.g   || 'hombre';
    document.getElementById('pf-goal').value    = P.pf.obj || '';
    document.getElementById('pf-deadline').value= P.pf.fechaObj || '';
    document.querySelectorAll('#profile-activity-pills .pill').forEach(p => p.classList.toggle('is-on', p.dataset.value === P.pf.act));
    const swAv = document.getElementById('switch-avatar');
    swAv.textContent = av.emoji; swAv.style.background = av.bg;
    document.getElementById('switch-name').textContent = P.name;
    this.updatePrediction(); this.renderHistory();
  },
  save() {
    const P = State.profile; if (!P) return;
    P.pf.h        = parseFloat(document.getElementById('pf-height').value)   || 175;
    P.pf.e        = parseInt(document.getElementById('pf-age').value)         || 28;
    P.pf.g        = document.getElementById('pf-gender').value;
    P.pf.obj      = parseFloat(document.getElementById('pf-goal').value)      || null;
    P.pf.fechaObj = document.getElementById('pf-deadline').value;
    Storage.save(State.db); this.updatePrediction(); Dashboard.update();
  },
  updatePrediction() {
    const P = State.profile; if (!P) return;
    const wl = P.pf.fechaObj ? Utils.weeksLeft(P.pf.fechaObj) : null;
    const ar = Dashboard._actualRate(); const ul = P.logs[P.logs.length - 1];
    const rr = ul ? Dashboard._requiredRate(ul) : null;
    document.getElementById('pred-weeks').textContent    = wl !== null ? `${Math.max(0,Math.round(wl))} semanas` : 'Sin fecha';
    document.getElementById('pred-required').textContent = rr !== null ? `${rr.toFixed(2)} kg/sem` : '-- kg/sem';
    document.getElementById('pred-actual').textContent   = ar !== null ? `${ar.toFixed(2)} kg/sem` : '-- kg/sem';
    let status = 'Más datos necesarios';
    if (wl !== null && wl < 0) status = '⏰ Plazo vencido';
    else if (ar !== null && rr !== null) {
      if (Math.abs(ar) >= Math.abs(rr)*1.2)  status = '🚀 ¡Adelantado!';
      else if (Math.abs(ar) >= Math.abs(rr)*0.8) status = '✅ En camino';
      else if (Math.abs(ar) < Math.abs(rr)*0.5)  status = '⚠️ No estás en camino';
      else status = '🟡 Progreso lento';
    }
    document.getElementById('pred-status').textContent = status;
  },
  renderHistory() {
    const P = State.profile; const hl = document.getElementById('history-list');
    if (!P || !P.logs.length) { hl.innerHTML = '<div style="text-align:center;padding:12px;color:var(--tx3);font-size:12px">Sin registros aún</div>'; return; }
    hl.innerHTML = P.logs.slice().reverse().slice(0,20).map(l =>
      `<div class="history-item"><span class="history-item__date">${Utils.formatDate(l.fecha)}</span><div class="history-item__values"><span class="history-item__val">${l.peso} kg</span>${l.grasa?`<span class="history-item__val" style="color:var(--tx2)">${l.grasa}%</span>`:''}</div></div>`
    ).join('');
  },
};

/* ══════════════════════════════════════════════════════
   BODY LOG
══════════════════════════════════════════════════════ */
const BodyLog = {
  prefill() {
    const P = State.profile; const t = Utils.today();
    const e = P.logs.find(l=>l.fecha===t) || P.logs[P.logs.length-1] || {};
    document.getElementById('b-weight').value   = e.peso  || '';
    document.getElementById('b-fat').value      = e.grasa || '';
    document.getElementById('b-muscle').value   = e.mus   || '';
    document.getElementById('b-water').value    = e.agua  || '';
    document.getElementById('b-visceral').value = e.visc  || '';
    document.getElementById('b-bmi').value      = e.imc   || '';
    document.getElementById('b-body-age').value = e.edc   || '';
    const nl = P.nutLog[t] || {};
    document.getElementById('b-steps').value  = nl.steps    || '';
    document.getElementById('b-cardio').value = nl.cardioMins|| '';
    State.cardioIntensity = nl.cardioInt || 'medio';
    document.querySelectorAll('.intensity-pill').forEach(p => p.classList.toggle('is-on', p.dataset.value === State.cardioIntensity));
  },
  save() {
    const weight = parseFloat(document.getElementById('b-weight').value);
    if (!weight) {
      UI.toast('EL PESO ES OBLIGATORIO', 'warn');
      document.getElementById('b-weight').classList.add('field-input--error');
      setTimeout(() => document.getElementById('b-weight').classList.remove('field-input--error'), 1000);
      return false;
    }
    const P = State.profile; const t = Utils.today();
    const entry = { fecha:t, peso:weight,
      grasa:   parseFloat(document.getElementById('b-fat').value)      || null,
      mus:     parseFloat(document.getElementById('b-muscle').value)    || null,
      agua:    parseFloat(document.getElementById('b-water').value)     || null,
      visc:    parseFloat(document.getElementById('b-visceral').value)  || null,
      imc:     parseFloat(document.getElementById('b-bmi').value)       || null,
      edc:     parseInt(document.getElementById('b-body-age').value)    || null,
    };
    const idx = P.logs.findIndex(l => l.fecha === t);
    if (idx >= 0) P.logs[idx] = entry; else P.logs.push(entry);
    P.logs.sort((a,b) => a.fecha < b.fecha ? -1 : 1);
    if (State.activityOpen) {
      const nl = P.nutLog[t] || {};
      P.nutLog[t] = { ...nl, steps: parseInt(document.getElementById('b-steps').value)||0, cardioMins: parseInt(document.getElementById('b-cardio').value)||0, cardioInt: State.cardioIntensity };
    }
    Storage.save(State.db);
    UI.saveAnim(document.getElementById('btn-save-body'));
    UI.toast('MÉTRICAS GUARDADAS ✓');
    Dashboard.update(); this._updateStreak(); return true;
  },
  _updateStreak() {
    let streak = 0; const d = new Date();
    while (true) {
      const ds = d.toISOString().split('T')[0];
      if (State.profile.logs.find(l=>l.fecha===ds)) { streak++; d.setDate(d.getDate()-1); } else break;
    }
    document.getElementById('streak-chip').textContent = `🔥 ${streak} DÍA${streak!==1?'S':''}`;
  },
};

/* ══════════════════════════════════════════════════════
   UI
══════════════════════════════════════════════════════ */
const UI = {
  _toastTimer: null,
  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const scr = document.getElementById(`screen-${name}`); if (scr) scr.classList.add('active');
    const isApp = ['inicio','progreso','nutricion','perfil'].includes(name);
    document.getElementById('bottom-nav').style.display = isApp ? 'flex' : 'none';
    document.getElementById('fab-log').style.display    = name === 'inicio' ? 'flex' : 'none';
    if (name === 'progreso') { setTimeout(() => Charts.render(), 50); Charts.fillCompareDates(); }
    if (name === 'nutricion') Nutrition.refresh();
    if (name === 'perfil')    ProfileScreen.render();
  },
  showProfiles() { Profiles.renderSelector(); this.showScreen('profiles'); },
  showOnboard()  {
    Profiles.renderAvatarPicker();
    ['ob-name','ob-email','ob-age','ob-height','ob-current-weight','ob-target-weight','ob-target-date'].forEach(id => document.getElementById(id).value='');
    State.selectedActivity = 'moderado';
    document.querySelectorAll('#onboard-activity-pills .pill').forEach(p => p.classList.toggle('is-on', p.dataset.value==='moderado'));
    this.showScreen('onboard');
  },
  showApp() {
    this.navTo('inicio', document.querySelector('.nav-item[data-screen="inicio"]'));
    const h = new Date().getHours();
    document.getElementById('greeting').textContent = h<12?'BUENOS DÍAS':h<20?'BUENAS TARDES':'BUENAS NOCHES';
    Dashboard.update(); BodyLog._updateStreak();
  },
  navTo(screen, el) {
    document.querySelectorAll('.nav-item').forEach(n => { n.classList.remove('active'); n.setAttribute('aria-current','false'); });
    if (el) { el.classList.add('active'); el.setAttribute('aria-current','page'); }
    this.showScreen(screen);
  },
  openModal(initialTab = 'body') {
    document.getElementById('modal-overlay').classList.add('is-open');
    document.getElementById('modal-date').textContent = new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
    State.advancedOpen=false; State.activityOpen=false;
    document.getElementById('switch-advanced').classList.remove('is-on');
    document.getElementById('advanced-body').classList.remove('is-open');
    document.getElementById('switch-activity').classList.remove('is-on');
    document.getElementById('activity-body').classList.remove('is-open');
    BodyLog.prefill(); Photos.prefillSlots(); Workout.initTab(); this.switchModalTab(initialTab);
  },
  closeModal() { document.getElementById('modal-overlay').classList.remove('is-open'); Dashboard.update(); },
  switchModalTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.toggle('is-active', b.dataset.tab===tab); b.setAttribute('aria-selected',b.dataset.tab===tab?'true':'false'); });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id===`tab-${tab}`));
  },
  toast(msg, type='ok') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast'+(type==='warn'?' toast--warn':type==='bad'?' toast--bad':'')+' is-visible';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2700);
  },
  saveAnim(el) {
    if (!el) return;
    el.classList.remove('is-save-pop'); void el.offsetWidth; el.classList.add('is-save-pop');
    setTimeout(() => el.classList.remove('is-save-pop'), 400);
  },
};

/* ══════════════════════════════════════════════════════
   EVENT BINDING  (zero onclick in HTML)
══════════════════════════════════════════════════════ */
function bindEvents() {
  /* ── Navigation ── */
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => UI.navTo(btn.dataset.screen, btn)));
  document.getElementById('fab-log').addEventListener('click',   () => UI.openModal('body'));
  document.getElementById('nav-avatar').addEventListener('click', () => UI.showProfiles());

  /* ── Modal ── */
  document.getElementById('btn-close-modal').addEventListener('click', () => UI.closeModal());
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === document.getElementById('modal-overlay')) UI.closeModal(); });
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => UI.switchModalTab(btn.dataset.tab)));

  /* ── Body tab ── */
  document.getElementById('toggle-advanced').addEventListener('click', () => {
    State.advancedOpen = !State.advancedOpen;
    document.getElementById('switch-advanced').classList.toggle('is-on', State.advancedOpen);
    document.getElementById('advanced-body').classList.toggle('is-open', State.advancedOpen);
    document.getElementById('toggle-advanced').setAttribute('aria-expanded', State.advancedOpen);
  });
  document.getElementById('toggle-activity').addEventListener('click', () => {
    State.activityOpen = !State.activityOpen;
    document.getElementById('switch-activity').classList.toggle('is-on', State.activityOpen);
    document.getElementById('activity-body').classList.toggle('is-open', State.activityOpen);
    document.getElementById('toggle-activity').setAttribute('aria-expanded', State.activityOpen);
  });
  document.getElementById('intensity-pills').addEventListener('click', e => {
    const pill = e.target.closest('.intensity-pill'); if (!pill) return;
    State.cardioIntensity = pill.dataset.value;
    document.querySelectorAll('.intensity-pill').forEach(p => p.classList.toggle('is-on', p===pill));
  });
  document.getElementById('btn-save-body').addEventListener('click', () => BodyLog.save());

  /* ── Workout tab ── */
  document.getElementById('workout-type-grid').addEventListener('click', e => {
    const btn = e.target.closest('.workout-type-btn'); if (!btn) return;
    State.currentWorkoutType = btn.dataset.workout;
    document.querySelectorAll('.workout-type-btn').forEach(b => b.classList.toggle('is-selected', b===btn));
  });
  document.getElementById('btn-repeat-workout').addEventListener('click', () => Workout.repeatLast());
  document.getElementById('btn-add-exercise').addEventListener('click',   () => Workout.addExercise());
  document.getElementById('btn-save-workout').addEventListener('click',   () => Workout.save());

  document.getElementById('exercise-list').addEventListener('click', e => {
    const rm  = e.target.closest('[data-remove-ex]');
    const chk = e.target.closest('.set-checkbox');
    const addS= e.target.closest('[data-add-set]');
    if (rm)   { State.exercises.splice(+rm.dataset.removeEx, 1); Workout.renderExercises(); }
    if (addS) { State.exercises[+addS.dataset.addSet].sets.push({r:'',p:'',ok:false}); Workout.renderExercises(); }
    if (chk)  {
      const ei=+chk.dataset.ei, si=+chk.dataset.si;
      State.exercises[ei].sets[si].ok = !State.exercises[ei].sets[si].ok;
      chk.classList.toggle('is-done', State.exercises[ei].sets[si].ok);
      chk.textContent = State.exercises[ei].sets[si].ok ? '✓' : '';
      chk.setAttribute('aria-checked', State.exercises[ei].sets[si].ok);
    }
  });
  document.getElementById('exercise-list').addEventListener('input', e => {
    const nameInput = e.target.closest('.exercise-card__name-input');
    const setInput  = e.target.closest('.set-input');
    if (nameInput) {
      const ei = +nameInput.dataset.ei; State.exercises[ei].nm = nameInput.value;
      const lp = Workout.getLastWeight(nameInput.value); const sp = lp ? +(lp+2.5).toFixed(1) : null;
      State.exercises[ei].sp = sp;
      const card = nameInput.closest('.exercise-card'); const oldHint = card.querySelector('.exercise-card__hint');
      if (sp) {
        const hint = document.createElement('span'); hint.className='exercise-card__hint';
        hint.textContent=`💡 Última: ${(sp-2.5).toFixed(1)}kg → Sugerido: ${sp}kg`;
        if (oldHint) oldHint.replaceWith(hint); else nameInput.closest('.exercise-card__header').after(hint);
      } else if (oldHint) oldHint.remove();
    }
    if (setInput) { const ei=+setInput.dataset.ei,si=+setInput.dataset.si,f=setInput.dataset.field; State.exercises[ei].sets[si][f]=setInput.value; }
  });

  /* ── Photos tab ── */
  document.querySelectorAll('.photo-slot').forEach(slot => slot.addEventListener('click', e => { if (e.target.closest('.photo-slot__action')) return; Photos.pick(slot.dataset.slot); }));
  document.querySelectorAll('[data-action="change-photo"]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); Photos.pick(btn.dataset.slot); }));
  document.querySelectorAll('[data-action="remove-photo"]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); Photos.remove(btn.dataset.slot); }));
  document.getElementById('photo-file-input').addEventListener('change', async e => { await Photos.handleFile(e.target.files[0]); e.target.value=''; });
  document.getElementById('btn-save-photos').addEventListener('click', () => Photos.save());

  /* ── Dashboard ── */
  document.getElementById('btn-start-workout').addEventListener('click', () => UI.openModal('workout'));

  /* ── Nutrition screen ── */
  document.getElementById('btn-save-nutrition').addEventListener('click', () => Nutrition.save());
  document.getElementById('ai-upload-zone').addEventListener('click',   () => document.getElementById('food-file-input').click());
  document.getElementById('ai-upload-zone').addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') document.getElementById('food-file-input').click(); });
  document.getElementById('food-file-input').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return; e.target.value='';
    document.getElementById('ai-result').classList.remove('is-visible');
    document.getElementById('ai-loading').classList.add('is-visible');
    document.getElementById('ai-loading').setAttribute('aria-busy','true');
    try {
      const url    = await Utils.compressImage(file, 900, 0.88);
      document.getElementById('ai-preview').src = url;
      const result = await Nutrition.analyzeFood(url.split(',')[1]);
      State.aiResult = result;
      document.getElementById('ai-food-name').textContent = result.descripcion||'Comida detectada';
      document.getElementById('ai-kcal').textContent      = result.calorias||'--';
      document.getElementById('ai-prot').textContent      = result.proteinas||'--';
      document.getElementById('ai-carb').textContent      = result.carbohidratos||'--';
      document.getElementById('ai-fat').textContent       = result.grasas||'--';
      document.getElementById('ai-note').textContent      = result.nota||'';
      const confEl=document.getElementById('ai-confidence');
      const cMap={alta:'ai-result__confidence--high',media:'ai-result__confidence--medium',baja:'ai-result__confidence--low'};
      const cTxt={alta:'🟢 ALTA',media:'🟡 MEDIA',baja:'🔴 BAJA'};
      confEl.className=`ai-result__confidence ${cMap[result.confianza]||cMap.media}`;
      confEl.textContent=`CONFIANZA ${cTxt[result.confianza]||cTxt.media}`;
      document.getElementById('ai-loading').classList.remove('is-visible');
      document.getElementById('ai-result').classList.add('is-visible');
    } catch { document.getElementById('ai-loading').classList.remove('is-visible'); UI.toast('ERROR AL ANALIZAR — intenta de nuevo','bad'); }
    document.getElementById('ai-loading').setAttribute('aria-busy','false');
  });
  document.getElementById('btn-add-ai-log').addEventListener('click', () => Nutrition.addAiResult());
  document.getElementById('compare-date-1').addEventListener('change', () => Charts.renderComparison());
  document.getElementById('compare-date-2').addEventListener('change', () => Charts.renderComparison());

  /* ── Profile screen ── */
  ['pf-height','pf-age','pf-goal','pf-deadline'].forEach(id => document.getElementById(id).addEventListener('input',  () => ProfileScreen.save()));
  document.getElementById('pf-gender').addEventListener('change', () => ProfileScreen.save());
  document.getElementById('profile-activity-pills').addEventListener('click', e => {
    const pill = e.target.closest('.pill'); if (!pill) return;
    document.querySelectorAll('#profile-activity-pills .pill').forEach(p => p.classList.remove('is-on'));
    pill.classList.add('is-on');
    if (State.profile) State.profile.pf.act = pill.dataset.value;
    ProfileScreen.save();
  });
  document.getElementById('btn-switch-profile').addEventListener('click', () => UI.showProfiles());
  document.getElementById('btn-delete-profile').addEventListener('click', () => {
    if (State.db.profiles.length <= 1) { UI.toast('NO PUEDES ELIMINAR EL ÚNICO PERFIL','warn'); return; }
    if (!confirm(`¿Eliminar el perfil de ${State.profile.name}? Esta acción no se puede deshacer.`)) return;
    Profiles.delete(State.activeId); Profiles.setActive(State.db.profiles[0]?.id||null);
    Storage.save(State.db); UI.showProfiles();
  });

  /* ── Onboarding ── */
  document.getElementById('onboard-activity-pills').addEventListener('click', e => {
    const pill = e.target.closest('.pill'); if (!pill) return;
    State.selectedActivity = pill.dataset.value;
    document.querySelectorAll('#onboard-activity-pills .pill').forEach(p => p.classList.toggle('is-on', p===pill));
  });
  document.getElementById('btn-create-profile').addEventListener('click', () => {
    const name   = document.getElementById('ob-name').value.trim();
    const weight = parseFloat(document.getElementById('ob-current-weight').value);
    if (!name)   { UI.toast('INGRESA TU NOMBRE','warn'); return; }
    if (!weight) { UI.toast('INGRESA TU PESO ACTUAL','warn'); return; }
    const profile = Profiles.create({
      avIdx: State.selectedAvatarIdx, name, email: document.getElementById('ob-email').value.trim(),
      age: parseInt(document.getElementById('ob-age').value)||28, height: parseFloat(document.getElementById('ob-height').value)||175,
      gender: document.getElementById('ob-gender').value, activity: State.selectedActivity,
      currentWeight: weight, targetWeight: parseFloat(document.getElementById('ob-target-weight').value)||null,
      targetDate: document.getElementById('ob-target-date').value||'',
    });
    Profiles.add(profile); UI.showApp();
  });
}

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
function init() {
  State.db       = Storage.load();
  State.activeId = Storage.getActiveId();
  bindEvents();
  if (!State.db.profiles.length) { UI.showOnboard(); return; }
  const found = Profiles.get(State.activeId);
  Profiles.setActive(found ? found.id : State.db.profiles[0].id);
  UI.showApp();
}

init();
