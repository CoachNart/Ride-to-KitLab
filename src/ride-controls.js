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
}
