// The marching order, at the top of the Exploration tab (the user, 2026-11-14; first its own tab): the party on a 4 x 4 grid, the front row at the top under an arrow
// pointing the way the party travels. Everyone moves anyone (drag a token to a square, or tap it and tap the square;
// a token dropped on another swaps with it). The GM adds others who travel with the party (a companion, an allied
// NPC) and takes them off again. The party keeps this order when it arrives on a map (board/travel.js
// formationArrival) and when Claude moves it (tools/marching.mjs), turned to face the way it heads, in column where
// the block does not fit. Docs: docs/best-practices/board.md (Marching order).
//
// o: {store, view() -> 'gm' | 'player', readOnly, pane, E (the engine: marchMembers, marchSlots, marchMove),
// tokens() -> {id: token} (the party's map), art(token) -> image URL or null, colour(token), log(text)}.
// Returns {render(), refresh()} (refresh: redraw only when the party itself changed).

export const MARCHING = 'state/marching';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ROWS = ['Front', 'Second', 'Third', 'Rear'];

/** The grid's HTML (pure). members: [{id, name, art, colour, extra}]; slots: {id: [col, row]}; picked: id or null. */
export function gridHtml({ members, slots, picked = null, write = false }) {
  const at = {};
  for (const m of members) if (slots[m.id]) at[slots[m.id].join(',')] = m;
  let cells = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const m = at[`${c},${r}`];
      const label = `${ROWS[r]} row, ${['far left', 'left', 'right', 'far right'][c]}`;
      cells += `<div class="mo-cell${m ? ' mo-full' : ''}" data-cell="${c},${r}" role="gridcell" aria-label="${esc(label)}${m ? `: ${esc(m.name)}` : ''}"${write ? ' tabindex="0"' : ''}>`
        + (m ? `<div class="mo-tok${picked === m.id ? ' mo-picked' : ''}" data-id="${esc(m.id)}" title="${esc(m.name)}${m.extra ? ' (travelling with the party)' : ''}" style="--mo-ring:${esc(m.colour)}">`
          + (m.art ? `<img src="${esc(m.art)}" alt="" draggable="false">` : `<span>${esc(String(m.name || '?').slice(0, 1).toUpperCase())}</span>`)
          + `</div><div class="mo-name">${esc(m.name)}</div>` : '')
        + '</div>';
    }
  }
  return `<div class="mo-fwd" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 3 L21 13 H15 V21 H9 V13 H3 Z" fill="currentColor"/></svg><span>Forward</span></div>`
    + `<div class="mo-grid" role="grid" aria-label="Marching order: the front row at the top">${cells}</div>`;
}

