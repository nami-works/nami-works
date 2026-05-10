// `@types/google.maps` is included via tsconfig.json `compilerOptions.types`
// so the global `google` namespace is available across the app. We re-expose
// it here on `Window.google` so `window.google.maps.*` is properly typed
// (replaces the legacy `google?: any`).

declare module "*.css";

declare global {
  interface Window {
    /**
     * Google Maps JavaScript API global, populated by the script loader
     * (see `app/utils/load-google-maps.client.ts`). `undefined` until the
     * loader has resolved.
     */
    google?: typeof google;
  }

  /**
   * Element ref type for Polaris `<s-modal>`. Polaris-types declares the
   * `Modal` class inside its module scope (not exported), so app code
   * can't reference it directly via `useRef<Modal>`. This alias extracts
   * the ref's element type from the JSX intrinsic, which is the cleanest
   * way to type `useRef<SModalElement>(null)` for app-level modal refs.
   * The element exposes Polaris's imperative `showOverlay()` / `hideOverlay()`.
   */
  type SModalElement = JSX.IntrinsicElements["s-modal"] extends {
    ref?: React.Ref<infer T> | undefined;
  }
    ? T
    : HTMLElement;
}

export {};