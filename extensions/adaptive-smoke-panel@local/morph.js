// At zero the pieces meet with square interior edges; at one they are the islands.
export function morphRects(width, height, boxes, progress) {
    const t = Math.max(0, Math.min(1, progress));
    const seams = [0, (boxes[0].x + boxes[0].width + boxes[1].x) / 2,
        (boxes[1].x + boxes[1].width + boxes[2].x) / 2, width];
    const radius = Math.min(10, height / 2);
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

export function paintMorph(cr, width, height, boxes, progress, scale = 1) {
    // Geometry is in logical CSS pixels, including on scaled displays.
    cr.scale(scale, scale);
    const rects = morphRects(width / scale, height / scale,
        boxes.map(b => ({x: b.x / scale, width: b.width / scale})), progress);
    const t = Math.max(0, Math.min(1, progress));
    // Paint the connected endpoint as one path: no internal seams or dark overlaps.
    const shapes = t < 0.001 ? [{x: 0, width: width / scale, height: height / scale,
        leftRadius: 10, rightRadius: 10}] : rects;
    for (const rect of shapes) roundedPath(cr, rect, 12, 15);
    cr.setSourceRGBA(0, 0, 0, 0.12);
    cr.fillPreserve();
    cr.setLineWidth(6);
    cr.stroke();
    for (const rect of shapes) roundedPath(cr, rect, 12, 12);
    cr.setSourceRGBA(18 / 255, 18 / 255, 18 / 255, 0.78 + 0.12 * t);
    cr.fill();
    // Inner edge highlights emerge with the split, rather than appearing at once.
    for (const rect of shapes) roundedPath(cr, rect, 12, 12);
    cr.setSourceRGBA(235 / 255, 235 / 255, 235 / 255, t < 0.001 ? 0.15 : 0.14 * t);
    cr.setLineWidth(1);
    cr.stroke();
}
