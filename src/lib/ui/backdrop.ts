import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import type { Rect } from './geometry.js';
import { RoundedMaskEffect } from './roundedMaskEffect.js';
import { uniqueTypeName } from './typeName.js';

/** Extra area sampled around the canvas so the blur does not fade out at its edges. */
const BLUR_MARGIN = 48;

/** An actor whose children never contribute to its parent's preferred size. */
export class DetachedLayer extends St.Widget {
    static {
        GObject.registerClass({ GTypeName: uniqueTypeName('DetachedLayer') }, this);
    }

    override vfunc_get_preferred_width(_forHeight: number): [number, number] {
        return [0, 0];
    }

    override vfunc_get_preferred_height(_forWidth: number): [number, number] {
        return [0, 0];
    }
}

/**
 * A live, blurred and rounded copy of what lies behind the panel.
 *
 * Shell.BlurMode.BACKGROUND cannot be clipped to rounded corners, so this
 * clones the wallpaper and windows behind the panel and blurs the clones in
 * ACTOR mode instead. global.window_group itself has no size and cannot be
 * cloned as a whole.
 *
 * The actor covers a canvas and the rounded panel moves within it, so the
 * blurred texture survives while the panel animates.
 */
export class Backdrop extends DetachedLayer {
    static {
        GObject.registerClass({ GTypeName: uniqueTypeName('Backdrop') }, this);
    }

    private readonly blurHost = new St.Widget({ clip_to_allocation: true });
    private readonly sources = new Clutter.Actor();
    private readonly clones = new Map<Clutter.Actor, Clutter.Clone>();
    private readonly mask: RoundedMaskEffect;

    constructor(radius: number, blurRadius: number, saturation: number) {
        super({ clip_to_allocation: true });

        this.blurHost.add_child(this.sources);
        this.blurHost.add_effect(
            new Shell.BlurEffect({ mode: Shell.BlurMode.ACTOR, radius: blurRadius, brightness: 1 }),
        );
        this.blurHost.set_position(-BLUR_MARGIN, -BLUR_MARGIN);
        this.add_child(this.blurHost);

        this.mask = new RoundedMaskEffect(radius, saturation);
        this.add_effect(this.mask);
    }

    /** Covers the canvas at the given stage rectangle, cloning what lies behind it. */
    setCanvas(canvas: Rect): void {
        this.set_size(canvas.width, canvas.height);
        this.blurHost.set_size(canvas.width + 2 * BLUR_MARGIN, canvas.height + 2 * BLUR_MARGIN);
        this.sources.set_position(BLUR_MARGIN - canvas.x, BLUR_MARGIN - canvas.y);
        this.capture(canvas);
    }

    /** Shows the rounded panel at the given rectangle of the canvas. */
    setPanel(panel: Rect): void {
        this.mask.setRect(panel);
    }

    /** Drops every clone while the panel is hidden, so that nothing keeps windows referenced. */
    release(): void {
        for (const clone of this.clones.values()) {
            clone.destroy();
        }
        this.clones.clear();
    }

    /** Clones the wallpaper and windows that overlap the canvas, in stacking order. */
    private capture(canvas: Rect): void {
        const x1 = canvas.x - BLUR_MARGIN;
        const y1 = canvas.y - BLUR_MARGIN;
        const x2 = canvas.x + canvas.width + BLUR_MARGIN;
        const y2 = canvas.y + canvas.height + BLUR_MARGIN;
        const overlaps = (actor: Clutter.Actor) =>
            actor.x < x2 &&
            actor.x + actor.width > x1 &&
            actor.y < y2 &&
            actor.y + actor.height > y1;

        const backgrounds = global.window_group
            .get_children()
            .filter((actor) => actor instanceof Meta.BackgroundGroup)
            .flatMap((group) => group.get_children());
        const windows = global
            .get_window_actors()
            .filter((actor) => actor.visible && !actor.meta_window?.minimized);

        const wanted = [...backgrounds, ...windows].filter(overlaps);

        for (const [source, clone] of this.clones) {
            if (!wanted.includes(source)) {
                clone.destroy();
                this.clones.delete(source);
            }
        }

        wanted.forEach((source, index) => this.syncClone(source, index));
    }

    private syncClone(source: Clutter.Actor, index: number): void {
        let clone = this.clones.get(source);

        if (!clone) {
            clone = new Clutter.Clone({ source });
            this.clones.set(source, clone);
            this.sources.add_child(clone);
        }

        if (clone.x !== source.x || clone.y !== source.y) {
            clone.set_position(source.x, source.y);
        }

        if (clone.width !== source.width || clone.height !== source.height) {
            clone.set_size(source.width, source.height);
        }

        if (this.sources.get_child_at_index(index) !== clone) {
            this.sources.set_child_at_index(clone, index);
        }
    }
}
