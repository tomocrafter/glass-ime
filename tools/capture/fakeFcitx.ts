import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CandidateOptions {
    cursor?: number;
    note?: string;
}

/** Plays the fcitx5 side of the kimpanel protocol so that scenes are reproducible. */
export class FakeFcitx {
    private readonly bus = Gio.DBus.session;

    moveCursor({ x, y, width, height }: Rect): void {
        this.call('SetSpotRect', new GLib.Variant('(iiii)', [x, y, width, height]));
    }

    showCandidates(texts: string[], { cursor = -1, note }: CandidateOptions = {}): void {
        const labels = texts.map((_, index) => `${index + 1}`);
        const rows = note ? [note, ...texts] : texts;
        const rowLabels = note ? ['', ...labels] : labels;
        const rowCursor = note && cursor >= 0 ? cursor + 1 : cursor;

        this.call(
            'SetLookupTable',
            new GLib.Variant('(asasasbbii)', [
                rowLabels,
                rows,
                rows.map(() => ''),
                false,
                true,
                rowCursor,
                0,
            ]),
        );
        this.emit('ShowLookupTable', new GLib.Variant('(b)', [true]));
    }

    announceMode(label: string): void {
        const icon = label === 'A' ? 'input-keyboard' : 'fcitx-mozc';

        this.emit(
            'UpdateProperty',
            new GLib.Variant('(s)', [`/Fcitx/im:Demo:${icon}::menu,label=${label}`]),
        );
        this.emit('ShowLookupTable', new GLib.Variant('(b)', [false]));
        this.emit('UpdateAux', new GLib.Variant('(ss)', [label, '']));
        this.emit('ShowAux', new GLib.Variant('(b)', [true]));
    }

    hide(): void {
        this.emit('ShowAux', new GLib.Variant('(b)', [false]));
        this.emit('ShowLookupTable', new GLib.Variant('(b)', [false]));
    }

    private emit(name: string, params: GLib.Variant): void {
        this.bus.emit_signal(null, '/kimpanel', 'org.kde.kimpanel.inputmethod', name, params);
    }

    private call(name: string, params: GLib.Variant): void {
        this.bus.call_sync(
            'org.kde.impanel',
            '/org/kde/impanel',
            'org.kde.impanel2',
            name,
            params,
            null,
            Gio.DBusCallFlags.NONE,
            1000,
            null,
        );
    }
}
