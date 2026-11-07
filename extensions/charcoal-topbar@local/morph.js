// At zero the pieces meet with square interior edges; at one they are the islands.
export function morphRects(width, height, boxes, progress, cornerRadius = 10) {
    const t = Math.max(0, Math.min(1, progress));
    const seams = [0, (boxes[0].x + boxes[0].width + boxes[1].x) / 2,
        (boxes[1].x + boxes[1].width + boxes[2].x) / 2, width];
    const radius = Math.min(cornerRadius, height / 2);
    return boxes.map((box, i) => {
        const x = seams[i] + (box.x - seams[i]) * t;
        const end = seams[i + 1] + (box.x + box.width - seams[i + 1]) * t;
        return {x, width: Math.max(0, end - x), height,
            leftRadius: i === 0 ? radius : radius * t,
            rightRadius: i === 2 ? radius : radius * t};
    });
}

export function roundedPath(cr, rect, offsetX = 0, offsetY = 0) {
    const x = rect.x + offsetX, y = offsetY;
    const right = x + rect.width, bottom = y + rect.height;
    const l = Math.min(rect.leftRadius, rect.width / 2);
    const r = Math.min(rect.rightRadius, rect.width / 2);
    cr.newSubPath();
    cr.moveTo(x + l, y);
    cr.lineTo(right - r, y);
    if (r) cr.arc(right - r, y + r, r, -Math.PI / 2, 0);
    cr.lineTo(right, bottom - r);
    if (r) cr.arc(right - r, bottom - r, r, 0, Math.PI / 2);
    cr.lineTo(x + l, bottom);
    if (l) cr.arc(x + l, bottom - l, l, Math.PI / 2, Math.PI);
    cr.lineTo(x, y + l);
    if (l) cr.arc(x + l, y + l, l, Math.PI, Math.PI * 1.5);
    cr.closePath();
}

// The outline of the joined bar: one rounded rectangle across the whole panel.
function joined(width, height, radius) {
    const r = Math.min(radius, height / 2);
    return {x: 0, width, height, leftRadius: r, rightRadius: r};
}

// Shapes the auto bar fills at this progress, in logical px relative to the panel.
// Shared by the painter and the blur mask so both always cover exactly the same area.
export function morphShapes(width, height, boxes, progress, radius = 10) {
    return progress < 0.001 ? [joined(width, height, radius)]
        : morphRects(width, height, boxes, progress, radius);
}

// style: {color: [r,g,b] 0..1, line: [r,g,b], opacity, border (alphas 0..1), radius, shadow}
// Both endpoints use the same opacity and outline so the split/join morph has no jumps.
export const DEFAULT_STYLE = {color: [18 / 255, 18 / 255, 18 / 255], line: [235 / 255, 235 / 255, 235 / 255],
    opacity: 0.78, border: 0.15, borderWidth: 1, radius: 10, shadow: true, shadowColor: [0, 0, 0], shadowSize: 12, shadowOpacity: 0.22};
// Room around the panel the surface paints into, for the shadow (logical px).
export const BLEED = 40;

export function paintMorph(cr, width, height, boxes, progress, scale = 1, style = DEFAULT_STYLE) {
    // Geometry is in logical CSS pixels, including on scaled displays.
    cr.scale(scale, scale);
    const w = width / scale, h = height / scale;
    const t = Math.max(0, Math.min(1, progress));
    const shapes = morphShapes(w, h, boxes.map(b => ({x: b.x / scale, width: b.width / scale})), t, style.radius);
    if (style.shadow && style.shadowSize > 0) {
        // Soft drop shadow like the compact bar's CSS shadow, without a blur filter: stacked,
        // growing shapes whose alphas add up to a smooth falloff - half strength at the bar's edge,
        // fading to nothing SPREAD px out - so no hard-edged shape shows around the corners.
        const SPREAD = Math.min(BLEED - 4, Math.round(style.shadowSize * 0.75)), OFFSET = Math.round(style.shadowSize / 4);
        const STRENGTH = style.shadowOpacity;
        const coverage = d => 0.5 * STRENGTH * (1 - d / SPREAD) ** 2;
        for (let i = SPREAD; i >= 1; i--) {
            for (const rect of shapes)
                roundedPath(cr, {...rect, x: rect.x - i, width: rect.width + 2 * i, height: rect.height + 2 * i,
                    leftRadius: rect.leftRadius + i, rightRadius: rect.rightRadius + i}, BLEED, BLEED + OFFSET - i);
            cr.setSourceRGBA(...style.shadowColor, coverage(i - 1) - coverage(i));
            cr.fill();
        }
    }
    // One path: overlapping pieces would darken their seams.
    for (const rect of shapes) roundedPath(cr, rect, BLEED, BLEED);
    cr.setSourceRGBA(...style.color, style.opacity);
    cr.fill();
    // The joined outline hands over to the pieces' outlines while the gaps are still hairline-thin:
    // constant strength, no seam pop at the start, no line left across open gaps.
    const handover = Math.min(1, t / 0.15);
    if (!(style.borderWidth > 0))
        return;
    cr.setLineWidth(style.borderWidth);
    if (handover < 1) {
        roundedPath(cr, joined(w, h, style.radius), BLEED, BLEED);
        cr.setSourceRGBA(...style.line, style.border * (1 - handover));
        cr.stroke();
    }
    if (t >= 0.001) {
        for (const rect of shapes) roundedPath(cr, rect, BLEED, BLEED);
        cr.setSourceRGBA(...style.line, style.border * handover);
        cr.stroke();
    }
}

// The texture an offscreen effect (our blur mask) renders into is not the actor's box: Clutter
// quantizes and enlarges it (_clutter_actor_box_enlarge_for_effects). Returns that texture's
// [x, y, width, height] relative to the actor, given the actor's stage position and size, so the
// mask can map texture coordinates back to actor pixels exactly.
export function effectBox(x, y, width, height) {
    const w = Math.round(width), h = Math.round(height);
    const x2 = Math.ceil(x + width + 0.75), y2 = Math.ceil(y + height + 0.75);
    return [x2 - w - 3 - x, y2 - h - 3 - y, w + 3, h + 3];
}
