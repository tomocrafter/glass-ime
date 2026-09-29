import GObject from 'gi://GObject';

import { PixelShaderEffect } from './pixelShaderEffect.js';
import { uniqueTypeName } from './typeName.js';

const SHADER = `
uniform float radius;
uniform float saturation;

void main(void) {
    vec4 c = texture2D(tex, cogl_tex_coord_in[0].xy);

    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = clamp(mix(vec3(luma), c.rgb, saturation), 0.0, c.a);

    float d = rect_distance(actor_position(), vec2(0.0), radius);

    cogl_color_out = c * clamp(0.5 - d, 0.0, 1.0);
}`;

/** Clips an actor to an antialiased rounded rectangle and boosts its saturation. */
export class RoundedMaskEffect extends PixelShaderEffect {
    static {
        GObject.registerClass({ GTypeName: uniqueTypeName('RoundedMaskEffect') }, this);
    }

    constructor(radius: number, saturation: number) {
        super(SHADER);
        this.setFloat('radius', radius);
        this.setFloat('saturation', saturation);
    }
}
