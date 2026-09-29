import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst?version=1.0';

import type { Rect } from './fakeFcitx.js';

const SCREEN_CAST = 'org.gnome.Mutter.ScreenCast';
const FPS = 30;
/** Long enough for a still to have been painted after the scene settles. */
const STILL_MS = 300;

Gst.init([]);

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();

            return GLib.SOURCE_REMOVE;
        });
    });
}

function screenCast(
    path: string,
    iface: string,
    method: string,
    args: GLib.Variant | null,
): unknown[] {
    const reply = Gio.DBus.session.call_sync(
        SCREEN_CAST,
        path,
        iface,
        method,
        args,
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
    );
    const values: unknown = reply.recursiveUnpack();

    return Array.isArray(values) ? values : [];
}

function waitForNode(stream: string): Promise<number> {
    return new Promise((resolve) => {
        const id = Gio.DBus.session.signal_subscribe(
            SCREEN_CAST,
            `${SCREEN_CAST}.Stream`,
            'PipeWireStreamAdded',
            stream,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, params) => {
                Gio.DBus.session.signal_unsubscribe(id);
                const values: unknown = params.recursiveUnpack();
                const node = Array.isArray(values) ? values[0] : undefined;
                resolve(typeof node === 'number' ? node : 0);
            },
        );
    });
}

/**
 * Records a screen area through Mutter's ScreenCast API, which captures what
 * GNOME Shell composites, its own popups included. Mutter only sends frames
 * when something changes, so they are resampled to a steady frame rate.
 */
export class ScreenRecorder {
    private constructor(
        private readonly session: string,
        private readonly pipeline: Gst.Element,
        private readonly directory: string,
    ) {}

    static async start(region: Rect): Promise<ScreenRecorder> {
        const [session] = screenCast(
            '/org/gnome/Mutter/ScreenCast',
            SCREEN_CAST,
            'CreateSession',
            new GLib.Variant('(a{sv})', [{}]),
        );
        if (typeof session !== 'string') {
            throw new Error('Mutter did not create a screen cast session.');
        }

        const cursorHidden = new GLib.Variant('u', 0);
        const [stream] = screenCast(
            session,
            `${SCREEN_CAST}.Session`,
            'RecordArea',
            new GLib.Variant('(iiiia{sv})', [
                region.x,
                region.y,
                region.width,
                region.height,
                { 'cursor-mode': cursorHidden },
            ]),
        );
        if (typeof stream !== 'string') {
            throw new Error('Mutter did not create a screen cast stream.');
        }

        const node = waitForNode(stream);
        screenCast(session, `${SCREEN_CAST}.Session`, 'Start', null);

        const directory = GLib.dir_make_tmp('glass-ime-XXXXXX');
        const pipeline = Gst.parse_launch(
            `pipewiresrc path=${await node} do-timestamp=true always-copy=true ! videorate ! ` +
                `video/x-raw,framerate=${FPS}/1 ! videoconvert ! pngenc compression-level=1 ! ` +
                `multifilesink location=${directory}/%05d.png`,
        );
        pipeline.set_state(Gst.State.PLAYING);

        return new ScreenRecorder(session, pipeline, directory);
    }

    /** Stops recording and returns the frames, oldest first. */
    stop(): string[] {
        this.pipeline.send_event(Gst.Event.new_eos());
        this.pipeline
            .get_bus()
            ?.timed_pop_filtered(Gst.SECOND, Gst.MessageType.EOS | Gst.MessageType.ERROR);
        this.pipeline.set_state(Gst.State.NULL);
        screenCast(this.session, `${SCREEN_CAST}.Session`, 'Stop', null);

        const frames: string[] = [];
        const enumerator = Gio.File.new_for_path(this.directory).enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );

        for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
            frames.push(`${this.directory}/${info.get_name()}`);
        }

        return frames.toSorted();
    }
}

function removeFrames(frames: string[]): void {
    const directory = frames[0] ? GLib.path_get_dirname(frames[0]) : null;

    for (const frame of frames) {
        Gio.File.new_for_path(frame).delete(null);
    }

    if (directory) {
        Gio.File.new_for_path(directory).delete(null);
    }
}

/** Saves a still of a screen area. */
export async function screenshot(region: Rect, path: string): Promise<void> {
    const recorder = await ScreenRecorder.start(region);
    await sleep(STILL_MS);

    const frames = recorder.stop();
    const last = frames.at(-1);
    if (!last) {
        throw new Error('The screen cast produced no frames.');
    }

    Gio.File.new_for_path(last).copy(
        Gio.File.new_for_path(path),
        Gio.FileCopyFlags.OVERWRITE,
        null,
        null,
    );
    removeFrames(frames);
    print(`wrote ${path}`);
}

export function encodeGif(frames: string[], width: number, path: string): void {
    const directory = GLib.path_get_dirname(frames[0] ?? '');
    const filter = [
        `scale=${width}:-1:flags=lanczos`,
        'split[a][b]',
        '[a]palettegen=stats_mode=diff[p]',
        '[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    ].join(',');

    Gio.Subprocess.new(
        [
            'ffmpeg',
            '-loglevel',
            'error',
            '-y',
            '-framerate',
            `${FPS}`,
            '-i',
            `${directory}/%05d.png`,
            '-vf',
            filter,
            path,
        ],
        Gio.SubprocessFlags.NONE,
    ).wait_check(null);

    removeFrames(frames);
    print(`wrote ${path} (${frames.length} frames)`);
}
