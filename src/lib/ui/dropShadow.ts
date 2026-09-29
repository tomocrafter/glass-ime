import GObject from 'gi://GObject';
import St from 'gi://St';

import { PixelShaderEffect } from './pixelShaderEffect.js';
import { uniqueTypeName } from './typeName.js';

export interface ShadowLayer {
    /** Gaussian standard deviation, in pixels. */
    blur: number;
    offsetY: number;
    opacity: number;
}

const SHADER = `
uniform float extent;
uniform float radius;
uniform float blur;
uniform float offset_y;
uniform float opacity;

float erf(float x) {
    float t = 1.0 / (1.0 + 0.3275911 * abs(x));
    float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
        - 0.284496736) * t + 0.254829592) * t * exp(-x * x);

    return sign(x) * y;
}

void main(void) {
    vec2 position = actor_position();
    vec2 panel = actor_size() - vec2(2.0 * extent);
    vec2 center = actor_size() * 0.5;

    float shadow = rounded_rect_distance(position, center + vec2(0.0, offset_y), panel, radius);
    float alpha = opacity * 0.5 * (1.0 - erf(shadow / (blur * 1.41421356)));

    // Nothing under the panel itself, so its antialiased edge stays clean.
    alpha *= clamp(rounded_rect_distance(position, center, panel, radius) + 0.5, 0.0, 1.0);

    // Dither to hide 8-bit banding in the long, faint falloff.
    float noise = fract(sin(dot(position, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    alpha = clamp(alpha + noise / 255.0, 0.0, 1.0);

    cogl_color_out = vec4(0.0, 0.0, 0.0, alpha);
}`;

/** A smooth Gaussian drop shadow for a rounded rectangle, drawn around its parent. */
export class DropShadow extends St.Widget {
    static {
        GObject.registerClass({ GTypeName: uniqueTypeName('DropShadow') }, this);
    }

    /** How far the shadow reaches beyond the panel. */
    readonly spread: number;
    private readonly shader = new PixelShaderEffect(SHADER);

    constructor(radius: number, { blur, offsetY, opacity }: ShadowLayer) {
        // The shader ignores what the actor paints, but it has to paint something to run.
        super({ style: 'background-color: black;' });

        this.spread = Math.ceil(3 * blur + Math.abs(offsetY));
        this.shader.setFloat('extent', this.spread);
        this.shader.setFloat('radius', radius);
        this.shader.setFloat('blur', blur);
        this.shader.setFloat('offset_y', offsetY);
        this.shader.setFloat('opacity', opacity);
        this.add_effect(this.shader);
    }

    /** Surrounds a panel occupying the given rectangle of the parent. */
    fit(x: number, y: number, width: number, height: number): void {
        const size: [number, number] = [width + 2 * this.spread, height + 2 * this.spread];

        this.set_position(x - this.spread, y - this.spread);
        this.set_size(...size);
        this.shader.setSize(...size);
    }
}
