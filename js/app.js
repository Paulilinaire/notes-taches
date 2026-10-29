import { state, save, uid, replaceState, isValidBackup } from './store.js';
import * as D from './dates.js';
import * as V from './vault.js';
import { parseIcs } from './ics.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (id, size = 20) => `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const THEMES = {
    bonbon: { label: 'Bonbon', color: '#7c5cff', swatch: 'conic-gradient(#ff5c8a,#7c5cff,#17c98b,#ffb800,#ff5c8a)' },
    sunset: { label: 'Coucher de soleil', color: '#ff7a00', swatch: 'conic-gradient(#ff4f6d,#ff7a00,#ffd23f,#8c52ff,#ff4f6d)' },
    lagon: { label: 'Lagon', color: '#00b4d8', swatch: 'conic-gradient(#00b4d8,#06d6a0,#3a86ff,#ff6b6b,#00b4d8)' },
};
const REMINDER_ICONS = ['i-bell', 'i-phone', 'i-pill', 'i-tooth', 'i-school', 'i-heart', 'i-home', 'i-gift', 'i-card', 'i-cart', 'i-sparkle', 'i-note', 'i-cal'];
const VAULT_ICONS = ['i-card', 'i-tax', 'i-heart', 'i-pill', 'i-home', 'i-lock', 'i-note'];
const COLORS = ['b', 'a', 'c', 'd'];
const REPEATS = { none: 'Jamais', weekly: 'Chaque semaine', monthly: 'Chaque mois', yearly: 'Chaque année' };
const CATEGORIES = { Administratif: 'b', Santé: 'a', Autre: 'd' };
const APP_VERSION = 4;
const AUTO_LOCK_MS = 120000;
const DEFAULT_CYCLE = 28;
const SCREENS = ['s-plan', 's-courses', 's-vault'];

const ui = {
    tab: 0,
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    selected: D.today(),
    lastToday: D.today(),
    revealed: new Set(),
    pin: '',
    pinFirst: '',
    pinMode: state.vault ? 'unlock' : 'create',
    busy: false,
    failures: 0,
    blockedUntil: 0,
    pending: null,
    lastActivity: Date.now(),
    bannersHtml: '',
};

function applyTheme() {
    const theme = THEMES[state.settings.theme] ? state.settings.theme : 'bonbon';
    document.documentElement.dataset.theme = theme;
    $('meta[name="theme-color"]').content = THEMES[theme].color;
}

let toastTimer;
function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function confetti() {
    const app = $('#app');
    const styles = getComputedStyle(document.documentElement);
    const colors = ['--a', '--b', '--c', '--d'].map(v => styles.getPropertyValue(v));
    for (let i = 0; i < 50; i++) {
        const c = document.createElement('i');
        c.className = 'confetti';
        c.style.left = '50%';
        c.style.top = '30%';
        c.style.background = colors[i % 4];
        c.style.setProperty('--x', `${Math.random() * 320 - 160}px`);
        c.style.setProperty('--y', `${Math.random() * 360 - 160}px`);
        app.appendChild(c);
        setTimeout(() => c.remove(), 1100);
    }
}

const sheet = $('#sheet');
const veil = $('#veil');

function openSheet(html, bind) {
    $('#sheet-body').innerHTML = html;
    if (!sheet.classList.contains('open')) {
        sheet.classList.add('open');
        veil.classList.add('open');
        history.pushState({ sheet: true }, '');
    }
    sheet.scrollTop = 0;
    bind?.($('#sheet-body'));
}

function hideSheet() {
    sheet.classList.remove('open');
    veil.classList.remove('open');
}

function closeSheet() {
    if (history.state?.sheet) {
        history.back();
    } else {
        hideSheet();
    }
}

function confirmSheet(title, text, okLabel, onOk) {
    openSheet(
        `<h3>${esc(title)}</h3><p>${esc(text)}</p>
        <div class="btns"><button class="btn-ghost" data-cancel>Annuler</button><button class="btn-danger" data-ok>${esc(okLabel)}</button></div>`,
        root => {
            $('[data-cancel]', root).onclick = closeSheet;
            $('[data-ok]', root).onclick = () => {
                closeSheet();
                onOk();
            };
        },
    );
}

function go(index) {
    ui.tab = index;
    SCREENS.forEach((id, k) => {
        const el = document.getElementById(id);
        el.classList.toggle('hide-left', k < index);
        el.classList.toggle('hide-right', k > index);
    });
    document.querySelectorAll('.tab').forEach((t, k) => t.classList.toggle('on', k === index));
    updateFab();
}

function updateFab() {
    $('#fab').hidden = ui.tab === 2 && (!V.isOpen() || ui.pinMode.startsWith('change'));
}

