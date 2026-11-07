import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

// Cuts the auto bar's blur layer to the bar's current shapes (up to three rounded pieces),
// so the blur stays exactly under the bar while it splits into islands and back.
// Coordinates are the layer's own pixels (the layer covers the panel).
const SHAPES = 3;
const DECLARATIONS = `
uniform vec2 size;   // layer width, height
uniform vec4 box;    // the effect texture's x, y, width, height in layer pixels
${[...Array(SHAPES).keys()].map(i => `uniform vec4 shape${i};`).join('\n')}
// shape: x, width, left radius, right radius; width 0 = unused
float piece(vec4 s, vec2 p) {
    if (s.y <= 0.0) return 0.0;
    vec2 half_size = vec2(s.y, size.y) * 0.5;
    vec2 q = p - vec2(s.x, 0.0) - half_size;
    float r = min(q.x < 0.0 ? s.z : s.w, min(half_size.x, half_size.y));
    vec2 e = abs(q) - half_size + r;
    float dist = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
    return clamp(0.5 - dist, 0.0, 1.0);
}
`;
const CODE = `
vec2 p = box.xy + cogl_tex_coord_in[0].xy * box.zw;
cogl_color_out *= max(max(piece(shape0, p), piece(shape1, p)), piece(shape2, p));
`;

export const PanelMask = GObject.registerClass(class PanelMask extends Clutter.ShaderEffect {
    setShapes(size, box, shapes) {
        this.set_uniform_float('size', 2, size);
        this.set_uniform_float('box', 4, box);
        for (let i = 0; i < SHAPES; i++) {
            const s = shapes[i];
            this.set_uniform_float(`shape${i}`, 4, s ? [s.x, s.width, s.leftRadius, s.rightRadius] : [0, 0, 0, 0]);
        }
    }

    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE);
    }
});
