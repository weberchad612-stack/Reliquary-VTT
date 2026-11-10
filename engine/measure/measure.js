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
