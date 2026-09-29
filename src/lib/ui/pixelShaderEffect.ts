import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import type { Rect } from '../geometry.js';
import { uniqueTypeName } from './typeName.js';

const PRELUDE = `
uniform sampler2D tex;
uniform float texture_width;
uniform float texture_height;
uniform float padding;
uniform float rect_x;
uniform float rect_y;
uniform float rect_width;
uniform float rect_height;

vec2 actor_position() {
    return cogl_tex_coord_in[0].xy * vec2(texture_width, texture_height) - vec2(padding);
}

/** Signed distance to the rounded rectangle given by setRect(), shifted by offset. */
float rect_distance(vec2 position, vec2 offset, float radius) {
    vec2 size = vec2(rect_width, rect_height);
    vec2 center = vec2(rect_x, rect_y) + size * 0.5 + offset;
    vec2 q = abs(position - center) - (size * 0.5 - vec2(radius));

    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
`;

/**
 * Clutter renders offscreen effects into a texture enlarged by 3px, with the
 * actor 2px from its top-left corner (_clutter_actor_box_enlarge_for_effects).
 */
const TEXTURE_PADDING = 2;

function floatValue(value: number): GObject.Value {
    const v = new GObject.Value();
    v.init(GObject.TYPE_DOUBLE);
    v.set_double(value);

    return v;
}

/**
 * A fragment shader that works in the actor's own pixel coordinates and
 * shapes a rounded rectangle given in uniforms. Moving that rectangle only
 * updates uniforms, so the cached offscreen texture is reused.
 */
export class PixelShaderEffect extends Clutter.ShaderEffect {
    static {
        GObject.registerClass({ GTypeName: uniqueTypeName('PixelShaderEffect') }, this);
    }

    constructor(source: string) {
        super();
        this.set_shader_source(PRELUDE + source);
        this.setFloat('padding', TEXTURE_PADDING);
        this.setRect({ x: 0, y: 0, width: 1, height: 1 });
    }

    setFloat(name: string, value: number): void {
        this.set_uniform_value(name, floatValue(value));
    }

    setRect({ x, y, width, height }: Rect): void {
        this.setFloat('rect_x', x);
        this.setFloat('rect_y', y);
        this.setFloat('rect_width', Math.max(width, 1));
        this.setFloat('rect_height', Math.max(height, 1));
        this.queue_repaint();
    }

    override vfunc_paint_target(node: Clutter.PaintNode, context: Clutter.PaintContext): void {
        const texture = this.get_texture();
        this.setFloat('texture_width', texture.get_width());
        this.setFloat('texture_height', texture.get_height());

        super.vfunc_paint_target(node, context);
    }
}
