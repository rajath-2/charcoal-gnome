import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {addBlur, RoundedMask} from './blur.js';
import {DEFAULT_CONTENT_SIZE, effectBox, fitContent, fromFraction, readPositions, readSize, resizeEdges, resizeRect, widgetLayout, toFraction} from './policy.js';

const FADE_MS = 200;
const DRAG_THRESHOLD = 5;

// Lays the one content child out in the frame: fills the frame's width when it can, and is
// scaled down to fit when the user drew the frame smaller than the content (fitContent).
const FitLayout = GObject.registerClass(class FitLayout extends Clutter.LayoutManager {
    vfunc_get_preferred_width(container, forHeight) {
        return container.get_first_child()?.get_preferred_width(-1) ?? [0, 0];
    }

    vfunc_get_preferred_height(container, forWidth) {
        return container.get_first_child()?.get_preferred_height(forWidth) ?? [0, 0];
    }

    vfunc_allocate(container, box) {
        const child = container.get_first_child();
        if (!child)
            return;
        const [boxW, boxH] = box.get_size();
        this.onSize?.(boxW, boxH);
        const {width, height, scale} = fitContent(boxW, boxH, child.get_preferred_width(-1)[0],
            w => child.get_preferred_height(w)[1]);
        child.set_scale(scale, scale);
        const x = box.x1 + (boxW - width * scale) / 2, y = box.y1 + (boxH - height * scale) / 2;
        child.allocate(Clutter.ActorBox.new(x, y, x + width, y + height));
    }
});

