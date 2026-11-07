import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {addBlur, RoundedMask} from './blur.js';
import {effectBox, fromFraction, readPositions, sizeClass, toFraction} from './policy.js';

const FADE_MS = 200;
const DRAG_THRESHOLD = 5;

// One desktop widget: a blur layer cut to the card's corners, the styled surface on top.
// Dragged by its background (buttons stop their own presses), saved as a fraction of the
// monitor's free space.
export const Card = GObject.registerClass(class Card extends St.Widget {
    _init(name, settings, ext) {
        super._init({layout_manager: new Clutter.BinLayout(), reactive: true, opacity: 0, visible: false});
        this.name = name;
        this.settings = settings;
        this.ext = ext;
        this.monitor = 0;
        this._shown = false;
        this._blurLayer = new St.Widget({reactive: false, clip_to_allocation: true});
        this._mask = new RoundedMask();
        this._blurLayer.add_effect(this._mask);
        this.add_child(this._blurLayer);
        // Lengths set in code follow the widget's size preference, like the stylesheet's (theme.js).
        const scale = settings.get_int(`${name}-size`) / 100;
        this.px = n => Math.round(n * scale);
        // 'small' | 'medium' | 'large': what the card shows, not only how big it is.
        this.layout = sizeClass(settings.get_int(`${name}-size`));
        this.body = new St.BoxLayout({style_class: `charcoal-widget charcoal-widget-${name}`,
            orientation: Clutter.Orientation.VERTICAL});
        this.add_child(this.body);
        // A fixed size keeps the monitor-sized wallpaper copy from inflating the card.
        this.body.connect('notify::allocation', () => {
            if (this._blurLayer.width === this.body.width && this._blurLayer.height === this.body.height)
                return;
            this._blurLayer.set_size(this.body.width, this.body.height);
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
        this.connect('destroy', () => this._grab?.dismiss());
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
        return Clutter.EVENT_PROPAGATE;
    }

    _drag(event) {
        const held = event.get_state() & Clutter.ModifierType.BUTTON1_MASK;
        const [px, py] = event.get_coords();
        if (!this._grab) {
            if (!held)
                this._press = null;
            if (!this._press || Math.hypot(px - this._press[0], py - this._press[1]) < DRAG_THRESHOLD)
                return Clutter.EVENT_PROPAGATE;
            this._press = null;
            this._grab = global.stage.grab(this);
        }
        // The release went elsewhere (another grab, a modal): finish here instead of following the pointer.
        if (!held)
            return this._endDrag();
        this.set_position(Math.round(px - this._offset[0]), Math.round(py - this._offset[1]));
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
        const monitor = Main.layoutManager.findIndexForActor(this);
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const frac = toFraction(area, {width: this.width, height: this.height}, {x: this.x, y: this.y});
        let saved = {};
        try {
            saved = JSON.parse(this.settings.get_string('positions'));
        } catch {}
        if (typeof saved !== 'object' || saved === null)
            saved = {};
        saved[this.name] = {monitor, x: +frac.x.toFixed(4), y: +frac.y.toFixed(4)};
        this.settings.set_string('positions', JSON.stringify(saved));
        return Clutter.EVENT_STOP;
    }
});
