/*
 * KitRace controls rebuilt around independent touch identifiers.
 *
 * Touch input uses the Touch Events API directly: every finger is tracked by
 * its own identifier. There is no pointer capture, no global "one button owns
 * input" state, and no synthetic click dependency. Mouse input is handled
 * separately so desktop controls remain usable.
 */
export function bindRideControls({ touch, cycleTrick, clamp }) {
  const layer = document.getElementById('touch');
  const knob = document.getElementById('knob');
  const padZone = document.getElementById('padZone');
  if (!layer || !knob || !padZone) return;

  const buttonKeys = new Map([
    ['tBrake', 'brake'],
    ['tBoost', 'boost'],
    ['tJump', 'jump']
  ]);
  const active = new Map();
  const mousePointers = new Map();
  let steeringId = null;
  let steeringStartX = 0;
  let destroyed = false;

  const buttonElements = new Map(
    [...buttonKeys.keys(), 'tTrick'].map(id => [id, document.getElementById(id)])
  );

  function elementAt(x, y, fallback) {
    const hit = document.elementFromPoint(x, y);
    return hit instanceof Element ? hit : (fallback instanceof Element ? fallback : null);
  }

  function classify(el) {
    if (!el) return null;
    const button = el.closest('#tBrake, #tBoost, #tJump, #tTrick');
    if (button && layer.contains(button)) {
      if (button.id === 'tTrick') return { type: 'trick', element: button };
      const key = buttonKeys.get(button.id);
      return key ? { type: 'button', key, element: button } : null;
    }
    if (el.closest('#padZone') === padZone) return { type: 'steer', element: padZone };
    return null;
  }

  function syncState() {
    for (const [id, key] of buttonKeys) {
      const down = [...active.values(), ...mousePointers.values()]
        .some(item => item.type === 'button' && item.key === key);
      touch[key] = down;
      buttonElements.get(id)?.classList.toggle('down', down);
    }
    const trickDown = [...active.values(), ...mousePointers.values()]
      .some(item => item.type === 'trick');
    buttonElements.get('tTrick')?.classList.toggle('down', trickDown);
  }

  function updateSteering(id, x) {
    if (steeringId !== id) return;
    const dx = x - steeringStartX;
    touch.steer = clamp(-dx / 55, -1, 1);
    knob.style.transform = 'translateX(' + clamp(dx, -52, 52) + 'px)';
  }

  function release(id) {
    const item = active.get(id) || mousePointers.get(id);
    if (!item) return;
    active.delete(id);
    mousePointers.delete(id);
    if (steeringId === id) {
      steeringId = null;
      touch.steer = 0;
      knob.style.transform = '';
    }
    syncState();
  }

  function begin(id, x, y, fallback, isTouch) {
    if (active.has(id) || mousePointers.has(id)) return;
    const control = classify(elementAt(x, y, fallback));
    if (!control) return;
    const item = { ...control, isTouch };
    if (control.type === 'steer') {
      if (steeringId !== null) item.type = 'ignored';
      else {
        steeringId = id;
        steeringStartX = x;
        touch.steer = 0;
        knob.style.transform = '';
      }
    } else if (control.type === 'trick') {
      cycleTrick();
    }
    (isTouch ? active : mousePointers).set(id, item);
    syncState();
  }

  function move(id, x) {
    const item = active.get(id) || mousePointers.get(id);
    if (item?.type === 'steer') updateSteering(id, x);
  }

  function clearControls() {
    active.clear();
    mousePointers.clear();
    steeringId = null;
    touch.steer = 0;
    touch.brake = false;
    touch.boost = false;
    touch.jump = false;
    knob.style.transform = '';
    for (const el of buttonElements.values()) el?.classList.remove('down');
  }

  function onTouchStart(event) {
    let handled = false;
    for (const point of event.changedTouches) {
      const fallback = event.target;
      const before = active.size;
      begin('t' + point.identifier, point.clientX, point.clientY, fallback, true);
      if (active.size !== before || active.has('t' + point.identifier)) handled = true;
    }
    if (handled) event.preventDefault();
  }

  function onTouchMove(event) {
    let handled = false;
    for (const point of event.changedTouches) {
      const id = 't' + point.identifier;
      if (active.has(id)) {
        move(id, point.clientX);
        handled = true;
      }
    }
    if (handled) event.preventDefault();
  }

  function onTouchEnd(event) {
    for (const point of event.changedTouches) release('t' + point.identifier);
    if (event.cancelable) event.preventDefault();
  }

  function onMouseDown(event) {
    if (event.button !== 0) return;
    begin('m' + event.pointerId, event.clientX, event.clientY, event.target, false);
    if (mousePointers.has('m' + event.pointerId)) event.preventDefault();
  }
  function onMouseMove(event) {
    for (const [id, item] of mousePointers) {
      if (id === 'm' + event.pointerId && item.type === 'steer') move(id, event.clientX);
    }
  }
  function onMouseEnd(event) {
    release('m' + event.pointerId);
  }

  // Touch Events prevent browser gesture arbitration from cancelling a second
  // finger when Boost and steering/brake are held simultaneously.
  layer.addEventListener('touchstart', onTouchStart, { passive: false });
  layer.addEventListener('touchmove', onTouchMove, { passive: false });
  layer.addEventListener('touchend', onTouchEnd, { passive: false });
  layer.addEventListener('touchcancel', onTouchEnd, { passive: false });

  // Pointer Events are used only for mouse input, never for touchscreen input.
  layer.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse') return;
    onMouseDown(event);
  });
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    onMouseMove(event);
  }, { passive: false });
  document.addEventListener('pointerup', event => {
    if (event.pointerType === 'mouse') onMouseEnd(event);
  });
  document.addEventListener('pointercancel', event => {
    if (event.pointerType === 'mouse') onMouseEnd(event);
  });
  window.addEventListener('blur', clearControls);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearControls();
  });

  window.__clearRideControls = clearControls;
  window.__kitRaceTouch = touch;
}
