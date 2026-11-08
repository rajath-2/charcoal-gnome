import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {MINIMAL_ORDER, rgbaOf} from './policy.js';
import {addBlur, color, surfaceStyle} from './appearance.js';
import {SearchLauncher} from './search.js';

// Cuts the blur layer to the card's rounded rectangle (size and radius in px).
const RoundedMask = GObject.registerClass(class RoundedMask extends Clutter.ShaderEffect {
    setShape(width, height, radius) { this.set_uniform_float('shape', 3, [width, height, radius]); }
    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, 'uniform vec3 shape;', `
vec2 half_size = shape.xy * 0.5;
vec2 q = abs(cogl_tex_coord_in[0].xy * shape.xy - half_size) - half_size + shape.z;
float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - shape.z;
cogl_color_out *= 1.0 - smoothstep(-0.75, 0.75, d);`);
    }
});

// A glass bar near the top of the screen that grows into one flat results card. No dimming.
export class MinimalSearch extends SearchLauncher {
    _frame() {
        const m = this.monitor;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.min(this.settings.get_int('launcher-width') * scale, m.width - 40);
        return {x: m.x + (m.width - width) / 2, y: m.y + 64 * scale, width, scale};
    }
    _duration(key) {
        return this.settings.get_boolean('animations') && St.Settings.get().enable_animations ? this.settings.get_int(key) : 0;
    }
    // The bare bar's height: the entry plus the panel's padding and border. Also the circle's diameter.
    _barHeight() {
        return this.panel.get_theme_node().adjust_preferred_height(0, this.entry.get_preferred_height(-1)[1])[1];
    }
    _build() {
        // Transparent, but still full-screen so a click outside closes search.
        this.actor = new St.Widget({reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height});
        this.panelStyle = surfaceStyle(this.settings);
        this.panel = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, reactive: true,
            style_class: 'charcoal-search charcoal-minimal', style: this.panelStyle});
        this.entry = new St.Entry({style_class: 'charcoal-search-entry', hint_text: 'Search', can_focus: true, x_expand: true});
        this.entry.set_primary_icon(new St.Icon({icon_name: 'system-search-symbolic', icon_size: 18}));
        this.panel.add_child(this.entry);
        this.scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, x_expand: true, visible: false});
        this.resultBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'charcoal-results', x_expand: true});
        this.scroll.set_child(this.resultBox);
        this.panel.add_child(this.scroll);
        const {x, y} = this._frame();
        // The mask sits on the layer's parent, so it cuts Blur My Shell's finished output in both modes:
        // the static wallpaper copy and the live pipeline (whose capture reads the stage under an offscreen parent).
        this.blur = new St.Widget({x, y, reactive: false, clip_to_allocation: true});
        this.actor.add_child(this.blur);
        this.actor.add_child(this.panel);
        this.dirty = false; this.scrollTarget = -1; this.radius = -1; this.shape = '';
        // The blur layer follows the panel every frame while it grows, shrinks or changes height: after the
        // transitions step and before layout, so the layer is never resized mid-allocation.
        const update = global.stage.connect('before-update', () => this._syncShape());
        this.actor.connect('destroy', () => global.stage.disconnect(update));
        this.blur.connect('child-added', () => { this.shape = ''; }); // place the static wallpaper copy
        // Mask only once blur actually attached (an empty layer would still cost an offscreen buffer every frame).
        const blur = this.blur;
        addBlur(blur, this.settings, 'blur', [x, y]).then(() => {
            if (!blur.get_n_children() || this.blur !== blur || !this.actor) return;
            this.mask = new RoundedMask();
            blur.add_effect(this.mask);
            this.shape = '';
        }).catch(() => {});
    }
    _syncShape() {
        const {panel, blur} = this;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        // Whole pixels, and only on a real change (this runs every frame while search is up).
        const [x, y, width] = [panel.x, panel.y, panel.width].map(Math.round);
        const height = Math.round(panel.get_preferred_height(panel.width)[1]);
        const shape = `${x} ${y} ${width} ${height}`;
        if (shape === this.shape) return;
        this.shape = shape;
        blur.set_position(x, y);
        blur.set_size(width, height);
        // The static wallpaper copy stays put on the stage while the layer moves.
        blur.get_children().find(child => child.name === 'charcoal-static-blur')?.set_position(-x, -y);
        // A circle at the bar's height, easing to the card's corner radius as the bar reaches full width.
        const bar = this._barHeight(), full = this._frame().width;
        const t = full > bar ? Math.min(1, Math.max(0, (width - bar) / (full - bar))) : 1;
        const radius = Math.round(Math.min(height / 2, bar / 2 + (this.settings.get_int('corner-radius') * scale - bar / 2) * t));
        this.mask?.setShape(width, height, radius);
        if (radius === this.radius) return;
        this.radius = radius;
        panel.set_style(`${this.panelStyle} border-radius: ${radius / scale}px;`);
    }
    // The typed text with its cursor, and the "Search" hint (a separate actor).
    _texts() { return [this.entry.clutter_text, this.entry.hint_actor].filter(Boolean); }
    // (a) the circle with the search icon fades in, (b) the bar grows sideways out of it, staying centred,
    // (c) the hint and cursor fade in. The entry already has key focus, so typing is kept throughout.
    _animateOpen() {
        const duration = this._duration('open-duration');
        if (!duration) return; // _place already left the full bar in place
        const {x, width} = this._frame(), bar = this._barHeight(), texts = this._texts();
        this.panel.set({x: x + (width - bar) / 2, width: bar, opacity: 0});
        this.blur.opacity = 0;
        texts.forEach(text => { text.opacity = 0; });
        const fade = () => ({opacity: 255, duration: 0.35 * duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this.panel.ease(fade());
        this.blur.ease(fade());
        this.panel.ease({x, width, delay: 0.35 * duration, duration: 0.65 * duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        texts.forEach(text => text.ease({opacity: 255, delay: 0.75 * duration, duration: 0.25 * duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD}));
    }
    // The reverse: results collapse and the text fades, the bar shrinks into the circle, the circle fades out.
    _animateClose(done) {
        const duration = this._duration('close-duration');
        if (!duration) { done(); return; }
        const {panel, blur, scroll} = this, texts = this._texts(), bar = this._barHeight(), quick = 0.25 * duration;
        // Closing mid-open: start from wherever the open animation got to.
        [panel, blur, scroll, ...texts].forEach(actor => actor.remove_all_transitions());
        texts.forEach(text => text.ease({opacity: 0, duration: quick, mode: Clutter.AnimationMode.EASE_OUT_QUAD}));
        if (scroll.visible) scroll.ease({height: 0, duration: quick, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        panel.ease({x: panel.x + (panel.width - bar) / 2, width: bar, duration: 0.65 * duration,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC});
        const fade = {opacity: 0, delay: 0.65 * duration, duration: 0.35 * duration, mode: Clutter.AnimationMode.EASE_IN_QUAD};
        blur.ease({...fade});
        panel.ease({...fade, onComplete: done});
    }
    // Keep the previous rows, dimmed and inert, until fresh results land.
    _markStale() {
        this.stale = true;
        this.rows.forEach(({row}) => { row.opacity = 120; row.track_hover = false; });
    }
    // An empty query is just the bare bar: skip Classic's favorites and all-apps lookups.
    _query() {
        if (this.entry.get_text().trim()) return super._query();
        this.generation.next();
        this.cancellable?.cancel();
        this.groups.clear();
        this._render();
        return undefined;
    }
    // Batch: replies from several sources in one main-loop pass rebuild and resize the card once, on idle.
    _render() {
        if (!this.isOpen) return;
        this.dirty = true;
        this._layout();
    }
    _rebuild() {
        const text = this.entry.get_text().trim();
        const results = text ? MINIMAL_ORDER.flatMap(category => this.groups.get(category)?.results ?? []) : [];
        // Nothing fresh yet but sources still searching: stay on the stale rows rather than flash "No results".
        if (this.stale && text && !results.length && [...this.groups.values()].some(group => group.pending)) return;
        this.stale = false;
        const selectedId = this.rows[this.selected]?.result.id;
        this.resultBox.destroy_all_children();
        this.rows = [];
        results.forEach(result => this._addRow(result));
        if (text && !results.length) this.resultBox.add_child(new St.Label({text: 'No results', style_class: 'charcoal-empty'}));
        this._finishRender(selectedId);
    }
    _selectedStyle() { return `background-color: ${rgbaOf(color(this.settings, 'accent-color'), 0.16)};`; }
    _place() {
        if (!this.isOpen) return;
        if (this.dirty) { this.dirty = false; this._rebuild(); }
        const {x, y, width, scale} = this._frame();
        // While the bar grows, the animation owns x and width.
        if (!this.panel.get_transition('width')) this.panel.set({x, width});
        this.panel.y = y;
        const m = this.monitor;
        // The card starts 64 * scale down; Classic's pixel cap leaves room for that and the bar.
        const target = this.entry.get_text().trim() ? Math.min(this.resultBox.get_preferred_height(width)[1],
            m.height - 240 * scale, m.height * this.settings.get_int('search-max-height') / 100) : 0;
        if (target === this.scrollTarget) return;
        this.scrollTarget = target;
        const scroll = this.scroll;
        scroll.remove_transition('height');
        if (!this._duration('open-duration')) {
            scroll.height = target; scroll.visible = !!target;
            return;
        }
        if (!target && !scroll.visible) return;
        if (!scroll.visible) { scroll.height = 0; scroll.show(); }
        scroll.ease({height: target, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => { if (!target) scroll.hide(); }});
    }
}
