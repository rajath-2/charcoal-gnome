import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {loadRemoteSearchProviders} from 'resource:///org/gnome/shell/ui/remoteSearch.js';
import {QueryGeneration, rgbaOf, SEARCH_ORDER, softwareAppId} from './policy.js';
import {animate, color, surfaceStyle, addBlur, keepOnTop} from './appearance.js';

const PROVIDERS = {
    'org.gnome.Calculator.desktop': ['calculator', 'Calculator'],
    'org.gnome.Nautilus.desktop': ['files', 'Files'],
    'org.gnome.Settings.desktop': ['settings', 'Settings'],
    'org.gnome.Software.desktop': ['software', 'Software'],
};
function call(proxy, method, args, cancellable) {
    return new Promise((resolve, reject) => proxy.call(method, args, Gio.DBusCallFlags.NONE, 2000,
        cancellable, (source, result) => {
            try { resolve(source.call_finish(result).deepUnpack()[0]); }
            catch (error) { reject(error); }
        }));
}

export class SearchLauncher {
    constructor(settings, openPreferences) {
        this.settings = settings;
        this.openPreferences = openPreferences;
        this.searchSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.search-providers'});
        this.generation = new QueryGeneration();
        this.isOpen = false;
        this.debounce = 0;
        this.layoutSource = 0;
        this.closing = new Set();
    }
    toggle() { this.isOpen ? this.close() : this.open(); }
    open() {
        if (this.isOpen) return;
        this.close(true);
        const [x, y] = global.get_pointer();
        this.monitor = Main.layoutManager.monitors.find(m => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
            ?? Main.layoutManager.primaryMonitor;
        if (!this.monitor) return;
        Main.overview.hide();
        this.isOpen = true;
        this.selected = 0;
        this.rows = [];
        this.groups = new Map();
        this.providers = loadRemoteSearchProviders(this.searchSettings).filter(p => PROVIDERS[p.id]);
        this.actor = new St.Widget({reactive: true, x: 0, y: 0, width: global.stage.width,
            height: global.stage.height, style: 'background-color: rgba(0,0,0,0.16);'});
        this.panel = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            reactive: true, style_class: 'charcoal-search', style: surfaceStyle(this.settings)});

