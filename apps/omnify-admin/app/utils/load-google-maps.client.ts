/**
 * Loads Google Maps JavaScript API with Places library.
 * Shared across routes that need Places Autocomplete.
 */
const MAPS_SCRIPT_ID = "google-maps-sdk";
let mapsLoader: Promise<void> | null = null;

export const loadGoogleMaps = (apiKey: string): Promise<void> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Maps can only load in the browser"));
  }
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return Promise.reject(new Error("Google Maps API key is missing"));
  }
  if (window.google?.maps) {
    return Promise.resolve();
  }
  if (mapsLoader) {
    return mapsLoader;
  }

  mapsLoader = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(
      MAPS_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve());
      existingScript.addEventListener("error", () =>
        reject(new Error("Google Maps failed to load")),
      );
      return;
    }

    const script = document.createElement("script");
    script.id = MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      trimmedKey,
    )}&v=weekly&libraries=marker,geometry,places`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () =>
      reject(new Error("Google Maps failed to load")),
    );
    document.head.appendChild(script);
  });

  return mapsLoader;
};
