import { EventEmitter } from 'events';
import { DatabaseManager } from './databaseManager.js';
import axios from 'axios';

interface SalesData {
    id: number;
    businessEntity: {
        active: boolean;
        addressStreet: string | null;
        categories: Array<{
            id: number;
            code: string;
            name: string;
        }>;
        code: string;
        phone: string;
        mobile: string;
        email: string;
        country: string;
        id: number;
        name: string;
        shopId: number;
        tin: string;
        town: string;
        typeOfId: string;
    };
    documentLevel: {
        id: number;
        code: string;
        isActive: boolean;
    };
    documentNumber: string;
    documentDate: string;
}

interface StoredSale {
    id: number;
    salesId: number;
    data: string; // JSON string
    town: string;
    fetchedAt: string;
    createdAt: string;
}

interface AuthToken {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}

interface SalesSettings {
    isAutoSchedulingEnabled: boolean;
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
    msg1: {
        content: string;
        images: string[];
        delaySeconds: number;
        delayMinutes: number;
        delayHours: number;
        delayDays: number;
    };
    msg2: {
        content: string;
        images: string[];
        delaySeconds: number;
        delayMinutes: number;
        delayHours: number;
        delayDays: number;
    };
}

interface ScheduledMessage {
    id?: number;
    salesId: number;
    contactName: string;
    contactPhone: string;
    town: string;
    messageType: 'msg1' | 'msg2';
    content: string;
    images: string;
    scheduledAt: string;
    sendAt: string;
    status: 'scheduled' | 'sent' | 'delivered' | 'read' | 'cancelled' | 'failed' | 'waiting_for_msg1';
    sentAt?: string;
    deliveredAt?: string;
    readAt?: string;
    errorMessage?: string;
    createdAt: string;
    msg1Id?: number; // For msg2 to reference msg1
}

export class SalesAPIManager extends EventEmitter {
    private db: DatabaseManager;
    private fetchTimer: NodeJS.Timeout | null = null;
    private timerUpdateInterval: NodeJS.Timeout | null = null;
    private authToken: AuthToken | null = null;
    private readonly FETCH_INTERVAL = 2 * 60 * 1000; // 2 minutes in milliseconds
    private readonly TOWNS = ['tirane', 'fier', 'vlore'];
    private lastFetchTime: number = 0;
    private isWhatsAppConnected: boolean = false;
    private isAutoFetchActive: boolean = false;
    private hasPerformed30DayFetch: boolean = false;
    private salesSettings: SalesSettings | null = null;
    private messageProcessingTimer: NodeJS.Timeout | null = null;
    private whatsappManager: any = null;
    private readonly API_CONFIG = {
        AUTH_URL: 'https://crm-api.bss.com.al/authentication/login',
        SALES_URL: 'https://crm-api.bss.com.al/11120/Sales',
        CREDENTIALS: {
            userName: 'Admin',
            password: 'T3aWy<[3dq07'
        },
        PARAMS: {
            shopId: '11120',
            customerGroup: 'PAKICE'
        }
    };

    constructor() {
        super();
        this.setMaxListeners(100000);
        this.db = new DatabaseManager();
        this.initializeSalesTable();
        this.initializeMessagingTables();
        this.loadLastFetchTime();
        this.loadSalesSettings();
        this.startGlobalTimer();
        this.startMessageProcessor();

        console.log('[SalesAPI] Sales API Manager initialized - waiting for WhatsApp connection');
    }

    private initializeSalesTable() {
        try {
            // Check if table exists and has correct structure
            const tableExists = this.db.db.prepare(`
                SELECT name FROM sqlite_master WHERE type='table' AND name='sales'
            `).get();

            if (tableExists) {
                // Check if table has correct columns
                try {
                    const testQuery = this.db.db.prepare(`SELECT salesId, data, town, fetchedAt, createdAt FROM sales LIMIT 1`);
                    testQuery.get();
                    console.log('[SalesAPI] Sales table already exists with correct structure');
                    return; // Table exists and has correct structure
                } catch {
                    // Table exists but has wrong structure, drop and recreate
                    console.log('[SalesAPI] Sales table exists but has wrong structure, recreating...');
                    this.db.db.exec(`DROP TABLE sales`);
                }
            }
            
            // Create sales table with correct structure
            this.db.db.exec(`
                CREATE TABLE sales (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    salesId INTEGER UNIQUE NOT NULL,
                    data TEXT NOT NULL,
                    town TEXT NOT NULL,
                    fetchedAt TEXT NOT NULL,
                    createdAt TEXT NOT NULL
                )
            `);

            // Create indexes for performance
            this.db.db.exec(`
                CREATE INDEX idx_sales_sales_id ON sales(salesId);
                CREATE INDEX idx_sales_town ON sales(town);
                CREATE INDEX idx_sales_fetched_at ON sales(fetchedAt);
            `);
            
            console.log('[SalesAPI] Database table and indexes created successfully');
        } catch (error: any) {
            console.error('[SalesAPI] Error creating database table:', error);
            throw error;
        }
    }

