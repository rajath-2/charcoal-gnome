import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

// Cuts the actor (the wheel's blur layer) to the wheel's sector shapes, with soft edges.
export const MAX_RINGS = 4;
const DECLARATIONS = `
uniform float size;
${[...Array(MAX_RINGS).keys()].map(i => `uniform vec4 ring${i};`).join('\n')}
// ring: inner radius, outer radius (px), sector count, half-gap (radians)
float sector(vec4 ring, float d, float a) {
    if (ring.z < 0.5) return 0.0;
    float radial = smoothstep(ring.x - 0.75, ring.x + 0.75, d) * (1.0 - smoothstep(ring.y - 0.75, ring.y + 0.75, d));
    float step = 6.2831853 / ring.z;
    float local = mod(a + step * 0.5, step);
    float edge = min(local, step - local);
    return radial * smoothstep(ring.w, ring.w + 1.5 / max(d, 1.0), edge);
}
`;
// Angle 0 at the top, clockwise: sector i is centred on i * step, as wheel.js paints them.
const CODE = `
vec2 p = (cogl_tex_coord_in[0].xy - 0.5) * size;
float d = length(p);
float a = atan(p.x, -p.y);
float mask = ${[...Array(MAX_RINGS).keys()].map(i => `sector(ring${i}, d, a)`).join(' + ')};
cogl_color_out *= clamp(mask, 0.0, 1.0);
`;

export const RingMask = GObject.registerClass(class RingMask extends Clutter.ShaderEffect {
    _init(size, rings) {
        super._init();
        this.set_uniform_float('size', 1, [size]);
        for (let i = 0; i < MAX_RINGS; i++)
            this.set_uniform_float(`ring${i}`, 4, rings[i] ?? [0, 0, 0, 0]);
    }

    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE);
    }
});
