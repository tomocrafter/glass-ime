import Gdk from 'gi://Gdk?version=3.0';
import type GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type { Rect } from './fakeFcitx.js';

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();

            return GLib.SOURCE_REMOVE;
        });
    });
}

/** Grabs a screen region, including the GNOME Shell chrome drawn over it. */
export function grab({ x, y, width, height }: Rect): GdkPixbuf.Pixbuf {
    const root = Gdk.get_default_root_window();
    const pixbuf = Gdk.pixbuf_get_from_window(root, x, y, width, height);

    if (!pixbuf) {
        throw new Error('Failed to grab the screen. Capturing needs an X11 session.');
    }

    return pixbuf;
}

export function savePng(pixbuf: GdkPixbuf.Pixbuf, path: string): void {
    pixbuf.savev(path, 'png', [], []);
    print(`wrote ${path}`);
}

/**
 * Grabs frames as fast as the main loop allows. Frames stay in memory until
 * the end, and grabbing runs at low priority so that the stage keeps redrawing.
 */
export class Recorder {
    private readonly frames: GdkPixbuf.Pixbuf[] = [];
    private sourceId = 0;
    private startedAt = 0;

    constructor(private readonly region: Rect) {}

    start(): void {
        this.startedAt = GLib.get_monotonic_time();
        this.sourceId = GLib.timeout_add(GLib.PRIORITY_LOW, 10, () => {
            this.frames.push(grab(this.region));

            return GLib.SOURCE_CONTINUE;
        });
    }

    stop(): { frames: GdkPixbuf.Pixbuf[]; fps: number } {
        GLib.source_remove(this.sourceId);
        const seconds = (GLib.get_monotonic_time() - this.startedAt) / 1e6;

        return { frames: this.frames, fps: this.frames.length / seconds };
    }
}

export function encodeGif(
    frames: GdkPixbuf.Pixbuf[],
    fps: number,
    width: number,
    path: string,
): void {
    const directory = GLib.dir_make_tmp('glass-ime-XXXXXX');

    frames.forEach((frame, index) => {
        frame.savev(`${directory}/${String(index).padStart(4, '0')}.png`, 'png', [], []);
    });

    const filter = [
        `fps=30,scale=${width}:-1:flags=lanczos`,
        'split[a][b]',
        '[a]palettegen=stats_mode=diff[p]',
        '[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    ].join(',');
    const ffmpeg = Gio.Subprocess.new(
        [
            'ffmpeg',
            '-loglevel',
            'error',
            '-y',
            '-framerate',
            fps.toFixed(2),
            '-i',
            `${directory}/%04d.png`,
            '-vf',
            filter,
            path,
        ],
        Gio.SubprocessFlags.NONE,
    );
    ffmpeg.wait_check(null);

    Gio.Subprocess.new(['rm', '-r', directory], Gio.SubprocessFlags.NONE).wait_check(null);
    print(`wrote ${path} (${frames.length} frames at ${fps.toFixed(1)} fps)`);
}
