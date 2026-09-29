import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { uniqueTypeName } from './typeName.js';

const PRELUDE = `
uniform sampler2D tex;
uniform float texture_width;
uniform float texture_height;
uniform float padding;
uniform float width;
uniform float height;

vec2 actor_size() {
    return vec2(width, height);
}

vec2 actor_position() {
    return cogl_tex_coord_in[0].xy * vec2(texture_width, texture_height) - vec2(padding);
}

float rounded_rect_distance(vec2 position, vec2 center, vec2 size, float radius) {
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

/** A fragment shader that works in the actor's own pixel coordinates. */
export class PixelShaderEffect extends Clutter.ShaderEffect {
    static {
        GObject.registerClass({ GTypeName: uniqueTypeName('PixelShaderEffect') }, this);
    }

    constructor(source: string) {
        super({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
        this.set_shader_source(PRELUDE + source);
        this.setFloat('padding', TEXTURE_PADDING);
        this.setSize(1, 1);
    }

    setFloat(name: string, value: number): void {
        this.set_uniform_value(name, floatValue(value));
    }

    setSize(width: number, height: number): void {
        this.setFloat('width', Math.max(width, 1));
        this.setFloat('height', Math.max(height, 1));
    }

    override vfunc_paint_target(node: Clutter.PaintNode, context: Clutter.PaintContext): void {
        const texture = this.get_texture();
        this.setFloat('texture_width', texture.get_width());
        this.setFloat('texture_height', texture.get_height());

        super.vfunc_paint_target(node, context);
    }
}
