import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Backdrop, DetachedLayer } from './backdrop.js';
import { uniqueTypeName } from './typeName.js';

export interface GlassPanelOptions {
    styleClass: string;
    radius?: number;
    blurRadius?: number;
    saturation?: number;
}

const RESIZE_MS = 110;
const SHOW_MS = 140;
const HIDE_MS = 120;
/** fcitx5 often hides and reshows the panel between keystrokes; don't flicker. */
const HIDE_DELAY_MS = 60;

/**
 * A frosted-glass popup: shadow, blurred backdrop, tinted surface and content.
 * Its height animates between sizes, while the width follows immediately so
 * that the content is never squeezed.
 */
export class GlassPanel extends St.Widget {
    static {
        GObject.registerClass({ GTypeName: uniqueTypeName('GlassPanel') }, this);
    }

    readonly box = new St.BoxLayout({ style_class: 'glass-ime-content', vertical: true });
    private readonly backdrop: Backdrop;
    private shown = false;
    private hideTimeoutId = 0;

    constructor({
        styleClass,
        radius = 14,
        blurRadius = 40,
        saturation = 1.35,
    }: GlassPanelOptions) {
        super({
            style_class: `glass-ime-panel ${styleClass}`,
            layout_manager: new Clutter.BinLayout(),
            visible: false,
            opacity: 0,
            reactive: true,
        });

        const rounded = `border-radius: ${radius}px;`;
        const layer = (className: string) =>
            new St.Widget({
                style_class: className,
                style: rounded,
                x_expand: true,
                y_expand: true,
            });

        this.backdrop = new Backdrop(radius, blurRadius, saturation);

        const content = new DetachedLayer({
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
        });
        content.add_child(this.box);

        this.add_child(layer('glass-ime-shadow'));
        this.add_child(this.backdrop);
        this.add_child(layer('glass-ime-surface'));
        this.add_child(content);

        this.connect('notify::position', () => this.backdrop.followPanel(this.x, this.y));
        this.connect('destroy', () => this.cancelHide());
    }

    get naturalSize(): [number, number] {
        this.box.set_size(-1, -1);
        const [, , width, height] = this.box.get_preferred_size();

        return [Math.ceil(width), Math.ceil(height)];
    }

    moveResize(x: number, y: number, width: number, height: number): void {
        const animate = this.shown && this.visible;

        this.box.set_size(width, height);
        this.backdrop.capture({
            x1: x,
            y1: animate ? Math.min(y, this.y) : y,
            x2: x + width,
            y2: animate ? Math.max(y + height, this.y + this.height) : y + height,
        });

        this.remove_transition('y');
        this.remove_transition('height');
        this.x = x;
        this.width = width;

        if (animate) {
            this.ease({
                y,
                height,
                duration: RESIZE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        } else {
            this.y = y;
            this.height = height;
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
                    }
                },
            });

            return GLib.SOURCE_REMOVE;
        });
    }

    private cancelHide(): void {
        if (this.hideTimeoutId) {
            GLib.source_remove(this.hideTimeoutId);
        }
        this.hideTimeoutId = 0;
    }
}
