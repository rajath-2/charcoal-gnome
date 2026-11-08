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
    _build() {
        // Transparent, but still full-screen so a click outside closes search.
        this.actor = new St.Widget({reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height});
        this.panel = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, reactive: true,
            style_class: 'charcoal-search charcoal-minimal', style: surfaceStyle(this.settings)});
        this.entry = new St.Entry({style_class: 'charcoal-search-entry', hint_text: 'Search', can_focus: true, x_expand: true});
        this.entry.set_primary_icon(new St.Icon({icon_name: 'system-search-symbolic', icon_size: 18}));
        this.panel.add_child(this.entry);
        this.scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, x_expand: true, visible: false});
        this.resultBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'charcoal-results', x_expand: true});
        this.scroll.set_child(this.resultBox);
        this.panel.add_child(this.scroll);
        const {x, y} = this._frame();
        this.blur = new St.Widget({x, y, reactive: false, clip_to_allocation: true});
        this.mask = new RoundedMask();
        this.blur.add_effect(this.mask);
        this.actor.add_child(this.blur);
        this.actor.add_child(this.panel);
        addBlur(this.blur, this.settings, 'blur', [x, y]);
    }
    // Task 3 animates these; for now Minimal simply appears and disappears.
    _animateOpen() {}
    _animateClose(done) { done(); }
    // Keep the previous rows, dimmed and inert, until fresh results land.
    _markStale() {
        this.stale = true;
        this.rows.forEach(({row}) => { row.opacity = 120; });
    }
    _render() {
        if (!this.isOpen) return;
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
        this.scroll.visible = !!text;
        this._finishRender(selectedId);
    }
    _selectedStyle() { return `background-color: ${rgbaOf(color(this.settings, 'accent-color'), 0.16)};`; }
    _place() {
        if (!this.isOpen) return;
        const {x, y, width, scale} = this._frame();
        this.panel.width = width;
        if (this.scroll.visible) {
            const natural = this.resultBox.get_preferred_height(width)[1];
            this.scroll.height = Math.min(natural, this.monitor.height * this.settings.get_int('search-max-height') / 100);
        }
        const height = this.panel.get_preferred_height(width)[1];
        this.panel.set_position(x, y);
        this.blur.set_size(width, height);
        this.mask.setShape(width, height, this.settings.get_int('corner-radius') * scale);
    }
}
