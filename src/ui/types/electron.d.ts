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
    
    templates: {
        getTemplates: (page: number, limit: number, search: string) => Promise<any>;
        getAllTemplateIds: (search: string) => Promise<any>;
        addTemplate: (templateData: any) => Promise<any>;
        updateTemplate: (templateId: number, templateData: any) => Promise<any>;
        deleteTemplates: (templateIds: number[]) => Promise<any>;
        getVariables: () => Promise<any>;
        previewTemplate: (template: any) => Promise<any>;
    };
    
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
    
    theme: {
        get: () => Promise<any>;
        set: (theme: string) => Promise<void>;
        onChange: (callback: (theme: any) => void) => void;
    };
    
    settings: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
    };
    
    power: {
        setPreventSleep: (enabled: boolean) => Promise<boolean>;
        getPreventSleep: () => Promise<boolean>;
        isBlocking: () => Promise<boolean>;
        onStatusUpdate: (callback: (isActive: boolean) => void) => () => void;
    };
    
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

    
    app: {
        getVersion: () => Promise<string>;
        onAutoLogin: (callback: () => void) => void;
        openFileDialog: (options: any) => Promise<any>;
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