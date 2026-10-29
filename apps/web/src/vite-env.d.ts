/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `true` only in demo builds: the login screen lists the seeded demo accounts. */
  readonly VITE_DEMO_MODE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
