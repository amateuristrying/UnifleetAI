declare module '*.png' {
    const value: string;
    export default value;
}

interface ImportMetaEnv {
    readonly VITE_NAVIXY_API_URL: string;
    readonly VITE_NAVIXY_SESSION_KEY: string;
    readonly VITE_NAVIXY_SESSION_KEY_TZ: string;
    readonly VITE_NAVIXY_SESSION_KEY_ZM: string;
    readonly VITE_MAPBOX_TOKEN: string;
    readonly VITE_GEMINI_API_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
