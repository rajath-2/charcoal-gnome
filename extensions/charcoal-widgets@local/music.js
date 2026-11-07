import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {Card} from './card.js';
import {MprisWatcher} from './mpris.js';
import {formatTime, nextLoop, trackInfo} from './policy.js';

const WIDTH = 340;

// The user's reference player: artwork, title and artist, a seek bar with times, and
// shuffle / previous / play-pause / next / repeat. Stays as "Nothing playing" when idle.
export const MusicCard = GObject.registerClass(class MusicCard extends Card {
    _init(name, settings, ext) {
        super._init(name, settings, ext);
        this._ext = ext;
        this._position = 0;
        this.body.width = this.px(WIDTH);
        const top = new St.BoxLayout({style: `spacing: ${this.px(14)}px;`});
        this._art = new St.Icon({icon_size: this.px(72), style_class: 'charcoal-artwork'});
        const info = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, style: `spacing: ${this.px(4)}px;`});
        this._title = new St.Label({style_class: 'charcoal-widget-title'});
        this._artist = new St.Label({style_class: 'charcoal-widget-dim'});
        this._album = new St.Label({style_class: 'charcoal-widget-dim', visible: false});
        info.add_child(this._title);
        info.add_child(this._artist);
        info.add_child(this._album);
        top.add_child(this._art);
        top.add_child(info);

        this._trough = new St.Widget({style_class: 'charcoal-seek-trough', reactive: true, x_expand: true,
            style: `margin-top: ${this.px(14)}px;`});
        this._fill = new St.Widget({style_class: 'charcoal-seek-fill'});
        this._trough.add_child(this._fill);
        this._trough.connect('notify::allocation', () => this._syncSeek());
        this._trough.connect('button-press-event', (actor, event) => {
            const [x] = event.get_coords();
            const [tx] = actor.get_transformed_position();
            const {length, trackId} = this._track;
            if (length) this._watcher.seek(trackId, Math.min(1, Math.max(0, (x - tx) / actor.width)) * length);
            return Clutter.EVENT_STOP;
        });
        const times = new St.BoxLayout({style: `margin-top: ${this.px(4)}px;`});
        this._elapsed = new St.Label({style_class: 'charcoal-seek-time', x_expand: true});
        this._total = new St.Label({style_class: 'charcoal-seek-time'});
        times.add_child(this._elapsed);
        times.add_child(this._total);

        const controls = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style: `spacing: ${this.px(18)}px; margin-top: ${this.px(8)}px;`});
        const button = (icon, label, callback, extra = '') => {
            const b = new St.Button({style_class: `charcoal-music-button ${extra}`, accessible_name: label,
                child: new St.Icon({icon_name: icon, icon_size: this.px(extra ? 20 : 16)}), y_align: Clutter.ActorAlign.CENTER});
            b.connect('clicked', callback);
            controls.add_child(b);
            return b;
        };
        this._shuffle = button('media-playlist-shuffle-symbolic', 'Shuffle',
            () => this._watcher.setShuffle(!this._watcher.active?.Shuffle));
        this._previous = button('media-skip-backward-symbolic', 'Previous', () => this._watcher.previous());
        this._play = button('media-playback-start-symbolic', 'Play or pause', () => this._watcher.playPause(), 'charcoal-play-ring');
        this._next = button('media-skip-forward-symbolic', 'Next', () => this._watcher.next());
        this._repeat = button('media-playlist-repeat-symbolic', 'Repeat',
            () => this._watcher.setLoop(nextLoop(this._watcher.active?.LoopStatus)));

        if (this.layout === 'small') {
            // Small: artwork, title and play/pause in one row.
            this.body.width = -1;
            controls.remove_child(this._play);
            top.add_child(this._play);
            this.body.add_child(top);
        } else {
            for (const child of [top, this._trough, times, controls])
                this.body.add_child(child);
        }
        this._watcher = new MprisWatcher(() => this._refresh());
        this._artChanged = settings.connect('changed::idle-artwork', () => this._render());
        // Position is polled only while the card is on screen and something plays.
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (this.shown && this._watcher.active?.PlaybackStatus === 'Playing')
                this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => {
            this._destroyed = true;
            GLib.Source.remove(this._timer);
            settings.disconnect(this._artChanged);
            this._watcher.destroy();
        });
        this._render();
    }

    async _refresh() {
        const position = await this._watcher.position();
        if (!this._destroyed) {
            this._position = position;
            this._render();
        }
    }

    _idleArt() {
        const path = this.settings.get_string('idle-artwork');
        return Gio.FileIcon.new(Gio.File.new_for_path(path || `${this._ext.path}/assets/idle.svg`));
    }

    _render() {
        const player = this._watcher.active;
        this._track = trackInfo(player?.Metadata ? Object.fromEntries(
            Object.entries(player.Metadata).map(([key, value]) => [key, value.deepUnpack()])) : null);
        const {title, artist, artUrl, length} = this._track;
        this._title.text = player ? title : 'Nothing playing';
        this._artist.text = player ? artist : '';
        this._artist.visible = !!this._artist.text && this.layout !== 'small';
        this._album.text = player ? this._track.album : '';
        this._album.visible = !!this._album.text && this.layout === 'large';
        this._art.gicon = player && artUrl ? Gio.FileIcon.new(Gio.File.new_for_uri(artUrl)) : this._idleArt();
        const position = player ? Math.min(this._position, length || this._position) : 0;
        this._elapsed.text = formatTime(position);
        this._total.text = formatTime(player ? length : 0);
        this._fraction = length ? position / length : 0;
        this._syncSeek();
        const control = !!player && player.CanControl !== false;
        this._play.child.icon_name = player?.PlaybackStatus === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._play.reactive = control;
        this._previous.reactive = control && !!player.CanGoPrevious;
        this._next.reactive = control && !!player.CanGoNext;
        this._trough.reactive = control && !!player.CanSeek && !!length;
        // Players without shuffle/loop support leave the property out (null).
        this._shuffle.reactive = control && typeof player.Shuffle === 'boolean';
        this._repeat.reactive = control && typeof player.LoopStatus === 'string';
        this._setActive(this._shuffle, this._shuffle.reactive && player.Shuffle);
        this._setActive(this._repeat, this._repeat.reactive && player.LoopStatus !== 'None');
        this._repeat.child.icon_name = player?.LoopStatus === 'Track'
            ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic';
    }

    _setActive(button, active) {
        if (active) button.add_style_class_name('active');
        else button.remove_style_class_name('active');
    }

    _syncSeek() {
        const width = Math.round(this._trough.width * (this._fraction ?? 0));
        if (this._fill.width !== width)
            this._fill.set_size(width, this._trough.height);
    }
});
