import Clutter from 'gi://Clutter';
import type Mtk from 'gi://Mtk';
import St from 'gi://St';

import { placeNearCursor } from '../placement.js';
import { GlassPanel } from './glassPanel.js';

const TEXT_INSET = 10;

/** The small "A" / "あ" badge shown when the input method changes. */
export class ModeIndicator {
    readonly actor = new GlassPanel({
        styleClass: 'glass-ime-indicator',
        radius: 7,
        shadows: [
            { blur: 0.8, offsetY: 0.5, opacity: 0.14 },
            { blur: 4, offsetY: 2, opacity: 0.16 },
        ],
    });
    private readonly label = new St.Label({
        style_class: 'glass-ime-indicator-text',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });

    constructor() {
        this.actor.box.add_child(this.label);
    }

    show(text: string, cursor: Mtk.Rectangle): void {
        this.label.text = text;

        const [width, height] = this.actor.naturalSize;
        const { x, y } = placeNearCursor(cursor, width, height, TEXT_INSET);

        this.actor.moveResize(x, y, width, height);
        this.actor.popup();
    }

    hide(): void {
        this.actor.popdown();
    }
}
