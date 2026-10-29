// Tiny synthesized SFX via WebAudio: zero audio files to download, instant load.

class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private userMuted = false;
  private forcedMute = false;
  private lastGun = 0;

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get muted(): boolean {
    return this.userMuted;
  }

  setUserMuted(m: boolean): void {
    this.userMuted = m;
    this.applyVolume();
  }

  /** Used by the SDK during ads / when the portal mutes the game. */
  setForcedMute(m: boolean): void {
    this.forcedMute = m;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.userMuted || this.forcedMute ? 0 : 0.5;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, filterFreq: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Volume falls off with distance from the listener (the player boat). */
  private atten(dist: number): number {
    return Math.max(0, 1 - dist / 70);
  }

  fire(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.tone(160, 0.18, 'square', 0.25 * a, 50);
    this.noise(0.15, 0.3 * a, 2500);
  }
  boom(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.tone(90, 0.5, 'sine', 0.6 * a, 30);
    this.noise(0.6, 0.6 * a, 1800);
  }
  splash(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.noise(0.35, 0.25 * a, 4000);
  }
  hit() {
    this.tone(300, 0.15, 'sawtooth', 0.25, 90);
  }
  pickup() {
    this.tone(660, 0.08, 'triangle', 0.3);
    this.tone(990, 0.12, 'triangle', 0.3, undefined, 0.07);
  }
  shield() {
    this.tone(400, 0.4, 'sine', 0.25, 900);
  }
  /** Deck Gun / drone shot: tiny crack. Throttled so a gatling doesn't stack hundreds of nodes. */
  gun(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0 || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGun < 0.06) return;
    this.lastGun = now;
    this.noise(0.06, 0.22 * a, 5000);
    this.tone(140, 0.05, 'square', 0.08 * a, 70);
  }
  launch(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.noise(0.45, 0.25 * a, 3000);
    this.tone(220, 0.4, 'sawtooth', 0.08 * a, 90);
  }
  twang(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.tone(900, 0.3, 'triangle', 0.25 * a, 250);
    this.noise(0.12, 0.15 * a, 2500);
  }
  thump(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.tone(120, 0.3, 'sine', 0.5 * a, 55);
    this.noise(0.2, 0.25 * a, 1200);
  }
  /** Falling-shell whistle for the mortar. */
  whistle(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.tone(1400, 0.7, 'sine', 0.07 * a, 450);
  }
  depth(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.tone(60, 0.8, 'sine', 0.6 * a, 30);
    this.noise(0.9, 0.4 * a, 600);
  }
  swirl(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.noise(2.2, 0.22 * a, 1500);
    this.tone(90, 2, 'sine', 0.12 * a, 160);
  }
  whoosh(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.noise(0.22, 0.16 * a, 3500);
  }
  clank(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.tone(520, 0.18, 'square', 0.14 * a, 260);
    this.tone(780, 0.12, 'triangle', 0.12 * a, 400);
  }
  beep() {
    this.tone(1200, 0.07, 'square', 0.1);
    this.tone(1600, 0.07, 'square', 0.1, undefined, 0.09);
  }
  /** Fake crate: a cheeky descending "wah-wah" plus the bang. */
  trap(dist = 0) {
    const a = this.atten(dist);
    if (a <= 0) return;
    this.tone(400, 0.18, 'sawtooth', 0.12 * a, 300);
    this.tone(300, 0.3, 'sawtooth', 0.12 * a, 180, 0.18);
  }
  kill() {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, 'square', 0.15, undefined, i * 0.07));
  }
  click() {
    this.tone(800, 0.05, 'triangle', 0.2);
  }
  countdown(final: boolean) {
    this.tone(final ? 880 : 440, final ? 0.4 : 0.15, 'square', 0.18);
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.25, undefined, i * 0.12));
  }
}

export const Sfx = new AudioSystem();
