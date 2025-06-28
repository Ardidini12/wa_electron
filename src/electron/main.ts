import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, nativeTheme, shell, powerSaveBlocker } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { isDev } from './util.js';
import csv from 'csv-parser';
import { stringify } from 'csv-stringify/sync';
import XLSX from 'xlsx';
import { pollResources } from './resourceManager.js';
import { getPreloadPath } from './pathResolver.js';
import { WhatsAppManager } from './whatsappManager.js';
import { AuthManager } from './authManager.js';
import { ThemeManager } from './themeManager.js';
import { AutoLaunchManager } from './autoLaunchManager.js';
import { DatabaseManager } from './databaseManager.js';
import { ContactManager } from './contactManager.js';
import { TemplateManager } from './templateManager.js';
import { BulkSenderManager } from './bulkSenderManager.js';
import { SalesAPIManager } from './salesAPIManager.js';

import Store from 'electron-store';

// ES module __dirname equivalent
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class AppManager {
    private mainWindow: BrowserWindow | null = null;
    private tray: Tray | null = null;
    private whatsappManager: WhatsAppManager;
    private authManager: AuthManager;
    private themeManager: ThemeManager;
    private autoLaunchManager: AutoLaunchManager;
    private databaseManager: DatabaseManager;
    private contactManager: ContactManager;
    private templateManager: TemplateManager;
    private bulkSenderManager: BulkSenderManager;
    private salesAPIManager: SalesAPIManager;

    private store: Store;
    private isQuiting = false;
    private autoConnectInProgress = false;
    private powerSaveBlockerId: number | null = null;

    constructor() {
        this.store = new Store();
        this.databaseManager = new DatabaseManager();
        this.contactManager = new ContactManager();
        this.templateManager = new TemplateManager();
        this.whatsappManager = new WhatsAppManager();
        this.bulkSenderManager = new BulkSenderManager(this.whatsappManager, this.templateManager, this.contactManager);
        this.salesAPIManager = new SalesAPIManager();
        this.salesAPIManager.setWhatsAppManager(this.whatsappManager);

        this.authManager = new AuthManager();
        this.themeManager = new ThemeManager();
        this.autoLaunchManager = new AutoLaunchManager();
        
        // Set max listeners for all managers
        this.whatsappManager.setMaxListeners(10000);
        this.bulkSenderManager.setMaxListeners(10000);
        
        this.setupApp();
        this.setupSchedulerPersistence();
    }

    private setupApp() {
        // Handle app ready
        app.whenReady().then(() => {
            this.createWindow();
            this.createTray();
            this.setupIpcHandlers();
            this.setupAppEvents();
            this.initializePowerSettings();
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
            
            // Clean up power save blocker
            if (this.powerSaveBlockerId !== null) {
                powerSaveBlocker.stop(this.powerSaveBlockerId);
                this.powerSaveBlockerId = null;
            }
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
                nodeIntegration: true,
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
            title: 'BSS - WhatsApp Bulk Sender'
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
                    {
                        label: 'Sleep Prevention',
                        type: 'checkbox',
                        checked: true,
                        enabled: false,
                        toolTip: 'Sleep prevention is always enabled'
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

    private togglePreventSleep(enabled: boolean) {
        try {
            if (enabled) {
                // Stop any existing blockers
                if (this.powerSaveBlockerId !== null) {
                    powerSaveBlocker.stop(this.powerSaveBlockerId);
                    this.powerSaveBlockerId = null;
                }
                
                // Start preventing sleep with the stronger 'prevent-display-sleep' mode
                // This prevents both system sleep and display sleep
                this.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
                console.log('[PowerManager] Sleep and display sleep prevention enabled - ID:', this.powerSaveBlockerId);
            } else {
                // Stop preventing sleep
                if (this.powerSaveBlockerId !== null) {
                    powerSaveBlocker.stop(this.powerSaveBlockerId);
                    console.log('[PowerManager] Sleep prevention disabled - ID:', this.powerSaveBlockerId);
                    this.powerSaveBlockerId = null;
                }
            }
            
            this.store.set('preventSleep', enabled);
            
            // Update tray menu to reflect the change
            const status = this.whatsappManager?.getStatus();
            this.updateTrayMenu(status?.connected || false, status?.connected ? 'Connected' : 'Disconnected');

            // Send updated status to renderer
            if (this.mainWindow) {
                this.mainWindow.webContents.send('power:status-updated', enabled && this.powerSaveBlockerId !== null);
            }
        } catch (error) {
            console.error('[PowerManager] Failed to toggle sleep prevention:', error);
        }
    }

    private initializePowerSettings() {
        // Always enable sleep prevention - app must work all time
        console.log('[PowerManager] Initializing power settings - enabling sleep prevention');
        this.togglePreventSleep(true);
        console.log('[PowerManager] Sleep prevention initialized and active');
        
        // OLD CODE - Check if sleep prevention was enabled before (commented for future use)
        // const preventSleep = this.store.get('preventSleep', false) as boolean;
        // if (preventSleep) {
        //     this.togglePreventSleep(true);
        // }
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

        // Power management handlers
        ipcMain.handle('power:setPreventSleep', (_, enabled) => {
            this.togglePreventSleep(enabled);
            return this.store.get('preventSleep', false);
        });

        ipcMain.handle('power:getPreventSleep', () => {
            return this.store.get('preventSleep', false);
        });

        ipcMain.handle('power:isBlocking', () => {
            return this.powerSaveBlockerId !== null;
        });

        // Contact API handlers
        ipcMain.handle('contacts:getContacts', async (_, page: number, limit: number, search: string) => {
            return await this.contactManager.getContacts(page, limit, search);
        });

        ipcMain.handle('contacts:getAllContactIds', async (_, search: string) => {
            return await this.contactManager.getAllContactIds(search);
        });

        ipcMain.handle('contacts:addContact', async (_, contactData: any) => {
            return await this.contactManager.addContact(contactData);
        });

        ipcMain.handle('contacts:updateContact', async (_, contactId: number, contactData: any) => {
            return await this.contactManager.updateContact(contactId, contactData);
        });

        ipcMain.handle('contacts:deleteContacts', async (_, contactIds: number[]) => {
            return await this.contactManager.deleteContacts(contactIds);
        });

        // Import/Export handlers
        ipcMain.handle('contacts:importFile', async (_, filePath: string) => {
            return await this.contactManager.parseContactFile(filePath);
        });

        ipcMain.handle('contacts:processImport', async (_, contacts: any[]) => {
            return await this.contactManager.processContactsForImport(contacts);
        });

        ipcMain.handle('contacts:checkPhoneExists', async (_, phone: string) => {
            return await this.contactManager.checkPhoneExists(phone);
        });

        ipcMain.handle('contacts:importContacts', async (_, contacts: any[], skipDuplicates: boolean) => {
            return await this.contactManager.importContacts(contacts, skipDuplicates);
        });

        ipcMain.handle('contacts:exportContacts', async (_, format: string) => {
            return await this.contactManager.exportContacts(format as 'csv' | 'excel' | 'json');
        });

        ipcMain.handle('app:openFileDialog', async (_, options: any) => {
            try {
                const result = await dialog.showOpenDialog(this.mainWindow!, {
                    title: options.title || 'Select File',
                    filters: options.filters || [
                        { name: 'Contact Files', extensions: ['csv', 'xlsx', 'xls', 'json'] },
                        { name: 'All Files', extensions: ['*'] }
                    ],
                    properties: options.properties || ['openFile']
                });
                
                return { 
                    success: !result.canceled, 
                    filePaths: result.filePaths,
                    error: result.canceled ? 'User cancelled' : null
                };
            } catch (error: any) {
                console.error('Error opening file dialog:', error);
                return { success: false, error: error.message };
            }
        });

        // Template API handlers
        ipcMain.handle('templates:getTemplates', async (_, page: number, limit: number, search: string) => {
            return await this.templateManager.getTemplates(page, limit, search);
        });

        ipcMain.handle('templates:getAllTemplateIds', async (_, search: string) => {
            return await this.templateManager.getAllTemplateIds(search);
        });

        ipcMain.handle('templates:addTemplate', async (_, templateData: any) => {
            return await this.templateManager.addTemplate(templateData);
        });

        ipcMain.handle('templates:updateTemplate', async (_, templateId: number, templateData: any) => {
            return await this.templateManager.updateTemplate(templateId, templateData);
        });

        ipcMain.handle('templates:deleteTemplates', async (_, templateIds: number[]) => {
            return await this.templateManager.deleteTemplates(templateIds);
        });

        ipcMain.handle('templates:getVariables', async () => {
            return this.templateManager.getTemplateVariables();
        });

        ipcMain.handle('templates:previewTemplate', async (_, template: any) => {
            return this.templateManager.previewTemplate(template);
        });

        ipcMain.handle('app:getVersion', () => {
            return app.getVersion();
        });

        // Bulk Sender API handlers
        ipcMain.handle('bulk:getSettings', async (_, userId: number) => {
            return await this.bulkSenderManager.getBulkSettings(userId);
        });

        ipcMain.handle('bulk:saveSettings', async (_, userId: number, settings: any) => {
            return await this.bulkSenderManager.saveBulkSettings(userId, settings);
        });

        ipcMain.handle('bulk:calculateMessagesPerDay', (_, settings: any) => {
            return this.bulkSenderManager.calculateMessagesPerDay(settings);
        });

        ipcMain.handle('bulk:getContactsBySource', async () => {
            return await this.bulkSenderManager.getContactsBySource();
        });

        ipcMain.handle('bulk:getContactsBySourcePaginated', async (_, source: string, page: number, limit: number) => {
            return await this.bulkSenderManager.getContactsBySourcePaginated(source, page, limit);
        });

        ipcMain.handle('bulk:createCampaign', async (_, userId: number, campaignName: string, templateId: number, contactIds: number[]) => {
            return await this.bulkSenderManager.createBulkCampaign(userId, campaignName, templateId, contactIds);
        });

        ipcMain.handle('bulk:getCampaigns', async (_, userId: number, page: number, limit: number) => {
            return await this.bulkSenderManager.getBulkCampaigns(userId, page, limit);
        });

        ipcMain.handle('bulk:getMessages', async (_, campaignId: number, page: number, limit: number, statusFilter?: string) => {
            return await this.bulkSenderManager.getBulkMessages(campaignId, page, limit, statusFilter);
        });

        ipcMain.handle('bulk:cancelCampaign', async (_, campaignId: number) => {
            return await this.bulkSenderManager.cancelBulkCampaign(campaignId);
        });

        ipcMain.handle('bulk:cancelCampaignMessages', async (_, campaignId: number, messageIds: number[]) => {
            return await this.bulkSenderManager.cancelCampaignMessages(campaignId, messageIds);
        });

        ipcMain.handle('bulk:cancelSingleMessage', async (_, messageId: number) => {
            return await this.bulkSenderManager.cancelSingleMessage(messageId);
        });

        ipcMain.handle('bulk:getAllScheduledMessageIds', async (_, campaignId: number, statusFilter?: string) => {
            return await this.bulkSenderManager.getAllScheduledMessageIds(campaignId, statusFilter);
        });

        ipcMain.handle('bulk:deleteMessages', async (_, messageIds: number[]) => {
            return await this.bulkSenderManager.deleteMessages(messageIds);
        });

        ipcMain.handle('bulk:getCampaignsWithFilter', async (_, userId: number, page: number, limit: number, nameFilter?: string, statusFilter?: string) => {
            return await this.bulkSenderManager.getBulkCampaignsWithFilter(userId, page, limit, nameFilter, statusFilter);
        });

        ipcMain.handle('bulk:getStatistics', async () => {
            return await this.bulkSenderManager.getBulkStatistics();
        });

        // Delete campaigns
        ipcMain.handle('bulk:deleteCampaigns', async (event, campaignIds: number[]) => {
            return await this.bulkSenderManager.deleteCampaigns(campaignIds);
        });

        // Get campaign counts
        ipcMain.handle('bulk:getCampaignCounts', async (event, userId: number, nameFilter?: string) => {
            return await this.bulkSenderManager.getCampaignCounts(userId, nameFilter);
        });

        // Get message counts
        ipcMain.handle('bulk:getMessageCounts', async (event, campaignId: number) => {
            return await this.bulkSenderManager.getMessageCounts(campaignId);
        });

        // Get all messages across campaigns
        ipcMain.handle('bulk:getAllMessages', async (event, userId: number, page: number, limit: number, statusFilter?: string, campaignFilter?: string) => {
            return await this.bulkSenderManager.getAllBulkMessages(userId, page, limit, statusFilter, campaignFilter);
        });

        // Get all message counts across campaigns
        ipcMain.handle('bulk:getAllMessageCounts', async (event, userId: number, campaignFilter?: string) => {
            return await this.bulkSenderManager.getAllMessageCounts(userId, campaignFilter);
        });

        // Get scheduler status
        ipcMain.handle('bulk:getSchedulerStatus', async () => {
            try {
                const status = this.bulkSenderManager.getSchedulerStatus();
                return { success: true, status };
            } catch (error: any) {
                console.error('Error getting scheduler status:', error);
                return { success: false, error: error.message };
            }
        });

        // Manually restart scheduler (for debugging or manual refresh)
        ipcMain.handle('bulk:restartScheduler', async () => {
            try {
                await this.bulkSenderManager.reloadAndRestartScheduler();
                return { success: true };
            } catch (error: any) {
                console.error('Error restarting scheduler:', error);
                return { success: false, error: error.message };
            }
        });

        // Force start processing (for debugging)
        ipcMain.handle('bulk:forceStartProcessing', async () => {
            try {
                await this.bulkSenderManager.forceStartProcessing();
                return { success: true };
            } catch (error: any) {
                console.error('Error force starting processing:', error);
                return { success: false, error: error.message };
            }
        });

        // Sales API handlers
        ipcMain.handle('salesAPI:getSales', async (_, page: number, limit: number, search: string, townFilter: string, dateFrom: string, dateTo: string, sortBy: string, sortOrder: string) => {
            return await this.salesAPIManager.getSales(page, limit, search, townFilter, dateFrom, dateTo, sortBy, sortOrder);
        });

        ipcMain.handle('salesAPI:getAllSalesIds', async (_, search: string, townFilter: string, dateFrom: string, dateTo: string) => {
            return await this.salesAPIManager.getAllSalesIds(search, townFilter, dateFrom, dateTo);
        });

        ipcMain.handle('salesAPI:manualFetch', async () => {
            return await this.salesAPIManager.fetchSalesData();
        });

        ipcMain.handle('salesAPI:deleteSales', async (_, salesIds: number[]) => {
            return await this.salesAPIManager.deleteSales(salesIds);
        });

        ipcMain.handle('salesAPI:getStats', async () => {
            return this.salesAPIManager.getStats();
        });

        ipcMain.handle('salesAPI:getTimerState', async () => {
            return this.salesAPIManager.getTimerState();
        });

        // Sales Settings handlers
        ipcMain.handle('salesAPI:getSalesSettings', async () => {
            return await this.salesAPIManager.getSalesSettings();
        });

        ipcMain.handle('salesAPI:saveSalesSettings', async (_, settings) => {
            return await this.salesAPIManager.saveSalesSettings(settings);
        });

        // Scheduled Messages handlers
        ipcMain.handle('salesAPI:getScheduledMessages', async (_, page: number, limit: number, statusFilter: string, messageTypeFilter: string, townFilter: string) => {
            return await this.salesAPIManager.getScheduledMessages(page, limit, statusFilter, messageTypeFilter, townFilter);
        });

        ipcMain.handle('salesAPI:getAllScheduledMessageIds', async (_, statusFilter: string, messageTypeFilter: string, townFilter: string) => {
            return await this.salesAPIManager.getAllScheduledMessageIds(statusFilter, messageTypeFilter, townFilter);
        });

        ipcMain.handle('salesAPI:cancelScheduledMessages', async (_, messageIds: number[]) => {
            return await this.salesAPIManager.cancelScheduledMessages(messageIds);
        });

        ipcMain.handle('salesAPI:deleteScheduledMessages', async (_, messageIds: number[]) => {
            return await this.salesAPIManager.deleteScheduledMessages(messageIds);
        });

        ipcMain.handle('salesAPI:getScheduledMessagesStats', async () => {
            return this.salesAPIManager.getScheduledMessagesStats();
        });

        this.salesAPIManager.on('sales-deleted', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:sales-deleted', data);
            }
        });

        this.salesAPIManager.on('message-sent', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:message-sent', data);
            }
        });

        this.salesAPIManager.on('message-failed', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:message-failed', data);
            }
        });

    }



    private setupSchedulerPersistence() {
        // Initialize scheduler when app starts to handle persistence across restarts
        setTimeout(async () => {
            try {
                await this.bulkSenderManager.reloadAndRestartScheduler();
                console.log('[Main] Scheduler persistence initialized');
            } catch (error) {
                console.error('[Main] Error initializing scheduler persistence:', error);
            }
        }, 2000); // Wait 2 seconds for everything to initialize
    }

    private setupAppEvents() {
        // WhatsApp event handlers
        this.whatsappManager.on('qr', (qr: string) => {
            this.mainWindow?.webContents.send('whatsapp:qr', qr);
        });

        this.whatsappManager.on('ready', (sessionInfo: any) => {
            this.mainWindow?.webContents.send('whatsapp:ready', sessionInfo);
            this.updateTrayMenu(true, 'Connected');
            // Start Sales API auto-fetch when WhatsApp connects
            this.salesAPIManager.setWhatsAppConnection(true);
        });

        this.whatsappManager.on('authenticated', () => {
            this.mainWindow?.webContents.send('whatsapp:authenticated');
        });

        this.whatsappManager.on('disconnected', (reason: string) => {
            this.mainWindow?.webContents.send('whatsapp:disconnected', reason);
            this.updateTrayMenu(false, 'Disconnected');
            // Stop Sales API auto-fetch when WhatsApp disconnects
            this.salesAPIManager.setWhatsAppConnection(false);
        });

        this.whatsappManager.on('auth_failure', (message: string) => {
            this.mainWindow?.webContents.send('whatsapp:auth_failure', message);
            this.updateTrayMenu(false, 'Authentication Failed');
        });

        // Theme change handler
        nativeTheme.on('updated', () => {
            this.mainWindow?.webContents.send('theme:changed', this.themeManager.getCurrentTheme());
        });

        // Bulk sender event handlers for real-time updates
        this.bulkSenderManager.on('message-status-updated', (data) => {
            this.mainWindow?.webContents.send('bulk:message-status-updated', data);
        });

        this.bulkSenderManager.on('campaign-completed', (data) => {
            this.mainWindow?.webContents.send('bulk:campaign-completed', data);
        });

        this.bulkSenderManager.on('campaign-cancelled', (data) => {
            this.mainWindow?.webContents.send('bulk:campaign-cancelled', data);
        });

        this.bulkSenderManager.on('campaign-created', (data) => {
            this.mainWindow?.webContents.send('bulk:campaign-created', data);
        });

        this.bulkSenderManager.on('message-sent', (data) => {
            this.mainWindow?.webContents.send('bulk:message-sent', data);
        });

        this.bulkSenderManager.on('message-failed', (data) => {
            this.mainWindow?.webContents.send('bulk:message-failed', data);
        });

        this.bulkSenderManager.on('settings-updated', (data) => {
            this.mainWindow?.webContents.send('bulk:settings-updated', data);
        });

        // Forward bulk sender events to frontend
        this.bulkSenderManager.on('message-status-updated', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('bulk-message-status-updated', data);
            }
        });
        
        this.bulkSenderManager.on('campaign-stats-updated', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('bulk-campaign-stats-updated', data);
            }
        });
        
        this.bulkSenderManager.on('message-sent', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('bulk-message-sent', data);
            }
        });
        
        this.bulkSenderManager.on('message-failed', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('bulk-message-failed', data);
            }
        });
        
        this.bulkSenderManager.on('campaign-cancelled', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('bulk-campaign-cancelled', data);
            }
        });

        // Sales API event handlers
        this.salesAPIManager.on('timer-update', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:timer-update', data);
            }
        });

        this.salesAPIManager.on('fetch-start', () => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:fetch-start');
            }
        });

        this.salesAPIManager.on('fetch-success', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:fetch-success', data);
            }
        });

        this.salesAPIManager.on('fetch-error', (message) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:fetch-error', message);
            }
        });

        this.salesAPIManager.on('sales-deleted', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:sales-deleted', data);
            }
        });

        this.salesAPIManager.on('message-sent', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:message-sent', data);
            }
        });

        this.salesAPIManager.on('message-failed', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:message-failed', data);
            }
        });

        this.salesAPIManager.on('message-status-updated', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('salesAPI:message-status-updated', data);
            }
        });

    }
}

// Initialize app
new AppManager();