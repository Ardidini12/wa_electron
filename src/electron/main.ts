import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, nativeTheme, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { isDev } from './util.js';

// ES module __dirname equivalent
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { pollResources } from './resourceManager.js';
import { getPreloadPath } from './pathResolver.js';
import { WhatsAppManager } from './whatsappManager.js';
import { AuthManager } from './authManager.js';
import { ThemeManager } from './themeManager.js';
import { AutoLaunchManager } from './autoLaunchManager.js';
import { DatabaseManager } from './databaseManager.js';
import Store from 'electron-store';

class AppManager {
    private mainWindow: BrowserWindow | null = null;
    private tray: Tray | null = null;
    private whatsappManager: WhatsAppManager;
    private authManager: AuthManager;
    private themeManager: ThemeManager;
    private autoLaunchManager: AutoLaunchManager;
    private store: Store;
    private isQuiting = false;
    private autoConnectInProgress = false;

    constructor() {
        this.store = new Store();
        this.whatsappManager = new WhatsAppManager();
        this.authManager = new AuthManager();
        this.themeManager = new ThemeManager();
        this.autoLaunchManager = new AutoLaunchManager();
        
        this.setupApp();
    }

    private setupApp() {
        // Handle app ready
        app.whenReady().then(() => {
            this.createWindow();
            this.createTray();
            this.setupIpcHandlers();
            this.setupAppEvents();
            pollResources();
        });

        // Handle window closed
        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                if (!this.isQuiting) {
                    this.hideToTray();
                }
            }
        });

        // Handle app activation (macOS)
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                this.createWindow();
            }
        });

        // Handle before quit
        app.on('before-quit', () => {
            this.isQuiting = true;
        });
    }

    private createWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            minWidth: 1000,
            minHeight: 700,
        webPreferences: {
            preload: getPreloadPath(),
                nodeIntegration: false,
                contextIsolation: true,
            },
            icon: path.join(app.getAppPath(), 'Logo-BSS.png'),
            titleBarStyle: 'default',
            frame: true, // Use native frame with controls
            show: false,
            center: true,
            resizable: true,
            maximizable: true,
            minimizable: true,
            closable: true,
            title: 'WhatsApp Bulk Sender'
        });

        // Don't maximize - just use the specified size and center it

        // Handle window events
        this.mainWindow.on('close', (event) => {
            if (!this.isQuiting) {
                event.preventDefault();
                this.hideToTray();
            }
        });

        this.mainWindow.on('minimize', () => {
            if (this.store.get('minimizeToTray', true)) {
                this.hideToTray();
            }
        });

        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow?.show();
            
            // Auto-login if remember me is enabled
            if (this.store.get('rememberMe', false)) {
                this.mainWindow?.webContents.send('auto-login');
            }
        });

                // Load app
    if (isDev()) {
            this.mainWindow.loadURL('http://localhost:5123');
            this.mainWindow.webContents.openDevTools();
        } else {
            this.mainWindow.loadFile(path.join(app.getAppPath(), '/dist-react/index.html'));
        }
    }

    private createTray() {
        // Use the proper tray icon with platform-specific sizing
        let trayIconPath: string;
        
        if (process.platform === 'win32') {
            trayIconPath = path.join(app.getAppPath(), 'tray-icon-16.png');
        } else if (process.platform === 'darwin') {
            trayIconPath = path.join(app.getAppPath(), 'tray-icon-32.png');
        } else {
            trayIconPath = path.join(app.getAppPath(), 'tray-icon-32.png');
        }
        
        const trayIcon = nativeImage.createFromPath(trayIconPath);
        
        // Ensure the icon is properly sized
        if (trayIcon.isEmpty()) {
            console.warn('Tray icon not found, falling back to logo');
            const fallbackIcon = nativeImage.createFromPath(path.join(app.getAppPath(), 'Logo-BSS.png'));
            this.tray = new Tray(fallbackIcon.resize({ width: 16, height: 16 }));
        } else {
            this.tray = new Tray(trayIcon);
        }
        
        this.updateTrayMenu(false, 'Disconnected');
        
        this.tray.on('double-click', () => {
            this.showFromTray();
        });
    }

    private updateTrayMenu(isConnected: boolean, status: string) {
        const contextMenu = Menu.buildFromTemplate([
            {
                label: `WhatsApp Status: ${status}`,
                enabled: false
            },
            { type: 'separator' },
            {
                label: 'Show App',
                click: () => this.showFromTray()
            },
            {
                label: 'Settings',
                submenu: [
                    {
                        label: 'Auto Launch',
                        type: 'checkbox',
                        checked: this.store.get('autoLaunch', false) as boolean,
                        click: (item) => this.toggleAutoLaunch(item.checked)
                    },
                    {
                        label: 'Minimize to Tray',
                        type: 'checkbox',
                        checked: this.store.get('minimizeToTray', true) as boolean,
                        click: (item) => this.store.set('minimizeToTray', item.checked)
                    },
                    { type: 'separator' },
                    {
                        label: 'Theme',
                        submenu: [
                            {
                                label: 'Light',
                                type: 'radio',
                                checked: this.store.get('theme', 'system') === 'light',
                                click: () => this.themeManager.setTheme('light')
                            },
                            {
                                label: 'Dark',
                                type: 'radio',
                                checked: this.store.get('theme', 'system') === 'dark',
                                click: () => this.themeManager.setTheme('dark')
                            },
                            {
                                label: 'System',
                                type: 'radio',
                                checked: this.store.get('theme', 'system') === 'system',
                                click: () => this.themeManager.setTheme('system')
                            }
                        ]
                    }
                ]
            },
            { type: 'separator' },
            {
                label: 'About',
                click: () => {
                    dialog.showMessageBox({
                        type: 'info',
                        title: 'About WhatsApp Bulk Sender',
                        message: 'WhatsApp Bulk Sender v1.0.0',
                        detail: 'Built with Electron, React, and WhatsApp Web.js'
                    });
                }
            },
            {
                label: 'Quit',
                click: () => {
                    this.isQuiting = true;
                    app.quit();
                }
            }
        ]);

        this.tray?.setContextMenu(contextMenu);
        this.tray?.setToolTip(`WhatsApp Bulk Sender - ${status}`);
    }

    private hideToTray() {
        this.mainWindow?.hide();
        
        // Show notification on first minimize
        if (!this.store.get('trayNotificationShown', false)) {
            const notificationIcon = nativeImage.createFromPath(path.join(app.getAppPath(), 'tray-icon-32.png'));
            this.tray?.displayBalloon({
                title: 'WhatsApp Bulk Sender',
                content: 'App minimized to tray. Double-click to restore.',
                icon: notificationIcon.isEmpty() ? 
                    nativeImage.createFromPath(path.join(app.getAppPath(), 'Logo-BSS.png')) : 
                    notificationIcon
            });
            this.store.set('trayNotificationShown', true);
        }
    }

    private showFromTray() {
        this.mainWindow?.show();
        this.mainWindow?.focus();
    }

    private async toggleAutoLaunch(enabled: boolean) {
        await this.autoLaunchManager.setAutoLaunch(enabled);
        this.store.set('autoLaunch', enabled);
    }

    private setupIpcHandlers() {
        // Authentication handlers
        ipcMain.handle('auth:register', async (_, userData) => {
            return await this.authManager.register(userData);
        });

        ipcMain.handle('auth:login', async (_, credentials) => {
            return await this.authManager.login(credentials);
        });

        ipcMain.handle('auth:logout', async () => {
            await this.authManager.logout();
            this.store.set('rememberMe', false);
            return true;
        });

        ipcMain.handle('auth:getStoredUser', async () => {
            return this.authManager.getStoredUser();
        });

        ipcMain.handle('auth:getSavedCredentials', async () => {
            return this.authManager.getSavedCredentials();
        });

        ipcMain.handle('auth:getSavedPassword', async (_, username) => {
            return await this.authManager.getSavedPassword(username);
        });

        ipcMain.handle('auth:clearSavedCredentials', async () => {
            this.authManager.clearSavedCredentials();
            return true;
        });

        // WhatsApp handlers
        ipcMain.handle('whatsapp:initialize', async (_, username) => {
            return await this.whatsappManager.initialize(username);
        });

        ipcMain.handle('whatsapp:autoConnect', async () => {
            // Prevent duplicate auto-connect calls
            if (this.autoConnectInProgress) {
                console.log('[Main] Auto-connect already in progress, skipping duplicate request');
                return false;
            }

            try {
                this.autoConnectInProgress = true;
                const storedUser = this.authManager.getStoredUser();
                if (storedUser) {
                    console.log('[Main] Auto-connecting WhatsApp for user:', storedUser.username);
                    // Check if already connected to prevent duplicate calls
                    const status = this.whatsappManager.getStatus();
                    if (status.connected) {
                        console.log('[Main] WhatsApp already connected, skipping auto-connect');
                        return true;
                    }
                    return await this.whatsappManager.initialize(storedUser.username);
                }
                console.log('[Main] No stored user found for auto-connect');
                return false;
            } finally {
                this.autoConnectInProgress = false;
            }
        });

        ipcMain.handle('whatsapp:getQR', async () => {
            return this.whatsappManager.getQRCode();
        });

        ipcMain.handle('whatsapp:getStatus', async () => {
            return this.whatsappManager.getStatus();
        });

        ipcMain.handle('whatsapp:getSessionInfo', async () => {
            return this.whatsappManager.getSessionInfo();
        });

        ipcMain.handle('whatsapp:logout', async () => {
            return await this.whatsappManager.logout();
        });

        ipcMain.handle('whatsapp:destroy', async () => {
            return await this.whatsappManager.destroy();
        });

        // Theme handlers
        ipcMain.handle('theme:get', () => {
            return this.themeManager.getCurrentTheme();
        });

        ipcMain.handle('theme:set', (_, theme) => {
            this.themeManager.setTheme(theme);
        });

        // Settings handlers
        ipcMain.handle('settings:get', (_, key) => {
            return this.store.get(key);
        });

        ipcMain.handle('settings:set', (_, key, value) => {
            this.store.set(key, value);
        });



        ipcMain.handle('app:getVersion', () => {
            return app.getVersion();
        });
    }

    private setupAppEvents() {
        // WhatsApp event handlers
        this.whatsappManager.on('qr', (qr: string) => {
            this.mainWindow?.webContents.send('whatsapp:qr', qr);
        });

        this.whatsappManager.on('ready', (sessionInfo: any) => {
            this.mainWindow?.webContents.send('whatsapp:ready', sessionInfo);
            this.updateTrayMenu(true, 'Connected');
        });

        this.whatsappManager.on('authenticated', () => {
            this.mainWindow?.webContents.send('whatsapp:authenticated');
        });

        this.whatsappManager.on('disconnected', (reason: string) => {
            this.mainWindow?.webContents.send('whatsapp:disconnected', reason);
            this.updateTrayMenu(false, 'Disconnected');
        });

        this.whatsappManager.on('auth_failure', (message: string) => {
            this.mainWindow?.webContents.send('whatsapp:auth_failure', message);
            this.updateTrayMenu(false, 'Authentication Failed');
        });

        // Theme change handler
        nativeTheme.on('updated', () => {
            this.mainWindow?.webContents.send('theme:changed', this.themeManager.getCurrentTheme());
        });
    }
}

// Initialize app
new AppManager();