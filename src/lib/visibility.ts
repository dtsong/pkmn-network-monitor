export interface VisibilityGap {
  hiddenAt: number;
  visibleAt: number;
  durationMs: number;
}

export class VisibilityTracker {
  private hiddenAt: number | null = null;
  private gaps: VisibilityGap[] = [];
  private onForeground: ((gap: VisibilityGap) => void) | null = null;

  start(onForeground?: (gap: VisibilityGap) => void): void {
    this.onForeground = onForeground ?? null;
    document.addEventListener('visibilitychange', this.handleChange);
  }

  stop(): void {
    document.removeEventListener('visibilitychange', this.handleChange);
  }

  private handleChange = () => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
    } else if (document.visibilityState === 'visible' && this.hiddenAt) {
      const now = Date.now();
      const gap: VisibilityGap = {
        hiddenAt: this.hiddenAt,
        visibleAt: now,
        durationMs: now - this.hiddenAt,
      };
      this.gaps.push(gap);
      this.hiddenAt = null;
      this.onForeground?.(gap);
    }
  };

  getGaps(): VisibilityGap[] {
    return [...this.gaps];
  }
}
