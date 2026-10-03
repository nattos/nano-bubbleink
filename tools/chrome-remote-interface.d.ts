/**
 * A deliberately narrow declaration for `chrome-remote-interface`, which ships
 * no types of its own.
 *
 * Narrow on purpose: this describes the handful of CDP domains the probes in
 * this directory drive, not the protocol. Adding a domain here should be the
 * same gesture as starting to use it, so the file stays a record of what the
 * tools actually touch rather than a second copy of the CDP schema that drifts
 * from the real one.
 */
declare module 'chrome-remote-interface' {
  interface RemoteObject { value?: unknown; description?: string }
  interface EvaluateResult {
    result: RemoteObject;
    exceptionDetails?: { text: string; exception?: RemoteObject };
  }

  interface Client {
    Page: {
      enable(): Promise<void>;
      navigate(p: { url: string }): Promise<unknown>;
      loadEventFired(): Promise<void>;
      captureScreenshot(p?: { format?: string }): Promise<{ data: string }>;
    };
    Runtime: {
      enable(): Promise<void>;
      evaluate(p: {
        expression: string;
        returnByValue?: boolean;
        awaitPromise?: boolean;
      }): Promise<EvaluateResult>;
    };
    Input: {
      dispatchMouseEvent(p: {
        type: 'mouseMoved' | 'mousePressed' | 'mouseReleased';
        x: number; y: number;
        button?: 'left' | 'right' | 'middle' | 'none';
        clickCount?: number;
        pointerType?: 'mouse' | 'pen';
      }): Promise<void>;
    };
    Emulation: {
      setDeviceMetricsOverride(p: {
        width: number; height: number;
        deviceScaleFactor: number; mobile: boolean;
      }): Promise<void>;
    };
    close(): Promise<void>;
  }

  function CDP(options?: { port?: number; host?: string }): Promise<Client>;
  export default CDP;
}
