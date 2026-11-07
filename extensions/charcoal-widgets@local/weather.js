import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import {Card} from './card.js';
import {describeWeather, forecastUrl, parseForecast, weatherDue} from './policy.js';

// Checked every minute against weatherDue (wall clock), so suspend and failed fetches catch up.
const TICK_SECONDS = 60;

export const WeatherCard = GObject.registerClass(class WeatherCard extends Card {
    _init(name, settings, ext) {
        super._init(name, settings, ext);
        this._session = new Soup.Session({user_agent: 'Charcoal Widgets', timeout: 20});
        this._data = null;
        this._schedule = {lastAttempt: null, lastSuccess: null, failures: 0};
        const row = new St.BoxLayout({style: `spacing: ${this.px(12)}px;`});
        this._temp = new St.Label({style_class: 'charcoal-widget-big', y_align: Clutter.ActorAlign.CENTER});
        this._icon = new St.Icon({icon_size: this.px(36), style_class: 'charcoal-widget-accent', y_align: Clutter.ActorAlign.CENTER});
        row.add_child(this._temp);
        row.add_child(this._icon);
        this._condition = new St.Label({style_class: 'charcoal-widget-title'});
        this._detail = new St.Label({style_class: 'charcoal-widget-dim'});
        this._setup = new St.Button({label: 'Set your city in Preferences', style_class: 'charcoal-cal-nav',
            x_align: Clutter.ActorAlign.START});
        this._setup.connect('clicked', () => ext.openPreferences());
        this._extra = new St.Label({style_class: 'charcoal-widget-dim', visible: false});
        for (const child of [row, this._condition, this._detail, this._extra, this._setup])
            this.body.add_child(child);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TICK_SECONDS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        // Back online after a failure (Wi-Fi joining after login): try again now.
        this._network = Gio.NetworkMonitor.get_default();
        this._networkChanged = this._network.connect('network-changed', (_, available) => {
            if (available && this._schedule.failures > 0)
                this._fetch();
        });
        // Preferences write latitude and longitude first, then the city.
        this._cityChanged = settings.connect('changed::weather-city', () => {
            this._data = null;
            this._failed = false;
            this._schedule = {lastAttempt: null, lastSuccess: null, failures: 0};
            this._render();
            this._fetch();
        });
        this.connect('destroy', () => {
            settings.disconnect(this._cityChanged);
            this._network.disconnect(this._networkChanged);
            this._request?.cancel();
            GLib.Source.remove(this._timer);
            this._session.abort();
        });
        this._render();
        this._fetch();
    }

    onShown(shown) {
        if (shown)
            this._tick();
    }

    _tick() {
        if (!this._request && weatherDue({now: GLib.get_real_time(), ...this._schedule}))
            this._fetch();
    }

    _hasCity() {
        return this.settings.get_string('weather-city') !== '';
    }

    _fetch() {
        if (!this._hasCity())
            return;
        // A newer request (city changed) replaces an older one, so a late reply can't land last.
        this._request?.cancel();
        const request = this._request = new Gio.Cancellable();
        this._schedule.lastAttempt = GLib.get_real_time();
        const url = forecastUrl(this.settings.get_double('weather-latitude'), this.settings.get_double('weather-longitude'));
        const message = Soup.Message.new('GET', url);
        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, request, (session, result) => {
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
            this._request = null;
            if (data) {
                this._data = data;
                this._schedule.lastSuccess = GLib.get_real_time();
                this._schedule.failures = 0;
            } else {
                this._schedule.failures++;
            }
            this._failed = !data;
            this._render();
        });
    }

    _render() {
        const city = this.settings.get_string('weather-city').split(',')[0];
        const data = this._data;
        this._setup.visible = !this._hasCity();
        this._temp.visible = this._icon.visible = !!data && this._hasCity();
        this._detail.visible = !!data && this._hasCity() && this.layout !== 'small';
        this._extra.visible = this._detail.visible && this.layout === 'large';
        // Small: temperature and icon only; the condition line is for status messages.
        this._condition.visible = !data || this.layout !== 'small';
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
        this._extra.text = [data.feelsLike !== null && `Feels like ${data.feelsLike}°`,
            data.humidity !== null && `Humidity ${data.humidity}%`, data.wind !== null && `Wind ${data.wind} km/h`]
            .filter(Boolean).join(' · ');
        this._extra.visible &&= !!this._extra.text;
    }
});
