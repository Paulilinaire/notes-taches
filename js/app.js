import { state, save, uid, replaceState, isValidBackup } from './store.js';
import * as D from './dates.js';
import * as V from './vault.js';
import { parseIcs } from './ics.js';
import { AISLES, guessAisle, normalize } from './aisles.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (id, size = 20) => `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const THEMES = {
    bonbon: { label: 'Bonbon', color: '#7c5cff', swatch: 'conic-gradient(#ff5c8a,#7c5cff,#17c98b,#ffb800,#ff5c8a)' },
    sunset: { label: 'Coucher de soleil', color: '#ff7a00', swatch: 'conic-gradient(#ff4f6d,#ff7a00,#ffd23f,#8c52ff,#ff4f6d)' },
    lagon: { label: 'Lagon', color: '#00b4d8', swatch: 'conic-gradient(#00b4d8,#06d6a0,#3a86ff,#ff6b6b,#00b4d8)' },
};
const REMINDER_ICONS = ['i-bell', 'i-cal', 'i-plane', 'i-palm', 'i-suitcase', 'i-car', 'i-cake', 'i-gift', 'i-work', 'i-sport', 'i-food', 'i-phone', 'i-pill', 'i-tooth', 'i-school', 'i-heart', 'i-home', 'i-card', 'i-cart', 'i-sparkle', 'i-note'];
const VAULT_ICONS = ['i-card', 'i-tax', 'i-heart', 'i-pill', 'i-home', 'i-lock', 'i-note'];
const COLORS = ['b', 'a', 'c', 'd'];
const REPEATS = { none: 'Jamais', daily: 'Chaque jour', days: 'Certains jours', weekly: 'Chaque semaine', monthly: 'Chaque mois', yearly: 'Chaque année' };
const WEEKDAYS = [[1, 'L', 'Lun'], [2, 'M', 'Mar'], [3, 'M', 'Mer'], [4, 'J', 'Jeu'], [5, 'V', 'Ven'], [6, 'S', 'Sam'], [0, 'D', 'Dim']];
const HABIT_ICONS = ['i-drop', 'i-sport', 'i-heart', 'i-sparkle', 'i-veg', 'i-food', 'i-pill', 'i-tooth', 'i-note', 'i-home', 'i-bell'];
const FLOWS = [['', 'Aucun'], ['light', 'Léger'], ['medium', 'Moyen'], ['heavy', 'Abondant']];
const SYMPTOMS = ['Crampes', 'Fatigue', 'Maux de tête', 'Ballonnements', 'Seins sensibles', 'Mal de dos', 'Nausées', 'Acné'];
const MOODS = [['😊', 'Bien'], ['😌', 'Calme'], ['😐', 'Bof'], ['😢', 'Triste'], ['😠', 'Irritable'], ['😰', 'Anxieuse']];
const BACKUP_EVERY_DAYS = 30;
const CATEGORIES = { Administratif: 'b', Santé: 'a', Autre: 'd' };
const APP_VERSION = 7;
const AUTO_LOCK_MS = 120000;
const DEFAULT_CYCLE = 28;
const SCREENS = ['s-plan', 's-courses', 's-cycle', 's-vault'];
const VAULT_TAB = 3;

const ui = {
    tab: 0,
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    selected: D.today(),
    lastToday: D.today(),
    logDate: D.today(),
    revealed: new Set(),
    pin: '',
    pinFirst: '',
    pinMode: state.vault ? 'unlock' : 'create',
    busy: false,
    failures: 0,
    blockedUntil: 0,
    lastActivity: Date.now(),
    bannersHtml: '',
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
    const theme = THEMES[state.settings.theme] ? state.settings.theme : 'bonbon';
    const appearance = state.settings.appearance || 'auto';
    const dark = appearance === 'dark' || (appearance === 'auto' && darkQuery.matches);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = dark ? 'dark' : 'light';
    $('meta[name="theme-color"]').content = THEMES[theme].color;
    $('meta[name="color-scheme"]').content = dark ? 'dark' : 'light';
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
    $('#fab').hidden = ui.tab === VAULT_TAB && (!V.isOpen() || ui.pinMode.startsWith('change'));
}

