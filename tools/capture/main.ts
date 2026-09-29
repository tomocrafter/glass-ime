import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=3.0';
import System from 'system';

import { SCENES } from './scenes.js';

/**
 * Re-records the README images against the running extension:
 *
 *     bun run capture [scene...]
 *
 * Needs a GNOME session with glass-ime enabled. The stage runs on XWayland so
 * that it can be placed on screen. Don't type while it runs.
 */
async function main(names: string[]): Promise<void> {
    const outDir = GLib.build_filenamev([GLib.get_current_dir(), 'docs']);
    const unknown = names.filter((name) => !(name in SCENES));

    if (unknown.length > 0) {
        throw new Error(
            `Unknown scene: ${unknown.join(', ')}. Scenes: ${Object.keys(SCENES).join(', ')}`,
        );
    }

    for (const name of names.length > 0 ? names : Object.keys(SCENES)) {
        await SCENES[name]?.(outDir);
    }
}

Gtk.init(null);

const loop = new GLib.MainLoop(null, false);
let exitCode = 0;

main(System.programArgs)
    .catch((error: unknown) => {
        logError(error);
        exitCode = 1;
    })
    .finally(() => loop.quit());

loop.run();
System.exit(exitCode);
