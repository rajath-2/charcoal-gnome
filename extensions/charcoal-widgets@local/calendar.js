import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {DBusEventSource} from 'resource:///org/gnome/shell/ui/calendar.js';
import {Card} from './card.js';
import {monthGrid} from './policy.js';

const MAX_EVENTS = 3;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const time = date => date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});

// Month grid with a dot under days that have events; the selected day's events listed below.
// Events come from GNOME's calendar server, the same source as the top bar's date menu.
export const CalendarCard = GObject.registerClass(class CalendarCard extends Card {
    _init(name, settings, ext) {
        super._init(name, settings, ext);
        this._weekStart = Shell.util_get_week_start();
        this._selected = addDays(new Date(), 0);
        this._month = new Date(this._selected.getFullYear(), this._selected.getMonth(), 1);
        const header = new St.BoxLayout();
        this._title = new St.Label({style_class: 'charcoal-cal-header', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        header.add_child(this._title);
        for (const [label, step] of [['‹', -1], ['›', 1]]) {
            const button = new St.Button({label, style_class: 'charcoal-cal-nav', accessible_name: step < 0 ? 'Previous month' : 'Next month'});
            button.connect('clicked', () => {
                this._month = new Date(this._month.getFullYear(), this._month.getMonth() + step, 1);
                this._render();
            });
            header.add_child(button);
        }
        this._grid = new Clutter.GridLayout();
        const grid = new St.Widget({layout_manager: this._grid, style: 'margin-top: 8px;'});
        this._gridActor = grid;
        this._events = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: 'margin-top: 8px; spacing: 2px;'});
        for (const child of [header, grid, this._events])
            this.body.add_child(child);
        this._source = new DBusEventSource();
        this._sourceChanged = this._source.connect('changed', () => this._render());
        this.connect('destroy', () => {
            this._source.disconnect(this._sourceChanged);
            this._source.destroy();
        });
        this._render();
    }

    // Today rolls over at midnight; re-render whenever the desktop is shown.
    onShown(shown) {
        if (shown)
            this._render();
    }

    _render() {
        const today = new Date();
        this._title.text = this._month.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
        this._gridActor.destroy_all_children();
        for (let i = 0; i < 7; i++) {
            // Nov 1 2026 is a Sunday: day i of the week, from the locale's first day.
            const day = new Date(2026, 10, 1 + (this._weekStart + i) % 7);
            this._grid.attach(new St.Label({text: day.toLocaleDateString(undefined, {weekday: 'narrow'}),
                style_class: 'charcoal-cal-weekday', x_expand: true}), i, 0, 1, 1);
        }
        const cells = monthGrid(this._month.getFullYear(), this._month.getMonth(), this._weekStart);
        this._source.requestRange(cells[0].date, addDays(cells.at(-1).date, 1));
        cells.forEach(({date, inMonth}, i) => {
            const classes = ['charcoal-cal-day'];
            if (!inMonth) classes.push('charcoal-cal-other');
            if (sameDay(date, today)) classes.push('charcoal-cal-today');
            if (sameDay(date, this._selected)) classes.push('charcoal-cal-selected');
            const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_align: Clutter.ActorAlign.CENTER});
            box.add_child(new St.Label({text: `${date.getDate()}`, x_align: Clutter.ActorAlign.CENTER}));
            const dot = new St.Widget({style_class: 'charcoal-cal-dot', x_align: Clutter.ActorAlign.CENTER});
            dot.opacity = this._source.hasEvents(date) ? 255 : 0;
            box.add_child(dot);
            const button = new St.Button({child: box, style_class: classes.join(' '),
                accessible_name: date.toLocaleDateString()});
            button.connect('clicked', () => {
                this._selected = date;
                this._render();
            });
            this._grid.attach(button, i % 7, 1 + Math.floor(i / 7), 1, 1);
        });
        this._renderEvents();
    }

    _renderEvents() {
        this._events.destroy_all_children();
        const begin = this._selected, end = addDays(begin, 1);
        const events = this._source.getEvents(begin, end);
        const line = (text, dim) => this._events.add_child(new St.Label({text,
            style_class: `charcoal-cal-event${dim ? ' charcoal-widget-dim' : ''}`}));
        if (!events.length)
            line('No events', true);
        for (const event of events.slice(0, MAX_EVENTS)) {
            const allDay = event.date <= begin && event.end >= end;
            line(`${allDay ? 'All day' : time(event.date)}  ${event.summary}`, false);
        }
        if (events.length > MAX_EVENTS)
            line(`+${events.length - MAX_EVENTS} more`, true);
    }
});
