import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {DBusEventSource} from 'resource:///org/gnome/shell/ui/calendar.js';
import {Card} from './card.js';
import {monthGrid, weekGrid, weekStartDay} from './policy.js';

const WIDTH = 280;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const time = date => date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});

// Month grid with a dot under days that have events; the selected day's events listed below.
// Events come from GNOME's calendar server, the same source as the top bar's date menu.
export const CalendarCard = GObject.registerClass(class CalendarCard extends Card {
    _init(name, settings, ext) {
        super._init(name, settings, ext);
        this.body.natural_width = this.px(WIDTH);
        // Same first weekday as the top bar's calendar: the desktop setting, else the locale.
        this._desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.calendar'});
        const readWeekStart = () => {
            this._weekStart = weekStartDay(this._desktop.get_enum('week-start-day'), Shell.util_get_week_start());
        };
        readWeekStart();
        this._weekStartChanged = this._desktop.connect('changed::week-start-day', () => {
            readWeekStart();
            this._render();
        });
        this._selected = addDays(new Date(), 0);
        this._month = new Date(this._selected.getFullYear(), this._selected.getMonth(), 1);
        const header = this._header = new St.BoxLayout();
        this._title = new St.Label({style_class: 'charcoal-cal-header', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        header.add_child(this._title);
        for (const [label, step] of [['‹', -1], ['›', 1]]) {
            const button = new St.Button({label, style_class: 'charcoal-cal-nav', accessible_name: step < 0 ? 'Previous' : 'Next'});
            button.connect('clicked', () => {
                if (this.layout.mode === 'week') {
                    this._selected = addDays(this._selected, step * 7);
                    this._month = new Date(this._selected.getFullYear(), this._selected.getMonth(), 1);
                } else {
                    this._month = new Date(this._month.getFullYear(), this._month.getMonth() + step, 1);
                    this._selected = new Date(this._month);
                }
                this._render();
            });
            header.add_child(button);
        }
        this._grid = new Clutter.GridLayout();
        const grid = new St.Widget({layout_manager: this._grid, style: `margin-top: ${this.px(8)}px;`});
        this._gridActor = grid;
        this._events = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: `margin-top: ${this.px(8)}px; spacing: ${this.px(2)}px;`});
        this._summary = new St.BoxLayout({style: `spacing: ${this.px(12)}px;`});
        this._date = new St.Label({style_class: 'charcoal-widget-big', y_align: Clutter.ActorAlign.CENTER});
        const dateInfo = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._weekday = new St.Label({style_class: 'charcoal-widget-title'});
        this._monthLabel = new St.Label({style_class: 'charcoal-widget-dim'});
        dateInfo.add_child(this._weekday);
        dateInfo.add_child(this._monthLabel);
        this._summary.add_child(this._date);
        this._summary.add_child(dateInfo);
        this._agenda = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._agenda.add_child(this._summary);
        this._agenda.add_child(this._events);
        this._content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        this._content.add_child(grid);
        this._content.add_child(this._agenda);
        for (const child of [header, this._content])
            this.body.add_child(child);
        this._source = new DBusEventSource();
        // The source can emit 'changed' from inside requestRange (during a render): render once, later.
        this._sourceChanged = this._source.connect('changed', () => {
            this._pendingRender ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._pendingRender = 0;
                this._render();
                return GLib.SOURCE_REMOVE;
            });
        });
        this.connect('destroy', () => {
            if (this._pendingRender) GLib.Source.remove(this._pendingRender);
            GLib.Source.remove(this._dayTimer);
            this._desktop.disconnect(this._weekStartChanged);
            this._source.disconnect(this._sourceChanged);
            this._source.destroy();
        });
        this._today = addDays(new Date(), 0);
        this._dayTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            if (this.shown) this._checkDay();
            return GLib.SOURCE_CONTINUE;
        });
        this.onLayoutChanged();
    }

    onLayoutChanged() {
        const {mode, sideBySide, summary, events} = this.layout;
        this._header.visible = mode !== 'compact';
        this._gridActor.visible = mode !== 'compact';
        this._summary.visible = summary;
        this._events.visible = events > 0;
        this._content.orientation = sideBySide ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL;
        this._content.set_style(sideBySide ? `spacing: ${this.px(20)}px;` : '');
        this._gridActor.x_expand = !sideBySide;
        this._render();
    }

    _checkDay() {
        const today = addDays(new Date(), 0);
        if (sameDay(today, this._today)) {
            this._renderEvents();
            return;
        }
        if (sameDay(this._selected, this._today)) {
            this._selected = today;
            this._month = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        this._today = today;
        this._render();
    }

    // Today rolls over at midnight; re-render whenever the desktop is shown. When hidden, go back to
    // the current month: the calendar server watches one range, shared with the date menu.
    onShown(shown) {
        this._checkDay();
        if (!shown) {
            const today = new Date();
            this._month = new Date(today.getFullYear(), today.getMonth(), 1);
            this._selected = addDays(today, 0);
        }
        this._render();
    }

    _render() {
        const today = new Date();
        this._date.text = `${this._selected.getDate()}`;
        this._weekday.text = this._selected.toLocaleDateString(undefined, {weekday: 'long'});
        this._monthLabel.text = this._selected.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
        this._title.text = this._month.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
        this._gridActor.destroy_all_children();
        const month = monthGrid(this._month.getFullYear(), this._month.getMonth(), this._weekStart);
        this._source.requestRange(month[0].date, addDays(month.at(-1).date, 1));
        if (this.layout.mode === 'compact') {
            this._renderEvents();
            return;
        }
        for (let i = 0; i < 7; i++) {
            // Nov 1 2026 is a Sunday: day i of the week, from the locale's first day.
            const day = new Date(2026, 10, 1 + (this._weekStart + i) % 7);
            this._grid.attach(new St.Label({text: day.toLocaleDateString(undefined, {weekday: 'narrow'}),
                style_class: 'charcoal-cal-weekday', x_expand: true}), i, 0, 1, 1);
        }
        const cells = this.layout.mode === 'week'
            ? weekGrid(this._selected, this._weekStart).map(date => ({date, inMonth: date.getMonth() === this._month.getMonth()}))
            : month;
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
                this._month = new Date(date.getFullYear(), date.getMonth(), 1);
                this._render();
            });
            this._grid.attach(button, i % 7, 1 + Math.floor(i / 7), 1, 1);
        });
        this._renderEvents();
    }

    _renderEvents() {
        this._events.destroy_all_children();
        const begin = this._selected, end = addDays(begin, 1);
        const now = new Date();
        const events = this._source.getEvents(begin, end)
            .filter(event => !sameDay(begin, now) || event.end > now);
        const line = (text, dim) => this._events.add_child(new St.Label({text,
            style_class: `charcoal-cal-event${dim ? ' charcoal-widget-dim' : ''}`}));
        const max = this.layout.events;
        if (!max) return;
        if (!events.length)
            line(sameDay(begin, now) ? 'No more events today' : 'No events', true);
        // A single compact line always shows the next event. Larger agendas reserve one
        // of their available rows for the overflow count rather than spilling out of the card.
        const shown = events.length > max && max > 1 ? max - 1 : max;
        for (const event of events.slice(0, shown)) {
            const allDay = event.date <= begin && event.end >= end;
            line(`${allDay ? 'All day' : time(event.date)}  ${event.summary}`, false);
        }
        if (events.length > shown && max > 1)
            line(`+${events.length - shown} more`, true);
    }
});
