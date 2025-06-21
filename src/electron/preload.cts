const electron = require('electron');

// Define the electron API interface
interface ElectronAPI {
    // Authentication APIs
    auth: {
        register: (userData: any) => Promise<any>;
        login: (credentials: any) => Promise<any>;
        logout: () => Promise<any>;
        getStoredUser: () => Promise<any>;
        getSavedCredentials: () => Promise<any>;
        getSavedPassword: (username: string) => Promise<string | null>;
        clearSavedCredentials: () => Promise<boolean>;
    };
    
    // WhatsApp APIs
    whatsapp: {
        initialize: (username: string) => Promise<boolean>;
        autoConnect: () => Promise<boolean>;
        getQR: () => Promise<string | null>;
        getStatus: () => Promise<any>;
        getSessionInfo: () => Promise<any>;
        logout: () => Promise<boolean>;
        destroy: () => Promise<boolean>;
        onQR: (callback: (qr: string) => void) => void;
        onReady: (callback: (sessionInfo: any) => void) => void;
        onAuthenticated: (callback: () => void) => void;
        onDisconnected: (callback: (reason: string) => void) => void;
        onAuthFailure: (callback: (message: string) => void) => void;
    };
    
    // Theme APIs
    theme: {
        get: () => Promise<any>;
        set: (theme: string) => Promise<void>;
        onChange: (callback: (theme: any) => void) => void;
    };
    
    // Settings APIs
    settings: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
    };
    

    
    // App APIs
    app: {
        getVersion: () => Promise<string>;
        onAutoLogin: (callback: () => void) => void;
    };
    
    // Legacy APIs (keep for compatibility)
    subscribeStatistics: (callback: (statistics: any) => void) => void;
    getStaticData: () => void;
}

// Expose the electron API
const electronAPI: ElectronAPI = {
    // Authentication APIs
    auth: {
        register: (userData) => electron.ipcRenderer.invoke('auth:register', userData),
        login: (credentials) => electron.ipcRenderer.invoke('auth:login', credentials),
        logout: () => electron.ipcRenderer.invoke('auth:logout'),
        getStoredUser: () => electron.ipcRenderer.invoke('auth:getStoredUser'),
        getSavedCredentials: () => electron.ipcRenderer.invoke('auth:getSavedCredentials'),
        getSavedPassword: (username) => electron.ipcRenderer.invoke('auth:getSavedPassword', username),
        clearSavedCredentials: () => electron.ipcRenderer.invoke('auth:clearSavedCredentials'),
    },
    
    // WhatsApp APIs
    whatsapp: {
        initialize: (username) => electron.ipcRenderer.invoke('whatsapp:initialize', username),
        autoConnect: () => electron.ipcRenderer.invoke('whatsapp:autoConnect'),
        getQR: () => electron.ipcRenderer.invoke('whatsapp:getQR'),
        getStatus: () => electron.ipcRenderer.invoke('whatsapp:getStatus'),
        getSessionInfo: () => electron.ipcRenderer.invoke('whatsapp:getSessionInfo'),
        logout: () => electron.ipcRenderer.invoke('whatsapp:logout'),
        destroy: () => electron.ipcRenderer.invoke('whatsapp:destroy'),
        onQR: (callback) => {
            const handler = (_: any, qr: string) => callback(qr);
            electron.ipcRenderer.on('whatsapp:qr', handler);
            return () => electron.ipcRenderer.removeListener('whatsapp:qr', handler);
        },
        onReady: (callback) => {
            const handler = (_: any, sessionInfo: any) => callback(sessionInfo);
            electron.ipcRenderer.on('whatsapp:ready', handler);
            return () => electron.ipcRenderer.removeListener('whatsapp:ready', handler);
        },
        onAuthenticated: (callback) => {
            const handler = () => callback();
            electron.ipcRenderer.on('whatsapp:authenticated', handler);
            return () => electron.ipcRenderer.removeListener('whatsapp:authenticated', handler);
        },
        onDisconnected: (callback) => {
            const handler = (_: any, reason: string) => callback(reason);
            electron.ipcRenderer.on('whatsapp:disconnected', handler);
            return () => electron.ipcRenderer.removeListener('whatsapp:disconnected', handler);
        },
        onAuthFailure: (callback) => {
            const handler = (_: any, message: string) => callback(message);
            electron.ipcRenderer.on('whatsapp:auth_failure', handler);
            return () => electron.ipcRenderer.removeListener('whatsapp:auth_failure', handler);
        },
    },
    
    // Theme APIs
    theme: {
        get: () => electron.ipcRenderer.invoke('theme:get'),
        set: (theme) => electron.ipcRenderer.invoke('theme:set', theme),
        onChange: (callback) => electron.ipcRenderer.on('theme:changed', (_: any, theme: any) => callback(theme)),
    },
    
    // Settings APIs
    settings: {
        get: (key) => electron.ipcRenderer.invoke('settings:get', key),
        set: (key, value) => electron.ipcRenderer.invoke('settings:set', key, value),
    },
    

    
    // App APIs
    app: {
        getVersion: () => electron.ipcRenderer.invoke('app:getVersion'),
        onAutoLogin: (callback) => electron.ipcRenderer.on('auto-login', callback),
    },
    
    // Legacy APIs (keep for compatibility)
    subscribeStatistics: (callback: (statistics: any) => void) => callback({}),
    getStaticData: () => console.log('static'),
};

electron.contextBridge.exposeInMainWorld("electron", electronAPI);

// Add TypeScript declarations for the window object
declare global {
    interface Window {
        electron: ElectronAPI;
    }
}