// One desktop widget: a blur layer cut to the card's corners, the styled surface on top.
// Dragged by its background (buttons stop their own presses), saved as a fraction of the
// monitor's free space; dragged by any edge or corner, resized to any shape.
export const Card = GObject.registerClass(class Card extends St.Widget {
    _init(name, settings, ext) {
        super._init({layout_manager: new Clutter.BinLayout(), reactive: true, opacity: 0, visible: false});
        this.name = name;
        this.settings = settings;
        this.ext = ext;
        this.monitor = 0;
        this._shown = false;
        // BinLayout fills this layer, but it must never contribute a minimum size to the
        // card: otherwise a previously wide backdrop prevents the next resize shrinking.
        this._blurLayer = new St.Widget({reactive: false, clip_to_allocation: true,
            x_expand: true, y_expand: true,
            min_width: 0, natural_width: 0, min_height: 0, natural_height: 0});
        this._mask = new RoundedMask();
        this._blurLayer.add_effect(this._mask);
        this.add_child(this._blurLayer);
        // Lengths set in code follow the widget's size preference, like the stylesheet's (theme.js).
        const scale = this._textScale = settings.get_int(`${name}-size`) / 100;
        this.px = n => Math.round(n * scale);
        this.layout = widgetLayout(name, ...DEFAULT_CONTENT_SIZE[name]);
        // The frame is the visible card (the user's shape); `body` holds what each widget shows.
        this._frame = new St.Widget({style_class: `charcoal-widget charcoal-widget-${name}`,
            layout_manager: new FitLayout(), clip_to_allocation: true});
        this._frame.layout_manager.onSize = (width, height) => {
            if (this._customSize)
                this._queueLayout(widgetLayout(this.name, width, height, this._textScale,
                    St.ThemeContext.get_for_stage(global.stage).scale_factor));
        };
        this.body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        this._frame.add_child(this.body);
        this.add_child(this._frame);
        this._frame.connect('notify::allocation', () => {
            // Content grew or shrank (data arrived): keep the saved spot, e.g. still flush right.
            if (this._shown && !this._grab)
                this.place();
        });
        addBlur(this._blurLayer, settings).then(group => {
            this._blurStatic = group;
            this._syncBlur();
        });
        this.connect('notify::allocation', () => this._syncBlur());
        this.connect('button-press-event', (_, event) => this._startDrag(event));
        this.connect('motion-event', (_, event) => this._drag(event));
        this.connect('button-release-event', () => this._endDrag());
        this.connect('leave-event', () => { if (!this._grab) this.cursor_type = Clutter.CursorType.DEFAULT; });
        this.connect('destroy', () => {
            this._grab?.dismiss();
            if (this._layoutIdle) GLib.Source.remove(this._layoutIdle);
        });
    }

    // Never change child structure during allocation. Coalesce pointer motion into one update,
    // and leave data sources and selection intact when crossing a layout breakpoint.
    _queueLayout(layout) {
        this._nextLayout = layout;
        if (JSON.stringify(layout) === JSON.stringify(this.layout) || this._layoutIdle)
            return;
        this._layoutIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._layoutIdle = 0;
            if (JSON.stringify(this.layout) !== JSON.stringify(this._nextLayout)) {
                this.layout = this._nextLayout;
                this.onLayoutChanged?.();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Static blur is a wallpaper copy: keep it at stage origin, and the mask on the card's corners.
    _syncBlur() {
        const [x, y] = this.get_transformed_position();
        if (this._blurStatic)
            this._blurStatic.set_position(-x, -y);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._mask.setShape([this.width, this.height], effectBox(x, y, this.width, this.height),
            this.settings.get_int('corner-radius') * scale);
    }

    place() {
        const p = readPositions(this.settings.get_string('positions'),
            Main.layoutManager.monitors.length, Main.layoutManager.primaryIndex)[this.name];
        this.monitor = p.monitor;
        const size = readSize(this.settings.get_string('sizes'), this.name);
        this._customSize = !!size;
        if (!size)
            this._queueLayout(widgetLayout(this.name, ...DEFAULT_CONTENT_SIZE[this.name]));
        this._frame.set_size(size?.width ?? -1, size?.height ?? -1);
        const area = Main.layoutManager.getWorkAreaForMonitor(p.monitor);
        const [, width] = this.get_preferred_width(-1);
        const [, height] = this.get_preferred_height(width);
        const {x, y} = fromFraction(area, {width, height}, p);
        this.set_position(x, y);
    }

    setShown(shown) {
        if (shown === this._shown)
            return;
        this._shown = shown;
        if (!shown)
            this._cancelDrag();
        this.remove_transition('opacity');
        if (shown) {
            this.show();
            this.place();
        }
        this.ease({opacity: shown ? 255 : 0, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => { if (!this._shown) this.hide(); }});
        this.onShown?.(shown);
    }

    get shown() {
        return this._shown;
    }

    // Only arm a drag here: grabbing on press would cancel the click gesture of the card's buttons.
    _startDrag(event) {
        if (this._grab || this.settings.get_boolean('locked') || event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        for (let actor = global.stage.get_event_actor(event); actor && actor !== this; actor = actor.get_parent()) {
            if (actor instanceof St.Button)
                return Clutter.EVENT_PROPAGATE;
        }
        const [px, py] = event.get_coords();
        this._press = [px, py];
        this._offset = [px - this.x, py - this.y];
        const edges = this._edges(px, py);
        this._resize = Object.values(edges).some(Boolean) ? {edges, px, py,
            rect: {x: this.x, y: this.y, width: this.width, height: this.height}} : null;
        return Clutter.EVENT_PROPAGATE;
    }

    _edges(px, py) {
        const [x, y] = this.get_transformed_position();
        return resizeEdges({x, y, width: this.width, height: this.height}, px, py);
    }

    // Show the resize cursor over the edges while the pointer just passes over the card.
    _hover(px, py) {
        const {left, right, top, bottom} = this.settings.get_boolean('locked') ? {} : this._edges(px, py);
        const direction = `${top ? 'N' : bottom ? 'S' : ''}${left ? 'W' : right ? 'E' : ''}`;
        this.cursor_type = direction ? Clutter.CursorType[`${direction}_RESIZE`] : Clutter.CursorType.DEFAULT;
    }

    _drag(event) {
        const held = event.get_state() & Clutter.ModifierType.BUTTON1_MASK;
        const [px, py] = event.get_coords();
        if (!this._grab) {
            if (!held) {
                this._press = null;
                this._hover(px, py);
            }
            if (!this._press || Math.hypot(px - this._press[0], py - this._press[1]) < DRAG_THRESHOLD)
                return Clutter.EVENT_PROPAGATE;
            this._press = null;
            this._grab = global.stage.grab(this);
        }
        // The release went elsewhere (another grab, a modal): finish here instead of following the pointer.
        if (!held)
            return this._endDrag();
        if (this._resize) {
            this._customSize = true;
            const start = this._resize;
            const rect = start.result = resizeRect(start.rect, start.edges, px - start.px, py - start.py);
            this._frame.set_size(rect.width, rect.height);
            this.set_position(rect.x, rect.y);
        } else {
            this.set_position(Math.round(px - this._offset[0]), Math.round(py - this._offset[1]));
        }
        return Clutter.EVENT_STOP;
    }

    // Hidden mid-drag (a window opened): drop the grab, it would never see the release.
    _cancelDrag() {
        if (!this._grab)
            return;
        this._grab.dismiss();
        this._grab = null;
        this.place();
    }

    _endDrag() {
        this._press = null;
        if (!this._grab)
            return Clutter.EVENT_PROPAGATE;
        this._grab.dismiss();
        this._grab = null;
        this.cursor_type = Clutter.CursorType.DEFAULT;
        // Measure both before saving either: each save re-places the card.
        const monitor = Main.layoutManager.findIndexForActor(this);
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
        // A release can arrive before the last requested size has been allocated.
        const rect = this._resize?.result ?? {x: this.x, y: this.y, width: this.width, height: this.height};
        const frac = toFraction(area, rect, rect);
        if (this._resize)
            this._save('sizes', {width: Math.round(rect.width), height: Math.round(rect.height)});
        this._save('positions', {monitor, x: +frac.x.toFixed(4), y: +frac.y.toFixed(4)});
        return Clutter.EVENT_STOP;
    }

    // Settings hold one JSON object per key, {name: value}, shared by the three cards.
    _save(key, value) {
        let saved = {};
        try {
            saved = JSON.parse(this.settings.get_string(key));
        } catch {}
        if (typeof saved !== 'object' || saved === null)
            saved = {};
        saved[this.name] = value;
        this.settings.set_string(key, JSON.stringify(saved));
    }
});
