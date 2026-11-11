import GObject from 'gi://GObject';
import {SnippetEffect} from './snippet-effect.js';

// Cuts the actor (the wheel's blur layer) to the wheel's sector shapes, with soft edges.
// Each sector follows its own animation (scale about the centre, opacity), so the blur
// opens and closes exactly with the sectors drawn on top of it.
export const MAX_RINGS = 4;
export const MAX_SECTORS = 32;
// Clutter takes at most vec4 per uniform (no arrays): two sectors per vec4.
const PACKS = MAX_SECTORS / 2;
const rings = [...Array(MAX_RINGS).keys()];
const DECLARATIONS = `
uniform float size;
${rings.map(i => `uniform vec4 ring${i};`).join('\n')}
// per sector, in wheel order (ring 0 first): scale, opacity; packed two per vec4
${[...Array(PACKS).keys()].map(i => `uniform vec4 pack${i};`).join('\n')}
vec2 animation(float index) {
${[...Array(MAX_SECTORS).keys()].map(k => `    if (index < ${k}.5) return pack${k >> 1}.${k % 2 ? 'zw' : 'xy'};`).join('\n')}
    return vec2(1.0, 0.0);
}
// ring: inner radius, outer radius (px), sector count, half-gap (radians)
float sector(vec4 ring, float offset, float d, float a) {
    if (ring.z < 0.5) return 0.0;
    float step = 6.2831853 / ring.z;
    float turn = mod(a + step * 0.5, 6.2831853);
    vec2 anim = animation(offset + floor(turn / step));
    float dd = d / max(anim.x, 0.001);
    float radial = smoothstep(ring.x - 0.75, ring.x + 0.75, dd) * (1.0 - smoothstep(ring.y - 0.75, ring.y + 0.75, dd));
    float local = mod(turn, step);
    float edge = min(local, step - local);
    return radial * smoothstep(ring.w, ring.w + 1.5 / max(d, 1.0), edge) * anim.y;
}
`;
// Angle 0 at the top, clockwise: sector i is centred on i * step, as wheel.js paints them.
const CODE = `
vec2 p = (cogl_tex_coord_in[0].xy - 0.5) * size;
float d = length(p);
float a = atan(p.x, -p.y);
float mask = 0.0;
float offset = 0.0;
${rings.map(i => `mask += sector(ring${i}, offset, d, a); offset += ring${i}.z;`).join('\n')}
cogl_color_out *= clamp(mask, 0.0, 1.0);
`;

export const RingMask = GObject.registerClass(class RingMask extends SnippetEffect {
    _init(size, ringValues) {
        super._init();
        this.set_uniform_float('size', 1, [size]);
        for (let i = 0; i < MAX_RINGS; i++)
            this.set_uniform_float(`ring${i}`, 4, ringValues[i] ?? [0, 0, 0, 0]);
        this.setSectors([]);
    }

    // [[scale, opacity 0..1], ...] in wheel order; missing sectors are hidden.
    setSectors(values) {
        for (let i = 0; i < PACKS; i++)
            this.set_uniform_float(`pack${i}`, 4, [...(values[2 * i] ?? [1, 0]), ...(values[2 * i + 1] ?? [1, 0])]);
    }

    snippet() {
        return [DECLARATIONS, CODE];
    }
});
