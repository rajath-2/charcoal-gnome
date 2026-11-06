import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const source=Gio.SettingsSchemaSource.new_from_directory(ARGV[0],Gio.SettingsSchemaSource.get_default(),false);
const settings=new Gio.Settings({settings_schema:source.lookup('org.gnome.shell.extensions.blur-my-shell',true)});
const pipelines=settings.get_value('pipelines').deepUnpack();
pipelines.pipeline_charcoal_popup_light={
    name:new GLib.Variant('s','Charcoal Popups · Light'),
    effects:new GLib.Variant('av',[new GLib.Variant('a{sv}',{
        type:new GLib.Variant('s','dual_kawase_blur'),
        id:new GLib.Variant('s','effect_charcoal_popup_light'),
        params:new GLib.Variant('a{sv}',{
            unscaled_radius:new GLib.Variant('i',16),brightness:new GLib.Variant('d',0.6),
        }),
    })]),
};
const value=new GLib.Variant('a{sa{sv}}',pipelines);
if(ARGV[1]==='--print') print(value.print(true));
else {
    if(!settings.set_value('pipelines',value)) throw Error('Could not save popup blur profile');
    Gio.Settings.sync();
}
