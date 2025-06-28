const electron = require('electron');

// Set max listeners to prevent memory leak warnings
electron.ipcRenderer.setMaxListeners(10000);

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
    
    // Power Management APIs
    power: {
        setPreventSleep: (enabled: boolean) => Promise<boolean>;
        getPreventSleep: () => Promise<boolean>;
        isBlocking: () => Promise<boolean>;
        onStatusUpdate: (callback: (isActive: boolean) => void) => void;
    };
    
    // App APIs
    app: {
        getVersion: () => Promise<string>;
        onAutoLogin: (callback: () => void) => void;
        openFileDialog: (options: any) => Promise<any>;
    };
    
    // Legacy APIs (keep for compatibility)
    subscribeStatistics: (callback: (statistics: any) => void) => void;
    getStaticData: () => void;
    
    // Contacts APIs
    contacts: {
        getContacts: (page: number, limit: number, search: string) => Promise<any>;
        getAllContactIds: (search: string) => Promise<any>;
        addContact: (contactData: any) => Promise<any>;
        updateContact: (contactId: number, contactData: any) => Promise<any>;
        deleteContacts: (contactIds: number[]) => Promise<any>;
        importFile: (filePath: string) => Promise<any>;
        processImport: (contacts: any[]) => Promise<any>;
        checkPhoneExists: (phone: string) => Promise<boolean>;
        importContacts: (contacts: any[], skipDuplicates: boolean) => Promise<any>;
        exportContacts: (format: string) => Promise<any>;
    };
    
    // Templates APIs
    templates: {
        getTemplates: (page: number, limit: number, search: string) => Promise<any>;
        getAllTemplateIds: (search: string) => Promise<any>;
        addTemplate: (templateData: any) => Promise<any>;
        updateTemplate: (templateId: number, templateData: any) => Promise<any>;
        deleteTemplates: (templateIds: number[]) => Promise<any>;
        getVariables: () => Promise<any>;
        previewTemplate: (template: any) => Promise<any>;
    };
    
    // Bulk Sender APIs
    bulk: {
        getSettings: (userId: number) => Promise<any>;
        saveSettings: (userId: number, settings: any) => Promise<any>;
        calculateMessagesPerDay: (settings: any) => number;
        getContactsBySource: () => Promise<any>;
        getContactsBySourcePaginated: (source: string, page: number, limit: number) => Promise<any>;
        createCampaign: (userId: number, campaignName: string, templateId: number, contactIds: number[]) => Promise<any>;
        getCampaigns: (userId: number, page: number, limit: number) => Promise<any>;
        getMessages: (campaignId: number, page: number, limit: number, statusFilter?: string) => Promise<any>;
        cancelCampaign: (campaignId: number) => Promise<any>;
        cancelCampaignMessages: (campaignId: number, messageIds: number[]) => Promise<any>;
        cancelSingleMessage: (messageId: number) => Promise<any>;
        getAllScheduledMessageIds: (campaignId: number, statusFilter?: string) => Promise<any>;
        deleteMessages: (messageIds: number[]) => Promise<any>;
        deleteCampaigns: (campaignIds: number[]) => Promise<any>;
        getCampaignsWithFilter: (userId: number, page: number, limit: number, nameFilter?: string, statusFilter?: string) => Promise<any>;
        getCampaignCounts: (userId: number, nameFilter?: string) => Promise<any>;
        getMessageCounts: (campaignId: number) => Promise<any>;
        getAllMessages: (userId: number, page: number, limit: number, statusFilter?: string, campaignFilter?: string) => Promise<any>;
        getAllMessageCounts: (userId: number, campaignFilter?: string) => Promise<any>;
        getStatistics: () => Promise<any>;
        getSchedulerStatus: () => Promise<any>;
        restartScheduler: () => Promise<any>;
        forceStartProcessing: () => Promise<any>;
        onMessageStatusUpdated: (callback: (data: any) => void) => void;
        onCampaignCompleted: (callback: (data: any) => void) => void;
        onCampaignCancelled: (callback: (data: any) => void) => void;
        onCampaignCreated: (callback: (data: any) => void) => void;
        onMessageSent: (callback: (data: any) => void) => void;
        onMessageFailed: (callback: (data: any) => void) => void;
        onSettingsUpdated: (callback: (data: any) => void) => void;
        onBulkMessageStatusUpdated: (callback: (data: any) => void) => void;
        onBulkCampaignStatsUpdated: (callback: (data: any) => void) => void;
        onBulkMessageSent: (callback: (data: any) => void) => void;
        onBulkMessageFailed: (callback: (data: any) => void) => void;
        onBulkCampaignCancelled: (callback: (data: any) => void) => void;
    };
    
    // Sales API
    salesAPI: {
        getSales: (page: number, limit: number, search: string, townFilter: string, dateFrom: string, dateTo: string, sortBy: string, sortOrder: string) => Promise<any>;
        getAllSalesIds: (search: string, townFilter: string, dateFrom: string, dateTo: string) => Promise<any>;
        manualFetch: () => Promise<any>;
        deleteSales: (salesIds: number[]) => Promise<any>;
        getStats: () => Promise<any>;
        getTimerState: () => Promise<any>;
        getSalesSettings: () => Promise<any>;
        saveSalesSettings: (settings: any) => Promise<any>;
        getScheduledMessages: (page: number, limit: number, statusFilter: string, messageTypeFilter: string, townFilter: string) => Promise<any>;
        getAllScheduledMessageIds: (statusFilter: string, messageTypeFilter: string, townFilter: string) => Promise<any>;
        cancelScheduledMessages: (messageIds: number[]) => Promise<any>;
        deleteScheduledMessages: (messageIds: number[]) => Promise<any>;
        getScheduledMessagesStats: () => Promise<any>;
        onTimerUpdate: (callback: (data: any) => void) => void;
        onFetchStart: (callback: () => void) => void;
        onFetchSuccess: (callback: (data: any) => void) => void;
        onFetchError: (callback: (message: string) => void) => void;
        onSalesDeleted: (callback: (data: any) => void) => void;
        onMessageSent: (callback: (data: any) => void) => void;
        onMessageFailed: (callback: (data: any) => void) => void;
        onMessageStatusUpdated: (callback: (data: any) => void) => void;
    };

}

