import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Backdrop, DetachedLayer } from './backdrop.js';
import { DropShadow, type ShadowLayer } from './dropShadow.js';
import { type Rect, sameRect, union } from './geometry.js';
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

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

/**
 * A frosted-glass popup: drop shadow, blurred backdrop, tinted surface and content.
 *
 * The layers cover a canvas that holds every position of the panel during an
 * animation, with a margin for the shadow. Animating the panel only moves it
 * within the canvas, so the blur and the shadows keep their cached textures.
 * The height animates between sizes, while the width follows immediately so
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
    private readonly contentLayer = new DetachedLayer();
    private readonly shadows: DropShadow[];
    private readonly margin: number;
    /** Stage rectangle the layers cover, or null once the clones are released. */
    private canvas: Rect | null = null;
    /** Stage rectangle of the panel as currently drawn. */
    private panel: Rect = { x: 0, y: 0, width: 0, height: 0 };
    /** Where the panel is heading, while animating. */
    private target: Rect | null = null;
    private resize: Clutter.Timeline | null = null;
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
            visible: false,
            opacity: 0,
            // Fade the composited panel as one image, not each layer on its own.
            offscreen_redirect: Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY,
        });

        this.shadows = shadows.map((shadow) => new DropShadow(radius, shadow));
        this.margin = Math.max(0, ...this.shadows.map((shadow) => shadow.spread));
        this.backdrop = new Backdrop(radius, blurRadius, saturation);
        this.surface = new St.Widget({
            style_class: 'glass-ime-surface',
            style: `border-radius: ${radius}px;`,
        });

        for (const shadow of this.shadows) {
            this.add_child(shadow);
        }

        this.contentLayer.add_child(this.box);
        this.add_child(this.backdrop);
        this.add_child(this.surface);
        this.add_child(this.contentLayer);

        this.connect('destroy', () => {
            this.cancelHide();
            this.stopResize();
        });
    }

    /** Adds the panel to the shell, taking input only on the glass. */
    addToShell(): void {
        Main.layoutManager.addTopChrome(this, { affectsInputRegion: false });
        Main.layoutManager.trackChrome(this.surface, { affectsInputRegion: true });
    }

    get naturalSize(): [number, number] {
        // Text measures a few pixels narrower until it is mapped, so map the
        // panel (still transparent) before measuring.
        if (!this.visible) {
            this.opacity = 0;
            this.show();
        }

        this.box.set_size(-1, -1);
        const [, , width, height] = this.box.get_preferred_size();

        return [Math.ceil(width), Math.ceil(height)];
    }

    /** Places the panel at the given stage rectangle. */
    moveResize(x: number, y: number, width: number, height: number): void {
        const next: Rect = { x, y, width, height };

        if (this.canvas && sameRect(next, this.target ?? this.panel)) {
            return;
        }

        this.stopResize();
        this.box.set_size(width, height);

        const from: Rect = { ...this.panel, x, width };
        const animate =
            this.shown && this.visible && (from.y !== next.y || from.height !== next.height);

        if (!animate) {
            this.setCanvas(next);
            this.showPanel(next);

            return;
        }

        this.setCanvas(union(from, next));
        this.target = next;
        this.resize = new Clutter.Timeline({
            actor: this,
            duration: RESIZE_MS,
            progress_mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        this.resize.connect('new-frame', (timeline: Clutter.Timeline) => {
            const progress = timeline.get_progress();

            this.showPanel({
                ...next,
                y: lerp(from.y, next.y, progress),
                height: lerp(from.height, next.height, progress),
            });
        });
        this.resize.connect('completed', () => {
            this.resize = null;
            this.target = null;
            this.setCanvas(next);
            this.showPanel(next);
        });
        this.resize.start();
    }

    popup(): void {
        this.cancelHide();
        if (this.shown) {
            return;
        }

        this.shown = true;
        this.remove_transition('opacity');
        this.remove_transition('translation-y');

        if (!this.visible || this.opacity === 0) {
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
                        this.canvas = null;
                    }
                },
            });

            return GLib.SOURCE_REMOVE;
        });
    }

    /** Sizes every layer to cover the given stage rectangle. */
    private setCanvas(canvas: Rect): void {
        if (this.canvas && sameRect(canvas, this.canvas)) {
            return;
        }

        const inner: Rect = {
            x: this.margin,
            y: this.margin,
            width: canvas.width,
            height: canvas.height,
        };

        this.canvas = canvas;
        this.set_position(canvas.x - this.margin, canvas.y - this.margin);
        this.set_size(canvas.width + 2 * this.margin, canvas.height + 2 * this.margin);

        for (const shadow of this.shadows) {
            shadow.setCanvas(inner);
        }

        this.backdrop.set_position(inner.x, inner.y);
        this.backdrop.setCanvas(canvas);
        this.contentLayer.set_position(inner.x, inner.y);
        this.contentLayer.set_size(inner.width, inner.height);
    }

    /** Draws the panel at the given stage rectangle, which lies within the canvas. */
    private showPanel(panel: Rect): void {
        const canvas = this.canvas ?? panel;
        const local: Rect = { ...panel, x: panel.x - canvas.x, y: panel.y - canvas.y };

        this.panel = panel;

        for (const shadow of this.shadows) {
            shadow.setPanel(local);
        }

        this.backdrop.setPanel(local);
        this.surface.set_position(this.margin + local.x, this.margin + local.y);
        this.surface.set_size(local.width, local.height);
        this.box.set_position(local.x, local.y);
        this.contentLayer.set_clip(local.x, local.y, local.width, local.height);
    }

    private stopResize(): void {
        this.resize?.stop();
        this.resize = null;
        this.target = null;
    }

    private cancelHide(): void {
        if (this.hideTimeoutId) {
            GLib.source_remove(this.hideTimeoutId);
        }
        this.hideTimeoutId = 0;
    }
}
