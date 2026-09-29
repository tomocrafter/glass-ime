import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    IMPANEL2_XML,
    IMPANEL_BUS_NAME,
    IMPANEL_OBJECT_PATH,
    IMPANEL_XML,
    IM_PROPERTY_KEY,
    INPUT_METHOD_INTERFACE,
    type ImEvent,
    type SpotRect,
    parseProperty,
    toCandidateLayout,
} from './protocol.js';

const NO_ARGS = new GLib.Variant('()', []);

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);
const asStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Owns org.kde.impanel so that fcitx5 hands its input panel over to us,
 * and translates the kimpanel protocol into {@link ImEvent}s.
 */
export class KimpanelService {
    private readonly impanel: Gio.DBusExportedObject;
    private readonly impanel2: Gio.DBusExportedObject;
    private readonly signalId: number;
    private readonly ownerId: number;
    private imOwner: string | null = null;
    private imWatchId = 0;

    constructor(private readonly onEvent: (event: ImEvent) => void) {
        this.impanel = Gio.DBusExportedObject.wrapJSObject(IMPANEL_XML, this);
        this.impanel.export(Gio.DBus.session, IMPANEL_OBJECT_PATH);

        this.impanel2 = Gio.DBusExportedObject.wrapJSObject(IMPANEL2_XML, this);
        this.impanel2.export(Gio.DBus.session, IMPANEL_OBJECT_PATH);

        this.signalId = Gio.DBus.session.signal_subscribe(
            null,
            INPUT_METHOD_INTERFACE,
            null,
            null,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, sender, _path, _iface, signal, params) => {
                const args: unknown = params.recursiveUnpack();
                this.handleSignal(sender, signal, Array.isArray(args) ? args : []);
            },
        );

        this.ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            IMPANEL_BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            null,
            () => {
                this.impanel.emit_signal('PanelCreated', NO_ARGS);
                this.impanel2.emit_signal('PanelCreated2', NO_ARGS);
            },
            null,
        );
    }

    destroy(): void {
        this.unwatchIm();
        Gio.DBus.session.signal_unsubscribe(this.signalId);
        Gio.bus_unown_name(this.ownerId);
        this.impanel.unexport();
        this.impanel2.unexport();
    }

    selectCandidate(index: number): void {
        this.impanel.emit_signal('SelectCandidate', new GLib.Variant('(i)', [index]));
    }

    pageUp(): void {
        this.impanel.emit_signal('LookupTablePageUp', NO_ARGS);
    }

    pageDown(): void {
        this.impanel.emit_signal('LookupTablePageDown', NO_ARGS);
    }

    triggerProperty(key: string): void {
        this.impanel.emit_signal('TriggerProperty', new GLib.Variant('(s)', [key]));
    }

    configure(): void {
        this.impanel.emit_signal('Configure', NO_ARGS);
    }

    // org.kde.impanel2 methods, called by fcitx5.

    SetSpotRect(x: number, y: number, width: number, height: number): void {
        this.emitSpot({ x, y, width, height, relative: false, scale: 1 });
    }

    SetRelativeSpotRect(x: number, y: number, width: number, height: number): void {
        this.emitSpot({ x, y, width, height, relative: true, scale: 1 });
    }

    SetRelativeSpotRectV2(
        x: number,
        y: number,
        width: number,
        height: number,
        scale: number,
    ): void {
        this.emitSpot({ x, y, width, height, relative: true, scale });
    }

    SetLookupTable(
        labels: string[],
        texts: string[],
        _attrs: string[],
        _hasPrev: boolean,
        _hasNext: boolean,
        cursor: number,
        layout: number,
    ): void {
        this.onEvent({
            type: 'lookupTable',
            table: { labels, texts, cursor, layout: toCandidateLayout(layout) },
        });
    }

    private emitSpot(spot: SpotRect): void {
        this.onEvent({ type: 'spot', spot });
    }

    private handleSignal(sender: string | null, signal: string, args: unknown[]): void {
        const event = toEvent(signal, args);
        if (!event) {
            return;
        }

        if (event.type === 'imProperty' && sender) {
            this.watchIm(sender);
        }
        this.onEvent(event);
    }

    /** Resets the panel when the fcitx5 process that talked to us goes away. */
    private watchIm(sender: string): void {
        if (this.imOwner === sender) {
            return;
        }

        this.unwatchIm();
        this.imOwner = sender;
        this.imWatchId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            sender,
            Gio.BusNameWatcherFlags.NONE,
            null,
            () => {
                this.unwatchIm();
                this.onEvent({ type: 'vanished' });
            },
        );
    }

    private unwatchIm(): void {
        if (this.imWatchId) {
            Gio.bus_unwatch_name(this.imWatchId);
        }
        this.imWatchId = 0;
        this.imOwner = null;
    }
}

function toEvent(signal: string, args: unknown[]): ImEvent | null {
    const [first, second] = args;

    switch (signal) {
        case 'RegisterProperties':
        case 'UpdateProperty': {
            const raws = signal === 'UpdateProperty' ? [asString(first)] : asStrings(first);
            const property = raws.map(parseProperty).find((p) => p.key === IM_PROPERTY_KEY);

            return property ? { type: 'imProperty', property } : null;
        }
        case 'ExecMenu':
            return { type: 'menu', items: asStrings(first).map(parseProperty) };
        case 'UpdateAux':
            return { type: 'aux', text: asString(first) };
        case 'ShowAux':
            return { type: 'showAux', visible: first === true };
        case 'UpdatePreeditText':
            return { type: 'preedit', text: asString(first) };
        case 'ShowPreedit':
            return { type: 'showPreedit', visible: first === true };
        case 'ShowLookupTable':
            return { type: 'showLookupTable', visible: first === true };
        case 'UpdateSpotLocation': {
            const spot = { x: asNumber(first), y: asNumber(second), width: 0, height: 0 };

            return { type: 'spot', spot: { ...spot, relative: false, scale: 1 } };
        }
        default:
            return null;
    }
}
