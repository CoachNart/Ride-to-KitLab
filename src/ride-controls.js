/*
 * KitRace input controller.
 * One Pointer Events pipeline owns every mobile control. Each finger/pointer
 * has its own ID and lifetime, so holding Boost cannot block steering or Brake.
 */
export function bindRideControls({ touch, cycleTrick, clamp }) {
  const layer = document.getElementById('touch');
  const knob = document.getElementById('knob');
  if (!layer || !knob) return;

  const heldButtons = new Map([
    ['tBrake', 'brake'],
    ['tBoost', 'boost'],
    ['tJump', 'jump']
  ]);
  const pointers = new Map();
  let steeringPointer = null;
  let steeringOriginX = 0;

  const controlFor = target => {
    if (!(target instanceof Element)) return null;
    const button = target.closest('#tBrake, #tBoost, #tJump, #tTrick');
    if (button) {
      if (button.id === 'tTrick') return { kind: 'trick', target: button };
      const key = heldButtons.get(button.id);
      return key ? { kind: 'button', key, target: button } : null;
    }
    if (target.closest('#padZone')) return { kind: 'steer', target: document.getElementById('padZone') };
    return null;
  };

  function syncButtons() {
    for (const [id, key] of heldButtons) {
      const isDown = [...pointers.values()].some(pointer => pointer.kind === 'button' && pointer.key === key);
      touch[key] = isDown;
      document.getElementById(id)?.classList.toggle('down', isDown);
    }
  }

  function clearControls() {
    pointers.clear();
    steeringPointer = null;
    touch.steer = 0;
    touch.brake = false;
    touch.boost = false;
    touch.jump = false;
    knob.style.transform = '';
    for (const id of heldButtons.keys()) document.getElementById(id)?.classList.remove('down');
    document.getElementById('tTrick')?.classList.remove('down');
  }

  function onPointerDown(event) {
    const control = controlFor(event.target);
    if (!control || pointers.has(event.pointerId)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.preventDefault();
    const record = { ...control, startX: event.clientX };
    if (control.kind === 'steer') {
      if (steeringPointer !== null) record.kind = 'ignored';
      else {
        steeringPointer = event.pointerId;
        steeringOriginX = event.clientX;
      }
    } else if (control.kind === 'trick') {
      control.target.classList.add('down');
      cycleTrick();
    }

    pointers.set(event.pointerId, record);
    try { control.target.setPointerCapture(event.pointerId); } catch (_) {}
    syncButtons();
  }

  function onPointerMove(event) {
    const record = pointers.get(event.pointerId);
    if (!record) return;
    event.preventDefault();
    if (record.kind !== 'steer' || steeringPointer !== event.pointerId) return;
    const dx = event.clientX - steeringOriginX;
    touch.steer = clamp(-dx / 55, -1, 1);
    knob.style.transform = 'translateX(' + clamp(dx, -52, 52) + 'px)';
  }

  function onPointerUp(event) {
    const record = pointers.get(event.pointerId);
    if (!record) return;
    pointers.delete(event.pointerId);
    if (steeringPointer === event.pointerId) {
      steeringPointer = null;
      touch.steer = 0;
      knob.style.transform = '';
    }
    if (record.kind === 'trick') record.target.classList.remove('down');
    syncButtons();
  }

  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
  document.addEventListener('pointerup', onPointerUp, { capture: true });
  document.addEventListener('pointercancel', onPointerUp, { capture: true });
  document.addEventListener('lostpointercapture', onPointerUp, { capture: true });
  window.addEventListener('blur', clearControls);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearControls();
  });

  window.__clearRideControls = clearControls;
  window.__kitRaceTouch = touch;
}


/*
 * Temporary root-cause probe. It is inert unless ?inputDebug=1 is present.
 * It records raw browser events, hit-test targets, pointer cancellation and
 * main-thread frame gaps so we can distinguish input loss from a frozen frame.
 */
function enableInputDiagnostics() {
  if (new URLSearchParams(location.search).get('inputDebug') !== '1') return;
  const trace = [];
  const rawPointers = new Set();
  const panel = document.createElement('pre');
  panel.id = 'kitRaceInputDiagnostics';
  panel.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:2147483646;max-width:94vw;max-height:34vh;overflow:hidden;margin:0;padding:7px 9px;border:1px solid #ffcf70;border-radius:7px;background:rgba(0,0,0,.88);color:#fff2cc;font:10px/1.35 monospace;white-space:pre-wrap;pointer-events:none';
  document.body.appendChild(panel);

  function record(label, extra = {}) {
    const item = { t: Math.round(performance.now()), label, ...extra };
    trace.push(item);
    if (trace.length > 80) trace.shift();
    panel.textContent = trace.slice(-13).map(row => {
      const { t, label, ...details } = row;
      return t + 'ms ' + label + (Object.keys(details).length ? ' ' + JSON.stringify(details) : '');
    }).join('\n');
    try { localStorage.setItem('kitrace:input-debug-trace', JSON.stringify(trace)); } catch (_) {}
    window.__kitRaceInputTrace = trace;
  }

  const describe = el => {
    if (!(el instanceof Element)) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s;
  };

  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) {
    document.addEventListener(type, event => {
      if (type === 'pointerdown') rawPointers.add(event.pointerId);
      if (type === 'pointerup' || type === 'pointercancel' || type === 'lostpointercapture') rawPointers.delete(event.pointerId);
      const hitStack = document.elementsFromPoint(event.clientX, event.clientY).slice(0, 4).map(describe);
      record(type, {
        id: event.pointerId,
        kind: event.pointerType,
        target: describe(event.target),
        hit: hitStack,
        activeRawPointers: [...rawPointers],
        buttons: { boost: !!window.__kitRaceTouch?.boost }
      });
    }, { capture: true, passive: true });
  }

  document.addEventListener('pointermove', event => {
    if (!rawPointers.has(event.pointerId)) return;
    record('move', { id: event.pointerId, target: describe(event.target), x: Math.round(event.clientX), y: Math.round(event.clientY) });
  }, { capture: true, passive: true });

  window.addEventListener('error', event => record('js-error', { message: String(event.message || event.error || 'unknown').slice(0, 180) }));
  window.addEventListener('unhandledrejection', event => record('promise-error', { message: String(event.reason?.message || event.reason || 'unknown').slice(0, 180) }));

  let lastFrame = performance.now();
  function frameProbe(now) {
    const gap = now - lastFrame;
    if (gap > 120) record('frame-gap', { gapMs: Math.round(gap), activeRawPointers: [...rawPointers] });
    lastFrame = now;
    requestAnimationFrame(frameProbe);
  }
  requestAnimationFrame(frameProbe);
  record('diagnostics-on', { ua: navigator.userAgent, touchPoints: navigator.maxTouchPoints, pointer: matchMedia('(pointer:coarse)').matches });
}

enableInputDiagnostics();
