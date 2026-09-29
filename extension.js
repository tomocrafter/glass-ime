import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// GJS はモジュールをキャッシュするため、有効化のたびに impl.js を別名で複製して読み込む。
// これで disable/enable だけでシェルを再起動せずにコードを反映できる。
export default class GlassImeExtension extends Extension {
    enable() {
        const token = {};
        this._token = token;
        const dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'glass-ime']);
        GLib.mkdir_with_parents(dir, 0o700);
        const copy = Gio.File.new_for_path(`${dir}/impl-${Date.now()}.js`);
        this.dir.get_child('impl.js').copy(copy, Gio.FileCopyFlags.OVERWRITE, null, null);
        import(copy.get_uri()).then(({default: GlassIme}) => {
            copy.delete(null);
            if (this._token !== token)
                return;
            this._impl = new GlassIme(this);
            this._impl.enable();
        }).catch(e => console.error(`glass-ime: ${e}\n${e.stack}`));
    }

    disable() {
        this._token = null;
        this._impl?.disable();
        this._impl = null;
    }
}
