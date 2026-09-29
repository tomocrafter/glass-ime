import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { uniqueTypeName } from './typeName.js';

const SHADER = `
uniform sampler2D tex;
uniform float width;
uniform float height;
uniform float radius;
uniform float saturation;

void main(void) {
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 c = texture2D(tex, uv);

    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = clamp(mix(vec3(luma), c.rgb, saturation), 0.0, c.a);

    vec2 size = vec2(width, height);
    vec2 q = abs(uv * size - size * 0.5) - (size * 0.5 - vec2(radius));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;

    cogl_color_out = c * clamp(0.5 - d, 0.0, 1.0);
}`;

function floatValue(value: number): GObject.Value {
    const v = new GObject.Value();
    v.init(GObject.TYPE_DOUBLE);
    v.set_double(value);
    return v;
}

/** Clips an actor to an antialiased rounded rectangle and boosts its saturation. */
export class RoundedMaskEffect extends Clutter.ShaderEffect {
    static {
        GObject.registerClass({ GTypeName: uniqueTypeName('RoundedMaskEffect') }, this);
    }

    constructor(radius: number, saturation: number) {
        super({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
        this.set_shader_source(SHADER);
        this.set_uniform_value('radius', floatValue(radius));
        this.set_uniform_value('saturation', floatValue(saturation));
        this.setSize(1, 1);
    }

    setSize(width: number, height: number): void {
        this.set_uniform_value('width', floatValue(Math.max(width, 1)));
        this.set_uniform_value('height', floatValue(Math.max(height, 1)));
    }
}
