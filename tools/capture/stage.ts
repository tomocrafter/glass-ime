import type Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=3.0';
import Gtk from 'gi://Gtk?version=3.0';

import type { Rect } from './fakeFcitx.js';

export type Painter = (cr: Cairo.Context, width: number, height: number) => void;

/** A borderless window centered on the primary monitor that a scene draws into. */
export class Stage {
    readonly bounds: Rect;
    private readonly window = new Gtk.Window({ type: Gtk.WindowType.POPUP });
    private readonly area = new Gtk.DrawingArea();

    constructor(width: number, height: number, painter: Painter) {
        const monitor = Gdk.Display.get_default()?.get_primary_monitor()?.get_geometry();
        const x = (monitor?.x ?? 0) + Math.round(((monitor?.width ?? width) - width) / 2);
        const y = (monitor?.y ?? 0) + Math.round(((monitor?.height ?? height) - height) / 2);

        this.bounds = { x, y, width, height };

        this.area.connect('draw', (_area, cr: Cairo.Context) => {
            painter(cr, width, height);

            return false;
        });

        this.window.add(this.area);
        this.window.move(x, y);
        this.window.set_default_size(width, height);
        this.window.show_all();
    }

    redraw(): void {
        this.area.queue_draw();
    }

    toScreen(rect: Rect): Rect {
        return { ...rect, x: this.bounds.x + rect.x, y: this.bounds.y + rect.y };
    }

    destroy(): void {
        this.window.destroy();
    }
}
