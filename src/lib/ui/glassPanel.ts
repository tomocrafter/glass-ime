import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Backdrop, DetachedLayer } from './backdrop.js';
import { DropShadow, type ShadowLayer } from './dropShadow.js';
import { uniqueTypeName } from './typeName.js';

export interface GlassPanelOptions {
    styleClass: string;
    radius?: number;
    blurRadius?: number;
    saturation?: number;
    shadows?: ShadowLayer[];
}

/** A tight contact shadow for definition, plus a soft ambient one. */
const DEFAULT_SHADOWS: ShadowLayer[] = [
    { blur: 1, offsetY: 0.5, opacity: 0.14 },
    { blur: 10, offsetY: 6, opacity: 0.2 },
];

const RESIZE_MS = 110;
const SHOW_MS = 140;
const HIDE_MS = 120;
/** fcitx5 often hides and reshows the panel between keystrokes; don't flicker. */
const HIDE_DELAY_MS = 60;

/**
 * A frosted-glass popup: drop shadow, blurred backdrop, tinted surface and
 * content. The actor reserves a margin for the shadow around the glass, so
 * positions and sizes given to it describe the glass alone.
 *
 * Its height animates between sizes, while the width follows immediately so
 * that the content is never squeezed.
 */
export class GlassPanel extends St.Widget {
    static {
        GObject.registerClass({ GTypeName: uniqueTypeName('GlassPanel') }, this);
    }

    readonly box = new St.BoxLayout({
        style_class: 'glass-ime-content',
        vertical: true,
        reactive: true,
    });
    private readonly backdrop: Backdrop;
    private readonly surface: St.Widget;
    private readonly shadows: DropShadow[];
    private readonly margin: number;
    private shown = false;
    private hideTimeoutId = 0;

    constructor({
        styleClass,
        radius = 14,
        blurRadius = 40,
        saturation = 1.35,
        shadows = DEFAULT_SHADOWS,
    }: GlassPanelOptions) {
        super({
            style_class: `glass-ime-panel ${styleClass}`,
            layout_manager: new Clutter.BinLayout(),
            visible: false,
            opacity: 0,
            // Fade the composited panel as one image, not each layer on its own.
            offscreen_redirect: Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY,
        });

        this.shadows = shadows.map((shadow) => new DropShadow(radius, shadow));
        this.margin = Math.max(0, ...this.shadows.map((shadow) => shadow.spread));

        const shadowLayer = new DetachedLayer({ x_expand: true, y_expand: true });
        for (const shadow of this.shadows) {
            shadowLayer.add_child(shadow);
        }

        this.backdrop = new Backdrop(radius, blurRadius, saturation);
        this.surface = new St.Widget({
            style_class: 'glass-ime-surface',
            style: `border-radius: ${radius}px;`,
        });

        const content = new DetachedLayer({ clip_to_allocation: true });
        content.add_child(this.box);

        this.add_child(shadowLayer);

        for (const glass of [this.backdrop, this.surface, content]) {
            this.inset(glass);
            this.add_child(glass);
        }

        this.connect('notify::size', () => this.fitShadows());
        this.connect('notify::position', () =>
            this.backdrop.followPanel(this.x + this.margin, this.y + this.margin),
        );
        this.connect('destroy', () => this.cancelHide());
    }

    /** Adds the panel to the shell, taking input only on the glass. */
    addToShell(): void {
        Main.layoutManager.addTopChrome(this, { affectsInputRegion: false });
        Main.layoutManager.trackChrome(this.surface, { affectsInputRegion: true });
    }

    get naturalSize(): [number, number] {
        this.box.set_size(-1, -1);
        const [, , width, height] = this.box.get_preferred_size();

        return [Math.ceil(width), Math.ceil(height)];
    }

    /** Places the glass at (x, y) with the given size. */
    moveResize(x: number, y: number, width: number, height: number): void {
        const animate = this.shown && this.visible;
        const glassTop = this.y + this.margin;
        const glassBottom = this.y + this.height - this.margin;

        this.box.set_size(width, height);
        this.backdrop.capture({
            x1: x,
            y1: animate ? Math.min(y, glassTop) : y,
            x2: x + width,
            y2: animate ? Math.max(y + height, glassBottom) : y + height,
        });

        const outerY = y - this.margin;
        const outerHeight = height + 2 * this.margin;

        this.remove_transition('y');
        this.remove_transition('height');
        this.x = x - this.margin;
        this.width = width + 2 * this.margin;

        if (animate) {
            this.ease({
                y: outerY,
                height: outerHeight,
                duration: RESIZE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        } else {
            this.y = outerY;
            this.height = outerHeight;
        }
    }

    popup(): void {
        this.cancelHide();
        if (this.shown) {
            return;
        }

        this.shown = true;
        this.remove_transition('opacity');
        this.remove_transition('translation-y');

        if (!this.visible) {
            this.opacity = 0;
            this.translation_y = 4;
        }

        this.show();
        this.ease({
            opacity: 255,
            translation_y: 0,
            duration: SHOW_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    popdown(): void {
        if (!this.shown || this.hideTimeoutId) {
            return;
        }

        this.hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
            this.hideTimeoutId = 0;
            this.shown = false;
            this.ease({
                opacity: 0,
                duration: HIDE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this.shown) {
                        this.hide();
                        this.backdrop.release();
                    }
                },
            });

            return GLib.SOURCE_REMOVE;
        });
    }

    /** St resets actor margins from CSS on every style change, so inset through CSS. */
    private inset(actor: St.Widget): void {
        actor.x_expand = true;
        actor.y_expand = true;
        actor.style = `${actor.style ?? ''} margin: ${this.margin}px;`;
    }

    private fitShadows(): void {
        const width = this.width - 2 * this.margin;
        const height = this.height - 2 * this.margin;

        for (const shadow of this.shadows) {
            shadow.fit(this.margin, this.margin, width, height);
        }
    }

    private cancelHide(): void {
        if (this.hideTimeoutId) {
            GLib.source_remove(this.hideTimeoutId);
        }
        this.hideTimeoutId = 0;
    }
}