        this.entry = new St.Entry({style_class: 'charcoal-search-entry',
            hint_text: 'Search apps, files, calculations…', can_focus: true, x_expand: true});
        this.entry.set_primary_icon(new St.Icon({icon_name: 'system-search-symbolic', icon_size: 18}));
        this.panel.add_child(this.entry);
        this.scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, x_expand: true});
        this.resultBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'charcoal-results', x_expand: true});
        this.scroll.set_child(this.resultBox);
        this.panel.add_child(this.scroll);
        const footer = new St.BoxLayout({x_expand: true});
        footer.add_child(new St.Label({text: '↑ ↓ Choose    Enter Open / Copy    Esc Close',
            style_class: 'charcoal-hint', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const prefs = new St.Button({child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16}),
            accessible_name: 'Launcher preferences', can_focus: true});
        prefs.connect('clicked', () => { this.close(); this.openPreferences(); });
        footer.add_child(prefs);
        this.panel.add_child(footer);
        this.backdrop = new St.Widget({width: global.stage.width, height: global.stage.height, reactive: false});
        this.actor.add_child(this.backdrop);
        addBlur(this.backdrop, this.settings);
        this.actor.add_child(this.panel);
        Main.layoutManager.addTopChrome(this.actor);
        keepOnTop(this.actor);
        this.actor.connect('captured-event', (_, event) => this._event(event));
        this.entry.clutter_text.connect('text-changed', () => this._schedule());
        this.modal = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
        global.stage.set_key_focus(this.entry.clutter_text);
        this._query();
        this._place();
        // Grow after the first frame: building the app list makes it slow enough to swallow the animation.
        this.panel.opacity = 0;
        this.paintSource = global.stage.connect('after-paint', () => {
            global.stage.disconnect(this.paintSource); this.paintSource = 0;
            if (this.isOpen) animate(this.panel, this.settings, true);
        });
    }
    _event(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
            const [x, y] = event.get_coords();
            const [px, py] = this.panel.get_transformed_position();
            const [pw, ph] = this.panel.get_transformed_size();
            if (x < px || y < py || x > px + pw || y > py + ph) { this.close(); return Clutter.EVENT_STOP; }
        }
        if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Escape) { this.close(); return Clutter.EVENT_STOP; }
        if ([Clutter.KEY_Up, Clutter.KEY_Down].includes(key)) {
            if (this.rows.length) {
                this.selected = (this.selected + (key === Clutter.KEY_Up ? -1 : 1) + this.rows.length) % this.rows.length;
                this._highlight();
            }
            return Clutter.EVENT_STOP;
        }
        if ([Clutter.KEY_Return, Clutter.KEY_KP_Enter].includes(key)) {
            this._activate(this.rows[this.selected]?.result);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
    _schedule() {
        this.generation.next();
        this.cancellable?.cancel();
        if (this.debounce) GLib.Source.remove(this.debounce);
        // Clear stale actionable rows immediately, even during debounce.
        this.groups.clear(); this.selected = 0; this._render('Searching…');
        this.debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this.debounce = 0; this._query(); return GLib.SOURCE_REMOVE;
        });
    }
    _query() {
        if (!this.isOpen) return;
        const generation = this.generation.next();
        this.cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this.cancellable = cancellable;
        const text = this.entry.get_text().trim();
        const terms = text.split(/\s+/).filter(Boolean);
        const limit = this.settings.get_int('result-limit');
        this.groups.clear();
        const apps = Shell.AppSystem.get_default();
        if (!text) {
            this.groups.set('favorites', {title: 'Favorites', results: this.settings.get_strv('favorites')
                .map(id => apps.lookup_app(id)).filter(Boolean).map(app => this._appResult(app))});
            if (this.settings.get_boolean('search-apps')) {
                const pinned = new Set(this.settings.get_strv('favorites'));
                const all = apps.get_installed().filter(info => info.should_show() && !pinned.has(info.get_id()))
                    .sort((a,b) => a.get_name().localeCompare(b.get_name()));
                this.groups.set('apps', {title: 'All applications', results: all.map(info => apps.lookup_app(info.get_id()))
                    .filter(Boolean).map(app => this._appResult(app))});
            }
            this._render('Start typing to search');
            return;
        }
        if (this.settings.get_boolean('search-apps')) {
            const lower = terms.map(t => t.toLocaleLowerCase());
            const matches = apps.get_installed().filter(info => info.should_show() && lower.every(term =>
                [info.get_name(), info.get_id(), info.get_description(), ...(info.get_keywords?.() ?? [])]
                    .filter(Boolean).join(' ').toLocaleLowerCase().includes(term)));
            matches.sort((a, b) => Number(b.get_name().toLocaleLowerCase().startsWith(text.toLocaleLowerCase())) -
                Number(a.get_name().toLocaleLowerCase().startsWith(text.toLocaleLowerCase())) || a.get_name().localeCompare(b.get_name()));
            this.groups.set('apps', {title: 'Applications', results: matches.slice(0, limit)
                .map(info => apps.lookup_app(info.get_id())).filter(Boolean).map(app => this._appResult(app))});
        }
        for (const [id, [category, title]] of Object.entries(PROVIDERS)) {
            if (!this.settings.get_boolean(`search-${category}`)) continue;
            const provider = this.providers.find(p => p.id === id);
            this.groups.set(category, {title, results: [], status: provider ? 'Searching…' : 'Unavailable or disabled in GNOME Search settings'});
            if (provider) this._providerQuery(provider, category, title, terms, limit, generation, cancellable);
        }
        this._render('No results');
    }
    _appResult(app) {
        return {id: app.get_id(), name: app.get_name(), detail: 'Open application',
            icon: size => app.create_icon_texture(size), activate: () => app.activate()};
    }
    async _providerQuery(provider, category, title, terms, limit, generation, cancellable) {
        try {
            const found = await call(provider.proxy, 'GetInitialResultSet', new GLib.Variant('(as)', [terms]), cancellable);
            const ids = category === 'software' ? found.slice(0, limit * 3) : found;
            // Software also returns apps that are already installed; drop those.
            const wanted = category === 'software'
                ? ids.filter(id => { const app = softwareAppId(id); return !app || !Shell.AppSystem.get_default().lookup_app(app); }).slice(0, limit)
                : ids.slice(0, limit);
            const metas = wanted.length ? await call(provider.proxy, 'GetResultMetas',
                new GLib.Variant('(as)', [wanted]), cancellable) : [];
            if (!this.isOpen || !this.generation.current(generation)) return;
            const results = metas.map(meta => {
                for (const key in meta) if (key !== 'icon') meta[key] = meta[key].deepUnpack();
                const clipboard = meta.clipboardText;
                return {id: `${category}:${meta.id}`, name: clipboard ? `${meta.name} = ${clipboard}` : meta.name,
                    detail: clipboard ? 'Enter to copy result' : meta.description || (category === 'software' ? 'Open in Software' : `Open ${title.toLowerCase()} result`),
                    tag: category === 'software' ? 'Install' : undefined,
                    icon: size => provider.createIcon(size, meta) ?? new St.Icon({gicon: provider.appInfo.get_icon(), icon_size: size}),
                    activate: () => {
                        if (clipboard) St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, clipboard);
                        else provider.activateResult(meta.id, terms);
                    }};
            });
            this.groups.set(category, {title, results});
        } catch (error) {
            if (!this.isOpen || !this.generation.current(generation)) return;
            this.groups.set(category, {title, results: [], status: 'Search provider unavailable'});
            console.warn(`Charcoal Launchers: ${category}: ${error.message}`);
        }
        if (this.isOpen && this.generation.current(generation)) this._render('No results');
    }
    _render(empty) {
        if (!this.isOpen) return;
        const selectedId = this.rows[this.selected]?.result.id;
        this.resultBox.destroy_all_children();
        this.rows = [];
        for (const category of SEARCH_ORDER) {
            const group = this.groups.get(category);
            if (!group || (!group.results.length && !group.status)) continue;
            this.resultBox.add_child(new St.Label({text: group.title, style_class: 'charcoal-heading'}));
            if (group.status) this.resultBox.add_child(new St.Label({text: group.status, style_class: 'charcoal-detail'}));
            for (const result of group.results) {
                const row = new St.Button({style_class: 'charcoal-result', x_expand: true, can_focus: false});
                const content = new St.BoxLayout({style_class: 'charcoal-result-content', x_expand: true});
                content.add_child(result.icon(this.settings.get_int('search-icon-size')));
                const labels = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
                    style_class: 'charcoal-result-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
                labels.add_child(new St.Label({text: result.name ?? '', x_expand: true}));
                labels.add_child(new St.Label({text: result.detail ?? '', style_class: 'charcoal-detail', x_expand: true}));
                content.add_child(labels);
                if (result.tag) content.add_child(new St.Label({text: result.tag, style_class: 'charcoal-install-tag',
                    y_align: Clutter.ActorAlign.CENTER}));
                row.set_child(content);
                row.connect('clicked', () => this._activate(result));
                this.rows.push({row, result}); this.resultBox.add_child(row);
            }
        }
        if (!this.resultBox.get_n_children()) this.resultBox.add_child(new St.Label({text: empty, style_class: 'charcoal-empty'}));
        const same = this.rows.findIndex(r => r.result.id === selectedId);
        this.selected = same >= 0 ? same : Math.min(this.selected, Math.max(0, this.rows.length - 1));
        this._highlight();
        this._layout();
    }
    _highlight() {
        this.rows.forEach(({row}, i) => row.set_style(i === this.selected
            ? `background-color: ${rgbaOf(color(this.settings, 'accent-color'), 0.16)}; border-left: 2px solid ${color(this.settings, 'accent-color')};` : ''));
        const row = this.rows[this.selected]?.row;
        if (row?.has_allocation()) {
            const adjustment = this.scroll.vadjustment;
            const box = row.get_allocation_box();
            if (box.y1 < adjustment.value) adjustment.value = box.y1;
            else if (box.y2 > adjustment.value + adjustment.page_size)
                adjustment.value = box.y2 - adjustment.page_size;
        }
    }
    _layout() {
        if (this.layoutSource) GLib.Source.remove(this.layoutSource);
        this.layoutSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.layoutSource = 0;
            this._place();
            return GLib.SOURCE_REMOVE;
        });
    }
    _place() {
        if (!this.isOpen) return;
        const m = this.monitor;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.min(this.settings.get_int('launcher-width') * scale, m.width - 40);
        this.panel.width = width;
        const natural = this.resultBox.get_preferred_height(width - 40 * scale)[1];
        this.scroll.height = Math.max(50, Math.min(natural, m.height - 240 * scale, m.height * this.settings.get_int('search-max-height') / 100));
        const height = this.panel.get_preferred_height(width)[1];
        this.panel.set_position(m.x + (m.width - width) / 2, m.y + Math.max(20, (m.height - height) / 2));
    }
    _activate(result) {
        if (!result) return;
        this.close();
        try { result.activate(); }
        catch (error) { Main.notify('Charcoal Launchers', `Could not open result: ${error.message}`); }
    }
    close(immediate = false) {
        this.generation.next(); this.cancellable?.cancel(); this.cancellable = null;
        for (const source of [this.debounce, this.layoutSource]) if (source) GLib.Source.remove(source);
        this.debounce = 0; this.layoutSource = 0;
        if (this.paintSource) global.stage.disconnect(this.paintSource);
        this.paintSource = 0;
        if (immediate) { for (const actor of this.closing) actor.destroy(); this.closing.clear(); }
        if (!this.isOpen) return;
        this.isOpen = false;
        if (this.modal) Main.popModal(this.modal);
        this.modal = null;
        const actor = this.actor, panel = this.panel;
        this.actor = null; this.rows = []; this.groups.clear();
        actor.reactive = false;
        if (immediate) actor.destroy();
        else {
            this.closing.add(actor);
            animate(panel, this.settings, false, () => { this.closing.delete(actor); actor.destroy(); });
        }
    }
    destroy() { this.close(true); }
}