const occurrences = s => state.reminders.filter(r => D.occursOn(r, s)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const isDone = (r, s) => !!r.done?.[s];
const isTask = r => r.kind !== 'note' && !D.isSpan(r);
const overdueTasks = t => state.reminders.filter(r => isTask(r) && (r.repeat || 'none') === 'none' && r.date < t && D.diffDays(r.date, t) <= 60 && !isDone(r, r.date));

function backupDue(t) {
    const hasData = state.reminders.length || state.vault || state.cycle.periods.length || state.habits.length || state.lists.some(l => l.items.length);
    return hasData && D.diffDays(state.lastBackup || state.createdAt, t) >= BACKUP_EVERY_DAYS;
}

function cycleInfo() {
    const starts = [...state.cycle.periods].sort();
    const len = state.cycle.periodLen;
    const gaps = starts.slice(1).map((s, i) => D.diffDays(starts[i], s)).filter(g => g >= 15 && g <= 60).slice(-6);
    const avg = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : DEFAULT_CYCLE;
    const next = starts.length ? D.addDays(starts.at(-1), avg) : null;
    return { starts: starts.slice(-24), len, avg, next, measured: gaps.length > 0 };
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
    if (state.settings.showFertility && c.starts.length) {
        for (const start of predictions) {
            const k = D.diffDays(s, start);
            if (k >= 13 && k <= 19) {
                return { kind: 'fert', ovulation: k === 14 };
            }
        }
    }
    return null;
}

function fertileWindow(c) {
    if (!state.settings.showFertility || !c.next) {
        return null;
    }
    const t = D.today();
    const start = predictedStarts(c).find(p => D.addDays(p, -13) >= t) || c.next;
    return { from: D.addDays(start, -19), to: D.addDays(start, -13) };
}

async function migrateCycleFromVault() {
    if (!V.isOpen()) {
        return;
    }
    if (state.cycleInVault) {
        state.cycleInVault = false;
        save();
    }
    if (!('periods' in V.data || 'periodLen' in V.data)) {
        return;
    }
    state.cycle.periods = [...new Set([...state.cycle.periods, ...(V.data.periods || [])])].sort();
    if (V.data.periodLen) {
        state.cycle.periodLen = V.data.periodLen;
    }
    delete V.data.periods;
    delete V.data.periodLen;
    delete state.cycleHint;
    save();
    await persistVault();
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
    if (backupDue(t)) {
        const n = state.lastBackup ? D.diffDays(state.lastBackup, t) : null;
        out.unshift({
            col: 'd', col2: 'a2', icon: 'i-down', date: '', action: 'backup',
            title: 'Pense à sauvegarder',
            sub: n ? `Dernière sauvegarde il y a ${n} jours` : 'Touche ici pour exporter tes données',
            count: '💾',
        });
    }
    const late = overdueTasks(t);
    if (late.length) {
        out.push({ col: 'a', col2: 'd', icon: 'i-bell', date: t, title: late.length === 1 ? late[0].title : `${late.length} tâches en retard`, sub: 'À rattraper', count: String(late.length) });
    }
    const left = occurrences(t).filter(r => isTask(r) && !isDone(r, t));
    if (left.length) {
        out.push({
            col: 'b', col2: 'b2', icon: left.length === 1 ? left[0].icon : 'i-bell', date: t,
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
    return out.slice(0, 3);
}

function renderBanners() {
    const html = banners(D.today()).map(b => `
        <div class="banner" style="--col:var(--${b.col});--col2:var(--${b.col2})" data-date="${b.date}" data-action="${b.action || ''}">
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
    $('#plan-hello').textContent = state.settings.name ? `Bonjour ${state.settings.name}\u00a0✦` : 'Bonjour\u00a0✦';
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
        const occ = occurrences(s);
        const spans = occ.filter(D.isSpan).slice(0, 2);
        const dots = occ.filter(r => !D.isSpan(r)).slice(0, 3).map(r => `<i style="background:var(--${r.color})"></i>`).join('');
        const bands = spans.map(r => `<i class="band ${s === r.date ? 'start' : ''} ${s === r.endDate ? 'end' : ''}" style="background:var(--${r.color})"></i>`).join('');
        const cy = cycleKind(s, c, predictions);
        const cls = ['d', cy?.kind === 'real' ? 'cy' : '', cy?.kind === 'pred' ? 'pred' : '', cy?.kind === 'fert' ? 'fert' : '', cy?.ovulation ? 'ovu' : '', spans.length ? 'has-band' : '', s === t ? 'today' : '', s === ui.selected ? 'sel' : ''].join(' ');
        html += `<button class="${cls}" data-date="${s}">${d}<span class="dots">${dots}</span>${bands ? `<span class="bands">${bands}</span>` : ''}</button>`;
    }
    const grid = $('#grid');
    grid.innerHTML = html;
    if (direction) {
        grid.classList.remove('slide-l', 'slide-r');
        void grid.offsetWidth;
        grid.classList.add(direction > 0 ? 'slide-l' : 'slide-r');
    }
}

function repeatLabel(r) {
    if (r.repeat === 'days') {
        return WEEKDAYS.filter(([d]) => (r.days || []).includes(d)).map(([, , label]) => label).join(', ');
    }
    const label = r.repeat && r.repeat !== 'none' ? REPEATS[r.repeat] : '';
    return label && r.endDate ? `${label} jusqu’au ${D.shortDate(r.endDate)}` : label;
}

function reminderRow(r, s, i, late = false) {
    const isNote = r.kind === 'note';
    const span = D.isSpan(r);
    let sub;
    if (isNote) {
        sub = (r.body || '').split('\n')[0];
    } else if (span) {
        sub = `${cap(D.rangeLabel(r.date, r.endDate))} · jour ${D.diffDays(r.date, s) + 1}/${D.diffDays(r.date, r.endDate) + 1}`;
    } else if (late) {
        sub = `En retard · prévu le ${D.shortDate(r.date)}`;
    } else {
        sub = [r.time, repeatLabel(r)].filter(Boolean).join(' · ');
    }
    const on = late ? r.date : s;
    return `
        <div class="item ${isTask(r) && isDone(r, on) ? 'done' : ''} ${late ? 'late' : ''}" style="--col:var(--${late ? 'a' : r.color});animation-delay:${i * 60}ms" data-id="${r.id}">
            <div class="ico">${svg(r.icon)}</div>
            <div class="txt"><span>${esc(r.title)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
            ${late ? `<button class="snooze" data-snooze="${r.id}">Demain</button>` : ''}
            ${isTask(r) ? `<button class="check" data-check="${r.id}" data-on="${on}" aria-label="Marquer comme fait"></button>` : ''}
        </div>`;
}

function logSummary(log) {
    if (!log) {
        return '';
    }
    const flow = FLOWS.find(([k]) => k && k === log.flow)?.[1];
    return [log.mood, flow && `Flux ${flow.toLowerCase()}`, ...(log.symptoms || [])].filter(Boolean).join(' · ');
}

function renderDay() {
    const s = ui.selected;
    const t = D.today();
    $('#day-title').innerHTML = `<span>${s === t ? "Aujourd'hui" : esc(cap(D.longDate(s)))}</span>${s !== t ? '<button class="link" data-today>Revenir à aujourd’hui</button>' : ''}`;
    const rows = [];
    if (s === t) {
        overdueTasks(t).forEach(r => rows.push(reminderRow(r, s, rows.length, true)));
    }
    const c = cycleInfo();
    const cy = cycleKind(s, c, predictedStarts(c));
    if (cy?.kind === 'fert') {
        rows.push(`
            <div class="item" style="--col:var(--c)" data-goto-cycle>
                <div class="ico">${svg('i-sparkle')}</div>
                <div class="txt"><span>${cy.ovulation ? 'Ovulation estimée' : 'Fenêtre de fertilité'}</span><small>Estimation indicative</small></div>
            </div>`);
    } else if (cy) {
        rows.push(`
            <div class="item" style="--col:var(--a)" data-goto-cycle>
                <div class="ico">${svg('i-drop')}</div>
                <div class="txt"><span>${cy.day === 1 ? 'Début des règles' : `Règles · jour ${cy.day}`}</span><small>${cy.kind === 'pred' ? 'Prévision' : 'Noté'}</small></div>
            </div>`);
    }
    const log = logSummary(state.cycle.logs[s]);
    if (log) {
        rows.push(`
            <div class="item" style="--col:var(--a)" data-goto-cycle="${s}">
                <div class="ico">${svg('i-uterus')}</div>
                <div class="txt"><span>Journal</span><small>${esc(log)}</small></div>
            </div>`);
    }
    occurrences(s).forEach(r => rows.push(reminderRow(r, s, rows.length)));
    $('#day-list').innerHTML = rows.length ? rows.join('') : `<div class="empty">${svg('i-sparkle', 34)}Journée libre !</div>`;
    renderHabits();
}

function habitStreak(h) {
    let day = D.today();
    if (!h.log[day]) {
        day = D.addDays(day, -1);
    }
    let n = 0;
    while (h.log[day]) {
        n++;
        day = D.addDays(day, -1);
    }
    return n;
}

function renderHabits() {
    const s = ui.selected;
    $('#habits').innerHTML = state.habits.length
        ? state.habits.map((h, i) => {
            const streak = habitStreak(h);
            return `
                <div class="item ${h.log[s] ? 'done' : ''}" style="--col:var(--${h.color});animation-delay:${i * 50}ms" data-habit="${h.id}">
                    <div class="ico">${svg(h.icon)}</div>
                    <div class="txt"><span>${esc(h.name)}</span><small>${streak ? `🔥 ${streak} jour${streak > 1 ? 's' : ''} d’affilée` : 'Pas encore de série'}</small></div>
                    <button class="check" data-habit-check="${h.id}" aria-label="Fait"></button>
                </div>`;
        }).join('')
        : '<div class="empty small">Boire de l’eau, marcher, lire… ajoute une habitude à suivre chaque jour.</div>';
}

function habitForm(h) {
    const isNew = !h;
    const v = h || { name: '', icon: 'i-drop', color: 'c' };
    openSheet(`
        <h3>${isNew ? 'Nouvelle habitude' : 'Modifier l’habitude'}</h3>
        <form>
            <label class="field"><span>Quoi ?</span><input name="name" required maxlength="50" value="${esc(v.name)}" placeholder="Boire 1,5 L d’eau…"></label>
            <div class="field"><span>Icône</span><div class="pick">${HABIT_ICONS.map(ic => `<label><input type="radio" name="icon" value="${ic}" ${v.icon === ic ? 'checked' : ''}><span class="opt">${svg(ic, 22)}</span></label>`).join('')}</div></div>
            <div class="field"><span>Couleur</span><div class="pick">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${v.color === c ? 'checked' : ''}><span class="sw" style="background:var(--${c})"></span></label>`).join('')}</div></div>
            <div class="btns">${isNew ? '' : '<button type="button" class="btn-danger" data-del>Supprimer</button>'}<button class="btn-main">Enregistrer</button></div>
        </form>`,
        root => {
            const form = $('form', root);
            form.onsubmit = e => {
                e.preventDefault();
                const fd = new FormData(form);
                const data = { name: fd.get('name').trim(), icon: fd.get('icon') || v.icon, color: fd.get('color') || v.color };
                if (!data.name) {
                    return;
                }
                if (isNew) {
                    state.habits.push({ id: uid(), log: {}, ...data });
                } else {
                    Object.assign(h, data);
                }
                save();
                closeSheet();
                renderHabits();
            };
            $('[data-del]', root)?.addEventListener('click', () => confirmSheet('Supprimer l’habitude ?', `« ${h.name} » et sa série seront supprimés.`, 'Supprimer', () => {
                state.habits = state.habits.filter(x => x !== h);
                save();
                renderHabits();
            }));
        },
    );
}

function searchSheet() {
    openSheet(`
        <h3>Rechercher</h3>
        <label class="field"><input name="q" placeholder="Dentiste, cantine, vacances…" autocomplete="off" enterkeyhint="search"></label>
        <div id="results"></div>`,
        root => {
            const input = $('[name=q]', root);
            const results = $('#results', root);
            const t = D.today();
            input.oninput = () => {
                const q = normalize(input.value);
                if (q.length < 2) {
                    results.innerHTML = '';
                    return;
                }
                const hits = state.reminders
                    .filter(r => normalize(`${r.title} ${r.body || ''}`).includes(q))
                    .map(r => ({ r, date: D.nextOccurrence(r, t) || r.date }))
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .slice(0, 30);
                results.innerHTML = hits.length
                    ? hits.map(({ r, date }, i) => `
                        <div class="item" style="--col:var(--${r.color});animation-delay:${i * 30}ms" data-result="${date}">
                            <div class="ico">${svg(r.icon)}</div>
                            <div class="txt"><span>${esc(r.title)}</span><small>${cap(D.longDate(date))}${date < t ? ' (passé)' : ''}</small></div>
                        </div>`).join('')
                    : '<div class="empty small">Aucun résultat</div>';
            };
            results.onclick = e => {
                const date = e.target.closest('[data-result]')?.dataset.result;
                if (date) {
                    closeSheet();
                    go(0);
                    selectDate(date);
                }
            };
            setTimeout(() => input.focus(), 350);
        },
    );
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
                <label class="field"><span>Date ${isNote ? '' : '<button type="button" class="link" data-tomorrow>→ demain</button>'}</span><input type="date" name="date" required value="${v.date}"></label>
                ${isNote ? '' : `<label class="field"><span>Heure</span><input type="time" name="time" value="${v.time || ''}"></label>`}
            </div>
            ${isNote ? '' : `
            <label class="field"><span>Répétition</span><select name="repeat">${Object.entries(REPEATS).map(([val, label]) => `<option value="${val}" ${v.repeat === val ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <div class="field" data-days-field><span>Jours</span><div class="pick days">${WEEKDAYS.map(([d, letter, label]) => `<label><input type="checkbox" name="days" value="${d}" ${(v.days || []).includes(d) ? 'checked' : ''}><span class="opt" title="${label}">${letter}</span></label>`).join('')}</div></div>
            <label class="field"><span data-end-label></span><input type="date" name="endDate" value="${v.endDate || ''}"></label>`}
            <div class="field"><span>Icône</span><div class="pick">${REMINDER_ICONS.map(ic => `<label><input type="radio" name="icon" value="${ic}" ${v.icon === ic ? 'checked' : ''}><span class="opt">${svg(ic, 22)}</span></label>`).join('')}</div></div>
            <div class="field"><span>Couleur</span><div class="pick">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${v.color === c ? 'checked' : ''}><span class="sw" style="background:var(--${c})"></span></label>`).join('')}</div></div>
            <div class="btns">${isNew ? '' : '<button type="button" class="btn-danger" data-del>Supprimer</button>'}<button class="btn-main">Enregistrer</button></div>
        </form>`,
        root => {
            const form = $('form', root);
            const syncRepeat = () => {
                if (isNote) {
                    return;
                }
                const repeat = form.repeat.value;
                $('[data-days-field]', root).hidden = repeat !== 'days';
                $('[data-end-label]', root).textContent = repeat === 'none' ? 'Jusqu’au (sur plusieurs jours)' : 'Fin de la répétition (facultatif)';
            };
            form.repeat?.addEventListener('change', syncRepeat);
            syncRepeat();
            $('[data-tomorrow]', root)?.addEventListener('click', () => {
                form.date.value = D.addDays(D.today(), 1);
            });
            form.onsubmit = e => {
                e.preventDefault();
                const fd = new FormData(form);
                const data = {
                    title: fd.get('title').trim(),
                    date: fd.get('date'),
                    time: fd.get('time') || '',
                    repeat: fd.get('repeat') || 'none',
                    days: fd.getAll('days').map(Number),
                    endDate: fd.get('endDate') || '',
                    icon: fd.get('icon') || v.icon,
                    color: fd.get('color') || v.color,
                    body: (fd.get('body') || '').trim(),
                };
                if (!data.title || !data.date) {
                    return;
                }
                if (data.endDate && data.endDate <= data.date) {
                    data.endDate = '';
                }
                if (data.repeat === 'days' && !data.days.length) {
                    data.days = [D.parse(data.date).getDay()];
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
    const todo = list.items.filter(i => !i.done);
    const done = list.items.filter(i => i.done);
    const groups = list.byAisle
        ? AISLES.map(a => ({ title: `${a.emoji} ${a.label}`, items: todo.filter(i => (i.aisle || 'autre') === a.key) })).filter(g => g.items.length)
        : [{ title: '', items: todo }];
    if (done.length) {
        groups.push({ title: list.byAisle ? '✅ Dans le panier' : '', items: done });
    }
    let index = 0;
    const row = it => {
        const i = index++;
        const anim = animate === 'all' || (animate === 'first' && i === 0 && !it.done) ? `animation-delay:${animate === 'all' ? i * 30 : 0}ms` : 'animation:none';
        return `
            <div class="item ${it.done ? 'done' : ''}" style="--col:var(--c);${anim}" data-item="${it.id}">
                <div class="txt"><span>${esc(it.text)}</span></div>
                <button class="x" data-del="${it.id}" aria-label="Supprimer">${svg('i-x', 16)}</button>
                <button class="check" aria-label="Cocher"></button>
            </div>`;
    };
    $('#shop').innerHTML = list.items.length
        ? groups.map(g => `${g.title ? `<div class="aisle">${g.title}</div>` : ''}${g.items.map(row).join('')}`).join('')
            + '<div class="hint">Appui long sur un article pour le modifier</div>'
        : `<div class="empty">${svg('i-cart', 34)}Liste vide, ajoute ton premier article</div>`;
    $('#shop-actions').hidden = !list.items.length;
    updateProgress(list);
    renderSuggestions();
}

function renderSuggestions() {
    const list = activeList();
    const q = normalize($('#new-item').value);
    const present = new Set(list.items.filter(i => !i.done).map(i => normalize(i.text)));
    const hits = Object.entries(state.shopHistory)
        .filter(([key]) => !present.has(key) && (!q || key.includes(q)) && key !== q)
        .sort((a, b) => (q ? Number(b[0].startsWith(q)) - Number(a[0].startsWith(q)) : 0) || b[1].count - a[1].count)
        .slice(0, 8);
    $('#suggest').innerHTML = hits.length
        ? `<small>${q ? 'Suggestions' : 'Souvent achetés'}</small>${hits.map(([key, h]) => `<button type="button" class="chip" data-suggest="${esc(key)}">+ ${esc(h.text)}</button>`).join('')}`
        : '';
}

function addItem(text, aisle) {
    const list = activeList();
    const key = normalize(text);
    const known = state.shopHistory[key];
    const item = { id: uid(), text, done: false, aisle: aisle || known?.aisle || guessAisle(text) };
    list.items.unshift(item);
    state.shopHistory[key] = { text, aisle: item.aisle, count: (known?.count || 0) + 1 };
    save();
    renderCourses('first');
}

function itemForm(item) {
    openSheet(`
        <h3>Modifier l’article</h3>
        <form>
            <label class="field"><span>Article</span><input name="text" required maxlength="80" value="${esc(item.text)}"></label>
            <label class="field"><span>Rayon</span><select name="aisle">${AISLES.map(a => `<option value="${a.key}" ${(item.aisle || 'autre') === a.key ? 'selected' : ''}>${a.emoji} ${a.label}</option>`).join('')}</select></label>
            <div class="btns"><button type="button" class="btn-danger" data-del>Supprimer</button><button class="btn-main">Enregistrer</button></div>
        </form>`,
        root => {
            const form = $('form', root);
            form.onsubmit = e => {
                e.preventDefault();
                const fd = new FormData(form);
                const text = fd.get('text').trim();
                if (!text) {
                    return;
                }
                item.text = text;
                item.aisle = fd.get('aisle');
                const key = normalize(text);
                state.shopHistory[key] = { text, aisle: item.aisle, count: state.shopHistory[key]?.count || 1 };
                save();
                closeSheet();
                renderCourses('none');
            };
            $('[data-del]', root).onclick = () => {
                const list = activeList();
                list.items = list.items.filter(i => i !== item);
                save();
                closeSheet();
                renderCourses('none');
            };
        },
    );
}

async function shareList() {
    const list = activeList();
    const todo = list.items.filter(i => !i.done);
    const lines = list.byAisle
        ? AISLES.flatMap(a => {
            const items = todo.filter(i => (i.aisle || 'autre') === a.key);
            return items.length ? [`${a.emoji} ${a.label}`, ...items.map(i => `- ${i.text}`)] : [];
        })
        : todo.map(i => `- ${i.text}`);
    const text = `🛒 ${list.name}\n${lines.join('\n')}`;
    if (navigator.share) {
        try {
            await navigator.share({ title: list.name, text });
        } catch {
        }
        return;
    }
    navigator.clipboard?.writeText(text).then(() => toast('Liste copiée'), () => toast('Partage impossible'));
}

function listForm(list) {
    const isNew = !list;
    openSheet(`
        <h3>${isNew ? 'Nouvelle liste' : 'Modifier la liste'}</h3>
        <form>
            <label class="field"><span>Nom</span><input name="name" required maxlength="40" value="${esc(list?.name)}" placeholder="Marché, Pharmacie…"></label>
            <label class="switch"><span>Trier par rayon<small>Fruits & légumes, frais, épicerie…</small></span><input type="checkbox" name="byAisle" ${list?.byAisle ? 'checked' : ''}></label>
            <div class="btns">${!isNew && state.lists.length > 1 ? '<button type="button" class="btn-danger" data-del>Supprimer</button>' : ''}<button class="btn-main">Enregistrer</button></div>
        </form>`,
        root => {
            const form = $('form', root);
            form.onsubmit = e => {
                e.preventDefault();
                const fd = new FormData(form);
                const name = fd.get('name').trim();
                const byAisle = fd.get('byAisle') === 'on';
                if (!name) {
                    return;
                }
                if (isNew) {
                    const created = { id: uid(), name, items: [], byAisle };
                    state.lists.push(created);
                    state.activeList = created.id;
                } else {
                    list.name = name;
                    list.byAisle = byAisle;
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

function renderCycle() {
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
    const history = c.starts.map((s, i) => ({ s, gap: i ? D.diffDays(c.starts[i - 1], s) : null })).slice(-12).reverse();
    const fertile = fertileWindow(c);
    const fertileText = fertile
        ? `${D.rangeLabel(fertile.from, fertile.to)}`
        : '';
    const log = state.cycle.logs[ui.logDate] || {};
    const journal = `
        <div class="journal">
            <div class="journal-head">
                <button class="nav" data-log-shift="-1" aria-label="Jour précédent">${svg('i-left', 16)}</button>
                <b>Journal · ${ui.logDate === t ? 'aujourd’hui' : esc(D.longDate(ui.logDate))}</b>
                <button class="nav" data-log-shift="1" aria-label="Jour suivant" ${ui.logDate >= t ? 'disabled' : ''}>${svg('i-right', 16)}</button>
            </div>
            <div class="label">Flux</div>
            <div class="tags">${FLOWS.map(([k, label]) => `<button class="tag ${(log.flow || '') === k ? 'on' : ''}" data-flow="${k}">${label}</button>`).join('')}</div>
            <div class="label">Symptômes</div>
            <div class="tags">${SYMPTOMS.map(sym => `<button class="tag ${(log.symptoms || []).includes(sym) ? 'on' : ''}" data-symptom="${sym}">${sym}</button>`).join('')}</div>
            <div class="label">Humeur</div>
            <div class="tags moods">${MOODS.map(([emoji, label]) => `<button class="tag ${log.mood === emoji ? 'on' : ''}" data-mood="${emoji}" title="${label}"><span>${emoji}</span>${label}</button>`).join('')}</div>
        </div>`;
    $('#cycle-body').innerHTML = `
        <div class="cycle">
            <div class="hello">Prochaines règles</div>
            <div class="big">${big}</div>
            <div class="hello">${sub}</div>
            <div class="meta">
                <span>${c.measured ? `Cycle moyen ${c.avg} j` : `Cycle ${c.avg} j par défaut`}</span>
                <span class="stepper">Durée <button data-len="-1" aria-label="Moins">−</button>${c.len} j<button data-len="1" aria-label="Plus">+</button></span>
            </div>
            ${fertileText ? `<div class="fert-line">${svg('i-sparkle', 14)} Fenêtre fertile estimée ${fertileText}</div>` : ''}
            <button class="go" data-period>Mes règles ont commencé</button>
        </div>
        ${journal}
        <div class="section">Historique</div>
        ${history.length ? history.map((h, i) => `
            <div class="item" style="--col:var(--a);animation-delay:${i * 40}ms">
                <div class="ico">${svg('i-drop')}</div>
                <div class="txt"><span>${cap(D.longDate(h.s))} ${h.s.slice(0, 4)}</span>${h.gap ? `<small>Cycle de ${h.gap} jours</small>` : ''}</div>
                <button class="x" data-period-del="${h.s}" aria-label="Retirer">${svg('i-x', 16)}</button>
            </div>`).join('') : `<div class="empty">${svg('i-uterus', 34)}Aucune date notée pour l’instant</div>`}
        <p class="fine">Les prévisions se basent sur la moyenne de tes 6 derniers cycles.${fertileText ? '<br>La fenêtre de fertilité est une estimation indicative, pas une méthode de contraception.' : ''}</p>`;
    if (state.cycleInVault) {
        $('#cycle-body').insertAdjacentHTML('afterbegin', `<div class="banner" style="--col:var(--b);--col2:var(--b2)" data-goto-vault><div class="bi">${svg('i-lock', 24)}</div><div><b>Ton historique est dans le coffre</b><small>Ouvre-le une fois pour le rapatrier ici</small></div></div>`);
    }
}

function renderVaultContent() {
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
        await migrateCycleFromVault();
        setTimeout(() => {
            renderVault();
            renderCycle();
            renderPlanning();
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
    const blob = creating ? await V.create(pin, { entries: [] }) : await V.rekey(pin);
    setBusy(false);
    state.vault = { ...blob, pinLen: pin.length };
    save();
    ui.pin = '';
    ui.pinFirst = '';
    ui.pinMode = 'unlock';
    ui.lastActivity = Date.now();
    renderVault();
    toast(creating ? 'Coffre créé 🔒' : 'Code modifié');
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
            $('form', root).onsubmit = e => {
                e.preventDefault();
                const date = new FormData(e.target).get('date');
                closeSheet();
                if (!date) {
                    return;
                }
                if (!state.cycle.periods.includes(date)) {
                    state.cycle.periods.push(date);
                    state.cycle.periods.sort();
                }
                save();
                renderCycle();
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
    state.lastBackup = D.today();
    save();
    renderBanners();
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
        <div class="field"><span>Apparence</span><div class="segmented">${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, label]) => `<label><input type="radio" name="appearance" value="${k}" ${(state.settings.appearance || 'auto') === k ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></div>
        <label class="switch"><span>Fenêtre de fertilité<small>Estimation affichée dans le calendrier et l’onglet Cycle</small></span><input type="checkbox" name="showFertility" ${state.settings.showFertility ? 'checked' : ''}></label>
        <div class="field"><span>Agenda</span>
            <div class="btns"><button type="button" class="btn-ghost" data-ics>${svg('i-cal', 18)} Importer un agenda (.ics)</button></div>
            <input type="file" accept=".ics,text/calendar" hidden data-ics-file>
        </div>
        <div class="field"><span>Sauvegarde de l’app</span>
            <div class="btns"><button type="button" class="btn-ghost" data-export>${svg('i-down', 18)} Exporter</button><button type="button" class="btn-ghost" data-import>${svg('i-up', 18)} Importer</button></div>
            <input type="file" accept="application/json,.json" hidden data-file>
            <p class="fine">${state.lastBackup ? `Dernière sauvegarde le ${D.shortDate(state.lastBackup)}` : 'Aucune sauvegarde pour l’instant'}</p>
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
            root.querySelectorAll('[name=appearance]').forEach(r => {
                r.onchange = () => {
                    state.settings.appearance = r.value;
                    save();
                    applyTheme();
                };
            });
            $('[name=showFertility]', root).onchange = e => {
                state.settings.showFertility = e.target.checked;
                save();
                renderPlanning();
                renderCycle();
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
            <button style="background:linear-gradient(135deg,var(--a),var(--a2))" data-add="period">${svg('i-uterus', 30)}Début règles</button>
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
                    periodForm();
                }
            };
        },
    );
}

function renderAll() {
    renderPlanning();
    renderCourses();
    renderCycle();
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
        const banner = e.target.closest('.banner');
        if (banner?.dataset.action === 'backup') {
            exportData();
        } else if (banner?.dataset.date) {
            selectDate(banner.dataset.date);
        }
    };
    $('#open-search').onclick = searchSheet;
    $('#habit-new').onclick = () => habitForm(null);
    $('#habits').onclick = e => {
        const check = e.target.closest('[data-habit-check]');
        const row = e.target.closest('[data-habit]');
        if (!row) {
            return;
        }
        const h = state.habits.find(x => x.id === row.dataset.habit);
        if (!check) {
            habitForm(h);
            return;
        }
        const s = ui.selected;
        if (h.log[s]) {
            delete h.log[s];
        } else {
            h.log[s] = true;
        }
        save();
        const streak = habitStreak(h);
        row.classList.toggle('done', !!h.log[s]);
        $('small', row).textContent = streak ? `🔥 ${streak} jour${streak > 1 ? 's' : ''} d’affilée` : 'Pas encore de série';
        if (h.log[s] && [7, 30, 100, 365].includes(streak)) {
            confetti();
            toast(`🔥 ${streak} jours d’affilée !`);
        }
    };
    $('#day-title').onclick = e => {
        if (e.target.closest('[data-today]')) {
            selectDate(D.today());
        }
    };
    $('#day-list').onclick = e => {
        const snooze = e.target.closest('[data-snooze]');
        if (snooze) {
            const r = state.reminders.find(x => x.id === snooze.dataset.snooze);
            r.date = D.addDays(D.today(), 1);
            save();
            renderPlanning();
            toast('Reporté à demain');
            return;
        }
        const cycleRow = e.target.closest('[data-goto-cycle]');
        if (cycleRow) {
            ui.logDate = cycleRow.dataset.gotoCycle || ui.logDate;
            renderCycle();
            go(2);
            return;
        }
        const check = e.target.closest('[data-check]');
        if (check) {
            const r = state.reminders.find(x => x.id === check.dataset.check);
            const s = check.dataset.on || ui.selected;
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
        input.value = '';
        addItem(text);
    };
    $('#new-item').oninput = renderSuggestions;
    $('#suggest').addEventListener('pointerdown', e => e.preventDefault());
    $('#suggest').onclick = e => {
        const key = e.target.closest('[data-suggest]')?.dataset.suggest;
        const known = key && state.shopHistory[key];
        if (known) {
            $('#new-item').value = '';
            addItem(known.text, known.aisle);
        }
    };
    $('#shop').addEventListener('contextmenu', e => {
        const row = e.target.closest('[data-item]');
        if (!row) {
            return;
        }
        e.preventDefault();
        const item = activeList().items.find(i => i.id === row.dataset.item);
        if (item) {
            itemForm(item);
        }
    });
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
        if (action === 'share') {
            shareList();
            return;
        }
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

    $('#cycle-body').onclick = e => {
        const t = e.target;
        if (t.closest('[data-period]')) {
            periodForm();
            return;
        }
        if (t.closest('[data-goto-vault]')) {
            go(VAULT_TAB);
            return;
        }
        const shift = t.closest('[data-log-shift]');
        if (shift) {
            const next = D.addDays(ui.logDate, Number(shift.dataset.logShift));
            if (next <= D.today()) {
                ui.logDate = next;
                renderCycle();
            }
            return;
        }
        const tag = t.closest('.journal .tag');
        if (tag) {
            const logs = state.cycle.logs;
            const log = logs[ui.logDate] || { flow: '', symptoms: [], mood: '' };
            if ('flow' in tag.dataset) {
                log.flow = tag.dataset.flow;
                tag.parentElement.querySelectorAll('.tag').forEach(b => b.classList.toggle('on', b === tag));
            } else if ('mood' in tag.dataset) {
                log.mood = log.mood === tag.dataset.mood ? '' : tag.dataset.mood;
                tag.parentElement.querySelectorAll('.tag').forEach(b => b.classList.toggle('on', b.dataset.mood === log.mood));
            } else {
                const sym = tag.dataset.symptom;
                log.symptoms = log.symptoms.includes(sym) ? log.symptoms.filter(x => x !== sym) : [...log.symptoms, sym];
                tag.classList.toggle('on', log.symptoms.includes(sym));
            }
            if (log.flow || log.mood || log.symptoms.length) {
                logs[ui.logDate] = log;
            } else {
                delete logs[ui.logDate];
            }
            save();
            renderDay();
            return;
        }
        const del = t.closest('[data-period-del]');
        const len = t.closest('[data-len]');
        if (del) {
            state.cycle.periods = state.cycle.periods.filter(p => p !== del.dataset.periodDel);
        } else if (len) {
            state.cycle.periodLen = Math.min(10, Math.max(2, state.cycle.periodLen + Number(len.dataset.len)));
        } else {
            return;
        }
        save();
        renderCycle();
        renderPlanning();
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
                'Sans le code, impossible de lire le coffre. Tu peux le vider pour repartir de zéro : tes numéros seront effacés définitivement.',
                'Vider le coffre',
                () => {
                    state.vault = null;
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
darkQuery.addEventListener('change', applyTheme);
bindEvents();
renderAll();
go(0);

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.().catch(() => {});
