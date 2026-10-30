import { Account, authErrorMessage, type AccountState, type Stats } from '../services/Account';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Menu account button + "Captain's Log" modal: Google / email sign-in, account creation,
 * password reset, and a profile view with cloud-save status and lifetime stats.
 */
export class AccountPanel {
  private chip: HTMLButtonElement;
  private overlay: HTMLDivElement;
  private open = false;
  private mode: 'signin' | 'signup' = 'signin';
  private busy = false;
  private message: { text: string; kind: 'error' | 'info' } | null = null;
  private email = '';

  constructor(
    root: HTMLElement,
    corner: HTMLElement,
    /** Captain name typed in the menu (used for new accounts and as a fallback display name). */
    private captainName: () => string,
    private stats: () => Stats,
  ) {
    this.chip = document.createElement('button');
    this.chip.className = 'account-chip';
    this.chip.addEventListener('click', () => this.show());
    corner.prepend(this.chip);

    this.overlay = document.createElement('div');
    this.overlay.className = 'screen overlay hidden account-overlay';
    // Typing in the form must not reach the game's keyboard handler (it swallows Space/arrows).
    this.overlay.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.hide();
    });
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) this.hide();
    });
    root.appendChild(this.overlay);

    Account.subscribe((s) => {
      this.renderChip(s);
      if (this.open) this.render(s);
    });
  }

  show(): void {
    this.open = true;
    this.message = null;
    this.render(Account.state);
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector<HTMLInputElement>('input')?.focus();
  }

  hide(): void {
    this.open = false;
    this.overlay.classList.add('hidden');
  }

  private avatar(s: AccountState): string {
    const name = s.name || this.captainName() || '?';
    return s.photo
      ? `<img src="${esc(s.photo)}" alt="" referrerpolicy="no-referrer" />`
      : `<b>${esc(name.charAt(0).toUpperCase())}</b>`;
  }

  private renderChip(s: AccountState): void {
    this.chip.classList.toggle('hidden', s.status === 'offline');
    this.chip.disabled = s.status === 'loading';
    if (s.status === 'signedIn') {
      this.chip.innerHTML = `<span class="ac-av">${this.avatar(s)}</span><span class="ac-name">${esc(s.name || this.captainName())}</span>`;
      this.chip.setAttribute('aria-label', 'Your account');
    } else {
      this.chip.innerHTML = `<span class="ac-av">${icon('user')}</span><span class="ac-name">${s.status === 'loading' ? '…' : 'Sign in'}</span>`;
      this.chip.setAttribute('aria-label', 'Sign in');
    }
  }

  private render(s: AccountState): void {
    const close = `<button class="x-btn" aria-label="Close">${icon('close')}</button>`;
    const msg = this.message ? `<div class="acc-msg ${this.message.kind}">${esc(this.message.text)}</div>` : '<div class="acc-msg"></div>';

    if (s.status === 'signedIn') {
      const st = this.stats();
      const cloud =
        s.cloud === 'error'
          ? `<div class="acc-cloud err">${icon('cloud')} Cloud save unavailable right now</div>`
          : s.cloud === 'syncing'
            ? `<div class="acc-cloud">${icon('cloud')} Syncing…</div>`
            : `<div class="acc-cloud ok">${icon('cloud')} Progress saved to your account</div>`;
      const via = s.provider === 'google' ? 'Google' : s.provider === 'password' ? 'Email' : 'Account';
      this.overlay.innerHTML = `<div class="card account-card">${close}
        <div class="acc-avatar">${this.avatar(s)}</div>
        <h2 class="title">${esc(s.name || this.captainName())}</h2>
        <p class="tag acc-sub">${esc(s.email ?? '')}${s.email ? ' · ' : ''}${via}</p>
        ${cloud}
        <div class="acc-stats">
          <div><b>${st.wins}</b><span>Wins</span></div>
          <div><b>${st.bestKills}</b><span>Best sinks</span></div>
          <div><b>${st.matches}</b><span>Matches</span></div>
          <div><b>${st.sinks}</b><span>Total sinks</span></div>
        </div>
        ${msg}
        <button class="btn btn-play acc-done">Back to the docks</button>
        <button class="btn btn-alt acc-signout">Sign out</button></div>`;
      this.bindCommon();
      this.overlay.querySelector('.acc-done')!.addEventListener('click', () => this.hide());
      this.overlay.querySelector('.acc-signout')!.addEventListener('click', () =>
        this.run(async () => {
          await Account.signOut();
          this.message = { text: 'Signed out. Your progress stays on this device too.', kind: 'info' };
        }),
      );
      return;
    }

    const signup = this.mode === 'signup';
    const loading = s.status === 'loading';
    this.overlay.innerHTML = `<div class="card account-card">${close}
      <div class="acc-hero">${icon('user')}</div>
      <h2 class="title">Captain's Log</h2>
      <p class="tag acc-sub">${signup ? 'Create an account to keep your wins, sailor and settings on every device.' : 'Sign in to save your progress across devices. Playing as a guest works too!'}</p>
      <button class="btn btn-google" ${loading ? 'disabled' : ''}>${icon('google')}<span>Continue with Google</span></button>
      <div class="acc-or"><span>or use email</span></div>
      <form class="acc-form" novalidate>
        <input class="acc-input" type="email" name="email" placeholder="Email" autocomplete="email" value="${esc(this.email)}" required />
        <input class="acc-input" type="password" name="password" placeholder="${signup ? 'Choose a password (6+ characters)' : 'Password'}" autocomplete="${signup ? 'new-password' : 'current-password'}" required />
        ${signup ? `<p class="acc-note">Your captain name will be <b>${esc(this.captainName() || 'Captain')}</b>. You can change it on the menu.</p>` : ''}
        <button type="submit" class="btn btn-play acc-submit" ${loading ? 'disabled' : ''}>${signup ? 'Create account' : 'Sign in'}</button>
      </form>
      ${msg}
      <div class="acc-links">
        <button class="link acc-toggle">${signup ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
        ${signup ? '' : '<button class="link acc-forgot">Forgot password?</button>'}
      </div>
      <button class="link acc-guest">Keep playing as guest</button></div>`;
    this.bindCommon();
    const form = this.overlay.querySelector<HTMLFormElement>('.acc-form')!;
    const emailEl = form.elements.namedItem('email') as HTMLInputElement;
    const passEl = form.elements.namedItem('password') as HTMLInputElement;
    emailEl.addEventListener('input', () => (this.email = emailEl.value));
    this.overlay.querySelector('.btn-google')!.addEventListener('click', () => this.run(() => Account.signInWithGoogle()));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.email = emailEl.value;
      if (!emailEl.value.trim() || !passEl.value) {
        this.message = { text: 'Enter your email and password.', kind: 'error' };
        this.render(Account.state);
        return;
      }
      this.run(() =>
        signup ? Account.createAccount(emailEl.value, passEl.value, this.captainName()) : Account.signInWithEmail(emailEl.value, passEl.value),
      );
    });
    this.overlay.querySelector('.acc-toggle')!.addEventListener('click', () => {
      this.mode = signup ? 'signin' : 'signup';
      this.message = null;
      this.render(Account.state);
    });
    this.overlay.querySelector('.acc-forgot')?.addEventListener('click', () => {
      this.email = emailEl.value;
      if (!emailEl.value.trim()) {
        this.message = { text: 'Type your email above first, then tap “Forgot password?”.', kind: 'error' };
        this.render(Account.state);
        return;
      }
      this.run(async () => {
        await Account.resetPassword(emailEl.value);
        this.message = { text: 'Check your inbox for a password reset link.', kind: 'info' };
      });
    });
    this.overlay.querySelector('.acc-guest')!.addEventListener('click', () => this.hide());
  }

  private bindCommon(): void {
    this.overlay.querySelector('.x-btn')!.addEventListener('click', () => this.hide());
    this.overlay.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled ||= this.busy));
  }

  /** Runs an auth action with a busy state; shows a friendly error if it fails. */
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.message = null;
    this.render(Account.state);
    try {
      await action();
    } catch (e) {
      const text = authErrorMessage(e);
      this.message = text ? { text, kind: 'error' } : null;
      if (text) console.warn('[Account]', e);
    } finally {
      this.busy = false;
      if (this.open) this.render(Account.state);
    }
  }
}
