export interface HtmlFullscreenTransition {
  windowFullscreen: boolean | null;
}

export class HtmlFullscreenCoordinator {
  private tabId: string | null = null;
  private ownsWindowFullscreen = false;

  enter(tabId: string, windowIsFullscreen: boolean): HtmlFullscreenTransition {
    this.tabId = tabId;
    this.ownsWindowFullscreen = !windowIsFullscreen;
    return { windowFullscreen: this.ownsWindowFullscreen ? true : null };
  }

  leave(tabId: string): HtmlFullscreenTransition {
    if (this.tabId !== tabId) return { windowFullscreen: null };
    this.tabId = null;
    return { windowFullscreen: this.ownsWindowFullscreen ? false : null };
  }

  windowDidEnter(): HtmlFullscreenTransition {
    return {
      windowFullscreen: this.ownsWindowFullscreen && this.tabId === null ? false : null,
    };
  }

  windowDidLeave(): string | null {
    const tabToExit = this.tabId;
    this.tabId = null;
    this.ownsWindowFullscreen = false;
    return tabToExit;
  }

  isActiveFor(tabId: string): boolean {
    return this.tabId === tabId;
  }
}
