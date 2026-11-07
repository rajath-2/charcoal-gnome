import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {pickPlayer} from './policy.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const IFACE = 'org.mpris.MediaPlayer2.Player';
// Shell's bundled interface lacks shuffle, loop, seeking and position.
const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(`<node><interface name="${IFACE}">
  <method name="PlayPause"/><method name="Next"/><method name="Previous"/>
  <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="LoopStatus" type="s" access="readwrite"/>
  <property name="Shuffle" type="b" access="readwrite"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanPlay" type="b" access="read"/>
  <property name="CanSeek" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
</interface></node>`);

// Tracks every MPRIS player on the session bus; `active` is the one the widget follows.
export class MprisWatcher {
    constructor(onChange) {
        this._onChange = onChange;
        this._players = new Map();
        this._cancellable = new Gio.Cancellable();
        const bus = Gio.DBus.session;
        this._subscription = bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE, (...args) => {
                const [name, oldOwner, newOwner] = args[5].deepUnpack();
                if (!name.startsWith(PREFIX)) return;
                if (oldOwner) this._remove(name);
                if (newOwner) this._add(name);
            });
        bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames', null,
            null, Gio.DBusCallFlags.NONE, -1, this._cancellable, (_, result) => {
                try {
                    const [names] = bus.call_finish(result).deepUnpack();
                    names.filter(name => name.startsWith(PREFIX)).forEach(name => this._add(name));
                } catch (error) {
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Charcoal Widgets: cannot list media players: ${error.message}`);
                }
            });
    }

    _add(name) {
        if (this._players.has(name))
            return;
        const player = {name, proxy: null, changedAt: GLib.get_monotonic_time(), ids: []};
        this._players.set(name, player);
        new PlayerProxy(Gio.DBus.session, name, PATH, (proxy, error) => {
            if (error || this._players.get(name) !== player)
                return;
            player.proxy = proxy;
            player.ids.push(proxy.connect('g-properties-changed', () => {
                player.changedAt = GLib.get_monotonic_time();
                this._onChange();
            }));
            player.ids.push(proxy.connectSignal('Seeked', () => this._onChange()));
            this._onChange();
        }, this._cancellable);
    }

    _remove(name) {
        const player = this._players.get(name);
        if (!player)
            return;
        this._players.delete(name);
        if (player.proxy) {
            player.proxy.disconnect(player.ids[0]);
            player.proxy.disconnectSignal(player.ids[1]);
        }
        this._onChange();
    }

    get active() {
        const ready = [...this._players.values()].filter(p => p.proxy?.g_name_owner && p.proxy.CanPlay);
        const name = pickPlayer(ready.map(p => ({name: p.name, status: p.proxy.PlaybackStatus, changedAt: p.changedAt})));
        return name ? this._players.get(name).proxy : null;
    }

    _call(method, ...args) {
        this.active?.[`${method}Remote`](...args, (_, error) => {
            if (error) console.warn(`Charcoal Widgets: ${method} failed: ${error.message}`);
        });
    }

    playPause() { this._call('PlayPause'); }
    next() { this._call('Next'); }
    previous() { this._call('Previous'); }
    seek(trackId, us) {
        if (this.active?.CanSeek && trackId)
            this._call('SetPosition', trackId, Math.round(us));
    }

    setShuffle(on) { this._set('Shuffle', GLib.Variant.new_boolean(on)); }
    setLoop(status) { this._set('LoopStatus', GLib.Variant.new_string(status)); }

    _set(property, value) {
        const proxy = this.active;
        proxy?.call('org.freedesktop.DBus.Properties.Set', new GLib.Variant('(ssv)', [IFACE, property, value]),
            Gio.DBusCallFlags.NONE, -1, null, (_, result) => {
                try {
                    proxy.call_finish(result);
                } catch (error) {
                    console.warn(`Charcoal Widgets: setting ${property} failed: ${error.message}`);
                }
            });
    }

    // Position is not announced through property changes, so ask for it.
    position() {
        const proxy = this.active;
        if (!proxy)
            return Promise.resolve(0);
        return new Promise(resolve => proxy.call('org.freedesktop.DBus.Properties.Get',
            new GLib.Variant('(ss)', [IFACE, 'Position']), Gio.DBusCallFlags.NONE, 1000, this._cancellable, (_, result) => {
                try {
                    resolve(Number(proxy.call_finish(result).deepUnpack()[0].deepUnpack()));
                } catch {
                    resolve(0);
                }
            }));
    }

    destroy() {
        this._onChange = () => {};
        this._cancellable.cancel();
        Gio.DBus.session.signal_unsubscribe(this._subscription);
        [...this._players.keys()].forEach(name => this._remove(name));
    }
}
