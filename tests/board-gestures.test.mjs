// Zoom and pan gesture arithmetic (board/gestures.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelPixels, wheelZoomFactor, pinchStep, isDrag } from '../board/gestures.js';

test('wheel: a notch zooms about 12%, out and in are symmetric, units are normalised', () => {
  const notch = wheelZoomFactor({ deltaY: 100, deltaMode: 0 });
  assert.ok(notch < 1 && notch > 0.85, `scrolling down zooms out a little (${notch})`);
  assert.ok(Math.abs(wheelZoomFactor({ deltaY: -100, deltaMode: 0 }) * notch - 1) < 1e-9);
  assert.equal(wheelPixels({ deltaY: 3, deltaMode: 1 }), 48, 'lines');
  assert.equal(wheelPixels({ deltaY: 1, deltaMode: 2 }, 700), 700, 'pages');
  assert.equal(wheelZoomFactor({ deltaY: 5000, deltaMode: 0 }), wheelZoomFactor({ deltaY: 120, deltaMode: 0 }), 'one event never jumps far');
  // a trackpad pinch (Ctrl+wheel) sends small deltas, so each counts for more
  assert.ok(wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true }) > wheelZoomFactor({ deltaY: -10, deltaMode: 0 }));
});

test('pinch: spreading fingers zooms in about their midpoint; moving them together pans', () => {
  const a = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  const spread = pinchStep(a, [{ x: 50, y: 100 }, { x: 250, y: 100 }]);
  assert.equal(spread.factor, 2);
  assert.deepEqual([spread.mid.x, spread.mid.y, spread.dx, spread.dy], [150, 100, 0, 0]);
  const slide = pinchStep(a, [{ x: 130, y: 140 }, { x: 230, y: 140 }]);
  assert.equal(slide.factor, 1);
  assert.deepEqual([slide.dx, slide.dy], [30, 40]);
  assert.equal(pinchStep([{ x: 1, y: 1 }, { x: 1, y: 1 }], a).factor, 1, 'no division by zero');
});

test('a press that moves a few pixels is still a click', () => {
  assert.equal(isDrag(0, 0, 3, 2), false);
  assert.equal(isDrag(0, 0, 6, 0), true);
});
