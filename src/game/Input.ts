import type { BoatInput } from './Boat';

/** Keyboard + mouse + touch joystick, merged into one BoatInput. */
export class Input {
  readonly isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  private keys = new Set<string>();
  private mouseFire = false;
  private touchFire = false;
  private joyId: number | null = null;
  private joyX = 0;
  private joyY = 0;
  private joyOx = 0;
  private joyOy = 0;
  private root: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private fireBtn: HTMLDivElement;
  enabled = false;
  onPause: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPause();
        return;
      }
      // Stop the page scrolling inside the CrazyGames iframe.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseFire = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseFire = true;
    });
    window.addEventListener('mouseup', () => (this.mouseFire = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.root = document.createElement('div');
    this.root.className = 'touch hidden';
    this.root.innerHTML = `<div class="joy-zone"><div class="joy-base"><div class="joy-knob"></div></div></div><div class="fire-btn">FIRE</div>`;
    uiRoot.appendChild(this.root);
    const zone = this.root.querySelector('.joy-zone') as HTMLDivElement;
    this.base = this.root.querySelector('.joy-base') as HTMLDivElement;
    this.knob = this.root.querySelector('.joy-knob') as HTMLDivElement;
    this.fireBtn = this.root.querySelector('.fire-btn') as HTMLDivElement;

    zone.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null) return;
      this.joyId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.joyOx = e.clientX;
      this.joyOy = e.clientY;
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('active');
      this.moveJoy(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyId) this.moveJoy(e.clientX, e.clientY);
    });
    const endJoy = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.joyX = this.joyY = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.base.style.left = this.base.style.top = '';
      this.base.classList.remove('active');
    };
    zone.addEventListener('pointerup', endJoy);
    zone.addEventListener('pointercancel', endJoy);

    this.fireBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touchFire = true;
      this.fireBtn.classList.add('pressed');
    });
    const endFire = () => {
      this.touchFire = false;
      this.fireBtn.classList.remove('pressed');
    };
    this.fireBtn.addEventListener('pointerup', endFire);
    this.fireBtn.addEventListener('pointercancel', endFire);
    this.fireBtn.addEventListener('pointerleave', endFire);
  }

  showTouch(show: boolean): void {
    this.root.classList.toggle('hidden', !(show && this.isTouch));
  }

  setFireIcon(icon: string | null): void {
    this.fireBtn.textContent = icon ?? 'FIRE';
    this.fireBtn.classList.toggle('empty', !icon);
  }

  private moveJoy(x: number, y: number): void {
    const R = 55;
    let dx = x - this.joyOx, dy = y - this.joyOy;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    this.joyX = dx / R;
    this.joyY = dy / R;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  read(out: BoatInput): void {
    if (!this.enabled) {
      out.throttle = out.steer = 0;
      out.fire = false;
      return;
    }
    const k = this.keys;
    let throttle = 0, steer = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) throttle += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) throttle -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steer += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) steer -= 1;
    if (this.joyId !== null) {
      const mag = Math.hypot(this.joyX, this.joyY);
      if (mag > 0.15) {
        // Push to go, pull back hard to reverse; horizontal = steering.
        throttle = this.joyY > 0.65 ? -1 : 1;
        steer = this.joyX * 1.2;
      }
    }
    out.throttle = Math.max(-1, Math.min(1, throttle));
    out.steer = Math.max(-1, Math.min(1, steer));
    out.fire = this.mouseFire || this.touchFire || k.has('Space') || k.has('KeyJ') || k.has('Enter');
  }
}
