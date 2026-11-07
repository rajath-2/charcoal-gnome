import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import {Card} from './card.js';
import {describeWeather, forecastUrl, parseForecast} from './policy.js';

const REFRESH_SECONDS = 1800;

export const WeatherCard = GObject.registerClass(class WeatherCard extends Card {
    _init(name, settings, ext) {
        super._init(name, settings, ext);
        this._session = new Soup.Session({user_agent: 'Charcoal Widgets', timeout: 20});
        this._cancellable = new Gio.Cancellable();
        this._data = null;
        this._fetchedAt = 0;
        const row = new St.BoxLayout({style: 'spacing: 12px;'});
        this._temp = new St.Label({style_class: 'charcoal-widget-big', y_align: Clutter.ActorAlign.CENTER});
        this._icon = new St.Icon({icon_size: 36, style_class: 'charcoal-widget-accent', y_align: Clutter.ActorAlign.CENTER});
        row.add_child(this._temp);
        row.add_child(this._icon);
        this._condition = new St.Label({style_class: 'charcoal-widget-title'});
        this._detail = new St.Label({style_class: 'charcoal-widget-dim'});
        this._setup = new St.Button({label: 'Set your city in Preferences', style_class: 'charcoal-cal-nav',
            x_align: Clutter.ActorAlign.START});
        this._setup.connect('clicked', () => ext.openPreferences());
        for (const child of [row, this._condition, this._detail, this._setup])
            this.body.add_child(child);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
        // Preferences write latitude and longitude first, then the city.
        this._cityChanged = settings.connect('changed::weather-city', () => {
            this._data = null;
            this._failed = false;
            this._render();
            this._fetch();
        });
        this.connect('destroy', () => {
            settings.disconnect(this._cityChanged);
            this._cancellable.cancel();
            GLib.Source.remove(this._timer);
            this._session.abort();
        });
        this._render();
        this._fetch();
    }

    // Also covers resume from suspend: a long-hidden card refreshes when it shows again.
    onShown(shown) {
        if (shown && GLib.get_monotonic_time() - this._fetchedAt > REFRESH_SECONDS * 1e6)
            this._fetch();
    }

    _hasCity() {
        return this.settings.get_string('weather-city') !== '';
    }

    _fetch() {
        if (!this._hasCity())
            return;
        const url = forecastUrl(this.settings.get_double('weather-latitude'), this.settings.get_double('weather-longitude'));
        const message = Soup.Message.new('GET', url);
        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, result) => {
            let data = null;
            try {
                const bytes = session.send_and_read_finish(result);
                if (message.get_status() === Soup.Status.OK)
                    data = parseForecast(JSON.parse(new TextDecoder().decode(bytes.get_data())));
            } catch (error) {
                if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                console.warn(`Charcoal Widgets: weather update failed: ${error.message}`);
            }
            if (data) {
                this._data = data;
                this._fetchedAt = GLib.get_monotonic_time();
            }
            this._failed = !data;
            this._render();
        });
    }

    _render() {
        const city = this.settings.get_string('weather-city').split(',')[0];
        const data = this._data;
        this._setup.visible = !this._hasCity();
        this._temp.visible = this._icon.visible = this._detail.visible = !!data && this._hasCity();
        if (!this._hasCity()) {
            this._condition.text = 'Weather';
            return;
        }
        if (!data) {
            this._condition.text = this._failed ? 'Weather unavailable' : 'Loading weather…';
            return;
        }
        // Stale data (a failed refresh) stays on screen; there is nothing better to show.
        const {text, icon} = describeWeather(data.code, data.isDay);
        this._temp.text = `${data.temperature}°`;
        this._icon.icon_name = icon;
        this._condition.text = text;
        this._detail.text = `${city} · ${data.high}° / ${data.low}°`;
    }
});
