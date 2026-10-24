// Below this width the particle shape sits above the hero text instead of beside it (matches Hero.css).
export const WIDE_LAYOUT_MIN = 900

// Shapes are about 2.8 units wide and 2.2 tall (see particles/shapes.ts).
const SHAPE_WIDTH = 2.8
const SHAPE_HEIGHT = 2.2
// Narrow layout: px kept clear at the top for the step counter, and between the shape and the text.
const TOP_CLEARANCE = 72
const TEXT_CLEARANCE = 24

export interface Framing {
  // Where the shape's centre lands on screen, in normalised device coordinates (-1..1, +y up).
  centreX: number
  centreY: number
  // Shape scale, so it fits its slot.
  scale: number
  // Where the world's horizon should sit on screen (NDC y). Narrow screens keep it low, behind the
  // text's bottom fade, so the text stays readable.
  horizonY: number
}

// Fit the shape into the free part of the screen: the right half on desktop, or the gap between the
// step counter and the text on narrow screens. `visibleHeight` is the world-space height the camera
// sees at the shape's distance; `textTop` is where the hero text starts, in px from the canvas top.
export function frameShape(width: number, height: number, textTop: number, visibleHeight: number): Framing {
  const visibleWidth = (visibleHeight * width) / height
  if (width >= WIDE_LAYOUT_MIN) {
    return { centreX: 0.4, centreY: 0, scale: Math.min(1, (visibleWidth * 0.48) / SHAPE_WIDTH), horizonY: -0.3 }
  }

  const unitsPerPixel = visibleHeight / height
  const gap = Math.max(textTop - TOP_CLEARANCE - TEXT_CLEARANCE, height * 0.2)
  const centreFromTop = TOP_CLEARANCE + gap / 2
  return {
    centreX: 0,
    centreY: 1 - (2 * centreFromTop) / height,
    scale: Math.min(0.85, visibleWidth / 3.1, (gap * unitsPerPixel) / SHAPE_HEIGHT),
    horizonY: -0.55,
  }
}
