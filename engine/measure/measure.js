// Distance on the grid: rulers, reach and range. Terrain never changes a distance; it changes what
// moving costs (engine/movement routeCost and path). Implements docs/design/maps.md section 9b.
//
// Diagonals follow the ruleset's repeating pattern, as in movement: PF2E 5-10-5 is [1, 2] (the default),
// D&D 5e's default is [1]. Distances are in cells; multiply by feet per cell for feet.

/** Cells to cover dx columns and dy rows, with the diagonal pattern starting at `parity` (0 = first diagonal). */
export function gridDistance(dx, dy, diagonalCosts = [1, 2], parity = 0) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const d = Math.min(ax, ay), straight = Math.max(ax, ay) - d;
  let cost = straight;
  for (let i = 0; i < d; i++) cost += diagonalCosts[(parity + i) % diagonalCosts.length];
  return cost;
}

/**
 * Length of a ruler drawn through waypoints (square centres or any cells): the diagonal pattern carries
 * on from one leg to the next, as it does for one continuous move.
 * @param {Array<[number, number]>} points  cells
 * @returns {{cells: number, legs: number[]}}  total and per-leg lengths in cells
 */
export function rulerLength(points, diagonalCosts = [1, 2]) {
  let parity = 0, total = 0;
  const legs = [];
  for (let i = 1; i < points.length; i++) {
    const dx = Math.round(points[i][0] - points[i - 1][0]), dy = Math.round(points[i][1] - points[i - 1][1]);
    const c = gridDistance(dx, dy, diagonalCosts, parity);
    parity = (parity + Math.min(Math.abs(dx), Math.abs(dy))) % diagonalCosts.length;
    legs.push(c); total += c;
  }
  return { cells: total, legs };
}

/**
 * Distance between two creatures' spaces, {x, y, size}, counted the way reach and range are: from a
 * square of one space to the nearest square of the other. Adjacent spaces are 1 cell apart (5 ft);
 * a space is 0 from itself or from a space it overlaps (sharing a square).
 */
export function spaceDistance(a, b, diagonalCosts = [1, 2]) {
  const as = Math.max(1, Math.ceil(a.size || 1)), bs = Math.max(1, Math.ceil(b.size || 1));
  const ax = Math.floor(a.x), ay = Math.floor(a.y), bx = Math.floor(b.x), by = Math.floor(b.y);
  // squares between the two spaces along each axis, plus the step into the other space
  const gap = (a0, aSize, b0, bSize) => {
    if (b0 >= a0 + aSize) return b0 - (a0 + aSize) + 1;
    if (a0 >= b0 + bSize) return a0 - (b0 + bSize) + 1;
    return 0; // the spaces overlap on this axis
  };
  return gridDistance(gap(ax, as, bx, bs), gap(ay, as, by, bs), diagonalCosts);
}

/** How tall a creature is, in squares: as tall as it is wide (Medium and Small 1, Large 2, Huge 3; Tiny 1). */
export function heightSquares(size) {
  return Math.max(1, Math.ceil(size || 1));
}

/**
 * Squares between two creatures' height columns, counted like the gap between their spaces: 0 when the
 * columns overlap, 1 when one is right on top of the other, and so on. A creature {elevation (feet), size}
 * fills from its elevation up to elevation + its height.
 */
export function verticalGap(a, b, squareFeet = 5) {
  const a0 = a.elevation || 0, a1 = a0 + heightSquares(a.size) * squareFeet;
  const b0 = b.elevation || 0, b1 = b0 + heightSquares(b.size) * squareFeet;
  if (b0 >= a1) return Math.ceil((b0 - a1) / squareFeet - 1e-9) + 1;
  if (a0 >= b1) return Math.ceil((a0 - b1) / squareFeet - 1e-9) + 1;
  return 0;
}

/**
 * Distance between two creatures in three dimensions, in squares: the flat nearest-square distance and the
 * vertical gap combined with the same diagonal pattern (PF2E's 5-10-5; the system's measurement.vertical is
 * 'diagonal'). With no height difference it is the flat distance.
 * @returns {{cells: number, across: number, up: number}}  up: the vertical gap in squares
 */
export function spaceDistance3D(a, b, diagonalCosts = [1, 2], squareFeet = 5) {
  const across = spaceDistance(a, b, diagonalCosts), up = verticalGap(a, b, squareFeet);
  return { cells: up ? gridDistance(across, up, diagonalCosts) : across, across, up };
}