const occurrences = s => state.reminders.filter(r => D.occursOn(r, s)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const isDone = (r, s) => !!r.done?.[s];

function cycleInfo() {
    if (V.isOpen()) {
        const starts = [...(V.data.periods || [])].sort();
        const len = V.data.periodLen || 5;
        const gaps = starts.slice(1).map((s, i) => D.diffDays(starts[i], s)).filter(g => g >= 15 && g <= 60).slice(-6);
        const avg = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : DEFAULT_CYCLE;
        const next = starts.length ? D.addDays(starts.at(-1), avg) : null;
        return { starts: starts.slice(-24), len, avg, next, measured: gaps.length > 0 };
    }
    const hint = state.settings.cycleHint && state.cycleHint;
    return hint ? { starts: [], len: hint.len, avg: hint.avg, next: hint.next, measured: true } : null;
}

const predictedStarts = c => (c?.next ? [0, 1, 2, 3].map(k => D.addDays(c.next, k * c.avg)) : []);

function cycleKind(s, c, predictions) {
    if (!c) {
        return null;
    }
    for (const start of c.starts) {
        const k = D.diffDays(start, s);
        if (k >= 0 && k < c.len) {
            return { kind: 'real', day: k + 1 };
        }
    }
    for (const start of predictions) {
        const k = D.diffDays(start, s);
        if (k >= 0 && k < c.len) {
            return { kind: 'pred', day: k + 1 };
        }
    }
    return null;
}

function syncCycleHint() {
    if (!V.isOpen()) {
        return;
    }
    const c = cycleInfo();
    state.cycleHint = state.settings.cycleHint && c.next ? { next: c.next, avg: c.avg, len: c.len } : null;
    save();
}

function banners(t) {
    const out = [];
    const c = cycleInfo();
    if (c?.next && cycleKind(t, c, [])?.kind !== 'real') {
        const n = D.diffDays(t, c.next);
        if (n <= 5 && n >= -10) {
            out.push({
                col: 'a', col2: 'a2', icon: 'i-drop', date: c.next,
                title: n < 0 ? 'Règles en retard ?' : 'Règles bientôt',
                sub: `Prévues ${D.longDate(c.next)}`,
                count: n === 0 ? 'Auj.' : n > 0 ? `J-${n}` : `J+${-n}`,
            });
        }
    }
    const left = occurrences(t).filter(r => r.kind !== 'note' && !isDone(r, t));
    if (left.length) {
        out.push({
            col: 'b', col2: 'b2', icon: 'i-bell', date: t,
            title: left.length === 1 ? left[0].title : `${left.length} choses à faire`,
            sub: "Aujourd'hui",
            count: String(left.length),
        });
    } else {
        for (let k = 1; k <= 7; k++) {
            const d = D.addDays(t, k);
            const next = occurrences(d).find(r => r.kind !== 'note');
            if (next) {
                out.push({ col: next.color, col2: 'a2', icon: next.icon, date: d, title: next.title, sub: cap(D.longDate(d)), count: `J-${k}` });
                break;
            }
        }
    }
    if (!out.length) {
        out.push({ col: 'c', col2: 'c2', icon: 'i-sparkle', date: '', title: 'Rien de prévu', sub: 'Profite de ta journée', count: '✦' });
    }
    return out.slice(0, 2);
}

function renderBanners() {
    const html = banners(D.today()).map(b => `
        <div class="banner" style="--col:var(--${b.col});--col2:var(--${b.col2})" data-date="${b.date}">
            <div class="bi">${svg(b.icon, 24)}</div>
            <div><b>${esc(b.title)}</b><small>${esc(b.sub)}</small></div>
            <div class="count">${esc(b.count)}</div>
        </div>`).join('');
    if (html !== ui.bannersHtml) {
        ui.bannersHtml = html;
        $('#banners').innerHTML = html;
    }
}

function renderHeader() {
    $('#plan-date').textContent = cap(D.longDate(D.today()));
    $('#plan-hello').textContent = state.settings.name ? `Bonjour ${state.settings.name} ✦` : 'Bonjour ✦';
}

function renderCalendar(direction = 0) {
    const { year: y, month: m } = ui;
    $('#cal-title').textContent = `${cap(D.MONTHS[m])} ${y}`;
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const t = D.today();
    const c = cycleInfo();
    const predictions = predictedStarts(c);
    let html = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(h => `<div class="h">${h}</div>`).join('') + '<div></div>'.repeat(offset);
    for (let d = 1; d <= D.daysInMonth(y, m); d++) {
        const s = D.iso(new Date(y, m, d));
        const dots = occurrences(s).slice(0, 3).map(r => `<i style="background:var(--${r.color})"></i>`).join('');
        const cy = cycleKind(s, c, predictions);
        const cls = ['d', cy?.kind === 'real' ? 'cy' : '', cy?.kind === 'pred' ? 'pred' : '', s === t ? 'today' : '', s === ui.selected ? 'sel' : ''].join(' ');
        html += `<button class="${cls}" data-date="${s}">${d}<span class="dots">${dots}</span></button>`;
    }
    const grid = $('#grid');
    grid.innerHTML = html;
    if (direction) {
        grid.classList.remove('slide-l', 'slide-r');
        void grid.offsetWidth;
        grid.classList.add(direction > 0 ? 'slide-l' : 'slide-r');
    }
}

function reminderRow(r, s, i) {
    const isNote = r.kind === 'note';
    const sub = isNote ? (r.body || '').split('\n')[0] : [r.time, r.repeat !== 'none' ? REPEATS[r.repeat] : ''].filter(Boolean).join(' · ');
    return `
        <div class="item ${!isNote && isDone(r, s) ? 'done' : ''}" style="--col:var(--${r.color});animation-delay:${i * 60}ms" data-id="${r.id}">
            <div class="ico">${svg(r.icon)}</div>
            <div class="txt"><span>${esc(r.title)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
            ${isNote ? '' : `<button class="check" data-check="${r.id}" aria-label="Marquer comme fait"></button>`}
        </div>`;
}

function renderDay() {
    const s = ui.selected;
    const t = D.today();
    $('#day-title').innerHTML = `<span>${s === t ? "Aujourd'hui" : esc(cap(D.longDate(s)))}</span>${s !== t ? '<button class="link" data-today>Revenir à aujourd’hui</button>' : ''}`;
    const rows = [];
    const c = cycleInfo();
    const cy = cycleKind(s, c, predictedStarts(c));
    if (cy) {
        rows.push(`
            <div class="item" style="--col:var(--a)">
                <div class="ico">${svg('i-drop')}</div>
                <div class="txt"><span>${cy.day === 1 ? 'Début des règles' : `Règles · jour ${cy.day}`}</span><small>${cy.kind === 'pred' ? 'Prévision' : 'Noté dans le coffre'}</small></div>
            </div>`);
    }
    occurrences(s).forEach(r => rows.push(reminderRow(r, s, rows.length)));
    $('#day-list').innerHTML = rows.length ? rows.join('') : `<div class="empty">${svg('i-sparkle', 34)}Journée libre !</div>`;
}

function renderPlanning() {
    const t = D.today();
    if (t !== ui.lastToday) {
        if (ui.selected === ui.lastToday) {
            ui.selected = t;
        }
        ui.lastToday = t;
    }
    renderHeader();
    renderBanners();
    renderCalendar();
    renderDay();
}

function selectDate(s, direction = 0) {
    const d = D.parse(s);
    const moved = d.getFullYear() !== ui.year || d.getMonth() !== ui.month;
    const dir = direction || (moved ? (d > new Date(ui.year, ui.month, 1) ? 1 : -1) : 0);
    ui.year = d.getFullYear();
    ui.month = d.getMonth();
    ui.selected = s;
    renderCalendar(dir);
    renderDay();
}

function shiftMonth(n) {
    const d = new Date(ui.year, ui.month + n, 1);
    ui.year = d.getFullYear();
    ui.month = d.getMonth();
    renderCalendar(n);
}

function reminderForm(r, kind = 'task') {
    const isNew = !r;
    const k = r?.kind || kind;
    const isNote = k === 'note';
    const v = r || { title: '', date: ui.selected, repeat: 'none', icon: isNote ? 'i-note' : 'i-bell', color: isNote ? 'd' : 'b', body: '' };
    const heading = isNote ? (isNew ? 'Nouvelle note' : 'Modifier la note') : (isNew ? 'Nouveau rappel' : 'Modifier le rappel');
    openSheet(`
        <h3>${heading}</h3>
        <form>
            <label class="field"><span>${isNote ? 'Titre' : 'Quoi ?'}</span><input name="title" required maxlength="80" value="${esc(v.title)}" placeholder="${isNote ? 'Idées cadeaux…' : 'Appeler la mutuelle…'}"></label>
            ${isNote ? `<label class="field"><span>Note</span><textarea name="body" maxlength="4000">${esc(v.body)}</textarea></label>` : ''}
            <div class="row2">
                <label class="field"><span>Date</span><input type="date" name="date" required value="${v.date}"></label>
                ${isNote ? '' : `<label class="field"><span>Heure</span><input type="time" name="time" value="${v.time || ''}"></label>`}
            </div>
            ${isNote ? '' : `<label class="field"><span>Répétition</span><select name="repeat">${Object.entries(REPEATS).map(([val, label]) => `<option value="${val}" ${v.repeat === val ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`}
            <div class="field"><span>Icône</span><div class="pick">${REMINDER_ICONS.map(ic => `<label><input type="radio" name="icon" value="${ic}" ${v.icon === ic ? 'checked' : ''}><span class="opt">${svg(ic, 22)}</span></label>`).join('')}</div></div>
            <div class="field"><span>Couleur</span><div class="pick">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${v.color === c ? 'checked' : ''}><span class="sw" style="background:var(--${c})"></span></label>`).join('')}</div></div>
            <div class="btns">${isNew ? '' : '<button type="button" class="btn-danger" data-del>Supprimer</button>'}<button class="btn-main">Enregistrer</button></div>
        </form>`,
        root => {
            const form = $('form', root);
            form.onsubmit = e => {
                e.preventDefault();
                const fd = new FormData(form);
                const data = {
                    title: fd.get('title').trim(),
                    date: fd.get('date'),
                    time: fd.get('time') || '',
                    repeat: fd.get('repeat') || 'none',
                    icon: fd.get('icon') || v.icon,
                    color: fd.get('color') || v.color,
                    body: (fd.get('body') || '').trim(),
                };
                if (!data.title || !data.date) {
                    return;
                }
                if (isNew) {
                    state.reminders.push({ id: uid(), kind: k, done: {}, ...data });
                } else {
                    Object.assign(r, data);
                }
                save();
                closeSheet();
                go(0);
                selectDate(data.date);
                renderBanners();
                toast(isNew ? 'Ajouté ✦' : 'Modifié');
            };
            $('[data-del]', root)?.addEventListener('click', () => confirmSheet(
                'Supprimer ?',
                `« ${r.title} » sera supprimé${r.repeat && r.repeat !== 'none' ? ', avec toutes ses répétitions' : ''}.`,
                'Supprimer',
                () => {
                    state.reminders = state.reminders.filter(x => x !== r);
                    save();
                    renderPlanning();
                    toast('Supprimé');
                },
            ));
        },
    );
}

const activeList = () => state.lists.find(l => l.id === state.activeList) || state.lists[0];

function updateProgress(list) {
    const done = list.items.filter(i => i.done).length;
    const total = list.items.length;
    $('#prog').style.width = total ? `${(done / total) * 100}%` : '0';
    $('#ptxt').textContent = !total ? 'Rien pour l’instant' : done === total ? 'Tout est dans le panier 🎉' : `${done} / ${total} dans le panier`;
}

function renderCourses(animate = 'all') {
    const list = activeList();
    $('#shop-title').textContent = list.name;
    $('#list-chips').innerHTML = state.lists.map(l => `<button class="chip ${l === list ? 'on' : ''}" data-list="${l.id}">${esc(l.name)}</button>`).join('')
        + `<button class="chip" data-newlist>+ Liste</button>`;
    const items = [...list.items.filter(i => !i.done), ...list.items.filter(i => i.done)];
    $('#shop').innerHTML = items.length
        ? items.map((it, i) => {
            const anim = animate === 'all' || (animate === 'first' && i === 0) ? `animation-delay:${animate === 'all' ? i * 30 : 0}ms` : 'animation:none';
            return `
                <div class="item ${it.done ? 'done' : ''}" style="--col:var(--c);${anim}" data-item="${it.id}">
                    <div class="txt"><span>${esc(it.text)}</span></div>
                    <button class="x" data-del="${it.id}" aria-label="Supprimer">${svg('i-x', 16)}</button>
                    <button class="check" aria-label="Cocher"></button>
                </div>`;
        }).join('')
        : `<div class="empty">${svg('i-cart', 34)}Liste vide, ajoute ton premier article</div>`;
    $('#shop-actions').hidden = !list.items.length;
    updateProgress(list);
}

function listForm(list) {
    const isNew = !list;
    openSheet(`
        <h3>${isNew ? 'Nouvelle liste' : 'Modifier la liste'}</h3>
        <form>
            <label class="field"><span>Nom</span><input name="name" required maxlength="40" value="${esc(list?.name)}" placeholder="Marché, Pharmacie…"></label>
            <div class="btns">${!isNew && state.lists.length > 1 ? '<button type="button" class="btn-danger" data-del>Supprimer</button>' : ''}<button class="btn-main">Enregistrer</button></div>
        </form>`,
        root => {
            const form = $('form', root);
            form.onsubmit = e => {
                e.preventDefault();
                const name = new FormData(form).get('name').trim();
                if (!name) {
                    return;
                }
                if (isNew) {
                    const created = { id: uid(), name, items: [] };
                    state.lists.push(created);
                    state.activeList = created.id;
                } else {
                    list.name = name;
                }
                save();
                closeSheet();
                renderCourses();
            };
            $('[data-del]', root)?.addEventListener('click', () => confirmSheet(
                'Supprimer la liste ?',
                `« ${list.name} » et ses ${list.items.length} article(s) seront supprimés.`,
                'Supprimer',
                () => {
                    state.lists = state.lists.filter(l => l !== list);
                    state.activeList = state.lists[0].id;
                    save();
                    renderCourses();
                },
            ));
        },
    );
}

const pinLength = () => (ui.pinMode === 'unlock' ? state.vault?.pinLen || 4 : 6);

const PIN_TEXTS = {
    unlock: ['Protégé par code', 'Entre ton code'],
    create: ['Première ouverture', 'Choisis un code de 4 à 6 chiffres'],
    confirm: ['Première ouverture', 'Confirme ton code'],
    change: ['Changement de code', 'Nouveau code (4 à 6 chiffres)'],
    changeConfirm: ['Changement de code', 'Confirme le nouveau code'],
};

function drawPins() {
    const slots = ui.pinMode === 'unlock' ? pinLength() : Math.max(4, ui.pin.length);
    $('#pins').innerHTML = Array.from({ length: slots }, (_, i) => `<i class="${i < ui.pin.length ? 'f' : ''}"></i>`).join('');
    const ok = $('[data-ok]', $('#vault-body'));
    if (ok) {
        ok.disabled = ui.pin.length < 4;
    }
}

function renderKeypad() {
    const [sub, prompt] = PIN_TEXTS[ui.pinMode];
    const isUnlock = ui.pinMode === 'unlock';
    const isChange = ui.pinMode.startsWith('change');
    $('#vault-sub').textContent = sub;
    $('#vault-body').innerHTML = `
        <div class="lock">
            <div class="padi">${svg('i-lock', 40)}</div>
            <p>${prompt}</p>
            <div class="pins" id="pins"></div>
            <div class="keys">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
                ${isUnlock ? '<span></span>' : `<button class="ok" data-ok aria-label="Valider">${svg('i-right', 26)}</button>`}
                <button data-k="0">0</button>
                <button data-k="back" aria-label="Effacer">${svg('i-left', 22)}</button>
            </div>
            ${ui.pinMode === 'create' ? '<p class="fine">Ce code protège tes numéros et ton suivi de cycle. Il n’est enregistré nulle part : si tu l’oublies, le coffre devra être vidé.</p>' : ''}
            ${isUnlock ? '<button class="forgot" data-forgot>Code oublié ?</button>' : ''}
            ${isChange ? '<button class="forgot" data-cancel-change>Annuler</button>' : ''}
        </div>`;
    drawPins();
}

function renderVaultContent() {
    const t = D.today();
    const c = cycleInfo();
    const current = cycleKind(t, c, []);
    const n = c.next ? D.diffDays(t, c.next) : null;
    let big = 'Pas encore de données';
    let sub = 'Note le premier jour de tes règles pour lancer les prévisions.';
    if (current?.kind === 'real') {
        big = `En cours · jour ${current.day}`;
        sub = `Prochaines prévues ${D.longDate(c.next)}`;
    } else if (c.next) {
        big = n > 0 ? `Dans ${n} jour${n > 1 ? 's' : ''}` : n === 0 ? 'Prévues aujourd’hui' : `Retard de ${-n} jour${-n > 1 ? 's' : ''}`;
        sub = `Prochaines règles prévues ${D.longDate(c.next)}`;
    }
    const history = c.starts.slice(-6).reverse().map(s => `<span>${D.shortDate(s)}<button data-period-del="${s}" aria-label="Retirer">${svg('i-x', 14)}</button></span>`).join('');
    const entries = Object.entries(CATEGORIES).map(([cat, color]) => {
        const list = V.data.entries.filter(e => e.category === cat);
        if (!list.length) {
            return '';
        }
        return `<div class="section">${cat}</div>` + list.map((e, i) => `
            <div class="item ${ui.revealed.has(e.id) ? 'reveal' : ''}" style="--col:var(--${color});animation-delay:${i * 50}ms" data-entry="${e.id}">
                <div class="ico">${svg(e.icon)}</div>
                <div class="txt"><span>${esc(e.label)}</span><span class="secret">${esc(e.value)}</span></div>
                <div class="vault-actions">
                    <button class="x" data-copy="${e.id}" aria-label="Copier">${svg('i-copy', 18)}</button>
                    <button class="x" data-edit="${e.id}" aria-label="Modifier">${svg('i-edit', 18)}</button>
                </div>
            </div>`).join('');
    }).join('');

    $('#vault-sub').textContent = 'Déverrouillé · se referme après 2 min';
    $('#vault-body').innerHTML = `
        <div class="cycle">
            <div class="hello">${svg('i-drop', 16)} Cycle</div>
            <div class="big">${big}</div>
            <div class="hello">${sub}</div>
            <div class="meta">
                <span>${c.measured ? `Cycle moyen ${c.avg} j` : `Cycle ${c.avg} j par défaut`}</span>
                <span class="stepper">Durée <button data-len="-1" aria-label="Moins">−</button>${c.len} j<button data-len="1" aria-label="Plus">+</button></span>
            </div>
            ${history ? `<div class="history">${history}</div>` : ''}
            <button class="go" data-period>Mes règles ont commencé</button>
        </div>
        ${entries || `<div class="empty">${svg('i-card', 34)}Ajoute ta carte vitale, ton n° fiscal…</div>`}
        ${entries ? '<div class="hint">Touche une ligne pour afficher la valeur</div>' : ''}
        <button class="big-btn" data-add-entry>+ Ajouter une info</button>
        <p class="fine"><button class="forgot" data-change-pin>Changer le code</button></p>`;
}

function renderVault() {
    $('#vault-lock').hidden = !V.isOpen() || ui.pinMode.startsWith('change');
    if (!V.isOpen() || ui.pinMode.startsWith('change')) {
        renderKeypad();
    } else {
        renderVaultContent();
    }
    updateFab();
}

function setBusy(busy) {
    ui.busy = busy;
    $('.lock')?.classList.toggle('busy', busy);
}

function shakePins() {
    const pins = $('#pins');
    pins?.classList.add('shake');
    setTimeout(() => {
        pins?.classList.remove('shake');
        ui.pin = '';
        drawPins();
    }, 400);
}

async function persistVault() {
    const pinLen = state.vault.pinLen;
    state.vault = { ...(await V.seal()), pinLen };
    save();
    syncCycleHint();
}

function runPending() {
    if (ui.pending === 'period' && V.isOpen()) {
        ui.pending = null;
        periodForm();
    }
}

async function submitPin() {
    const pin = ui.pin;
    if (ui.pinMode === 'unlock') {
        if (Date.now() < ui.blockedUntil) {
            toast(`Trop d’essais, patiente ${Math.ceil((ui.blockedUntil - Date.now()) / 1000)} s`);
            shakePins();
            return;
        }
        setBusy(true);
        const ok = await V.open(state.vault, pin);
        setBusy(false);
        if (!ok) {
            ui.failures++;
            if (ui.failures >= 5) {
                ui.failures = 0;
                ui.blockedUntil = Date.now() + 30000;
            }
            shakePins();
            return;
        }
        ui.failures = 0;
        ui.pin = '';
        ui.lastActivity = Date.now();
        $('.lock')?.classList.add('ok');
        syncCycleHint();
        setTimeout(() => {
            renderVault();
            renderPlanning();
            runPending();
        }, 350);
        return;
    }
    if (pin.length < 4) {
        return;
    }
    if (ui.pinMode === 'create' || ui.pinMode === 'change') {
        ui.pinFirst = pin;
        ui.pin = '';
        ui.pinMode = ui.pinMode === 'create' ? 'confirm' : 'changeConfirm';
        renderVault();
        return;
    }
    if (pin !== ui.pinFirst) {
        toast('Les deux codes sont différents');
        ui.pinMode = ui.pinMode === 'confirm' ? 'create' : 'change';
        ui.pinFirst = '';
        shakePins();
        setTimeout(renderVault, 420);
        return;
    }
    const creating = ui.pinMode === 'confirm';
    setBusy(true);
    const blob = creating ? await V.create(pin, { entries: [], periods: [], periodLen: 5 }) : await V.rekey(pin);
    setBusy(false);
    state.vault = { ...blob, pinLen: pin.length };
    save();
    ui.pin = '';
    ui.pinFirst = '';
    ui.pinMode = 'unlock';
    ui.lastActivity = Date.now();
    syncCycleHint();
    renderVault();
    toast(creating ? 'Coffre créé 🔒' : 'Code modifié');
    runPending();
}

function onKey(k) {
    if (ui.busy) {
        return;
    }
    if (k === 'back') {
        ui.pin = ui.pin.slice(0, -1);
    } else if (ui.pin.length < pinLength()) {
        ui.pin += k;
    }
    drawPins();
    if (ui.pinMode === 'unlock' && ui.pin.length === pinLength()) {
        submitPin();
    }
}

function lockVault() {
    if (!V.isOpen()) {
        return;
    }
    V.lock();
    ui.revealed.clear();
    ui.pin = '';
    ui.pinFirst = '';
    ui.pinMode = state.vault ? 'unlock' : 'create';
    renderVault();
    renderPlanning();
}

function periodForm() {
    const t = D.today();
    openSheet(`
        <h3>Début des règles</h3>
        <form>
            <label class="field"><span>Premier jour</span><input type="date" name="date" required value="${t}" max="${t}"></label>
            <div class="btns"><button class="btn-main">Enregistrer</button></div>
        </form>`,
        root => {
            $('form', root).onsubmit = async e => {
                e.preventDefault();
                const date = new FormData(e.target).get('date');
                closeSheet();
                if (!date || !V.isOpen()) {
                    return;
                }
                if (!V.data.periods.includes(date)) {
                    V.data.periods.push(date);
                    V.data.periods.sort();
                }
                await persistVault();
                renderVault();
                renderPlanning();
                toast('Noté 🩸');
            };
        },
    );
}

function entryForm(entry) {
    const isNew = !entry;
    const v = entry || { label: '', value: '', category: 'Administratif', icon: 'i-card' };
    openSheet(`
        <h3>${isNew ? 'Nouvelle info' : 'Modifier'}</h3>
        <form autocomplete="off">
            <label class="field"><span>Nom</span><input name="label" required maxlength="60" value="${esc(v.label)}" placeholder="Carte Vitale, N° fiscal…"></label>
            <label class="field"><span>Valeur</span><input name="value" required maxlength="300" value="${esc(v.value)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
            <label class="field"><span>Catégorie</span><select name="category">${Object.keys(CATEGORIES).map(c => `<option ${v.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            <div class="field"><span>Icône</span><div class="pick">${VAULT_ICONS.map(ic => `<label><input type="radio" name="icon" value="${ic}" ${v.icon === ic ? 'checked' : ''}><span class="opt">${svg(ic, 22)}</span></label>`).join('')}</div></div>
            <div class="btns">${isNew ? '' : '<button type="button" class="btn-danger" data-del>Supprimer</button>'}<button class="btn-main">Enregistrer</button></div>
        </form>`,
        root => {
            const form = $('form', root);
            form.onsubmit = async e => {
                e.preventDefault();
                const fd = new FormData(form);
                const data = { label: fd.get('label').trim(), value: fd.get('value').trim(), category: fd.get('category'), icon: fd.get('icon') || v.icon };
                if (!data.label || !data.value) {
                    return;
                }
                closeSheet();
                if (!V.isOpen()) {
                    toast('Coffre verrouillé, rien n’a été enregistré');
                    return;
                }
                if (isNew) {
                    V.data.entries.push({ id: uid(), ...data });
                } else {
                    Object.assign(V.data.entries.find(x => x.id === entry.id) || {}, data);
                }
                await persistVault();
                renderVault();
                toast('Enregistré 🔒');
            };
            $('[data-del]', root)?.addEventListener('click', () => confirmSheet(
                'Supprimer ?',
                `« ${entry.label} » sera supprimé du coffre.`,
                'Supprimer',
                async () => {
                    if (!V.isOpen()) {
                        return;
                    }
                    V.data.entries = V.data.entries.filter(x => x.id !== entry.id);
                    await persistVault();
                    renderVault();
                },
            ));
        },
    );
}

function exportData() {
    const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `to-doudou-${D.today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Sauvegarde téléchargée');
}

async function importData(file) {
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch {
        data = null;
    }
    if (!isValidBackup(data)) {
        toast('Fichier de sauvegarde invalide');
        return;
    }
    delete data.exportedAt;
    confirmSheet('Importer cette sauvegarde ?', 'Toutes les données actuelles de l’app seront remplacées par celles du fichier.', 'Remplacer', () => {
        replaceState(data);
        V.lock();
        ui.revealed.clear();
        ui.pin = '';
        ui.pinMode = state.vault ? 'unlock' : 'create';
        ui.bannersHtml = '';
        applyTheme();
        renderAll();
        toast('Sauvegarde importée');
    });
}

async function importIcs(file) {
    const events = parseIcs(await file.text());
    if (!events.length) {
        toast('Aucun événement trouvé dans ce fichier');
        return;
    }
    const t = D.today();
    const upcoming = events.filter(e => e.repeat !== 'none' || e.date >= t).slice(0, 500);
    const known = new Set(state.reminders.map(r => r.icsUid).filter(Boolean));
    const fresh = upcoming.filter(e => !known.has(e.uid)).length;
    const updated = upcoming.length - fresh;
    const skipped = events.length - upcoming.length;
    const simplified = upcoming.filter(e => e.simplified).length;
    const lines = [
        fresh && `${fresh} nouvel(s) événement(s)`,
        updated && `${updated} déjà importé(s), mis à jour`,
        skipped && `${skipped} passé(s), ignoré(s)`,
        simplified && `${simplified} répétition(s) trop complexe(s) : seule la date de départ est gardée`,
    ].filter(Boolean);
    openSheet(`
        <h3>Importer l’agenda</h3>
        <p>${events.length} événement(s) dans « ${esc(file.name)} ».</p>
        <ul class="recap">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
        <div class="btns"><button class="btn-ghost" data-cancel>Annuler</button><button class="btn-main" data-ok ${upcoming.length ? '' : 'disabled'}>Importer ${upcoming.length}</button></div>`,
        root => {
            $('[data-cancel]', root).onclick = closeSheet;
            $('[data-ok]', root).onclick = () => {
                upcoming.forEach(e => {
                    const data = { title: e.title, date: e.date, time: e.time, repeat: e.repeat };
                    const existing = state.reminders.find(r => r.icsUid === e.uid);
                    if (existing) {
                        Object.assign(existing, data);
                    } else {
                        state.reminders.push({ id: uid(), kind: 'task', done: {}, icon: 'i-cal', color: 'b', body: '', icsUid: e.uid, ...data });
                    }
                });
                save();
                closeSheet();
                go(0);
                renderPlanning();
                toast(`${upcoming.length} événement(s) importé(s) ✦`);
            };
        },
    );
}

function settingsForm() {
    openSheet(`
        <h3>Paramètres</h3>
        <label class="field"><span>Ton prénom</span><input name="name" maxlength="30" value="${esc(state.settings.name)}" placeholder="Prénom"></label>
        <div class="field"><span>Ambiance</span><div class="themes">${Object.entries(THEMES).map(([k, t]) => `<label><input type="radio" name="theme" value="${k}" ${state.settings.theme === k ? 'checked' : ''}><span class="sw" style="background:${t.swatch}"></span>${t.label}</label>`).join('')}</div></div>
        <label class="switch"><span>Prévision des règles sans code<small>Bandeau J-x et jours prévus visibles même coffre fermé</small></span><input type="checkbox" name="cycleHint" ${state.settings.cycleHint ? 'checked' : ''}></label>
        <div class="field"><span>Agenda</span>
            <div class="btns"><button type="button" class="btn-ghost" data-ics>${svg('i-cal', 18)} Importer un agenda (.ics)</button></div>
            <input type="file" accept=".ics,text/calendar" hidden data-ics-file>
        </div>
        <div class="field"><span>Sauvegarde de l’app</span>
            <div class="btns"><button type="button" class="btn-ghost" data-export>${svg('i-down', 18)} Exporter</button><button type="button" class="btn-ghost" data-import>${svg('i-up', 18)} Importer</button></div>
            <input type="file" accept="application/json,.json" hidden data-file>
        </div>
        <p class="fine">Tes données restent sur ce téléphone, rien n’est envoyé sur Internet.<br>Le coffre est chiffré avec ton code, y compris dans la sauvegarde.<br>Version ${APP_VERSION}</p>`,
        root => {
            $('[name=name]', root).oninput = e => {
                state.settings.name = e.target.value.trim();
                save();
                renderHeader();
            };
            root.querySelectorAll('[name=theme]').forEach(r => {
                r.onchange = () => {
                    state.settings.theme = r.value;
                    save();
                    applyTheme();
                };
            });
            $('[name=cycleHint]', root).onchange = e => {
                state.settings.cycleHint = e.target.checked;
                if (!e.target.checked) {
                    state.cycleHint = null;
                }
                save();
                syncCycleHint();
                renderPlanning();
            };
            $('[data-export]', root).onclick = exportData;
            const file = $('[data-file]', root);
            $('[data-import]', root).onclick = () => file.click();
            file.onchange = () => file.files[0] && importData(file.files[0]);
            const icsFile = $('[data-ics-file]', root);
            $('[data-ics]', root).onclick = () => icsFile.click();
            icsFile.onchange = () => icsFile.files[0] && importIcs(icsFile.files[0]);
        },
    );
}

function fabMenu() {
    openSheet(`
        <h3>Ajouter…</h3>
        <div class="choices">
            <button style="background:linear-gradient(135deg,var(--b),var(--b2))" data-add="task">${svg('i-bell', 30)}Rappel</button>
            <button style="background:linear-gradient(135deg,var(--c),var(--c2))" data-add="item">${svg('i-cart', 30)}Article</button>
            <button style="background:linear-gradient(135deg,var(--a),var(--a2))" data-add="period">${svg('i-drop', 30)}Début règles</button>
            <button style="background:linear-gradient(135deg,var(--d),var(--a2))" data-add="note">${svg('i-note', 30)}Note</button>
        </div>`,
        root => {
            $('.choices', root).onclick = e => {
                const action = e.target.closest('[data-add]')?.dataset.add;
                if (action === 'task' || action === 'note') {
                    reminderForm(null, action);
                } else if (action === 'item') {
                    closeSheet();
                    go(1);
                    setTimeout(() => $('#new-item').focus(), 450);
                } else if (action === 'period') {
                    if (V.isOpen()) {
                        periodForm();
                        return;
                    }
                    closeSheet();
                    ui.pending = 'period';
                    go(2);
                    toast('Déverrouille le coffre d’abord');
                }
            };
        },
    );
}

function renderAll() {
    renderPlanning();
    renderCourses();
    renderVault();
}

function bindEvents() {
    $('#tabs').onclick = e => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
            go(Number(tab.dataset.tab));
        }
    };
    $('#fab').onclick = fabMenu;
    $('#open-settings').onclick = settingsForm;
    $('#vault-lock').onclick = lockVault;
    veil.onclick = closeSheet;
    window.addEventListener('popstate', hideSheet);

    $('#cal-prev').onclick = () => shiftMonth(-1);
    $('#cal-next').onclick = () => shiftMonth(1);
    $('#cal-title').onclick = () => selectDate(D.today());
    $('#grid').onclick = e => {
        const day = e.target.closest('[data-date]');
        if (!day) {
            return;
        }
        ui.selected = day.dataset.date;
        $('#grid .sel')?.classList.remove('sel');
        day.classList.add('sel');
        renderDay();
    };
    let touch = null;
    $('#cal').addEventListener('touchstart', e => { touch = e.touches[0]; }, { passive: true });
    $('#cal').addEventListener('touchend', e => {
        if (!touch) {
            return;
        }
        const dx = e.changedTouches[0].clientX - touch.clientX;
        const dy = e.changedTouches[0].clientY - touch.clientY;
        touch = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            shiftMonth(dx < 0 ? 1 : -1);
        }
    });
    $('#banners').onclick = e => {
        const date = e.target.closest('[data-date]')?.dataset.date;
        if (date) {
            selectDate(date);
        }
    };
    $('#day-title').onclick = e => {
        if (e.target.closest('[data-today]')) {
            selectDate(D.today());
        }
    };
    $('#day-list').onclick = e => {
        const check = e.target.closest('[data-check]');
        if (check) {
            const r = state.reminders.find(x => x.id === check.dataset.check);
            const s = ui.selected;
            r.done = r.done || {};
            if (r.done[s]) {
                delete r.done[s];
            } else {
                r.done[s] = true;
            }
            save();
            check.closest('.item').classList.toggle('done', !!r.done[s]);
            renderBanners();
            return;
        }
        const row = e.target.closest('[data-id]');
        if (row) {
            reminderForm(state.reminders.find(x => x.id === row.dataset.id));
        }
    };

    $('#add-item').onsubmit = e => {
        e.preventDefault();
        const input = $('#new-item');
        const text = input.value.trim();
        if (!text) {
            return;
        }
        activeList().items.unshift({ id: uid(), text, done: false });
        save();
        input.value = '';
        renderCourses('first');
    };
    $('#list-chips').onclick = e => {
        const chip = e.target.closest('[data-list]');
        if (chip) {
            state.activeList = chip.dataset.list;
            save();
            renderCourses();
        } else if (e.target.closest('[data-newlist]')) {
            listForm(null);
        }
    };
    $('#list-menu').onclick = () => listForm(activeList());
    $('#shop').onclick = e => {
        const list = activeList();
        const del = e.target.closest('[data-del]');
        if (del) {
            list.items = list.items.filter(i => i.id !== del.dataset.del);
            save();
            const row = del.closest('.item');
            row.style.transform = 'translateX(60px)';
            row.style.opacity = '0';
            setTimeout(() => renderCourses('none'), 200);
            return;
        }
        const row = e.target.closest('[data-item]');
        if (!row) {
            return;
        }
        const item = list.items.find(i => i.id === row.dataset.item);
        item.done = !item.done;
        save();
        row.classList.toggle('done', item.done);
        updateProgress(list);
        if (item.done && list.items.every(i => i.done)) {
            confetti();
        }
    };
    $('#shop-actions').onclick = e => {
        const action = e.target.closest('[data-shop]')?.dataset.shop;
        const list = activeList();
        if (action === 'uncheck') {
            list.items.forEach(i => { i.done = false; });
        } else if (action === 'clear') {
            list.items = list.items.filter(i => !i.done);
        } else {
            return;
        }
        save();
        renderCourses();
    };

    $('#vault-body').onclick = e => {
        const t = e.target;
        const key = t.closest('[data-k]');
        if (key) {
            onKey(key.dataset.k);
        } else if (t.closest('[data-ok]')) {
            if (!ui.busy) {
                submitPin();
            }
        } else if (t.closest('[data-forgot]')) {
            confirmSheet(
                'Code oublié ?',
                'Sans le code, impossible de lire le coffre. Tu peux le vider pour repartir de zéro : tes numéros et ton suivi de cycle seront effacés définitivement.',
                'Vider le coffre',
                () => {
                    state.vault = null;
                    state.cycleHint = null;
                    save();
                    ui.pin = '';
                    ui.pinMode = 'create';
                    renderVault();
                    renderPlanning();
                },
            );
        } else if (t.closest('[data-cancel-change]')) {
            ui.pin = '';
            ui.pinFirst = '';
            ui.pinMode = 'unlock';
            renderVault();
        } else if (t.closest('[data-change-pin]')) {
            ui.pin = '';
            ui.pinMode = 'change';
            renderVault();
        } else if (t.closest('[data-period]')) {
            periodForm();
        } else if (t.closest('[data-period-del]')) {
            const date = t.closest('[data-period-del]').dataset.periodDel;
            V.data.periods = V.data.periods.filter(p => p !== date);
            persistVault().then(() => {
                renderVault();
                renderPlanning();
            });
        } else if (t.closest('[data-len]')) {
            V.data.periodLen = Math.min(10, Math.max(2, (V.data.periodLen || 5) + Number(t.closest('[data-len]').dataset.len)));
            persistVault().then(() => {
                renderVault();
                renderPlanning();
            });
        } else if (t.closest('[data-copy]')) {
            const entry = V.data.entries.find(x => x.id === t.closest('[data-copy]').dataset.copy);
            navigator.clipboard?.writeText(entry.value).then(() => toast('Copié'), () => toast('Copie impossible'));
        } else if (t.closest('[data-edit]')) {
            entryForm(V.data.entries.find(x => x.id === t.closest('[data-edit]').dataset.edit));
        } else if (t.closest('[data-add-entry]')) {
            entryForm(null);
        } else if (t.closest('[data-entry]')) {
            const row = t.closest('[data-entry]');
            const id = row.dataset.entry;
            if (ui.revealed.has(id)) {
                ui.revealed.delete(id);
            } else {
                ui.revealed.add(id);
            }
            row.classList.toggle('reveal', ui.revealed.has(id));
        }
    };

    ['pointerdown', 'keydown'].forEach(type => document.addEventListener(type, () => { ui.lastActivity = Date.now(); }, { passive: true }));
    setInterval(() => {
        if (V.isOpen() && Date.now() - ui.lastActivity > AUTO_LOCK_MS) {
            lockVault();
        }
    }, 5000);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            lockVault();
        } else {
            renderPlanning();
        }
    });
}

applyTheme();
bindEvents();
renderAll();
go(0);

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.().catch(() => {});
