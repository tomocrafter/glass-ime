import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { RoundedMaskEffect } from './roundedMaskEffect.js';
import { uniqueTypeName } from './typeName.js';

/** Extra area sampled around the panel so the blur does not fade out at its edges. */
const BLUR_MARGIN = 48;

export interface StageArea {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

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
        super({ x_expand: true, y_expand: true, clip_to_allocation: true });

        this.blurHost.add_child(this.sources);
        this.blurHost.add_effect(
            new Shell.BlurEffect({ mode: Shell.BlurMode.ACTOR, radius: blurRadius, brightness: 1 }),
        );
        this.add_child(this.blurHost);

        this.mask = new RoundedMaskEffect(radius, saturation);
        this.add_effect(this.mask);

        this.connect('notify::size', () => this.syncSize());
    }

    /** Keeps the clones aligned with the stage while the panel sits at (x, y). */
    followPanel(x: number, y: number): void {
        this.sources.set_position(BLUR_MARGIN - x, BLUR_MARGIN - y);
    }

    /** Clones the wallpaper and windows that overlap `area`, in stacking order. */
    capture(area: StageArea): void {
        const x1 = area.x1 - BLUR_MARGIN;
        const y1 = area.y1 - BLUR_MARGIN;
        const x2 = area.x2 + BLUR_MARGIN;
        const y2 = area.y2 + BLUR_MARGIN;
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

    /** Drops every clone while the panel is hidden, so that nothing keeps windows referenced. */
    release(): void {
        for (const clone of this.clones.values()) {
            clone.destroy();
        }
        this.clones.clear();
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

    private syncSize(): void {
        const [width, height] = this.get_size();

        this.blurHost.set_position(-BLUR_MARGIN, -BLUR_MARGIN);
        this.blurHost.set_size(width + 2 * BLUR_MARGIN, height + 2 * BLUR_MARGIN);
        this.mask.setSize(width, height);
    }
}
