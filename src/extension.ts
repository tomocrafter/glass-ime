import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import type GlassIme from './lib/glassIme.js';

const CHILD_ATTRIBUTES = 'standard::name,standard::type';

function children(directory: Gio.File): Gio.FileInfo[] {
    const enumerator = directory.enumerate_children(
        CHILD_ATTRIBUTES,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    const infos: Gio.FileInfo[] = [];

    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
        infos.push(info);
    }

    return infos;
}

function copyTree(source: Gio.File, target: Gio.File): void {
    target.make_directory_with_parents(null);

    for (const info of children(source)) {
        const from = source.get_child(info.get_name());
        const to = target.get_child(info.get_name());

        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            copyTree(from, to);
        } else {
            from.copy(to, Gio.FileCopyFlags.OVERWRITE, null, null);
        }
    }
}

function deleteTree(file: Gio.File): void {
    for (const info of children(file)) {
        const child = file.get_child(info.get_name());

        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            deleteTree(child);
        } else {
            child.delete(null);
        }
    }

    file.delete(null);
}

/**
 * GJS caches modules for the lifetime of GNOME Shell, so every enable imports
 * a fresh copy of lib/. Disabling and re-enabling the extension then picks up
 * new code without restarting the shell.
 */
export default class GlassImeExtension extends Extension {
    private instance: GlassIme | null = null;
    private generation = 0;

    override enable(): void {
        const generation = ++this.generation;
        const copy = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_runtime_dir(), 'glass-ime', `${Date.now()}`]),
        );
        copyTree(this.dir.get_child('lib'), copy);

        import(copy.get_child('glassIme.js').get_uri())
            .then(({ default: Loaded }: { default: typeof GlassIme }) => {
                if (generation === this.generation) {
                    this.instance = new Loaded(this.uuid);
                }
            })
            .catch((error: unknown) => console.error('glass-ime: failed to load', error))
            .finally(() => deleteTree(copy));
    }

    override disable(): void {
        this.generation++;
        this.instance?.destroy();
        this.instance = null;
    }
}