// Expose the electron API
const electronAPI: ElectronAPI = {
    // Authentication APIs
    auth: {
        register: (userData: any) => electron.ipcRenderer.invoke('auth:register', userData),
        login: (credentials: any) => electron.ipcRenderer.invoke('auth:login', credentials),
        logout: () => electron.ipcRenderer.invoke('auth:logout'),
        getStoredUser: () => electron.ipcRenderer.invoke('auth:getStoredUser'),
        getSavedCredentials: () => electron.ipcRenderer.invoke('auth:getSavedCredentials'),
        getSavedPassword: (username: string) => electron.ipcRenderer.invoke('auth:getSavedPassword', username),
        clearSavedCredentials: () => electron.ipcRenderer.invoke('auth:clearSavedCredentials'),
    },
    
    // WhatsApp APIs
    whatsapp: {
        initialize: (username: string) => electron.ipcRenderer.invoke('whatsapp:initialize', username),
        autoConnect: () => electron.ipcRenderer.invoke('whatsapp:autoConnect'),
        getQR: () => electron.ipcRenderer.invoke('whatsapp:getQR'),
        getStatus: () => electron.ipcRenderer.invoke('whatsapp:getStatus'),
        getSessionInfo: () => electron.ipcRenderer.invoke('whatsapp:getSessionInfo'),
        logout: () => electron.ipcRenderer.invoke('whatsapp:logout'),
        destroy: () => electron.ipcRenderer.invoke('whatsapp:destroy'),
        onQR: (callback: (qr: string) => void) => {
            const unsubscribe = () => electron.ipcRenderer.removeListener('whatsapp:qr', callback);
            electron.ipcRenderer.on('whatsapp:qr', (_: any, qr: string) => callback(qr));
            return unsubscribe;
        },
        onReady: (callback: (sessionInfo: any) => void) => {
            const unsubscribe = () => electron.ipcRenderer.removeListener('whatsapp:ready', callback);
            electron.ipcRenderer.on('whatsapp:ready', (_: any, sessionInfo: any) => callback(sessionInfo));
            return unsubscribe;
        },
        onAuthenticated: (callback: () => void) => {
            const unsubscribe = () => electron.ipcRenderer.removeListener('whatsapp:authenticated', callback);
            electron.ipcRenderer.on('whatsapp:authenticated', callback);
            return unsubscribe;
        },
        onDisconnected: (callback: (reason: string) => void) => {
            const unsubscribe = () => electron.ipcRenderer.removeListener('whatsapp:disconnected', callback);
            electron.ipcRenderer.on('whatsapp:disconnected', (_: any, reason: string) => callback(reason));
            return unsubscribe;
        },
        onAuthFailure: (callback: (message: string) => void) => {
            const unsubscribe = () => electron.ipcRenderer.removeListener('whatsapp:auth_failure', callback);
            electron.ipcRenderer.on('whatsapp:auth_failure', (_: any, message: string) => callback(message));
            return unsubscribe;
        },
    },
    
    // Theme APIs
    theme: {
        get: () => electron.ipcRenderer.invoke('theme:get'),
        set: (theme: string) => electron.ipcRenderer.invoke('theme:set', theme),
        onChange: (callback: (theme: any) => void) => {
            electron.ipcRenderer.on('theme:changed', (_: any, theme: any) => callback(theme));
        },
    },
    
    // Settings APIs
    settings: {
        get: (key: string) => electron.ipcRenderer.invoke('settings:get', key),
        set: (key: string, value: any) => electron.ipcRenderer.invoke('settings:set', key, value),
    },
    
    // Power Management APIs
    power: {
        setPreventSleep: (enabled: boolean) => electron.ipcRenderer.invoke('power:setPreventSleep', enabled),
        getPreventSleep: () => electron.ipcRenderer.invoke('power:getPreventSleep'),
        isBlocking: () => electron.ipcRenderer.invoke('power:isBlocking'),
        onStatusUpdate: (callback: (isActive: boolean) => void) => {
            const unsubscribe = () => electron.ipcRenderer.removeListener('power:status-updated', callback);
            electron.ipcRenderer.on('power:status-updated', (_: any, isActive: boolean) => callback(isActive));
            return unsubscribe;
        }
    },
    
    // App APIs
    app: {
        getVersion: () => electron.ipcRenderer.invoke('app:getVersion'),
        onAutoLogin: (callback: () => void) => electron.ipcRenderer.on('auto-login', callback),
        openFileDialog: (options: any) => electron.ipcRenderer.invoke('app:openFileDialog', options),
    },
    
    // Legacy APIs (keep for compatibility)
    subscribeStatistics: (callback: (statistics: any) => void) => callback({}),
    getStaticData: () => console.log('static'),
    
    // Contacts APIs
    contacts: {
        getContacts: (page: number, limit: number, search: string) => electron.ipcRenderer.invoke('contacts:getContacts', page, limit, search),
        getAllContactIds: (search: string) => electron.ipcRenderer.invoke('contacts:getAllContactIds', search),
        addContact: (contactData: any) => electron.ipcRenderer.invoke('contacts:addContact', contactData),
        updateContact: (contactId: number, contactData: any) => electron.ipcRenderer.invoke('contacts:updateContact', contactId, contactData),
        deleteContacts: (contactIds: number[]) => electron.ipcRenderer.invoke('contacts:deleteContacts', contactIds),
        importFile: (filePath: string) => electron.ipcRenderer.invoke('contacts:importFile', filePath),
        processImport: (contacts: any[]) => electron.ipcRenderer.invoke('contacts:processImport', contacts),
        checkPhoneExists: (phone: string) => electron.ipcRenderer.invoke('contacts:checkPhoneExists', phone),
        importContacts: (contacts: any[], skipDuplicates: boolean) => electron.ipcRenderer.invoke('contacts:importContacts', contacts, skipDuplicates),
        exportContacts: (format: string) => electron.ipcRenderer.invoke('contacts:exportContacts', format),
    },
    
    // Templates APIs
    templates: {
        getTemplates: (page: number, limit: number, search: string) => electron.ipcRenderer.invoke('templates:getTemplates', page, limit, search),
        getAllTemplateIds: (search: string) => electron.ipcRenderer.invoke('templates:getAllTemplateIds', search),
        addTemplate: (templateData: any) => electron.ipcRenderer.invoke('templates:addTemplate', templateData),
        updateTemplate: (templateId: number, templateData: any) => electron.ipcRenderer.invoke('templates:updateTemplate', templateId, templateData),
        deleteTemplates: (templateIds: number[]) => electron.ipcRenderer.invoke('templates:deleteTemplates', templateIds),
        getVariables: () => electron.ipcRenderer.invoke('templates:getVariables'),
        previewTemplate: (template: any) => electron.ipcRenderer.invoke('templates:previewTemplate', template),
    },
    
    // Bulk Sender APIs
    bulk: {
        getSettings: (userId: number) => electron.ipcRenderer.invoke('bulk:getSettings', userId),
        saveSettings: (userId: number, settings: any) => electron.ipcRenderer.invoke('bulk:saveSettings', userId, settings),
        calculateMessagesPerDay: (settings: any) => electron.ipcRenderer.invoke('bulk:calculateMessagesPerDay', settings),
        getContactsBySource: () => electron.ipcRenderer.invoke('bulk:getContactsBySource'),
        getContactsBySourcePaginated: (source: string, page: number, limit: number) => electron.ipcRenderer.invoke('bulk:getContactsBySourcePaginated', source, page, limit),
        createCampaign: (userId: number, campaignName: string, templateId: number, contactIds: number[]) => electron.ipcRenderer.invoke('bulk:createCampaign', userId, campaignName, templateId, contactIds),
        getCampaigns: (userId: number, page: number, limit: number) => electron.ipcRenderer.invoke('bulk:getCampaigns', userId, page, limit),
        getMessages: (campaignId: number, page: number, limit: number, statusFilter?: string) => electron.ipcRenderer.invoke('bulk:getMessages', campaignId, page, limit, statusFilter),
        cancelCampaign: (campaignId: number) => electron.ipcRenderer.invoke('bulk:cancelCampaign', campaignId),
        cancelCampaignMessages: (campaignId: number, messageIds: number[]) => electron.ipcRenderer.invoke('bulk:cancelCampaignMessages', campaignId, messageIds),
        cancelSingleMessage: (messageId: number) => electron.ipcRenderer.invoke('bulk:cancelSingleMessage', messageId),
        getAllScheduledMessageIds: (campaignId: number, statusFilter?: string) => electron.ipcRenderer.invoke('bulk:getAllScheduledMessageIds', campaignId, statusFilter),
        deleteMessages: (messageIds: number[]) => electron.ipcRenderer.invoke('bulk:deleteMessages', messageIds),
        deleteCampaigns: (campaignIds: number[]) => electron.ipcRenderer.invoke('bulk:deleteCampaigns', campaignIds),
        getCampaignsWithFilter: (userId: number, page: number, limit: number, nameFilter?: string, statusFilter?: string) => electron.ipcRenderer.invoke('bulk:getCampaignsWithFilter', userId, page, limit, nameFilter, statusFilter),
        getCampaignCounts: (userId: number, nameFilter?: string) => electron.ipcRenderer.invoke('bulk:getCampaignCounts', userId, nameFilter),
        getMessageCounts: (campaignId: number) => electron.ipcRenderer.invoke('bulk:getMessageCounts', campaignId),
        getAllMessages: (userId: number, page: number, limit: number, statusFilter?: string, campaignFilter?: string) => electron.ipcRenderer.invoke('bulk:getAllMessages', userId, page, limit, statusFilter, campaignFilter),
        getAllMessageCounts: (userId: number, campaignFilter?: string) => electron.ipcRenderer.invoke('bulk:getAllMessageCounts', userId, campaignFilter),
        getStatistics: () => electron.ipcRenderer.invoke('bulk:getStatistics'),
        getSchedulerStatus: () => electron.ipcRenderer.invoke('bulk:getSchedulerStatus'),
        restartScheduler: () => electron.ipcRenderer.invoke('bulk:restartScheduler'),
        forceStartProcessing: () => electron.ipcRenderer.invoke('bulk:forceStartProcessing'),
        onMessageStatusUpdated: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk:message-status-updated', (_: any, data: any) => callback(data)),
        onCampaignCompleted: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk:campaign-completed', (_: any, data: any) => callback(data)),
        onCampaignCancelled: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk:campaign-cancelled', (_: any, data: any) => callback(data)),
        onCampaignCreated: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk:campaign-created', (_: any, data: any) => callback(data)),
        onMessageSent: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk:message-sent', (_: any, data: any) => callback(data)),
        onMessageFailed: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk:message-failed', (_: any, data: any) => callback(data)),
        onSettingsUpdated: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk:settings-updated', (_: any, data: any) => callback(data)),
        onBulkMessageStatusUpdated: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk-message-status-updated', (_: any, data: any) => callback(data)),
        onBulkCampaignStatsUpdated: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk-campaign-stats-updated', (_: any, data: any) => callback(data)),
        onBulkMessageSent: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk-message-sent', (_: any, data: any) => callback(data)),
        onBulkMessageFailed: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk-message-failed', (_: any, data: any) => callback(data)),
        onBulkCampaignCancelled: (callback: (data: any) => void) => electron.ipcRenderer.on('bulk-campaign-cancelled', (_: any, data: any) => callback(data)),
    },
    
    // Sales API
    salesAPI: {
        getSales: (page: number, limit: number, search: string, townFilter: string, dateFrom: string, dateTo: string, sortBy: string, sortOrder: string) => electron.ipcRenderer.invoke('salesAPI:getSales', page, limit, search, townFilter, dateFrom, dateTo, sortBy, sortOrder),
        getAllSalesIds: (search: string, townFilter: string, dateFrom: string, dateTo: string) => electron.ipcRenderer.invoke('salesAPI:getAllSalesIds', search, townFilter, dateFrom, dateTo),
        manualFetch: () => electron.ipcRenderer.invoke('salesAPI:manualFetch'),
        deleteSales: (salesIds: number[]) => electron.ipcRenderer.invoke('salesAPI:deleteSales', salesIds),
        getStats: () => electron.ipcRenderer.invoke('salesAPI:getStats'),
        getTimerState: () => electron.ipcRenderer.invoke('salesAPI:getTimerState'),
        getSalesSettings: () => electron.ipcRenderer.invoke('salesAPI:getSalesSettings'),
        saveSalesSettings: (settings: any) => electron.ipcRenderer.invoke('salesAPI:saveSalesSettings', settings),
        getScheduledMessages: (page: number, limit: number, statusFilter: string, messageTypeFilter: string, townFilter: string) => electron.ipcRenderer.invoke('salesAPI:getScheduledMessages', page, limit, statusFilter, messageTypeFilter, townFilter),
        getAllScheduledMessageIds: (statusFilter: string, messageTypeFilter: string, townFilter: string) => electron.ipcRenderer.invoke('salesAPI:getAllScheduledMessageIds', statusFilter, messageTypeFilter, townFilter),
        cancelScheduledMessages: (messageIds: number[]) => electron.ipcRenderer.invoke('salesAPI:cancelScheduledMessages', messageIds),
        deleteScheduledMessages: (messageIds: number[]) => electron.ipcRenderer.invoke('salesAPI:deleteScheduledMessages', messageIds),
        getScheduledMessagesStats: () => electron.ipcRenderer.invoke('salesAPI:getScheduledMessagesStats'),
        onTimerUpdate: (callback: (data: any) => void) => electron.ipcRenderer.on('salesAPI:timer-update', (_: any, data: any) => callback(data)),
        onFetchStart: (callback: () => void) => electron.ipcRenderer.on('salesAPI:fetch-start', callback),
        onFetchSuccess: (callback: (data: any) => void) => electron.ipcRenderer.on('salesAPI:fetch-success', (_: any, data: any) => callback(data)),
        onFetchError: (callback: (message: string) => void) => electron.ipcRenderer.on('salesAPI:fetch-error', (_: any, message: string) => callback(message)),
        onSalesDeleted: (callback: (data: any) => void) => electron.ipcRenderer.on('salesAPI:sales-deleted', (_: any, data: any) => callback(data)),
        onMessageSent: (callback: (data: any) => void) => electron.ipcRenderer.on('salesAPI:message-sent', (_: any, data: any) => callback(data)),
        onMessageFailed: (callback: (data: any) => void) => electron.ipcRenderer.on('salesAPI:message-failed', (_: any, data: any) => callback(data)),
        onMessageStatusUpdated: (callback: (data: any) => void) => electron.ipcRenderer.on('salesAPI:message-status-updated', (_: any, data: any) => callback(data)),
    },

};

electron.contextBridge.exposeInMainWorld("electron", electronAPI);

// Add TypeScript declarations for the window object
declare global {
    interface Window {
        electron: ElectronAPI;
    }
}