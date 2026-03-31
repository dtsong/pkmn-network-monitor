export class WakeLockManager {
  private wakeLock: WakeLockSentinel | null = null;
  private enabled = false;

  async enable(): Promise<boolean> {
    if (!('wakeLock' in navigator)) return false;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.enabled = true;
      // Re-acquire on visibility change (wake lock is released when tab is hidden)
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      return true;
    } catch {
      return false;
    }
  }

  async disable(): Promise<void> {
    this.enabled = false;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.wakeLock) {
      await this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  private handleVisibilityChange = async () => {
    if (this.enabled && document.visibilityState === 'visible') {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch {
        // Failed to re-acquire
      }
    }
  };

  isActive(): boolean {
    return this.wakeLock !== null && !this.wakeLock.released;
  }

  isSupported(): boolean {
    return 'wakeLock' in navigator;
  }
}