    private initializeMessagingTables() {
        try {
            console.log('[SalesAPI] Initializing messaging tables...');
            
            // Check if tables exist
            const salesSettingsExists = this.db.db.prepare(`
                SELECT name FROM sqlite_master WHERE type='table' AND name='sales_settings'
            `).get();
            
            const scheduledMessagesExists = this.db.db.prepare(`
                SELECT name FROM sqlite_master WHERE type='table' AND name='sales_scheduled_messages'
            `).get();

            // Only create sales_settings table if it doesn't exist
            if (!salesSettingsExists) {
                console.log('[SalesAPI] Creating sales_settings table...');
                this.db.db.exec(`
                    CREATE TABLE sales_settings (
                        id INTEGER PRIMARY KEY,
                        isAutoSchedulingEnabled INTEGER NOT NULL DEFAULT 0,
                        startHour INTEGER NOT NULL DEFAULT 9,
                        startMinute INTEGER NOT NULL DEFAULT 0,
                        endHour INTEGER NOT NULL DEFAULT 17,
                        endMinute INTEGER NOT NULL DEFAULT 0,
                        msg1Content TEXT NOT NULL DEFAULT '',
                        msg1Images TEXT NOT NULL DEFAULT '[]',
                        msg1DelaySeconds INTEGER NOT NULL DEFAULT 0,
                        msg1DelayMinutes INTEGER NOT NULL DEFAULT 0,
                        msg1DelayHours INTEGER NOT NULL DEFAULT 1,
                        msg1DelayDays INTEGER NOT NULL DEFAULT 0,
                        msg2Content TEXT NOT NULL DEFAULT '',
                        msg2Images TEXT NOT NULL DEFAULT '[]',
                        msg2DelaySeconds INTEGER NOT NULL DEFAULT 0,
                        msg2DelayMinutes INTEGER NOT NULL DEFAULT 0,
                        msg2DelayHours INTEGER NOT NULL DEFAULT 0,
                        msg2DelayDays INTEGER NOT NULL DEFAULT 30,
                        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Insert default settings row
                this.db.db.exec(`
                    INSERT INTO sales_settings (
                        id, 
                        isAutoSchedulingEnabled, 
                        startHour, 
                        startMinute, 
                        endHour, 
                        endMinute, 
                        msg1Content, 
                        msg1Images, 
                        msg1DelaySeconds, 
                        msg1DelayMinutes, 
                        msg1DelayHours, 
                        msg1DelayDays, 
                        msg2Content, 
                        msg2Images, 
                        msg2DelaySeconds, 
                        msg2DelayMinutes, 
                        msg2DelayHours, 
                        msg2DelayDays
                    ) VALUES (
                        1, 
                        0, 
                        9, 
                        0, 
                        17, 
                        0, 
                        'Hello! Thank you for your interest in our services. We will contact you shortly.', 
                        '[]', 
                        0, 
                        0, 
                        1, 
                        0, 
                        'Hi again! We hope you are doing well. Please let us know if you need any assistance.', 
                        '[]', 
                        0, 
                        0, 
                        0, 
                        30
                    )
                `);
                console.log('[SalesAPI] Sales settings table created with default values');
            } else {
                console.log('[SalesAPI] Sales settings table already exists');
            }

            // Only create scheduled_messages table if it doesn't exist  
            if (!scheduledMessagesExists) {
                console.log('[SalesAPI] Creating sales_scheduled_messages table...');
                this.db.db.exec(`
                    CREATE TABLE sales_scheduled_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        salesId INTEGER NOT NULL,
                        contactName TEXT NOT NULL,
                        contactPhone TEXT NOT NULL,
                        town TEXT NOT NULL,
                        messageType TEXT NOT NULL,
                        content TEXT NOT NULL,
                        images TEXT NOT NULL DEFAULT '[]',
                        scheduledAt TEXT NOT NULL,
                        sendAt TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'scheduled',
                        sentAt TEXT,
                        deliveredAt TEXT,
                        readAt TEXT,
                        errorMessage TEXT,
                        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        msg1Id INTEGER,
                        messageId TEXT
                    )
                `);

                // Create indexes for performance
                this.db.db.exec(`CREATE INDEX idx_scheduled_messages_sales_id ON sales_scheduled_messages(salesId)`);
                this.db.db.exec(`CREATE INDEX idx_scheduled_messages_status ON sales_scheduled_messages(status)`);
                this.db.db.exec(`CREATE INDEX idx_scheduled_messages_send_at ON sales_scheduled_messages(sendAt)`);
                this.db.db.exec(`CREATE INDEX idx_scheduled_messages_type ON sales_scheduled_messages(messageType)`);
                this.db.db.exec(`CREATE INDEX idx_scheduled_messages_msg1_id ON sales_scheduled_messages(msg1Id)`);
                this.db.db.exec(`CREATE INDEX idx_scheduled_messages_message_id ON sales_scheduled_messages(messageId)`);
                console.log('[SalesAPI] Sales scheduled messages table and indexes created');
            } else {
                console.log('[SalesAPI] Sales scheduled messages table already exists');
                
                // Check if timestamp columns exist and add them if missing
                try {
                    const tableInfo = this.db.db.prepare(`PRAGMA table_info(sales_scheduled_messages)`).all() as any[];
                    const columnNames = tableInfo.map(col => col.name);
                    
                    if (!columnNames.includes('sentAt')) {
                        this.db.db.exec(`ALTER TABLE sales_scheduled_messages ADD COLUMN sentAt TEXT`);
                        console.log('[SalesAPI] Added sentAt column to existing table');
                    }
                    if (!columnNames.includes('deliveredAt')) {
                        this.db.db.exec(`ALTER TABLE sales_scheduled_messages ADD COLUMN deliveredAt TEXT`);
                        console.log('[SalesAPI] Added deliveredAt column to existing table');
                    }
                    if (!columnNames.includes('readAt')) {
                        this.db.db.exec(`ALTER TABLE sales_scheduled_messages ADD COLUMN readAt TEXT`);
                        console.log('[SalesAPI] Added readAt column to existing table');
                    }
                    if (!columnNames.includes('messageId')) {
                        this.db.db.exec(`ALTER TABLE sales_scheduled_messages ADD COLUMN messageId TEXT`);
                        console.log('[SalesAPI] Added messageId column to existing table');
                    }
                } catch (error) {
                    console.error('[SalesAPI] Error adding missing columns:', error);
                }
            }

            console.log('[SalesAPI] Messaging tables initialization completed successfully');
            
            // Verify tables were created
            const settingsCount = this.db.db.prepare(`SELECT COUNT(*) as count FROM sales_settings`).get() as { count: number };
            console.log(`[SalesAPI] Settings table has ${settingsCount.count} rows`);
            
        } catch (error: any) {
            console.error('[SalesAPI] Error creating messaging tables:', error);
            console.error('[SalesAPI] Error details:', error.message);
            throw error;
        }
    }

    private loadSalesSettings() {
        try {
            console.log('[SalesAPI] 🔧 Loading sales settings from database...');
            const stmt = this.db.db.prepare(`SELECT * FROM sales_settings WHERE id = 1`);
            const settings = stmt.get() as any;

            if (settings) {
                this.salesSettings = {
                    isAutoSchedulingEnabled: Boolean(settings.isAutoSchedulingEnabled),
                    startHour: settings.startHour,
                    startMinute: settings.startMinute,
                    endHour: settings.endHour,
                    endMinute: settings.endMinute,
                    msg1: {
                        content: settings.msg1Content || '',
                        images: this.safeJsonParse(settings.msg1Images, []),
                        delaySeconds: settings.msg1DelaySeconds ?? 0,
                        delayMinutes: settings.msg1DelayMinutes ?? 0,
                        delayHours: settings.msg1DelayHours ?? 0,
                        delayDays: settings.msg1DelayDays ?? 0
                    },
                    msg2: {
                        content: settings.msg2Content || '',
                        images: this.safeJsonParse(settings.msg2Images, []),
                        delaySeconds: settings.msg2DelaySeconds ?? 0,
                        delayMinutes: settings.msg2DelayMinutes ?? 0,
                        delayHours: settings.msg2DelayHours ?? 0,
                        delayDays: settings.msg2DelayDays ?? 0
                    }
                };
                console.log(`[SalesAPI] ✅ Settings loaded successfully:`);
                console.log(`[SalesAPI]   - Auto-scheduling: ${this.salesSettings.isAutoSchedulingEnabled}`);
                console.log(`[SalesAPI]   - Business hours: ${this.salesSettings.startHour}:${String(this.salesSettings.startMinute).padStart(2, '0')} - ${this.salesSettings.endHour}:${String(this.salesSettings.endMinute).padStart(2, '0')}`);
                console.log(`[SalesAPI]   - MSG1 content: ${this.salesSettings.msg1.content.length} chars`);
                console.log(`[SalesAPI]   - MSG2 content: ${this.salesSettings.msg2.content.length} chars`);
            } else {
                console.log('[SalesAPI] ⚠️ No settings found in database, creating defaults');
                this.createDefaultSettings();
            }
        } catch (error: any) {
            console.error('[SalesAPI] ❌ Error loading sales settings:', error);
            console.error('[SalesAPI] Error details:', error.message);
            this.createDefaultSettings();
        }
    }

    private safeJsonParse(jsonString: string, defaultValue: any): any {
        try {
            return JSON.parse(jsonString || 'null') || defaultValue;
        } catch {
            return defaultValue;
        }
    }

    private createDefaultSettings() {
        console.log('[SalesAPI] Creating default settings...');
        this.salesSettings = {
            isAutoSchedulingEnabled: false,
            startHour: 9,
            startMinute: 0,
            endHour: 17,
            endMinute: 0,
            msg1: {
                content: 'Hello! Thank you for your interest in our services. We will contact you shortly.',
                images: [],
                delaySeconds: 0,
                delayMinutes: 0,
                delayHours: 0,
                delayDays: 0
            },
            msg2: {
                content: 'Hi again! We hope you are doing well. Please let us know if you need any assistance.',
                images: [],
                delaySeconds: 0,
                delayMinutes: 0,
                delayHours: 0,
                delayDays: 0
            }
        };
        console.log('[SalesAPI] Default settings created in memory');
        
        // Save default settings to database
        try {
            const stmt = this.db.db.prepare(`
                INSERT OR REPLACE INTO sales_settings (
                    id, isAutoSchedulingEnabled, startHour, startMinute, endHour, endMinute,
                    msg1Content, msg1Images, msg1DelaySeconds, msg1DelayMinutes, msg1DelayHours, msg1DelayDays,
                    msg2Content, msg2Images, msg2DelaySeconds, msg2DelayMinutes, msg2DelayHours, msg2DelayDays,
                    createdAt, updatedAt
                ) VALUES (
                    1, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?,
                    ?, ?
                )
            `);

            stmt.run(
                this.salesSettings.isAutoSchedulingEnabled ? 1 : 0,
                this.salesSettings.startHour,
                this.salesSettings.startMinute,
                this.salesSettings.endHour,
                this.salesSettings.endMinute,
                this.salesSettings.msg1.content,
                JSON.stringify(this.salesSettings.msg1.images),
                this.salesSettings.msg1.delaySeconds,
                this.salesSettings.msg1.delayMinutes,
                this.salesSettings.msg1.delayHours,
                this.salesSettings.msg1.delayDays,
                this.salesSettings.msg2.content,
                JSON.stringify(this.salesSettings.msg2.images),
                this.salesSettings.msg2.delaySeconds,
                this.salesSettings.msg2.delayMinutes,
                this.salesSettings.msg2.delayHours,
                this.salesSettings.msg2.delayDays,
                new Date().toISOString(),
                new Date().toISOString()
            );
            
            console.log('[SalesAPI] Default settings saved to database');
        } catch (error: any) {
            console.error('[SalesAPI] Error saving default settings to database:', error.message);
        }
    }

    private startMessageProcessor() {
        // Check for messages to send every 30 seconds
        this.messageProcessingTimer = setInterval(() => {
            if (this.isWhatsAppConnected && this.salesSettings?.isAutoSchedulingEnabled) {
                this.processScheduledMessages();
            }
        }, 30000);

        console.log('[SalesAPI] Message processor started');
    }

    public setWhatsAppConnection(connected: boolean) {
        console.log(`[SalesAPI] WhatsApp connection changed: ${connected ? 'Connected' : 'Disconnected'}`);
        this.isWhatsAppConnected = connected;
        
        if (connected && !this.isAutoFetchActive) {
            this.startAutoFetch();
        } else if (!connected && this.isAutoFetchActive) {
            this.stopAutoFetch();
        }

        // Trigger 30-day historical fetch when WhatsApp connects (only once per session)
        if (connected && !this.hasPerformed30DayFetch) {
            this.perform30DayHistoricalFetch();
        }
    }

    private startAutoFetch() {
        if (this.isAutoFetchActive) {
            console.log('[SalesAPI] Auto-fetch already active');
            return;
        }

        console.log('[SalesAPI] Starting auto-fetch system...');
        this.isAutoFetchActive = true;

        // Initial fetch
        setTimeout(() => {
            if (this.isAutoFetchActive) {
                this.fetchSalesData();
            }
        }, 5000); // Wait 5 seconds after WhatsApp connects

        // Set up recurring fetch
        this.fetchTimer = setInterval(() => {
            if (this.isWhatsAppConnected && this.isAutoFetchActive) {
                this.fetchSalesData();
            }
        }, this.FETCH_INTERVAL);

        console.log('[SalesAPI] Auto-fetch system started - interval: 2 minutes');
    }

    private stopAutoFetch() {
        if (!this.isAutoFetchActive) {
            return;
        }

        console.log('[SalesAPI] Stopping auto-fetch system...');
        this.isAutoFetchActive = false;

        if (this.fetchTimer) {
            clearInterval(this.fetchTimer);
            this.fetchTimer = null;
        }

        console.log('[SalesAPI] Auto-fetch system stopped');
    }

    private startGlobalTimer() {
        // Stop existing timer if any
        if (this.timerUpdateInterval) {
            clearInterval(this.timerUpdateInterval);
        }

        // Emit timer updates every second - this runs continuously
        this.timerUpdateInterval = setInterval(() => {
            this.emitTimerUpdate();
        }, 1000);

        console.log('[SalesAPI] Global timer started');
    }

    private emitTimerUpdate() {
        const now = Date.now();
        const timeSinceLastFetch = now - this.lastFetchTime;
        const timeUntilNextFetch = Math.max(0, this.FETCH_INTERVAL - timeSinceLastFetch);
        
        const minutes = Math.floor(timeUntilNextFetch / (60 * 1000));
        const seconds = Math.floor((timeUntilNextFetch % (60 * 1000)) / 1000);

        this.emit('timer-update', { 
            minutes, 
            seconds, 
            timeUntilNextFetch,
            isActive: this.isAutoFetchActive,
            whatsAppConnected: this.isWhatsAppConnected
        });
    }

    private loadLastFetchTime() {
        try {
            const lastFetch = this.db.db.prepare(`
                SELECT MAX(fetchedAt) as lastFetch FROM sales
            `).get() as { lastFetch: string | null };

            this.lastFetchTime = lastFetch?.lastFetch ? new Date(lastFetch.lastFetch).getTime() : 0;
            console.log(`[SalesAPI] Loaded last fetch time: ${this.lastFetchTime ? new Date(this.lastFetchTime).toISOString() : 'Never'}`);
        } catch (error) {
            console.error('[SalesAPI] Error loading last fetch time:', error);
            this.lastFetchTime = 0;
        }
    }

    private updateLastFetchTime() {
        this.lastFetchTime = Date.now();
    }

    private async authenticate(): Promise<boolean> {
        try {
            // Check if current token is still valid (with 5 minute buffer)
            if (this.authToken && this.authToken.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
                return true;
            }

            const response = await axios.post(this.API_CONFIG.AUTH_URL, {
                userName: this.API_CONFIG.CREDENTIALS.userName,
                password: this.API_CONFIG.CREDENTIALS.password
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data?.accessToken) {
                // JWT tokens typically expire in 1 hour, but we'll be conservative
                this.authToken = {
                    accessToken: response.data.accessToken,
                    refreshToken: response.data.refreshToken,
                    expiresAt: new Date(Date.now() + 50 * 60 * 1000) // 50 minutes
                };
                return true;
            }

            console.error('[SalesAPI] Authentication failed: No access token received');
            return false;
        } catch (error: any) {
            console.error('[SalesAPI] Authentication error:', error.message);
            return false;
        }
    }

    private getCurrentDate(): string {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = now.getFullYear();
        return `${month}/${day}/${year}`;
    }

    private getDateDaysAgo(daysAgo: number): string {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        return `${month}/${day}/${year}`;
    }

    private async perform30DayHistoricalFetch(): Promise<void> {
        try {
            console.log('[SalesAPI] Starting 30-day historical fetch...');
            this.hasPerformed30DayFetch = true;

            // Authenticate with retry
            const authSuccess = await this.authenticateWithRetry();
            if (!authSuccess) {
                console.error('[SalesAPI] 30 day Fetch error: Authentication failed after retries');
                return;
            }

            let totalNewSales = 0;
            const fetchedAt = new Date().toISOString();
            const newSalesToSchedule: SalesData[] = [];
            const today = this.getCurrentDate();
            
            // Fetch data for each day in the last 30 days
            for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
                const targetDate = this.getDateDaysAgo(dayOffset);
                
                // Fetch sales for each town for this date
                for (const town of this.TOWNS) {
                    try {
                        const salesData = await this.fetchSalesForTownAndDateWithRetry(town, targetDate);
                        
                        // Save only new sales (check by salesId - same uniqueness as regular fetch)
                        for (const sale of salesData) {
                            const existingStmt = this.db.db.prepare(`
                                SELECT id FROM sales WHERE salesId = ?
                            `);
                            const existing = existingStmt.get(sale.id);

                            if (!existing) {
                                const insertStmt = this.db.db.prepare(`
                                    INSERT INTO sales (salesId, data, town, fetchedAt, createdAt)
                                    VALUES (?, ?, ?, ?, ?)
                                `);
                                
                                insertStmt.run(
                                    sale.id,
                                    JSON.stringify(sale),
                                    town,
                                    fetchedAt,
                                    new Date().toISOString()
                                );
                                
                                totalNewSales++;

                                // Check if this sale is from today for auto-scheduling
                                const todayFormatted = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
                                const saleDocumentDate = sale.documentDate ? new Date(sale.documentDate).toLocaleDateString('en-CA') : null;
                                
                                if (saleDocumentDate === todayFormatted) {
                                    console.log(`[SalesAPI] Historical - Sale ${sale.id} qualifies for auto-scheduling (document date matches today)`);
                                    newSalesToSchedule.push(sale);
                                }
                            }
                        }
                    } catch (error: any) {
                        console.error(`[SalesAPI] 30 day Fetch error for ${town} on ${targetDate}:`, error.message);
                        // Continue with other towns/dates even if one fails
                    }
                }
            }

            // Auto-schedule messages for today's new sales if enabled
            console.log(`[SalesAPI] Historical - Auto-scheduling check: enabled=${this.salesSettings?.isAutoSchedulingEnabled}, newSales=${newSalesToSchedule.length}`);
            if (this.salesSettings?.isAutoSchedulingEnabled && newSalesToSchedule.length > 0) {
                console.log(`[SalesAPI] Auto-scheduling messages for ${newSalesToSchedule.length} new sales from today (historical fetch)`);
                await this.autoScheduleMessagesForNewSales(newSalesToSchedule);
            } else if (!this.salesSettings?.isAutoSchedulingEnabled) {
                console.log('[SalesAPI] Historical - Auto-scheduling disabled in settings');
            }

            console.log(`[SalesAPI] 30 day Fetch completed. Found ${totalNewSales} new historical sales.`);
            if (newSalesToSchedule.length > 0) {
                console.log(`[SalesAPI] ${newSalesToSchedule.length} sales from today scheduled for messaging.`);
            }
        } catch (error: any) {
            console.error(`[SalesAPI] 30 day Fetch error:`, error.message);
        }
    }

    private async authenticateWithRetry(maxRetries: number = 3): Promise<boolean> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const success = await this.authenticate();
                if (success) {
                    if (attempt > 1) {
                        console.log(`[SalesAPI] Authentication succeeded on attempt ${attempt}`);
                    }
                    return true;
                }
            } catch (error: any) {
                console.error(`[SalesAPI] Authentication attempt ${attempt} failed:`, error.message);
            }

            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
                console.log(`[SalesAPI] Retrying authentication in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.error(`[SalesAPI] Authentication failed after ${maxRetries} attempts`);
        return false;
    }

    private async fetchSalesForTownAndDateWithRetry(town: string, date: string, maxRetries: number = 2): Promise<SalesData[]> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.fetchSalesForTownAndDate(town, date);
            } catch (error: any) {
                console.error(`[SalesAPI] Fetch attempt ${attempt} failed for ${town} on ${date}:`, error.message);
                
                // Check if it's an auth error and retry authentication
                if (error.message.includes('401') || error.message.includes('unauthorized') || error.message.includes('authentication')) {
                    console.log(`[SalesAPI] Authentication error detected, retrying auth for ${town} on ${date}`);
                    const authSuccess = await this.authenticateWithRetry(2);
                    if (!authSuccess) {
                        throw new Error('Re-authentication failed');
                    }
                    // Continue to retry the request with new auth
                }

                if (attempt < maxRetries) {
                    const delay = attempt * 1000; // Linear backoff: 1s, 2s
                    console.log(`[SalesAPI] Retrying fetch for ${town} on ${date} in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error; // Re-throw on final attempt
                }
            }
        }

        return []; // This should never be reached, but TypeScript requires it
    }

    private async fetchSalesForTownAndDate(town: string, date: string): Promise<SalesData[]> {
        if (!this.authToken) {
            throw new Error('Not authenticated');
        }

        const url = `${this.API_CONFIG.SALES_URL}?Date=${date}&PageNumber=&PageSize=&HasPhone=true&CustomerGroup=${this.API_CONFIG.PARAMS.customerGroup}&Town=${town}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.authToken.accessToken}`
                },
                timeout: 15000 // Shorter timeout for historical fetch
            });

            return response.data || [];
        } catch (error: any) {
            console.error(`[SalesAPI] Error fetching sales for ${town} on ${date}:`, error.message);
            throw error;
        }
    }

    private async fetchSalesForTown(town: string): Promise<SalesData[]> {
        if (!this.authToken) {
            throw new Error('Not authenticated');
        }

        const currentDate = this.getCurrentDate();
        const url = `${this.API_CONFIG.SALES_URL}?Date=${currentDate}&PageNumber=&PageSize=&HasPhone=true&CustomerGroup=${this.API_CONFIG.PARAMS.customerGroup}&Town=${town}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.authToken.accessToken}`
                },
                timeout: 30000
            });

            return response.data || [];
        } catch (error: any) {
            console.error(`[SalesAPI] Error fetching sales for ${town}:`, error.message);
            throw error;
        }
    }

    public async fetchSalesData(): Promise<{ success: boolean; message: string; newSalesCount?: number }> {
        try {
            if (!this.isWhatsAppConnected) {
                const message = 'WhatsApp not connected - skipping sales fetch';
                console.log(`[SalesAPI] ${message}`);
                return { success: false, message };
            }

            console.log('[SalesAPI] Starting sales data fetch...');
            this.emit('fetch-start');

            // Authenticate with retry
            const authSuccess = await this.authenticateWithRetry();
            if (!authSuccess) {
                const message = 'Authentication failed after retries';
                console.error(`[SalesAPI] ${message}`);
                this.emit('fetch-error', message);
                return { success: false, message };
            }

            let totalNewSales = 0;
            const fetchedAt = new Date().toISOString();
            const townResults: { [town: string]: number } = {};
            const newSalesToSchedule: SalesData[] = [];

            // Fetch sales for each town with retry
            for (const town of this.TOWNS) {
                try {
                    console.log(`[SalesAPI] Fetching sales for town: ${town}`);
                    const salesData = await this.fetchSalesForTownWithRetry(town);
                    let townNewSales = 0;
                    
                                // Save only new sales (check by salesId)
            for (const sale of salesData) {
                const existingStmt = this.db.db.prepare(`
                    SELECT id FROM sales WHERE salesId = ?
                `);
                const existing = existingStmt.get(sale.id);

                if (!existing) {
                    const insertStmt = this.db.db.prepare(`
                        INSERT INTO sales (salesId, data, town, fetchedAt, createdAt)
                        VALUES (?, ?, ?, ?, ?)
                    `);
                    
                    insertStmt.run(
                        sale.id,
                        JSON.stringify(sale),
                        town,
                        fetchedAt,
                        new Date().toISOString()
                    );
                    
                    townNewSales++;
                    totalNewSales++;

                    // Check if this sale's document date is today (for auto-scheduling)
                    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
                    const saleDocumentDate = sale.documentDate ? new Date(sale.documentDate).toLocaleDateString('en-CA') : null;
                    
                    console.log(`[SalesAPI] Sale ${sale.id}: documentDate=${sale.documentDate}, parsed=${saleDocumentDate}, today=${today}`);
                    
                    if (saleDocumentDate === today) {
                        console.log(`[SalesAPI] Sale ${sale.id} qualifies for auto-scheduling (document date matches today)`);
                        newSalesToSchedule.push(sale);
                    } else {
                        console.log(`[SalesAPI] Sale ${sale.id} does NOT qualify for auto-scheduling (document date mismatch)`);
                    }
                }
            }
                    
                    townResults[town] = townNewSales;
                    if (townNewSales > 0) {
                        console.log(`[SalesAPI] Saved ${townNewSales} new sales for town: ${town}`);
                    } else {
                        console.log(`[SalesAPI] No new sales found for town: ${town}`);
                    }
                    
                } catch (townError: any) {
                    console.error(`[SalesAPI] Error fetching sales for ${town}:`, townError.message);
                    townResults[town] = 0;
                    // Continue with other towns even if one fails
                }
            }

            // Auto-schedule messages for new sales if enabled
            console.log(`[SalesAPI] Manual/Timer - Auto-scheduling check: enabled=${this.salesSettings?.isAutoSchedulingEnabled}, newSales=${newSalesToSchedule.length}`);
            if (this.salesSettings?.isAutoSchedulingEnabled && newSalesToSchedule.length > 0) {
                console.log(`[SalesAPI] Auto-scheduling messages for ${newSalesToSchedule.length} new sales`);
                await this.autoScheduleMessagesForNewSales(newSalesToSchedule);
            } else if (!this.salesSettings?.isAutoSchedulingEnabled && newSalesToSchedule.length > 0) {
                console.log('[SalesAPI] Auto-scheduling disabled in settings');
            }

            // Update last fetch time
            this.updateLastFetchTime();

            const message = totalNewSales > 0 
                ? `Fetch completed. ${totalNewSales} new sales found across all towns.`
                : 'Fetch completed. No new sales found.';
            
            console.log(`[SalesAPI] ${message}`);
            
            // Log detailed results
            for (const [town, count] of Object.entries(townResults)) {
                if (count > 0) {
                    console.log(`[SalesAPI] Town ${town}: ${count} new sales`);
                }
            }

            this.emit('fetch-success', { newSalesCount: totalNewSales, message, townResults });
            return { success: true, message, newSalesCount: totalNewSales };
        } catch (error: any) {
            const message = `Fetch failed: ${error.message}`;
            console.error(`[SalesAPI] ${message}`);
            this.emit('fetch-error', message);
            return { success: false, message };
        }
    }

    private async fetchSalesForTownWithRetry(town: string, maxRetries: number = 2): Promise<SalesData[]> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.fetchSalesForTown(town);
            } catch (error: any) {
                console.error(`[SalesAPI] Fetch attempt ${attempt} failed for ${town}:`, error.message);
                
                // Check if it's an auth error and retry authentication
                if (error.message.includes('401') || error.message.includes('unauthorized') || error.message.includes('authentication')) {
                    console.log(`[SalesAPI] Authentication error detected, retrying auth for ${town}`);
                    const authSuccess = await this.authenticateWithRetry(2);
                    if (!authSuccess) {
                        throw new Error('Re-authentication failed');
                    }
                    // Continue to retry the request with new auth
                }

                if (attempt < maxRetries) {
                    const delay = attempt * 1000; // Linear backoff: 1s, 2s
                    console.log(`[SalesAPI] Retrying fetch for ${town} in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error; // Re-throw on final attempt
                }
            }
        }

        return []; // This should never be reached, but TypeScript requires it
    }

    public async getSales(page: number = 1, limit: number = 100, search: string = '', townFilter: string = '', dateFrom: string = '', dateTo: string = '', sortBy: string = 'createdAt', sortOrder: string = 'DESC'): Promise<{ success: boolean; sales?: any[]; pagination?: any; error?: string }> {
        try {
            const offset = (page - 1) * limit;
            
            let whereClause = '';
            let whereParams: any[] = [];
            const conditions = [];
            
            if (search) {
                conditions.push(`(data LIKE ? OR town LIKE ?)`);
                whereParams.push(`%${search}%`, `%${search}%`);
            }
            
            if (townFilter && townFilter !== 'all') {
                conditions.push(`town = ?`);
                whereParams.push(townFilter);
            }

            // Date filtering based on document date (extracted from JSON data)
            if (dateFrom) {
                conditions.push(`json_extract(data, '$.documentDate') >= ?`);
                whereParams.push(dateFrom);
            }

            if (dateTo) {
                // Add one day to include the entire end date
                const endDate = new Date(dateTo);
                endDate.setDate(endDate.getDate() + 1);
                conditions.push(`json_extract(data, '$.documentDate') < ?`);
                whereParams.push(endDate.toISOString().split('T')[0]);
            }

            if (conditions.length > 0) {
                whereClause = ` WHERE ${conditions.join(' AND ')}`;
            }

            // Determine sort column
            let sortColumn = 'createdAt'; // Default sort by fetch date
            if (sortBy === 'documentDate') {
                sortColumn = `json_extract(data, '$.documentDate')`;
            } else if (sortBy === 'fetchedAt') {
                sortColumn = 'fetchedAt';
            }

            // Get total count
            const countQuery = `SELECT COUNT(*) as total FROM sales${whereClause}`;
            const countStmt = this.db.db.prepare(countQuery);
            const countResult = countStmt.get(...whereParams) as { total: number };
            const total = countResult.total;

            // Get sales data with sorting - for same document dates, show newest first by createdAt
            let orderClause = `${sortColumn} ${sortOrder}`;
            if (sortBy === 'documentDate') {
                orderClause = `${sortColumn} ${sortOrder}, createdAt DESC`;
            }
            
            const dataQuery = `SELECT * FROM sales${whereClause} ORDER BY ${orderClause} LIMIT ? OFFSET ?`;
            const stmt = this.db.db.prepare(dataQuery);
            const allParams = [...whereParams, limit, offset];
            const sales = stmt.all(...allParams) as StoredSale[];

            // Parse JSON data for each sale
            const parsedSales = sales.map(sale => ({
                ...sale,
                parsedData: JSON.parse(sale.data)
            }));

            const pagination = {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            };

            return { success: true, sales: parsedSales, pagination };
        } catch (error: any) {
            console.error('[SalesAPI] Error getting sales:', error);
            return { success: false, error: error.message };
        }
    }

    public async getAllSalesIds(search: string = '', townFilter: string = '', dateFrom: string = '', dateTo: string = ''): Promise<{ success: boolean; salesIds?: number[]; error?: string }> {
        try {
            let whereClause = '';
            let whereParams: any[] = [];
            const conditions = [];
            
            if (search) {
                conditions.push(`(data LIKE ? OR town LIKE ?)`);
                whereParams.push(`%${search}%`, `%${search}%`);
            }
            
            if (townFilter && townFilter !== 'all') {
                conditions.push(`town = ?`);
                whereParams.push(townFilter);
            }

            // Date filtering based on document date (extracted from JSON data)
            if (dateFrom) {
                conditions.push(`json_extract(data, '$.documentDate') >= ?`);
                whereParams.push(dateFrom);
            }

            if (dateTo) {
                // Add one day to include the entire end date
                const endDate = new Date(dateTo);
                endDate.setDate(endDate.getDate() + 1);
                conditions.push(`json_extract(data, '$.documentDate') < ?`);
                whereParams.push(endDate.toISOString().split('T')[0]);
            }

            if (conditions.length > 0) {
                whereClause = ` WHERE ${conditions.join(' AND ')}`;
            }

            const query = `SELECT id FROM sales${whereClause} ORDER BY createdAt DESC`;
            const stmt = this.db.db.prepare(query);
            const results = stmt.all(...whereParams) as Array<{ id: number }>;
            
            const salesIds = results.map(result => result.id);
            return { success: true, salesIds };
        } catch (error: any) {
            console.error('[SalesAPI] Error getting all sales IDs:', error);
            return { success: false, error: error.message };
        }
    }

    public async deleteSales(salesIds: number[]): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
        try {
            const placeholders = salesIds.map(() => '?').join(',');
            const stmt = this.db.db.prepare(`
                DELETE FROM sales WHERE id IN (${placeholders})
            `);
            const result = stmt.run(...salesIds);
            
            this.emit('sales-deleted', { salesIds, deletedCount: result.changes });
            return { success: true, deletedCount: result.changes };
        } catch (error: any) {
            console.error('[SalesAPI] Error deleting sales:', error);
            return { success: false, error: error.message };
        }
    }

    public getStats(): any {
        try {
            const totalStmt = this.db.db.prepare(`SELECT COUNT(*) as total FROM sales`);
            const total = totalStmt.get() as { total: number };

            const townStatsStmt = this.db.db.prepare(`
                SELECT town, COUNT(*) as count FROM sales GROUP BY town
            `);
            const townStats = townStatsStmt.all() as Array<{ town: string; count: number }>;

            const todayStmt = this.db.db.prepare(`
                SELECT COUNT(*) as today FROM sales 
                WHERE DATE(createdAt) = DATE('now')
            `);
            const today = todayStmt.get() as { today: number };

            return {
                total: total.total,
                todayCount: today.today,
                townStats,
                lastUpdate: this.lastFetchTime
            };
        } catch (error: any) {
            console.error('[SalesAPI] Error getting stats:', error);
            return { total: 0, todayCount: 0, townStats: [], lastUpdate: 0 };
        }
    }

    public getTimerState(): { minutes: number; seconds: number; timeUntilNextFetch: number; isActive: boolean; whatsAppConnected: boolean } {
        const now = Date.now();
        const timeSinceLastFetch = now - this.lastFetchTime;
        const timeUntilNextFetch = Math.max(0, this.FETCH_INTERVAL - timeSinceLastFetch);
        
        const minutes = Math.floor(timeUntilNextFetch / (60 * 1000));
        const seconds = Math.floor((timeUntilNextFetch % (60 * 1000)) / 1000);

        return {
            minutes,
            seconds,
            timeUntilNextFetch,
            isActive: this.isAutoFetchActive,
            whatsAppConnected: this.isWhatsAppConnected
        };
    }

    public destroy() {
        console.log('[SalesAPI] Destroying Sales API Manager...');
        
        this.stopAutoFetch();
        
        if (this.timerUpdateInterval) {
            clearInterval(this.timerUpdateInterval);
            this.timerUpdateInterval = null;
        }
        
        this.removeAllListeners();
        console.log('[SalesAPI] Sales API Manager destroyed');
    }

    public setWhatsAppManager(whatsappManager: any) {
        console.log('[SalesAPI] 🔗 Setting WhatsApp manager reference...');
        this.whatsappManager = whatsappManager;
        
        // Set up message acknowledgment listeners now that we have the WhatsApp manager
        this.setupMessageAckListeners();
        
        // Test that the WhatsApp manager is working by checking if it has the expected methods
        if (this.whatsappManager && typeof this.whatsappManager.sendMessage === 'function') {
            console.log('[SalesAPI] ✅ WhatsApp manager reference set with working sendMessage method');
        } else {
            console.error('[SalesAPI] ❌ WhatsApp manager missing sendMessage method!');
        }
        
        // Test event emission capability
        if (this.whatsappManager && typeof this.whatsappManager.on === 'function') {
            console.log('[SalesAPI] ✅ WhatsApp manager has event emission capability');
        } else {
            console.error('[SalesAPI] ❌ WhatsApp manager missing event emission capability!');
        }
        
        console.log('[SalesAPI] ✅ WhatsApp manager reference set and listeners configured');
    }

    private setupMessageAckListeners() {
        if (!this.whatsappManager) {
            console.log('[SalesAPI] ⚠️ WhatsApp manager not available, cannot set up message ack listeners');
            return;
        }
        
        // Listen for WhatsApp message acknowledgments
        this.whatsappManager.on('message_ack', (messageId: string, ack: number) => {
            console.log(`[SalesAPI] 📨 Received message ack: messageId=${messageId}, ack=${ack}`);
            this.updateMessageAckStatus(messageId, ack);
        });
        
        console.log('[SalesAPI] ✅ Message acknowledgment listeners set up successfully');
    }

    private async updateMessageAckStatus(whatsappMessageId: string, ack: number) {
        try {
            console.log(`[SalesAPI] 🔄 Processing message ack: messageId=${whatsappMessageId}, ack=${ack}`);
            
            const now = new Date().toISOString();
            let status = 'sent';
            let updateField = 'sentAt';
            
            // Map WhatsApp acknowledgment codes to status
            switch (ack) {
                case 1: // Sent to server
                    status = 'sent';
                    updateField = 'sentAt';
                    console.log(`[SalesAPI] ✅ Message sent to server: ${whatsappMessageId}`);
                    break;
                case 2: // Delivered to recipient
                    status = 'delivered';
                    updateField = 'deliveredAt';
                    console.log(`[SalesAPI] 📨 Message delivered to recipient: ${whatsappMessageId}`);
                    break;
                case 3: // Read by recipient
                    status = 'read';
                    updateField = 'readAt';
                    console.log(`[SalesAPI] 👁️ Message read by recipient: ${whatsappMessageId}`);
                    break;
                default:
                    console.log(`[SalesAPI] ❓ Unknown ack code ${ack} for message ${whatsappMessageId}`);
                    return; // Unknown ack code
            }

            // First check if the message exists in our database with exact match
            const checkStmt = this.db.db.prepare(`
                SELECT id, messageType FROM sales_scheduled_messages WHERE messageId = ?
            `);
            let existingMessage = checkStmt.get(whatsappMessageId) as { id: number; messageType: string } | undefined;
            
            // If exact match not found, try to find by partial match (last 20 chars)
            if (!existingMessage && whatsappMessageId.length > 20) {
                const partialId = whatsappMessageId.slice(-20);
                console.log(`[SalesAPI] 🔍 Trying to match by partial ID (last 20 chars): ${partialId}`);
                
                const partialStmt = this.db.db.prepare(`
                    SELECT id, messageType FROM sales_scheduled_messages 
                    WHERE messageId LIKE ? AND status = 'sent'
                    ORDER BY id DESC LIMIT 1
                `);
                existingMessage = partialStmt.get(`%${partialId}`) as { id: number; messageType: string } | undefined;
                
                if (existingMessage) {
                    console.log(`[SalesAPI] ✅ Found message by partial match: ${existingMessage.id}`);
                }
            }
            
            // If still not found, try to find the most recently sent message
            if (!existingMessage) {
                console.log(`[SalesAPI] ⚠️ Message ${whatsappMessageId} not found in sales database`);
                
                // Try to find the most recently sent message without a delivery/read status
                const recentStmt = this.db.db.prepare(`
                    SELECT id, messageType FROM sales_scheduled_messages 
                    WHERE status = 'sent' 
                    AND (deliveredAt IS NULL OR readAt IS NULL)
                    ORDER BY sentAt DESC LIMIT 1
                `);
                existingMessage = recentStmt.get() as { id: number; messageType: string } | undefined;
                
                if (existingMessage) {
                    console.log(`[SalesAPI] ✅ Fallback: Using most recent sent message: ${existingMessage.id}`);
                    
                    // Update the messageId field with this WhatsApp ID for future matches
                    const updateIdStmt = this.db.db.prepare(`
                        UPDATE sales_scheduled_messages SET messageId = ? WHERE id = ?
                    `);
                    updateIdStmt.run(whatsappMessageId, existingMessage.id);
                    console.log(`[SalesAPI] 📝 Updated message ${existingMessage.id} with WhatsApp ID: ${whatsappMessageId}`);
                }
            }
            
            // Debug: Check what messageIds we actually have in the database
            const debugStmt = this.db.db.prepare(`
                SELECT id, messageId, contactName, messageType, status FROM sales_scheduled_messages 
                WHERE messageId IS NOT NULL AND messageId != '' 
                ORDER BY id DESC LIMIT 5
            `);
            const recentMessages = debugStmt.all();
            console.log(`[SalesAPI] 🔍 Recent messages with messageId in database:`, recentMessages);
            
            if (!existingMessage) {
                console.log(`[SalesAPI] ❌ Could not find any matching message for ack: ${whatsappMessageId}`);
                return;
            }

            console.log(`[SalesAPI] 📝 Updating message ${existingMessage.id} to status: ${status}`);

            // Update message status in database
            const updateQuery = `
                UPDATE sales_scheduled_messages 
                SET status = ?, ${updateField} = ?, messageId = ?
                WHERE id = ?
            `;
            
            const stmt = this.db.db.prepare(updateQuery);
            const result = stmt.run(status, now, whatsappMessageId, existingMessage.id);
            
            if (result.changes > 0) {
                console.log(`[SalesAPI] ✅ Successfully updated message ${existingMessage.id} status to ${status} with timestamp ${now}`);
                
                // Get the complete message details including all timestamps
                const messageStmt = this.db.db.prepare(`
                    SELECT id, messageType, salesId, status, sentAt, deliveredAt, readAt, sendAt FROM sales_scheduled_messages 
                    WHERE id = ?
                `);
                const message = messageStmt.get(existingMessage.id) as { 
                    id: number; 
                    messageType: string; 
                    salesId: number;
                    status: string;
                    sentAt?: string;
                    deliveredAt?: string;
                    readAt?: string;
                    sendAt: string;
                } | undefined;

                if (message) {
                    console.log(`[SalesAPI] 📡 Emitting real-time update for message ${message.id} with all timestamps:`, {
                        sentAt: message.sentAt,
                        deliveredAt: message.deliveredAt,
                        readAt: message.readAt
                    });
                    
                    // Emit real-time update with complete timestamp data
                    this.emit('message-status-updated', {
                        messageId: message.id,
                        salesId: message.salesId,
                        status: message.status,
                        timestamp: now,
                        whatsappMessageId,
                        sendAt: message.sendAt,
                        sentAt: message.sentAt,
                        deliveredAt: message.deliveredAt,
                        readAt: message.readAt
                    });

                    // If this is MSG1 and it was sent, schedule MSG2
                    if (message.messageType === 'msg1' && status === 'sent') {
                        await this.schedulePendingMsg2ForMsg1(message.id);
                    }
                } else {
                    console.error(`[SalesAPI] ❌ Could not retrieve updated message details for ${existingMessage.id}`);
                }
            } else {
                console.error(`[SalesAPI] ❌ No rows updated when setting status to ${status} for message ${existingMessage.id}`);
            }
        } catch (error) {
            console.error('[SalesAPI] ❌ Error updating message ack status:', error);
        }
    }

    private async schedulePendingMsg2ForMsg1(msg1Id: number) {
        try {
            // Find MSG2 messages waiting for this MSG1
            const stmt = this.db.db.prepare(`
                SELECT * FROM sales_scheduled_messages 
                WHERE msg1Id = ? AND status = 'waiting_for_msg1'
            `);
            const msg2Messages = stmt.all(msg1Id) as ScheduledMessage[];

            for (const msg2 of msg2Messages) {
                // Calculate the actual send time for MSG2 based on when MSG1 was sent (now)
                const msg2SendAt = this.calculateSendTime('msg2', new Date());
                
                console.log(`[SalesAPI] 📅 Calculating MSG2 send time after MSG1 sent:`);
                console.log(`[SalesAPI]   - MSG1 sent at: ${new Date().toISOString()}`);
                console.log(`[SalesAPI]   - MSG2 delay: ${this.salesSettings?.msg2.delayDays} days, ${this.salesSettings?.msg2.delayHours} hours, ${this.salesSettings?.msg2.delayMinutes} minutes, ${this.salesSettings?.msg2.delaySeconds} seconds`);
                console.log(`[SalesAPI]   - MSG2 calculated send time: ${msg2SendAt.toISOString()}`);
                
                // Update MSG2 with proper send time and status
                const updateStmt = this.db.db.prepare(`
                    UPDATE sales_scheduled_messages 
                    SET sendAt = ?, status = 'scheduled'
                    WHERE id = ?
                `);
                
                updateStmt.run(msg2SendAt.toISOString(), msg2.id);
                
                console.log(`[SalesAPI] ✅ MSG2 (ID: ${msg2.id}) scheduled for ${msg2SendAt.toISOString()} after MSG1 (ID: ${msg1Id}) was sent`);
                
                // Emit update with all necessary data
                this.emit('message-status-updated', {
                    messageId: msg2.id,
                    salesId: msg2.salesId,
                    status: 'scheduled',
                    timestamp: new Date().toISOString(),
                    sendAt: msg2SendAt.toISOString()
                });
            }
        } catch (error) {
            console.error('[SalesAPI] Error scheduling MSG2 after MSG1 sent:', error);
        }
    }

    private cancelMsg2ForFailedOrExpiredMsg1() {
        try {
            // Cancel MSG2 messages where MSG1 has failed, cancelled, or expired
            const stmt = this.db.db.prepare(`
                UPDATE sales_scheduled_messages 
                SET status = 'cancelled', errorMessage = 'MSG1 was not sent successfully'
                WHERE status = 'waiting_for_msg1' 
                AND msg1Id IN (
                    SELECT id FROM sales_scheduled_messages 
                    WHERE messageType = 'msg1' 
                    AND status IN ('failed', 'cancelled')
                    AND createdAt < datetime('now', '-24 hours')
                )
            `);
            
            const result = stmt.run();
            if (result.changes > 0) {
                console.log(`[SalesAPI] Cancelled ${result.changes} MSG2 messages due to failed/expired MSG1`);
            }
        } catch (error) {
            console.error('[SalesAPI] Error cancelling MSG2 for failed MSG1:', error);
        }
    }

    private adjustScheduledMessagesToNewSettings() {
        try {
            if (!this.salesSettings) return;

            console.log('[SalesAPI] 🔄 Adjusting existing scheduled messages to new business hours...');
            
            // Get all scheduled messages that need adjustment
            const stmt = this.db.db.prepare(`
                SELECT id, sendAt, messageType FROM sales_scheduled_messages 
                WHERE status = 'scheduled' AND sendAt > datetime('now')
            `);
            const messages = stmt.all() as { id: number; sendAt: string; messageType: string }[];

            let adjustedCount = 0;
            const updateStmt = this.db.db.prepare(`
                UPDATE sales_scheduled_messages SET sendAt = ? WHERE id = ?
            `);

            for (const message of messages) {
                const currentSendTime = new Date(message.sendAt);
                const adjustedSendTime = this.adjustTimeToBusinessHours(currentSendTime);
                
                // Only update if the time actually changed
                if (adjustedSendTime.getTime() !== currentSendTime.getTime()) {
                    updateStmt.run(adjustedSendTime.toISOString(), message.id);
                    adjustedCount++;
                    console.log(`[SalesAPI] Adjusted ${message.messageType} message ${message.id}: ${currentSendTime.toISOString()} → ${adjustedSendTime.toISOString()}`);
                }
            }

            if (adjustedCount > 0) {
                console.log(`[SalesAPI] ✅ Adjusted ${adjustedCount} scheduled messages to new business hours`);
            } else {
                console.log('[SalesAPI] No scheduled messages needed adjustment');
            }
        } catch (error) {
            console.error('[SalesAPI] Error adjusting scheduled messages:', error);
        }
    }

    private async autoScheduleMessagesForNewSales(newSales: SalesData[]) {
        try {
            console.log(`[SalesAPI] ═══ BEGINNING AUTO-SCHEDULING FOR ${newSales.length} SALES ═══`);
            
            if (!this.salesSettings) {
                console.error('[SalesAPI] ❌ Cannot auto-schedule: settings not loaded');
                return;
            }
            
            console.log(`[SalesAPI] Settings check: autoSchedulingEnabled=${this.salesSettings.isAutoSchedulingEnabled}`);
            console.log(`[SalesAPI] MSG1 content length: ${this.salesSettings.msg1?.content?.length || 0} chars`);
            console.log(`[SalesAPI] MSG2 content length: ${this.salesSettings.msg2?.content?.length || 0} chars`);
            
            if (!this.salesSettings.isAutoSchedulingEnabled) {
                console.error('[SalesAPI] ❌ Auto-scheduling called but disabled in settings');
                return;
            }

            let scheduledCount = 0;

            for (const sale of newSales) {
                // Extract contact info from sale
                const businessEntity = sale.businessEntity;
                const contactName = businessEntity.name;
                const contactPhone = businessEntity.mobile || businessEntity.phone;
                const town = businessEntity.town.toLowerCase();
                
                if (!contactPhone) {
                    console.log(`[SalesAPI] Skipping sale ${sale.id} (${contactName}): No phone number`);
                    continue;
                }

                console.log(`[SalesAPI] 📋 Processing sale ${sale.id} for ${contactName} (${contactPhone})`);

                // Format phone number for WhatsApp
                const formattedPhone = this.formatPhoneNumber(contactPhone);
                if (!formattedPhone) {
                    console.log(`[SalesAPI] ⚠️ Skipping sale ${sale.id}: Invalid phone number format`);
                    continue;
                }

                let saleScheduledCount = 0;

                // Schedule MSG1
                if (this.salesSettings?.msg1.content) {
                    console.log(`[SalesAPI] 📤 Scheduling MSG1 for sale ${sale.id} (${contactName})`);
                    const msg1SendAt = this.calculateSendTime('msg1', new Date());
                    const processedContent = this.processMessageVariables(this.salesSettings.msg1.content, sale);
                    console.log(`[SalesAPI] MSG1 send time: ${msg1SendAt.toISOString()}`);
                    const msg1Id = await this.scheduleMessage({
                        salesId: sale.id,
                        contactName,
                        contactPhone: formattedPhone,
                        town,
                        messageType: 'msg1',
                        content: processedContent,
                        images: JSON.stringify(this.salesSettings.msg1.images),
                        scheduledAt: new Date().toISOString(),
                        sendAt: msg1SendAt.toISOString(),
                        status: 'scheduled',
                        createdAt: new Date().toISOString()
                    });
                    
                    if (msg1Id) {
                        console.log(`[SalesAPI] ✅ MSG1 scheduled with ID: ${msg1Id}`);
                        saleScheduledCount++;

                        // Schedule MSG2 if MSG1 was scheduled successfully
                        if (this.salesSettings?.msg2.content) {
                            console.log(`[SalesAPI] 📤 Scheduling MSG2 for sale ${sale.id} (${contactName})`);
                            const processedContent = this.processMessageVariables(this.salesSettings.msg2.content, sale);
                            // MSG2 send time will be calculated when MSG1 is sent
                            const msg2Id = await this.scheduleMessage({
                                salesId: sale.id,
                                contactName,
                                contactPhone: formattedPhone,
                                town,
                                messageType: 'msg2',
                                content: processedContent,
                                images: JSON.stringify(this.salesSettings.msg2.images),
                                scheduledAt: new Date().toISOString(),
                                sendAt: '9999-12-31T23:59:59.999Z', // Placeholder - will be updated when MSG1 is sent
                                status: 'waiting_for_msg1',
                                createdAt: new Date().toISOString(),
                                msg1Id
                            });
                            if (msg2Id) {
                                console.log(`[SalesAPI] ✅ MSG2 scheduled with ID: ${msg2Id}`);
                                saleScheduledCount++;
                            } else {
                                console.log(`[SalesAPI] ❌ Failed to schedule MSG2 for sale ${sale.id}`);
                            }
                        } else {
                            console.log(`[SalesAPI] ⚠️ Skipping MSG2 for sale ${sale.id}: No content template`);
                        }
                    } else {
                        console.log(`[SalesAPI] ❌ Failed to schedule MSG1 for sale ${sale.id}`);
                    }
                } else {
                    console.log(`[SalesAPI] ⚠️ Skipping MSG1 for sale ${sale.id}: No content template`);
                }

                if (saleScheduledCount > 0) {
                    scheduledCount += saleScheduledCount;
                    console.log(`[SalesAPI] 🎯 Sale ${sale.id} (${contactName}): ${saleScheduledCount} messages scheduled`);
                } else {
                    console.log(`[SalesAPI] 🚫 Sale ${sale.id} (${contactName}): No messages scheduled`);
                }
            }
            
            console.log(`[SalesAPI] ═══ AUTO-SCHEDULING COMPLETED: ${scheduledCount} MESSAGES SCHEDULED FOR ${newSales.length} SALES ═══`);
        } catch (error) {
            console.error('[SalesAPI] Error in auto-scheduling:', error);
        }
    }

    private calculateSendTime(messageType: 'msg1' | 'msg2', baseTime: Date): Date {
        if (!this.salesSettings) return baseTime;

        const delayConfig = this.salesSettings[messageType];
        const delayMs = (
            delayConfig.delaySeconds * 1000 +
            delayConfig.delayMinutes * 60 * 1000 +
            delayConfig.delayHours * 60 * 60 * 1000 +
            delayConfig.delayDays * 24 * 60 * 60 * 1000
        );

        const sendTime = new Date(baseTime.getTime() + delayMs);

        // For MSG1, check if send time is within business hours
        if (messageType === 'msg1') {
            return this.adjustTimeToBusinessHours(sendTime);
        }

        // For MSG2, it will be checked when MSG1 is actually sent
        return sendTime;
    }

    private adjustTimeToBusinessHours(sendTime: Date): Date {
        if (!this.salesSettings) return sendTime;

        const now = new Date();
        const maxWaitTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day max wait

        // If send time is beyond max wait time, don't schedule
        if (sendTime.getTime() > maxWaitTime.getTime()) {
            return maxWaitTime;
        }

        const startHour = this.salesSettings.startHour;
        const startMinute = this.salesSettings.startMinute;
        const endHour = this.salesSettings.endHour;
        const endMinute = this.salesSettings.endMinute;

        const sendHour = sendTime.getHours();
        const sendMinute = sendTime.getMinutes();
        const startTimeMinutes = startHour * 60 + startMinute;
        const endTimeMinutes = endHour * 60 + endMinute;
        const sendTimeMinutes = sendHour * 60 + sendMinute;

        // If within business hours, return as is
        if (sendTimeMinutes >= startTimeMinutes && sendTimeMinutes <= endTimeMinutes) {
            return sendTime;
        }

        // If before business hours today, move to start of business hours today
        if (sendTimeMinutes < startTimeMinutes) {
            const adjustedTime = new Date(sendTime);
            adjustedTime.setHours(startHour, startMinute, 0, 0);
            return adjustedTime;
        }

        // If after business hours, move to start of next business day
        const nextDay = new Date(sendTime);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(startHour, startMinute, 0, 0);

        // But don't exceed max wait time
        if (nextDay.getTime() > maxWaitTime.getTime()) {
            return maxWaitTime;
        }

        return nextDay;
    }

    private async scheduleMessage(message: Omit<ScheduledMessage, 'id'>): Promise<number | null> {
        try {
            console.log(`[SalesAPI] Inserting ${message.messageType} into database for ${message.contactName}`);
            const stmt = this.db.db.prepare(`
                INSERT INTO sales_scheduled_messages (
                    salesId, contactName, contactPhone, town, messageType, content, images,
                    scheduledAt, sendAt, status, createdAt, msg1Id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const result = stmt.run(
                message.salesId,
                message.contactName,
                message.contactPhone,
                message.town,
                message.messageType,
                message.content,
                message.images,
                message.scheduledAt,
                message.sendAt,
                message.status,
                message.createdAt,
                message.msg1Id || null
            );

            const messageId = result.lastInsertRowid as number;
            console.log(`[SalesAPI] Successfully scheduled ${message.messageType} with ID ${messageId} for ${message.contactName}`);
            return messageId;
        } catch (error: any) {
            console.error('[SalesAPI] Error scheduling message:', error.message);
            return null;
        }
    }

    private async processScheduledMessages() {
        try {
            // Skip processing if WhatsApp is not connected
            if (!this.isWhatsAppConnected) {
                console.log('[SalesAPI] 📱 WhatsApp not connected, skipping message processing');
                return;
            }

            // Check if we're within business hours
            const inBusinessHours = this.isWithinBusinessHours();
            if (!inBusinessHours) {
                console.log('[SalesAPI] 🕐 Outside business hours, skipping message processing');
                return;
            }

            // Get messages that are scheduled to be sent now or in the past (with 30 second buffer)
            const now = new Date();
            const bufferTime = new Date(now.getTime() + 30000); // 30 seconds buffer
            const stmt = this.db.db.prepare(`
                SELECT * FROM sales_scheduled_messages 
                WHERE status = 'scheduled' AND sendAt <= ? 
                ORDER BY sendAt ASC
                LIMIT 5
            `);
            
            const messages = stmt.all(bufferTime.toISOString()) as ScheduledMessage[];
            
            // Also check for failed MSG1 messages and cancel their MSG2s
            this.cancelMsg2ForFailedOrExpiredMsg1();
            
            if (messages.length === 0) {
                // Only log if we're in business hours and connected
                console.log('[SalesAPI] 📮 No scheduled messages ready to send');
                return;
            }

            console.log(`[SalesAPI] 📨 Found ${messages.length} messages ready to send`);
            
            // Process each message (only 'scheduled' status messages should be here)
            for (const message of messages) {
                try {
                    // Send the message
                    await this.sendScheduledMessage(message);
                    
                    // Small delay between messages to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error: any) {
                    console.error(`[SalesAPI] Error processing message ${message.id}:`, error);
                    await this.updateMessageStatus(message.id!, 'failed', undefined, error.message || 'Unknown error');
                }
            }
        } catch (error: any) {
            console.error('[SalesAPI] Error processing scheduled messages:', error);
        }
    }

    private isWithinBusinessHours(): boolean {
        if (!this.salesSettings) return false;

        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTimeMinutes = currentHour * 60 + currentMinute;
        
        const startTimeMinutes = this.salesSettings.startHour * 60 + this.salesSettings.startMinute;
        const endTimeMinutes = this.salesSettings.endHour * 60 + this.salesSettings.endMinute;

        return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes;
    }

    private async sendScheduledMessage(message: ScheduledMessage) {
        try {
            console.log(`[SalesAPI] Sending scheduled message ${message.id} to ${message.contactName}`);
            
            // Format phone number for WhatsApp (with proper error handling)
            let formattedPhone: string | null;
            try {
                formattedPhone = this.formatPhoneNumber(message.contactPhone);
                if (!formattedPhone) {
                    throw new Error(`Invalid phone number format: ${message.contactPhone}`);
                }
            } catch (error) {
                console.error(`[SalesAPI] Error formatting phone number for message ${message.id}:`, error);
                await this.updateMessageStatus(message.id!, 'failed', undefined, `Invalid phone number format: ${message.contactPhone}`);
                return;
            }
            
            // Parse images if any
            const images = this.safeJsonParse(message.images, []);
            
            try {
                let whatsappMessageId: string | null = null;
                
                if (images.length > 0) {
                    // Send message with images
                    whatsappMessageId = await this.whatsappManager.sendMessageWithMedia(
                        formattedPhone,
                        message.content,
                        images
                    );
                } else {
                    // Send text-only message
                    whatsappMessageId = await this.whatsappManager.sendMessage(
                        formattedPhone,
                        message.content
                    );
                }
                
                // Mark as sent and store WhatsApp message ID
                console.log(`[SalesAPI] 📨 WhatsApp returned message ID: ${whatsappMessageId} for message ${message.id}`);
                
                // Only update if we have a valid message ID
                if (whatsappMessageId) {
                    await this.updateMessageStatus(message.id!, 'sent', whatsappMessageId);
                } else {
                    // If no message ID was returned, still mark as sent but without WhatsApp ID
                    console.log(`[SalesAPI] ⚠️ No WhatsApp message ID returned, marking as sent without ID`);
                    await this.updateMessageStatus(message.id!, 'sent');
                }
                
                console.log(`[SalesAPI] Successfully sent message ${message.id} to ${message.contactName}`);
                
                // Emit event
                this.emit('message-sent', { 
                    messageId: message.id,
                    contactName: message.contactName,
                    messageType: message.messageType
                });

                // If this is MSG1, immediately schedule MSG2 (don't wait for WhatsApp ack)
                if (message.messageType === 'msg1') {
                    console.log(`[SalesAPI] 🔄 MSG1 sent successfully, scheduling MSG2 immediately...`);
                    await this.schedulePendingMsg2ForMsg1(message.id!);
                }
                
            } catch (error: any) {
                console.error(`[SalesAPI] Error sending message ${message.id}:`, error);
                
                // Mark as failed
                await this.updateMessageStatus(message.id!, 'failed', undefined, error.message || 'Failed to send message');
                
                // Emit event
                this.emit('message-failed', { 
                    messageId: message.id,
                    contactName: message.contactName,
                    messageType: message.messageType,
                    error: error.message || 'Failed to send message'
                });

                // If this is MSG1 and it failed, cancel the corresponding MSG2
                if (message.messageType === 'msg1') {
                    try {
                        const cancelMsg2 = this.db.db.prepare(`
                            UPDATE sales_scheduled_messages 
                            SET status = 'cancelled', errorMessage = 'Cancelled because MSG1 failed'
                            WHERE msg1Id = ? AND status = 'scheduled'
                        `);
                        const result = cancelMsg2.run(message.id);
                        if (result.changes > 0) {
                            console.log(`[SalesAPI] Cancelled ${result.changes} MSG2 messages for failed MSG1 (ID: ${message.id})`);
                        }
                    } catch (cancelError) {
                        console.error('[SalesAPI] Error cancelling MSG2 after MSG1 failure:', cancelError);
                    }
                }
            }
        } catch (error: any) {
            console.error(`[SalesAPI] Error processing message ${message.id}:`, error);
        }
    }

    private async updateMessageStatus(
        messageId: number, 
        status: string, 
        whatsappMessageId?: string, 
        errorMessage?: string
    ) {
        try {
            const now = new Date().toISOString();
            const updateFields = ['status = ?'];
            const updateValues = [status];

            // Add timestamp field based on status
            if (status === 'sent') {
                updateFields.push('sentAt = ?');
                updateValues.push(now);
            } else if (status === 'delivered') {
                updateFields.push('deliveredAt = ?');
                updateValues.push(now);
            } else if (status === 'read') {
                updateFields.push('readAt = ?');
                updateValues.push(now);
            }

            // Add WhatsApp message ID if provided
            if (whatsappMessageId) {
                updateFields.push('messageId = ?');
                updateValues.push(whatsappMessageId);
                console.log(`[SalesAPI] 💾 Storing WhatsApp message ID: ${whatsappMessageId} for message ${messageId}`);
            }

            // Add error message if provided
            if (errorMessage) {
                updateFields.push('errorMessage = ?');
                updateValues.push(errorMessage);
            }

            updateValues.push(messageId.toString());

            const stmt = this.db.db.prepare(`
                UPDATE sales_scheduled_messages 
                SET ${updateFields.join(', ')} 
                WHERE id = ?
            `);

            stmt.run(...updateValues);
            
            console.log(`[SalesAPI] Updated message ${messageId} status to ${status}${whatsappMessageId ? ` (WhatsApp ID: ${whatsappMessageId})` : ''}`);

            // Verify the message ID was stored correctly
            if (whatsappMessageId) {
                const verifyStmt = this.db.db.prepare(`SELECT messageId FROM sales_scheduled_messages WHERE id = ?`);
                const storedMessage = verifyStmt.get(messageId) as { messageId: string } | undefined;
                console.log(`[SalesAPI] 🔍 Verification - Stored messageId for ${messageId}: ${storedMessage?.messageId || 'NULL'}`);
            }

            // Get updated message data and emit real-time update
            const messageStmt = this.db.db.prepare(`
                SELECT id, salesId, status, sentAt, deliveredAt, readAt, sendAt FROM sales_scheduled_messages 
                WHERE id = ?
            `);
            const message = messageStmt.get(messageId) as any;

            if (message) {
                this.emit('message-status-updated', {
                    messageId: message.id,
                    salesId: message.salesId,
                    status: message.status,
                    timestamp: now,
                    whatsappMessageId,
                    sendAt: message.sendAt,
                    sentAt: message.sentAt,
                    deliveredAt: message.deliveredAt,
                    readAt: message.readAt
                });
            }
        } catch (error: any) {
            console.error('[SalesAPI] Error updating message status:', error.message);
        }
    }

    private formatPhoneNumber(phone: string): string | null {
        try {
            if (!phone || phone.trim() === '') {
                console.warn('[SalesAPI] Empty phone number provided');
                return null;
            }

            // Remove all non-digit characters except +
            let cleanPhone = phone.replace(/[^\d+]/g, '');
            
            // If phone starts with 00, replace with +
            if (cleanPhone.startsWith('00')) {
                cleanPhone = '+' + cleanPhone.substring(2);
            }
            
            // If phone doesn't start with +, add it
            if (!cleanPhone.startsWith('+')) {
                cleanPhone = '+' + cleanPhone;
            }
            
            // Remove the + for WhatsApp format and add @c.us
            const phoneNumber = cleanPhone.substring(1); // Remove the +
            
            // Basic validation - phone should be at least 7 digits
            if (phoneNumber.length < 7) {
                console.warn(`[SalesAPI] Phone number too short: ${phone}`);
                return null;
            }
            
            return phoneNumber + '@c.us';
        } catch (error) {
            console.error(`[SalesAPI] Error formatting phone number ${phone}:`, error);
            return null;
        }
    }

    private processMessageVariables(content: string, sale: SalesData): string {
        try {
            let processedContent = content;
            
            // Contact variables
            const fullName = sale.businessEntity.name || '';
            const nameParts = fullName.split(' ').filter(part => part.trim());
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            
            processedContent = processedContent.replace(/{name}/g, fullName);
            processedContent = processedContent.replace(/{name\[0\]}/g, firstName);
            processedContent = processedContent.replace(/{name\[1\]}/g, lastName);
            processedContent = processedContent.replace(/{phone}/g, sale.businessEntity.phone || '');
            processedContent = processedContent.replace(/{town}/g, sale.businessEntity.town || '');
            
            // Date/time variables
            const now = new Date();
            const currentDate = now.toLocaleDateString('en-GB'); // DD/MM/YYYY format
            const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const currentDateTime = `${currentDate} ${currentTime}`;
            
            processedContent = processedContent.replace(/{current_date}/g, currentDate);
            processedContent = processedContent.replace(/{current_time}/g, currentTime);
            processedContent = processedContent.replace(/{current_datetime}/g, currentDateTime);
            
            // Document date
            if (sale.documentDate) {
                const docDate = new Date(sale.documentDate).toLocaleDateString('en-GB');
                processedContent = processedContent.replace(/{document_date}/g, docDate);
            } else {
                processedContent = processedContent.replace(/{document_date}/g, 'N/A');
            }
            
            return processedContent;
        } catch (error) {
            console.error('[SalesAPI] Error processing message variables:', error);
            return content; // Return original content on error
        }
    }

    // Public API methods for settings management
    public async getSalesSettings(): Promise<{ success: boolean; settings?: SalesSettings; error?: string }> {
        try {
            console.log('[SalesAPI] 📤 Getting sales settings for UI...');
            
            if (this.salesSettings) {
                console.log(`[SalesAPI] Returning cached settings - Auto-scheduling: ${this.salesSettings.isAutoSchedulingEnabled}`);
                return { success: true, settings: this.salesSettings };
            }
            
            console.log('[SalesAPI] No cached settings, loading from database...');
            this.loadSalesSettings();
            
            if (this.salesSettings) {
                console.log('[SalesAPI] Settings loaded successfully from database');
                return { success: true, settings: this.salesSettings };
            } else {
                console.error('[SalesAPI] ❌ Failed to load settings after database call');
                return { success: false, error: 'Failed to load settings' };
            }
        } catch (error: any) {
            console.error('[SalesAPI] ❌ Error getting sales settings:', error.message);
            return { success: false, error: error.message };
        }
    }

    public async saveSalesSettings(settings: SalesSettings): Promise<{ success: boolean; error?: string }> {
        try {
            console.log('[SalesAPI] 💾 Saving sales settings to database...');
            console.log(`[SalesAPI] Settings to save:`);
            console.log(`[SalesAPI]   - Auto-scheduling: ${settings.isAutoSchedulingEnabled}`);
            console.log(`[SalesAPI]   - Business hours: ${settings.startHour}:${String(settings.startMinute).padStart(2, '0')} - ${settings.endHour}:${String(settings.endMinute).padStart(2, '0')}`);
            console.log(`[SalesAPI]   - MSG1 content: ${settings.msg1.content.length} chars`);
            console.log(`[SalesAPI]   - MSG2 content: ${settings.msg2.content.length} chars`);
            
            const stmt = this.db.db.prepare(`
                UPDATE sales_settings SET
                    isAutoSchedulingEnabled = ?,
                    startHour = ?,
                    startMinute = ?,
                    endHour = ?,
                    endMinute = ?,
                    msg1Content = ?,
                    msg1Images = ?,
                    msg1DelaySeconds = ?,
                    msg1DelayMinutes = ?,
                    msg1DelayHours = ?,
                    msg1DelayDays = ?,
                    msg2Content = ?,
                    msg2Images = ?,
                    msg2DelaySeconds = ?,
                    msg2DelayMinutes = ?,
                    msg2DelayHours = ?,
                    msg2DelayDays = ?,
                    updatedAt = ?
                WHERE id = 1
            `);

            const result = stmt.run(
                settings.isAutoSchedulingEnabled ? 1 : 0,
                settings.startHour,
                settings.startMinute,
                settings.endHour,
                settings.endMinute,
                settings.msg1.content,
                JSON.stringify(settings.msg1.images),
                settings.msg1.delaySeconds,
                settings.msg1.delayMinutes,
                settings.msg1.delayHours,
                settings.msg1.delayDays,
                settings.msg2.content,
                JSON.stringify(settings.msg2.images),
                settings.msg2.delaySeconds,
                settings.msg2.delayMinutes,
                settings.msg2.delayHours,
                settings.msg2.delayDays,
                new Date().toISOString()
            );

            if (result.changes === 0) {
                console.error('[SalesAPI] ❌ No rows updated when saving settings');
                return { success: false, error: 'No rows updated' };
            }

            // Update in-memory settings immediately
            this.salesSettings = {...settings};
            
            console.log('[SalesAPI] ✅ Settings saved successfully to database');
            console.log(`[SalesAPI] In-memory auto-scheduling now: ${this.salesSettings.isAutoSchedulingEnabled}`);
            
            // Adjust existing scheduled messages to new business hours
            this.adjustScheduledMessagesToNewSettings();
            
            // Emit settings updated event
            this.emit('settings-updated', { settings: this.salesSettings });
            
            return { success: true };
        } catch (error: any) {
            console.error('[SalesAPI] ❌ Error saving sales settings:', error.message);
            return { success: false, error: error.message };
        }
    }

    // Public API methods for scheduled messages management
    public async getScheduledMessages(
        page: number = 1, 
        limit: number = 100, 
        statusFilter: string = '', 
        messageTypeFilter: string = '',
        townFilter: string = ''
    ): Promise<{ success: boolean; messages?: ScheduledMessage[]; pagination?: any; error?: string }> {
        try {
            const offset = (page - 1) * limit;
            let whereClause = 'WHERE 1=1';
            const params: any[] = [];

            if (statusFilter && statusFilter !== 'all') {
                whereClause += ' AND status = ?';
                params.push(statusFilter);
            }

            if (messageTypeFilter && messageTypeFilter !== 'all') {
                whereClause += ' AND messageType = ?';
                params.push(messageTypeFilter);
            }

            if (townFilter && townFilter !== 'all') {
                whereClause += ' AND town = ?';
                params.push(townFilter);
            }

            // Get total count
            const countStmt = this.db.db.prepare(`
                SELECT COUNT(*) as total FROM sales_scheduled_messages ${whereClause}
            `);
            const countResult = countStmt.get(...params) as { total: number };

            // Get messages
            const stmt = this.db.db.prepare(`
                SELECT * FROM sales_scheduled_messages 
                ${whereClause}
                ORDER BY createdAt DESC
                LIMIT ? OFFSET ?
            `);
            
            const messages = stmt.all(...params, limit, offset) as ScheduledMessage[];

            const pagination = {
                page,
                limit,
                total: countResult.total,
                totalPages: Math.ceil(countResult.total / limit)
            };

            return { success: true, messages, pagination };
        } catch (error: any) {
            console.error('[SalesAPI] Error getting scheduled messages:', error.message);
            return { success: false, error: error.message };
        }
    }

    public async cancelScheduledMessages(messageIds: number[]): Promise<{ success: boolean; cancelledCount?: number; error?: string }> {
        try {
            if (messageIds.length === 0) {
                return { success: false, error: 'No messages selected' };
            }

            // First, get details of messages being cancelled
            const placeholders = messageIds.map(() => '?').join(',');
            const getMessagesStmt = this.db.db.prepare(`
                SELECT id, messageType FROM sales_scheduled_messages 
                WHERE id IN (${placeholders}) AND status IN ('scheduled', 'waiting_for_msg1')
            `);
            const messagesToCancel = getMessagesStmt.all(...messageIds) as { id: number; messageType: string }[];

            // Get MSG1 messages that are being cancelled directly
            const directMsg1Messages = messagesToCancel.filter(msg => msg.messageType === 'msg1');
            
            // Get MSG2 messages that are being cancelled directly
            const directMsg2Messages = messagesToCancel.filter(msg => msg.messageType === 'msg2');

            // Cancel the selected messages first
            const cancelStmt = this.db.db.prepare(`
                UPDATE sales_scheduled_messages 
                SET status = 'cancelled', errorMessage = 'Cancelled by user'
                WHERE id IN (${placeholders}) AND status IN ('scheduled', 'waiting_for_msg1')
            `);
            const directResult = cancelStmt.run(...messageIds);

            let additionalMsg2Cancelled = 0;
            
            // For each MSG1 that was cancelled, also cancel related MSG2 messages (but exclude ones already cancelled directly)
            if (directMsg1Messages.length > 0) {
                const msg1Ids = directMsg1Messages.map(msg => msg.id);
                const msg1Placeholders = msg1Ids.map(() => '?').join(',');
                
                // Get MSG2 messages that would be cancelled (excluding already directly cancelled ones)
                const relatedMsg2Stmt = this.db.db.prepare(`
                    SELECT id FROM sales_scheduled_messages 
                    WHERE msg1Id IN (${msg1Placeholders}) 
                    AND status IN ('scheduled', 'waiting_for_msg1')
                    AND id NOT IN (${placeholders})
                `);
                const relatedMsg2Messages = relatedMsg2Stmt.all(...msg1Ids, ...messageIds) as { id: number }[];
                
                if (relatedMsg2Messages.length > 0) {
                    const relatedMsg2Ids = relatedMsg2Messages.map(msg => msg.id);
                    const relatedMsg2Placeholders = relatedMsg2Ids.map(() => '?').join(',');
                    
                    const cancelMsg2Stmt = this.db.db.prepare(`
                        UPDATE sales_scheduled_messages 
                        SET status = 'cancelled', errorMessage = 'Cancelled because MSG1 was cancelled'
                        WHERE id IN (${relatedMsg2Placeholders})
                    `);
                    const msg2Result = cancelMsg2Stmt.run(...relatedMsg2Ids);
                    additionalMsg2Cancelled = msg2Result.changes;
                }
            }

            const totalCancelled = directResult.changes + additionalMsg2Cancelled;
            const directMsg1Count = directMsg1Messages.length;
            const directMsg2Count = directMsg2Messages.length;
            
            console.log(`[SalesAPI] Cancelled ${totalCancelled} total messages:`);
            console.log(`[SalesAPI] - ${directMsg1Count} MSG1 messages (directly selected)`);
            console.log(`[SalesAPI] - ${directMsg2Count} MSG2 messages (directly selected)`);
            console.log(`[SalesAPI] - ${additionalMsg2Cancelled} MSG2 messages (auto-cancelled due to MSG1 cancellation)`);
            
            return { success: true, cancelledCount: totalCancelled };
        } catch (error: any) {
            console.error('[SalesAPI] Error cancelling scheduled messages:', error.message);
            return { success: false, error: error.message };
        }
    }

    public async deleteScheduledMessages(messageIds: number[]): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
        try {
            if (messageIds.length === 0) {
                return { success: false, error: 'No messages selected' };
            }

            const placeholders = messageIds.map(() => '?').join(',');
            const stmt = this.db.db.prepare(`
                DELETE FROM sales_scheduled_messages 
                WHERE id IN (${placeholders})
            `);

            const result = stmt.run(...messageIds);
            
            console.log(`[SalesAPI] Deleted ${result.changes} scheduled messages`);
            return { success: true, deletedCount: result.changes };
        } catch (error: any) {
            console.error('[SalesAPI] Error deleting scheduled messages:', error.message);
            return { success: false, error: error.message };
        }
    }

    public async getAllScheduledMessageIds(
        statusFilter: string = '', 
        messageTypeFilter: string = '',
        townFilter: string = ''
    ): Promise<{ success: boolean; messageIds?: number[]; error?: string }> {
        try {
            let whereClause = 'WHERE 1=1';
            const params: any[] = [];

            if (statusFilter && statusFilter !== 'all') {
                whereClause += ' AND status = ?';
                params.push(statusFilter);
            }

            if (messageTypeFilter && messageTypeFilter !== 'all') {
                whereClause += ' AND messageType = ?';
                params.push(messageTypeFilter);
            }

            if (townFilter && townFilter !== 'all') {
                whereClause += ' AND town = ?';
                params.push(townFilter);
            }

            const stmt = this.db.db.prepare(`
                SELECT id FROM sales_scheduled_messages ${whereClause}
                ORDER BY createdAt DESC
            `);
            
            const results = stmt.all(...params) as { id: number }[];
            const messageIds = results.map(row => row.id);

            return { success: true, messageIds };
        } catch (error: any) {
            console.error('[SalesAPI] Error getting all scheduled message IDs:', error.message);
            return { success: false, error: error.message };
        }
    }

    public getScheduledMessagesStats(): any {
        try {
            const stats = this.db.db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'scheduled' THEN 1 END) as scheduled,
                    COUNT(CASE WHEN status = 'waiting_for_msg1' THEN 1 END) as waiting_for_msg1,
                    COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
                    COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
                    COUNT(CASE WHEN status = 'read' THEN 1 END) as read,
                    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                    COUNT(CASE WHEN messageType = 'msg1' THEN 1 END) as msg1Count,
                    COUNT(CASE WHEN messageType = 'msg2' THEN 1 END) as msg2Count
                FROM sales_scheduled_messages
            `).get() as any;

            const townStats = this.db.db.prepare(`
                SELECT town, COUNT(*) as count
                FROM sales_scheduled_messages
                GROUP BY town
                ORDER BY count DESC
            `).all() as any[];

            return {
                total: stats?.total || 0,
                byStatus: {
                    scheduled: stats?.scheduled || 0,
                    waiting_for_msg1: stats?.waiting_for_msg1 || 0,
                    sent: stats?.sent || 0,
                    delivered: stats?.delivered || 0,
                    read: stats?.read || 0,
                    cancelled: stats?.cancelled || 0,
                    failed: stats?.failed || 0
                },
                byType: {
                    msg1: stats?.msg1Count || 0,
                    msg2: stats?.msg2Count || 0
                },
                byTown: townStats.reduce((acc: any, row: any) => {
                    acc[row.town] = row.count;
                    return acc;
                }, {})
            };
        } catch (error: any) {
            console.error('[SalesAPI] Error getting scheduled messages stats:', error.message);
            return {
                total: 0,
                byStatus: { scheduled: 0, sent: 0, delivered: 0, read: 0, cancelled: 0, failed: 0 },
                byType: { msg1: 0, msg2: 0 },
                byTown: {}
            };
        }
    }
} 