declare module "@novnc/novnc/lib/rfb.js" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string);

    viewOnly: boolean;

    scaleViewport: boolean;

    resizeSession: boolean;

    background: string;

    focusOnClick: boolean;

    sendKey(keysym: number, code?: string, down?: boolean): void;

    disconnect(): void;

    focus(): void;
  }
}
