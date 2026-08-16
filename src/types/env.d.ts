/**
 * Minimal ambient declarations. The project sets `"types": []` so no global
 * @types packages leak in; anything the app reads off `import.meta` is declared
 * here explicitly.
 */

interface ImportMetaEnv {
  /** Vite's public base path — '/LotMGame/' in the GitHub Pages build. */
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
