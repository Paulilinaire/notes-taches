export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const pad = n => String(n).padStart(2, '0');

export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parse = s => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
};

export const today = () => iso(new Date());

export const addDays = (s, n) => {
    const d = parse(s);
    d.setDate(d.getDate() + n);
    return iso(d);
};

export const diffDays = (from, to) => Math.round((parse(to) - parse(from)) / 86400000);

export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export const longDate = s => {
    const d = parse(s);
    return `${DAYS[d.getDay()]} ${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]}`;
};

export const shortDate = s => {
    const d = parse(s);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
};

const sameDayOfMonth = (start, d) => d.getDate() === Math.min(start.getDate(), daysInMonth(d.getFullYear(), d.getMonth()));

export function occursOn(reminder, s) {
    if (s < reminder.date) {
        return false;
    }
    const start = parse(reminder.date);
    const d = parse(s);
    switch (reminder.repeat) {
        case 'weekly':
            return diffDays(reminder.date, s) % 7 === 0;
        case 'monthly':
            return sameDayOfMonth(start, d);
        case 'yearly':
            return d.getMonth() === start.getMonth() && sameDayOfMonth(start, d);
        default:
            return s === reminder.date;
    }
}
