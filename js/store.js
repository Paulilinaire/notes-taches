const KEY = 'nt-state';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const defaults = () => ({
    version: 1,
    createdAt: todayIso(),
    lastBackup: null,
    settings: { name: '', theme: 'bonbon', appearance: 'auto', showFertility: true },
    reminders: [],
    habits: [],
    lists: [{ id: uid(), name: 'Courses', items: [], byAisle: false }],
    activeList: null,
    shopHistory: {},
    vault: null,
    cycle: { periods: [], periodLen: 5, logs: {} },
    cycleInVault: false,
});

function normalize(raw) {
    const base = defaults();
    const merged = {
        ...base,
        ...raw,
        settings: { ...base.settings, ...(raw.settings || {}) },
        cycle: { ...base.cycle, ...(raw.cycle || {}) },
        cycleInVault: raw.cycleInVault ?? (!raw.cycle && !!raw.vault),
    };
    delete merged.settings.cycleHint;
    if (!Array.isArray(merged.cycle.periods)) {
        merged.cycle.periods = [];
    }
    if (!Array.isArray(merged.lists) || !merged.lists.length) {
        merged.lists = base.lists;
    }
    if (!Array.isArray(merged.reminders)) {
        merged.reminders = [];
    }
    if (!Array.isArray(merged.habits)) {
        merged.habits = [];
    }
    if (!merged.cycle.logs || typeof merged.cycle.logs !== 'object') {
        merged.cycle.logs = {};
    }
    if (!merged.shopHistory || typeof merged.shopHistory !== 'object') {
        merged.shopHistory = {};
    }
    return merged;
}

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
            return normalize(JSON.parse(raw));
        }
    } catch {
    }
    return defaults();
}

export const state = load();

export function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
        return true;
    } catch {
        return false;
    }
}

export function isValidBackup(data) {
    return data && typeof data === 'object' && data.settings && Array.isArray(data.lists) && Array.isArray(data.reminders);
}

export function replaceState(data) {
    const next = normalize(data);
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, next);
    save();
}
