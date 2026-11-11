import GObject from 'gi://GObject';
import St from 'gi://St';
import {rgb01} from './theme.js';
import {SnippetEffect} from './snippet-effect.js';

// CSS cannot recolor full-color tray textures or custom-painted indicators.
// Preserve their alpha (including antialiasing), replacing only the foreground.
const ForegroundTint = GObject.registerClass(class CharcoalForegroundTint extends SnippetEffect {
    snippet() {
        return ['uniform vec3 foreground;',
            'cogl_color_out.rgb = foreground * cogl_color_out.a;'];
    }
});

export class ContentTheme {
    constructor(roots) {
        this._actors = new Map();
        this._roots = roots;
    }

    update(color, bold) {
        this._color = color;
        this._rgb = rgb01(color);
        this._weight = bold ? 600 : 400;
        for (const root of this._roots)
            this._watch(root);
        for (const [actor, record] of this._actors)
            this._apply(actor, record);
    }

    _watch(actor) {
        if (this._actors.has(actor))
            return;
        const record = {signals: [], style: actor instanceof St.Widget ? actor.get_style() : null};
        this._actors.set(actor, record);
        const connect = (signal, callback) => record.signals.push(actor.connect(signal, callback));
        connect('child-added', (_parent, child) => this._watch(child));
        connect('child-removed', (_parent, child) => this._unwatch(child));
        connect('destroy', () => this._unwatch(actor));
        if (actor instanceof St.Widget) {
            connect('notify::style', () => {
                const style = actor.get_style();
                // GObject can defer a nested notify until after set_style returns.
                if (style === record.appliedStyle)
                    return;
                // Keep the owner's latest style, not just its style at enable time.
                record.style = style?.startsWith(record.appliedStyle)
                    ? (record.style ?? '') + style.slice(record.appliedStyle.length) : style;
                this._apply(actor, record);
            });
        }
        // Labels may contain Pango markup with its own foreground color, too.
        if (actor instanceof St.Icon || actor instanceof St.Label || actor instanceof St.DrawingArea) {
            record.effect = new ForegroundTint();
            actor.add_effect_with_name('charcoal-foreground', record.effect);
        }
        this._apply(actor, record);
        for (const child of actor.get_children())
            this._watch(child);
    }

    _apply(actor, record) {
        if (actor instanceof St.Widget) {
            // Size is set once on #panel. Reset descendants to 1em so nesting
            // does not compound the percentage and extension fonts cannot escape it.
            const original = (record.style ?? '').trim().replace(/;+$/, '');
            record.appliedStyle = `${original ? `${original}; ` : ''}color: ${this._color} !important; ` +
                `font-weight: ${this._weight} !important; font-size: 1em !important;`;
            actor.set_style(record.appliedStyle);
        }
        record.effect?.set_uniform_float('foreground', 3, this._rgb);
    }

    _unwatch(actor) {
        const record = this._actors.get(actor);
        if (!record)
            return;
        this._actors.delete(actor);
        for (const id of record.signals)
            actor.disconnect(id);
        if (record.effect)
            actor.remove_effect(record.effect);
        if (actor instanceof St.Widget)
            actor.set_style(record.style);
        for (const child of actor.get_children())
            this._unwatch(child);
    }

    destroy() {
        for (const actor of this._actors.keys())
            this._unwatch(actor);
        this._roots = [];
    }
}
