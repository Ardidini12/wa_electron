// Electron API type definitions
interface ElectronAPI {
    auth: {
        register: (userData: any) => Promise<any>;
        login: (credentials: any) => Promise<any>;
        logout: () => Promise<any>;
        getStoredUser: () => Promise<any>;
        getSavedCredentials: () => Promise<{ username: string; name: string; password: string; rememberMe: boolean } | null>;
        getSavedPassword: (username: string) => Promise<string | null>;
        clearSavedCredentials: () => Promise<boolean>;
    };
    
    whatsapp: {
        initialize: (username: string) => Promise<boolean>;
        autoConnect: () => Promise<boolean>;
        getQR: () => Promise<string | null>;
        getStatus: () => Promise<any>;
        getSessionInfo: () => Promise<any>;
        logout: () => Promise<boolean>;
        destroy: () => Promise<boolean>;
        onQR: (callback: (qr: string) => void) => () => void;
        onReady: (callback: (sessionInfo: any) => void) => () => void;
        onAuthenticated: (callback: () => void) => () => void;
        onDisconnected: (callback: (reason: string) => void) => () => void;
        onAuthFailure: (callback: (message: string) => void) => () => void;
    };
    
    theme: {
        get: () => Promise<any>;
        set: (theme: string) => Promise<void>;
        onChange: (callback: (theme: any) => void) => void;
    };
    
    settings: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
    };
    

    
    app: {
        getVersion: () => Promise<string>;
        onAutoLogin: (callback: () => void) => void;
    };
    
    subscribeStatistics: (callback: (statistics: any) => void) => void;
    getStaticData: () => void;
}

declare global {
    interface Window {
        electron: ElectronAPI;
    }
}

export {}; 