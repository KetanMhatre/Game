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
