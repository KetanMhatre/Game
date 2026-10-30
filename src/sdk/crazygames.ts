// Thin wrapper around the CrazyGames HTML5 SDK v3.
// Every call is safe when the SDK is missing (local dev, other portals): it simply no-ops.
// Docs: https://docs.crazygames.com/sdk/html5-v3/

type AdType = 'midgame' | 'rewarded';

interface CGSdk {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(cb: (s: { muteAudio?: boolean }) => void): void;
    // Multiplayer invites (rooms shared through the portal).
    isInstantMultiplayer?: boolean;
    inviteLink?(params: Record<string, string>): string;
    getInviteParam?(key: string): string | null;
    showInviteButton?(params: Record<string, string>): string;
    hideInviteButton?(): void;
  };
  ad: {
    requestAd(type: AdType, cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void }): void;
  };
  user?: {
    isUserAccountAvailable?: boolean;
    getUser?(): Promise<{ username: string } | null>;
  };
  data?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CGSdk };
  }
}

class CrazyGamesWrapper {
  private sdk: CGSdk | null = null;
  private inGameplay = false;
  private lastAdAt = 0;
  /** Called with true when the game must be silent (ad playing or user muted on the portal). */
  onMuteChange: (muted: boolean) => void = () => {};
  /** Called when an ad pauses/unpauses the game. */
  onPauseChange: (paused: boolean) => void = () => {};

  async init(): Promise<void> {
    const sdk = window.CrazyGames?.SDK;
    if (!sdk) return;
    try {
      await sdk.init();
      if (sdk.environment === 'disabled') return;
      this.sdk = sdk;
      sdk.game.addSettingsChangeListener?.((s) => this.onMuteChange(!!s.muteAudio));
      if (sdk.game.settings?.muteAudio) this.onMuteChange(true);
    } catch (e) {
      console.warn('[CrazyGames] SDK init failed, continuing without it', e);
    }
  }

  get available(): boolean {
    return this.sdk !== null;
  }

  loadingStart(): void {
    this.sdk?.game.loadingStart();
  }

  loadingStop(): void {
    this.sdk?.game.loadingStop();
  }

  gameplayStart(): void {
    if (this.inGameplay) return;
    this.inGameplay = true;
    this.sdk?.game.gameplayStart();
  }

  gameplayStop(): void {
    if (!this.inGameplay) return;
    this.inGameplay = false;
    this.sdk?.game.gameplayStop();
  }

  /** Call on a genuinely happy moment (winning a match). */
  happytime(): void {
    this.sdk?.game.happytime();
  }

  /**
   * Midgame ad between matches. Resolves when the game may continue.
   * Throttled locally too; CrazyGames also enforces its own frequency cap.
   */
  midgameAd(): Promise<void> {
    return this.requestAd('midgame').then(() => undefined);
  }

  /** Rewarded ad. Resolves true if the user watched it to the end. */
  rewardedAd(): Promise<boolean> {
    return this.requestAd('rewarded');
  }

  private requestAd(type: AdType): Promise<boolean> {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve(false);
    if (type === 'midgame' && Date.now() - this.lastAdAt < 60_000) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        this.onMuteChange(false);
        this.onPauseChange(false);
        resolve(ok);
      };
      sdk.ad.requestAd(type, {
        adStarted: () => {
          this.lastAdAt = Date.now();
          this.onMuteChange(true);
          this.onPauseChange(true);
        },
        adFinished: () => done(true),
        adError: () => done(false),
      });
    });
  }

  // ---------------------------------------------------------------- multiplayer invites

  /** Link that drops a friend straight into room `code` (a plain ?room= link outside CrazyGames). */
  inviteLink(code: string): string {
    try {
      const link = this.sdk?.game.inviteLink?.({ roomId: code });
      if (link) return link;
    } catch {
      /* fall through */
    }
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', code);
    return url.toString();
  }

  /** Room code this page was opened with (CrazyGames invite or ?room=), if any. */
  inviteCode(): string | null {
    try {
      const code = this.sdk?.game.getInviteParam?.('roomId');
      if (code) return code;
    } catch {
      /* fall through */
    }
    return new URLSearchParams(location.search).get('room');
  }

  /** CrazyGames asked to put the player straight into a multiplayer match. */
  get instantMultiplayer(): boolean {
    return !!this.sdk?.game.isInstantMultiplayer;
  }

  /** The portal's own "Invite friends" button, shown while in a private room. */
  showInviteButton(code: string): void {
    try {
      this.sdk?.game.showInviteButton?.({ roomId: code });
    } catch {
      /* optional */
    }
  }

  hideInviteButton(): void {
    try {
      this.sdk?.game.hideInviteButton?.();
    } catch {
      /* optional */
    }
  }

  async getUsername(): Promise<string | null> {
    try {
      if (!this.sdk?.user?.isUserAccountAvailable) return null;
      const user = await this.sdk.user.getUser?.();
      return user?.username ?? null;
    } catch {
      return null;
    }
  }

  /** Persistent storage: CrazyGames cloud data when available, localStorage otherwise. */
  getItem(key: string): string | null {
    try {
      if (this.sdk?.data) return this.sdk.data.getItem(key);
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      if (this.sdk?.data) this.sdk.data.setItem(key, value);
      else localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  }
}

export const CrazyGames = new CrazyGamesWrapper();