export function mountMarching(o) {
  const { store, pane, E } = o;
  let rec = { slots: {}, extra: [] }, picked = null, drag = null;
  const canWrite = () => !o.readOnly;
  const gm = () => o.view() === 'gm';

  function current() {
    const tokens = o.tokens() || {};
    const ids = E.marchMembers(tokens, rec);
    const slots = E.marchSlots(ids, rec.slots || {});
    const extra = new Set(rec.extra || []);
    const members = ids.map((id) => ({ id, name: tokens[id].name || id, art: o.art(tokens[id]), colour: o.colour(tokens[id]), extra: extra.has(id) }));
    return { tokens, ids, slots, members, extra };
  }

  async function save(next, words) {
    rec = next;
    render();
    try {
      await store.set(MARCHING, next);
      if (words) o.log(words);
    } catch (e) { pane.querySelector('.mo-msg').textContent = `Could not save the marching order (${e.message || e}).`; }
  }

  function moveMember(id, cell) {
    const { slots, tokens } = current();
    const [c, r] = cell.split(',').map(Number);
    if (slots[id] && slots[id][0] === c && slots[id][1] === r) return;
    const next = E.marchMove(slots, id, [c, r]);
    picked = null;
    save({ ...rec, slots: next }, `marching order: ${tokens[id] ? tokens[id].name || id : id} to the ${ROWS[r].toLowerCase()} row`);
  }

  function render() {
    const { tokens, members, slots, extra } = current();
    const write = canWrite();
    let html = `<div class="mo"><h3 class="mo-title">Marching order</h3>${gridHtml({ members, slots, picked, write })}`;
    // how it works, one point per line (the user, 2026-11-14)
    const how = [
      ...(write ? ['Drag a token to a square, or tap it and then the square. Dropping one on another swaps them.'] : []),
      'Placement is relative: only the shape and who stands where count, not where on the grid you draw it.',
      'The arrow points the way the party travels; the shape turns to face it.',
      'The party keeps this order when it arrives on a map and when Claude moves it.',
      'In a narrow passage it goes in column, front row first.',
      'Nobody is placed on ground the party has not explored.',
    ];
    html += members.length ? `<ul class="mo-help">${how.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="mo-msg muted">No one is in the party on this map yet.</p>';
    html += '<p class="mo-msg muted" aria-live="polite"></p>';
    if (gm() && write) {
      const others = Object.entries(tokens).filter(([id, t]) => t && !t.dead && t.kind !== 'pc' && t.kind !== 'object' && !extra.has(id))
        .sort(([, a], [, b]) => String(a.name || '').localeCompare(String(b.name || '')));
      const added = members.filter((m) => m.extra);
      html += `<div class="mo-gm"><b>Travelling with the party (GM)</b>`
        + (added.length ? `<ul>${added.map((m) => `<li>${esc(m.name)} <button type="button" class="mo-drop" data-id="${esc(m.id)}" title="Take ${esc(m.name)} out of the marching order">Remove</button></li>`).join('')}</ul>` : '<p class="muted">Only the PCs.</p>')
        + (others.length && members.length < 16 ? `<label>Add <select class="mo-add"><option value="">a companion or ally on this map…</option>${others.map(([id, t]) => `<option value="${esc(id)}">${esc(t.name || id)}</option>`).join('')}</select></label>` : '')
        + '</div>';
    }
    pane.innerHTML = html + '</div>';
  }

  // tap a token, then a square; or drag a token onto a square. Once a drag starts the window follows the pointer (in
  // the capture phase), so the map's own handlers (an encounter's, an aim) can never swallow its moves.
  function onMove(ev) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 6) {
      drag.moved = true;
      const src = pane.querySelector(`.mo-tok[data-id="${CSS.escape(drag.id)}"]`);
      if (src) { drag.ghost = src.cloneNode(true); drag.ghost.classList.add('mo-ghost'); document.body.appendChild(drag.ghost); src.classList.add('mo-lifted'); }
    }
    if (drag.ghost) { drag.ghost.style.left = `${ev.clientX}px`; drag.ghost.style.top = `${ev.clientY}px`; }
    for (const c of pane.querySelectorAll('.mo-over')) c.classList.remove('mo-over');
    const under = drag.moved && document.elementFromPoint(ev.clientX, ev.clientY);
    const cell = under && under.closest && under.closest('.mo-cell');
    if (cell && pane.contains(cell)) cell.classList.add('mo-over');
  }
  function stop() {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
  }
  function onUp(ev) {
    if (!drag) return stop();
    const d = drag;
    drag = null;
    stop();
    if (d.ghost) d.ghost.remove();
    if (!d.moved) { picked = picked === d.id ? null : d.id; render(); return; }
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const cell = under && under.closest && under.closest('.mo-cell');
    if (cell && pane.contains(cell)) moveMember(d.id, cell.dataset.cell); else render();
  }
  function onCancel() { if (drag && drag.ghost) drag.ghost.remove(); drag = null; stop(); render(); }
  pane.addEventListener('pointerdown', (ev) => {
    const tok = ev.target.closest('.mo-tok');
    if (!tok || !canWrite() || ev.button > 0) return;
    ev.preventDefault();
    drag = { id: tok.dataset.id, x: ev.clientX, y: ev.clientY, moved: false, ghost: null };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
  });
  pane.addEventListener('click', (ev) => {
    const cell = ev.target.closest('.mo-cell');
    if (cell && picked && !ev.target.closest('.mo-tok') && canWrite()) { moveMember(picked, cell.dataset.cell); return; }
    const drop = ev.target.closest('.mo-drop');
    if (drop && gm() && canWrite()) {
      const id = drop.dataset.id, { tokens, slots } = current();
      const next = { slots: { ...slots }, extra: (rec.extra || []).filter((x) => x !== id) };
      delete next.slots[id];
      save(next, `marching order: ${tokens[id] ? tokens[id].name || id : id} no longer travels with the party`);
    }
  });
  pane.addEventListener('keydown', (ev) => {
    const cell = ev.target.closest('.mo-cell');
    if (!cell || !canWrite() || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    const tok = cell.querySelector('.mo-tok');
    if (picked && (!tok || tok.dataset.id !== picked)) moveMember(picked, cell.dataset.cell);
    else { picked = tok ? (picked === tok.dataset.id ? null : tok.dataset.id) : null; render(); }
  });
  pane.addEventListener('change', (ev) => {
    const sel = ev.target.closest('.mo-add');
    if (!sel || !sel.value || !gm() || !canWrite()) return;
    const id = sel.value, { tokens, slots } = current();
    const extra = [...(rec.extra || []), id];
    const ids = E.marchMembers(tokens, { extra });
    save({ slots: E.marchSlots(ids, slots), extra }, `marching order: ${tokens[id] ? tokens[id].name || id : id} travels with the party`);
  });

  // the party changed (a PC joined, died or was renamed; a token's art arrived): redraw; plain moves do not
  let sig = '';
  const signature = () => { const t = o.tokens() || {}; return Object.keys(t).sort().map((id) => `${id}:${t[id].kind}:${t[id].name}:${!!t[id].dead}:${t[id].art || ''}`).join('|'); };
  function refresh() { const now = signature(); if (now !== sig && !drag) { sig = now; render(); } }

  store.watch(MARCHING, (d) => { rec = d || { slots: {}, extra: [] }; if (!drag) render(); });
  sig = signature();
  render();
  return { render, refresh };
}
