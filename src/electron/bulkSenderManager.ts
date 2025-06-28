import { EventEmitter } from 'events';
import { DatabaseManager } from './databaseManager.js';
import { WhatsAppManager } from './whatsappManager.js';
import { TemplateManager } from './templateManager.js';
import { ContactManager } from './contactManager.js';
import cron from 'node-cron';
import moment from 'moment-timezone';

interface BulkSettings {
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
    intervalSeconds: number;
    intervalMinutes: number;
    maxMessagesPerDay: number;
    isActive: boolean;
}

interface BulkMessage {
    id?: number;
    userId: number;
    campaignName: string;
    templateId: number;
    contactIds: number[];
    scheduledAt: string;
    status: 'scheduled' | 'sending' | 'paused' | 'completed' | 'cancelled';
    createdAt: string;
    completedAt?: string;
    totalMessages: number;
    sentCount: number;
    deliveredCount: number;
    readCount: number;
    failedCount: number;
}

interface MessageLog {
    id?: number;
    campaignId: number;
    contactId: number;
    contactName: string;
    contactSurname: string;
    contactPhone: string;
    templateName: string;
    messageContent: string;
    scheduledAt: string;
    sentAt?: string;
    deliveredAt?: string;
    readAt?: string;
    status: 'scheduled' | 'sent' | 'delivered' | 'read' | 'failed' | 'cancelled';
    errorMessage?: string;
    messageId?: string;
}

interface BulkStatistics {
    total: number;
    statusCounts: {
        scheduled: number;
        sent: number;
        delivered: number;
        read: number;
        failed: number;
        cancelled: number;
    };
    statusPercentages: {
        scheduled: number;
        sent: number;
        delivered: number;
        read: number;
        failed: number;
        cancelled: number;
    };
    dailyStats: {
        [date: string]: {
            scheduled: number;
            sent: number;
            delivered: number;
            read: number;
            failed: number;
            cancelled: number;
        };
    };
    today: {
        sent: number;
        delivered: number;
        read: number;
        failed: number;
    };
    week: {
        sent: number;
        delivered: number;
        read: number;
        failed: number;
    };
    month: {
        sent: number;
        delivered: number;
        read: number;
        failed: number;
    };
    year: {
        sent: number;
        delivered: number;
        read: number;
        failed: number;
    };
    totalCampaigns: number;
    activeCampaigns: number;
}

interface SchedulerState {
    isInActiveTimeFrame: boolean;
    nextScheduledTime: Date | null;
    lastMessageSentAt: Date | null;
    activeTask: cron.ScheduledTask | null;
    messageTimeout: NodeJS.Timeout | null;
    currentSettings: BulkSettings | null;
}

export class BulkSenderManager extends EventEmitter {
    private db: DatabaseManager;
    private whatsappManager: WhatsAppManager;
    private templateManager: TemplateManager;
    private contactManager: ContactManager;
    private sendingInterval: NodeJS.Timeout | null = null;
    private isProcessing = false;
    
    // Enhanced scheduling state
    private schedulerState: SchedulerState = {
        isInActiveTimeFrame: false,
        nextScheduledTime: null,
        lastMessageSentAt: null,
        activeTask: null,
        messageTimeout: null,
        currentSettings: null
    };
    
    private readonly timezone = moment.tz.guess(); // Auto-detect timezone

    constructor(whatsappManager: WhatsAppManager, templateManager: TemplateManager, contactManager: ContactManager) {
        super();
        // Increase max listeners to prevent memory leak warnings
        this.setMaxListeners(100000);
        this.db = new DatabaseManager();
        this.whatsappManager = whatsappManager;
        this.templateManager = templateManager;
        this.contactManager = contactManager;
        
        this.initializeBulkSender();
    }

    private async initializeBulkSender() {
        // Create additional tables for bulk sender
        this.createBulkSenderTables();
        
        // Set up WhatsApp message acknowledgment listeners
        this.setupMessageAckListeners();
        
        // Set default settings if not exist
        await this.initializeDefaultSettings();
        
        // Initialize the enhanced scheduler with delay to ensure everything is ready
        setTimeout(async () => {
            await this.initializeScheduler();
            await this.startDynamicScheduler();
        }, 1000);
    }

    private async initializeScheduler() {
        console.log('[BulkSender] Initializing dynamic scheduler...');
        
        // Load current settings
        const settingsResult = await this.getBulkSettings(1); // TODO: Use actual user ID
        if (settingsResult.success && settingsResult.settings) {
            this.schedulerState.currentSettings = settingsResult.settings;
            console.log('[BulkSender] Loaded settings:', settingsResult.settings);
        }
        
        // Check if we're currently in active time frame
        this.updateTimeFrameStatus();
        
        // Load last message sent time from database
        await this.loadLastMessageTime();
        
        console.log('[BulkSender] Scheduler initialized');
    }

    private async startDynamicScheduler() {
        console.log('[BulkSender] Starting dynamic scheduler...');
        
        if (!this.schedulerState.currentSettings) {
            console.log('[BulkSender] No settings available, scheduler not started');
            return;
        }
        
        // Stop any existing tasks
        this.stopAllScheduledTasks();
        
        // Create cron tasks for start and end times
        this.createTimeFrameCronTasks();
        
        // If we're currently in active time frame, start processing
        if (this.schedulerState.isInActiveTimeFrame && this.schedulerState.currentSettings.isActive) {
            await this.startMessageProcessing();
        }
        
        console.log('[BulkSender] Dynamic scheduler started');
    }

    private createTimeFrameCronTasks() {
        if (!this.schedulerState.currentSettings) return;
        
        const settings = this.schedulerState.currentSettings;
        
        // Create start time cron (runs daily at start hour:minute)
        const startCron = `0 ${settings.startMinute} ${settings.startHour} * * *`;
        const endCron = `0 ${settings.endMinute} ${settings.endHour} * * *`;
        
        console.log(`[BulkSender] Creating cron tasks: start=${startCron}, end=${endCron}`);
        
        // Start time task
        const startTask = cron.schedule(startCron, async () => {
            console.log('[BulkSender] Entering active time frame via cron');
            this.schedulerState.isInActiveTimeFrame = true;
            this.emit('timeframe-entered');
            
            if (this.schedulerState.currentSettings?.isActive) {
                await this.startMessageProcessing();
            }
        }, {
            timezone: this.timezone
        });
        
        // End time task
        const endTask = cron.schedule(endCron, async () => {
            console.log('[BulkSender] Exiting active time frame via cron');
            this.schedulerState.isInActiveTimeFrame = false;
            this.emit('timeframe-exited');
            await this.stopMessageProcessing();
        }, {
            timezone: this.timezone
        });
        
        // Store tasks for cleanup
        this.schedulerState.activeTask = startTask;
        
        // Also check every minute if we should be processing messages
        const checkTask = cron.schedule('*/1 * * * *', async () => {
            this.updateTimeFrameStatus();
            
            // If we're in timeframe but not processing, start processing
            if (this.schedulerState.isInActiveTimeFrame && 
                this.schedulerState.currentSettings?.isActive && 
                !this.isProcessing) {
                console.log('[BulkSender] Starting message processing via periodic check');
                await this.startMessageProcessing();
            }
        }, {
            timezone: this.timezone
        });
    }

    private async startMessageProcessing() {
        if (this.isProcessing) {
            console.log('[BulkSender] Message processing already active');
            return;
        }
        
        // Check if WhatsApp is connected
        const whatsappStatus = this.whatsappManager.getStatus();
        if (!whatsappStatus.connected) {
            console.log('[BulkSender] WhatsApp not connected, cannot start message processing');
            // Try again in 30 seconds
            setTimeout(() => this.startMessageProcessing(), 30000);
            return;
        }
        
        console.log('[BulkSender] Starting message processing...');
        this.isProcessing = true;
        
        // Schedule the next message immediately
        setImmediate(() => this.scheduleNextMessage());
    }

    private async stopMessageProcessing() {
        console.log('[BulkSender] Stopping message processing...');
        this.isProcessing = false;
        
        // Clear any pending message timeout
        if (this.schedulerState.messageTimeout) {
            clearTimeout(this.schedulerState.messageTimeout);
            this.schedulerState.messageTimeout = null;
        }
    }

    private async scheduleNextMessage() {
        if (!this.isProcessing || !this.schedulerState.currentSettings?.isActive) {
            return;
        }
        
        // Check if we're still in active time frame
        this.updateTimeFrameStatus();
        if (!this.schedulerState.isInActiveTimeFrame) {
            console.log('[BulkSender] Outside active time frame, stopping processing');
            await this.stopMessageProcessing();
            return;
        }
        
        // Get next message to send
        const nextMessage = await this.getNextScheduledMessage();
        if (!nextMessage) {
            console.log('[BulkSender] No messages to send');
            // Check again in 30 seconds for new messages
            this.schedulerState.messageTimeout = setTimeout(() => {
                this.scheduleNextMessage();
            }, 30000);
            return;
        }
        
        // Calculate when to send the next message
        const sendDelay = this.calculateSendDelay();
        
        console.log(`[BulkSender] Next message scheduled in ${sendDelay}ms`);
        
        this.schedulerState.messageTimeout = setTimeout(async () => {
            await this.processNextMessage(nextMessage);
            // Schedule the next message after this one
            await this.scheduleNextMessage();
        }, sendDelay);
    }

    private calculateSendDelay(): number {
        if (!this.schedulerState.currentSettings) return 1000;
        
        const settings = this.schedulerState.currentSettings;
        const intervalMs = (settings.intervalSeconds + settings.intervalMinutes * 60) * 1000;
        
        // If no previous message, send immediately
        if (!this.schedulerState.lastMessageSentAt) {
            return 0;
        }
        
        // Calculate time since last message
        const now = new Date();
        const timeSinceLastMessage = now.getTime() - this.schedulerState.lastMessageSentAt.getTime();
        
        // If enough time has passed, send immediately
        if (timeSinceLastMessage >= intervalMs) {
            return 0;
        }
        
        // Otherwise, wait for the remaining time
        return intervalMs - timeSinceLastMessage;
    }

    private async getNextScheduledMessage() {
        try {
            const nextMessage = this.db.db.prepare(`
                SELECT bml.*, bc.userId
                FROM bulk_message_logs bml
                JOIN bulk_campaigns bc ON bml.campaignId = bc.id
                WHERE bml.status = 'scheduled' 
                AND bc.status IN ('scheduled', 'sending')
                ORDER BY bml.scheduledAt ASC
                LIMIT 1
            `).get();
            
            return nextMessage || null;
        } catch (error) {
            console.error('[BulkSender] Error getting next message:', error);
            return null;
        }
    }

    private async processNextMessage(messageLog: any) {
        try {
            console.log(`[BulkSender] Processing message for ${messageLog.contactPhone}`);
            
            // Update last message sent time
            this.schedulerState.lastMessageSentAt = new Date();
            await this.saveLastMessageTime();
            
            // Send the message
            await this.sendMessage(messageLog);
            
        } catch (error) {
            console.error('[BulkSender] Error processing message:', error);
        }
    }

    private updateTimeFrameStatus() {
        if (!this.schedulerState.currentSettings) return;
        
        const now = moment().tz(this.timezone);
        const currentHour = now.hour();
        const currentMinute = now.minute();
        const settings = this.schedulerState.currentSettings;
        
        // Convert time to minutes for easier comparison
        const currentTimeMinutes = currentHour * 60 + currentMinute;
        const startTimeMinutes = settings.startHour * 60 + settings.startMinute;
        const endTimeMinutes = settings.endHour * 60 + settings.endMinute;
        
        let isInFrame = false;
        
        if (startTimeMinutes <= endTimeMinutes) {
            // Same day timeframe (e.g., 9:30 AM to 5:45 PM)
            isInFrame = currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes;
        } else {
            // Cross-midnight timeframe (e.g., 10:30 PM to 6:15 AM)
            isInFrame = currentTimeMinutes >= startTimeMinutes || currentTimeMinutes < endTimeMinutes;
        }
        
        const wasInFrame = this.schedulerState.isInActiveTimeFrame;
        this.schedulerState.isInActiveTimeFrame = isInFrame;
        
        if (wasInFrame !== isInFrame) {
            console.log(`[BulkSender] Time frame status changed: ${isInFrame ? 'entered' : 'exited'} (${settings.startHour}:${settings.startMinute.toString().padStart(2, '0')} - ${settings.endHour}:${settings.endMinute.toString().padStart(2, '0')})`);
            this.emit(isInFrame ? 'timeframe-entered' : 'timeframe-exited');
        }
    }

    private async loadLastMessageTime() {
        try {
            const lastMessage = this.db.db.prepare(`
                SELECT MAX(sentAt) as lastSent FROM bulk_message_logs WHERE sentAt IS NOT NULL
            `).get() as { lastSent: string | null };
            
            if (lastMessage?.lastSent) {
                this.schedulerState.lastMessageSentAt = new Date(lastMessage.lastSent);
                console.log(`[BulkSender] Loaded last message time: ${this.schedulerState.lastMessageSentAt}`);
            }
        } catch (error) {
            console.error('[BulkSender] Error loading last message time:', error);
        }
    }

    private async saveLastMessageTime() {
        // This is automatically saved when marking message as sent
        // But we can also store it separately for faster access
    }

    private async sendMessage(messageLog: any) {
        try {
            // Update campaign status to sending
            const updateCampaign = this.db.db.prepare(`
                UPDATE bulk_campaigns 
                SET status = 'sending'
                WHERE id = ? AND status = 'scheduled'
            `);
            updateCampaign.run(messageLog.campaignId);

            // Format phone number for WhatsApp
            const formattedPhone = this.formatPhoneNumber(messageLog.contactPhone);

            // Get template content for images
            const template = this.db.db.prepare(`
                SELECT t.content FROM templates t
                JOIN bulk_campaigns bc ON t.id = bc.templateId
                WHERE bc.id = ?
            `).get(messageLog.campaignId) as { content: string } | undefined;

            let messageContent = messageLog.messageContent;
            let hasImages = false;
            let templateContent = null;
            
            if (template) {
                try {
                    templateContent = JSON.parse(template.content);
                    hasImages = templateContent.images && templateContent.images.length > 0;
                } catch (parseError) {
                    console.error('[BulkSenderManager] Error parsing template content:', parseError);
                }
            }
            
            try {
                let whatsappMessageId = null;
                
                if (hasImages && templateContent) {
                    // Send message with images
                    whatsappMessageId = await this.whatsappManager.sendMessageWithMedia(
                        formattedPhone,
                        messageContent,
                        templateContent.images
                    );
                } else {
                    // Send text-only message
                    whatsappMessageId = await this.whatsappManager.sendMessage(
                        formattedPhone,
                        messageContent
                    );
                }
                
                await this.markMessageAsSent(messageLog.id, whatsappMessageId);
                
            } catch (sendError: any) {
                console.error('[BulkSenderManager] Error sending message:', sendError);
                await this.markMessageAsFailed(messageLog.id, sendError.message || 'Failed to send message');
            }
            
        } catch (error: any) {
            console.error('[BulkSenderManager] Error in sendMessage:', error);
            await this.markMessageAsFailed(messageLog.id, error.message || 'Unknown error occurred');
        }
    }

    private async markMessageAsSent(messageLogId: number, whatsappMessageId?: string | null) {
        const updateLog = this.db.db.prepare(`
            UPDATE bulk_message_logs 
            SET status = 'sent', sentAt = ?, messageId = ?
            WHERE id = ?
        `);
        
        updateLog.run(new Date().toISOString(), whatsappMessageId || null, messageLogId);
        
        this.emit('message-sent', { messageLogId, whatsappMessageId });
    }

    private formatPhoneNumber(phone: string): string {
        try {
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
                console.warn(`[BulkSenderManager] Phone number too short: ${phone}`);
                return phone; // Return original if too short
            }
            
            return phoneNumber + '@c.us';
        } catch (error) {
            console.error(`[BulkSenderManager] Error formatting phone number ${phone}:`, error);
            return phone; // Return original on error
        }
    }

    private async markMessageAsFailed(messageLogId: number, errorMessage: string) {
        const updateLog = this.db.db.prepare(`
            UPDATE bulk_message_logs 
            SET status = 'failed', errorMessage = ?
            WHERE id = ?
        `);
        
        updateLog.run(errorMessage, messageLogId);
        
        // Update campaign failed count
        const messageLog = this.db.db.prepare(`
            SELECT campaignId FROM bulk_message_logs WHERE id = ?
        `).get(messageLogId) as { campaignId: number } | undefined;

        if (messageLog) {
            const updateCampaign = this.db.db.prepare(`
                UPDATE bulk_campaigns 
                SET failedCount = failedCount + 1
                WHERE id = ?
            `);
            
            updateCampaign.run(messageLog.campaignId);
            
            await this.checkCampaignCompletion(messageLog.campaignId);
        }
        
        this.emit('message-failed', { messageLogId, errorMessage });
    }

    private stopAllScheduledTasks() {
        // Clear message timeout
        if (this.schedulerState.messageTimeout) {
            clearTimeout(this.schedulerState.messageTimeout);
            this.schedulerState.messageTimeout = null;
        }
        
        // Stop cron tasks
        if (this.schedulerState.activeTask) {
            this.schedulerState.activeTask.stop();
            this.schedulerState.activeTask = null;
        }
    }

    // Override the existing saveBulkSettings method to trigger scheduler restart
    async saveBulkSettings(userId: number, settings: BulkSettings): Promise<{ success: boolean; error?: string }> {
        try {
            const upsertSettings = this.db.db.prepare(`
                INSERT OR REPLACE INTO bulk_settings 
                (userId, startHour, startMinute, endHour, endMinute, intervalSeconds, intervalMinutes, maxMessagesPerDay, isActive, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            upsertSettings.run(
                userId,
                settings.startHour,
                settings.startMinute,
                settings.endHour,
                settings.endMinute,
                settings.intervalSeconds,
                settings.intervalMinutes,
                settings.maxMessagesPerDay,
                settings.isActive ? 1 : 0,
                new Date().toISOString()
            );

            // Update current settings
            this.schedulerState.currentSettings = settings;
            
            // Restart the dynamic scheduler with new settings
            console.log('[BulkSender] Settings updated, restarting scheduler...');
            await this.startDynamicScheduler();

            this.emit('settings-updated', { userId, settings });
            return { success: true };
        } catch (error: any) {
            console.error('[BulkSender] Error saving bulk settings:', error);
            return { success: false, error: error.message };
        }
    }

    // Add method to get scheduler status
    getSchedulerStatus(): {
        isActive: boolean;
        isInTimeFrame: boolean;
        nextMessageTime: string | null;
        lastMessageTime: string | null;
        currentSettings: BulkSettings | null;
        whatsappConnected: boolean;
        pendingMessages: number;
    } {
        // Get pending messages count
        let pendingMessages = 0;
        try {
            const result = this.db.db.prepare(`
                SELECT COUNT(*) as count
                FROM bulk_message_logs bml
                JOIN bulk_campaigns bc ON bml.campaignId = bc.id
                WHERE bml.status = 'scheduled' 
                AND bc.status IN ('scheduled', 'sending')
            `).get() as { count: number };
            pendingMessages = result.count;
        } catch (error) {
            console.error('[BulkSender] Error getting pending messages count:', error);
        }
        
        return {
            isActive: this.isProcessing,
            isInTimeFrame: this.schedulerState.isInActiveTimeFrame,
            nextMessageTime: this.schedulerState.nextScheduledTime?.toISOString() || null,
            lastMessageTime: this.schedulerState.lastMessageSentAt?.toISOString() || null,
            currentSettings: this.schedulerState.currentSettings,
            whatsappConnected: this.whatsappManager.getStatus().connected,
            pendingMessages
        };
    }

    // Add method to manually trigger settings reload (for app restart)
    async reloadAndRestartScheduler() {
        console.log('[BulkSender] Reloading and restarting scheduler...');
        
        // Stop current processing
        await this.stopMessageProcessing();
        this.stopAllScheduledTasks();
        
        // Reinitialize
        await this.initializeScheduler();
        await this.startDynamicScheduler();
        
        console.log('[BulkSender] Scheduler reloaded and restarted');
    }

    // Manual trigger for testing
    async forceStartProcessing() {
        console.log('[BulkSender] Force starting message processing...');
        this.isProcessing = false; // Reset flag
        this.schedulerState.isInActiveTimeFrame = true; // Force timeframe
        await this.startMessageProcessing();
    }

    private migrateBulkSettingsTable() {
        try {
            // Check if startMinute column exists
            const columnInfo = this.db.db.prepare(`PRAGMA table_info(bulk_settings)`).all() as any[];
            const hasStartMinute = columnInfo.some(col => col.name === 'startMinute');
            const hasEndMinute = columnInfo.some(col => col.name === 'endMinute');

            if (!hasStartMinute) {
                console.log('[BulkSender] Adding startMinute column to bulk_settings table');
                this.db.db.exec(`ALTER TABLE bulk_settings ADD COLUMN startMinute INTEGER NOT NULL DEFAULT 0`);
            }

            if (!hasEndMinute) {
                console.log('[BulkSender] Adding endMinute column to bulk_settings table');
                this.db.db.exec(`ALTER TABLE bulk_settings ADD COLUMN endMinute INTEGER NOT NULL DEFAULT 0`);
            }
        } catch (error) {
            console.error('[BulkSender] Error migrating bulk_settings table:', error);
        }
    }

    private createBulkSenderTables() {
        try {
            // Bulk settings table
            this.db.db.exec(`
                CREATE TABLE IF NOT EXISTS bulk_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId INTEGER NOT NULL,
                    startHour INTEGER NOT NULL DEFAULT 9,
                    startMinute INTEGER NOT NULL DEFAULT 0,
                    endHour INTEGER NOT NULL DEFAULT 17,
                    endMinute INTEGER NOT NULL DEFAULT 0,
                    intervalSeconds INTEGER NOT NULL DEFAULT 30,
                    intervalMinutes INTEGER NOT NULL DEFAULT 0,
                    maxMessagesPerDay INTEGER NOT NULL DEFAULT 1000,
                    isActive INTEGER NOT NULL DEFAULT 1,
                    updatedAt TEXT NOT NULL,
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            // Migrate existing tables to add minute columns if they don't exist
            this.migrateBulkSettingsTable();

            // Enhanced bulk messages table
            this.db.db.exec(`
                CREATE TABLE IF NOT EXISTS bulk_campaigns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId INTEGER NOT NULL,
                    campaignName TEXT NOT NULL,
                    templateId INTEGER NOT NULL,
                    contactIds TEXT NOT NULL,
                    scheduledAt TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'scheduled',
                    createdAt TEXT NOT NULL,
                    completedAt TEXT,
                    totalMessages INTEGER NOT NULL DEFAULT 0,
                    sentCount INTEGER NOT NULL DEFAULT 0,
                    deliveredCount INTEGER NOT NULL DEFAULT 0,
                    readCount INTEGER NOT NULL DEFAULT 0,
                    failedCount INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (templateId) REFERENCES templates(id) ON DELETE CASCADE
                )
            `);

            // Message logs table with enhanced tracking
            this.db.db.exec(`
                CREATE TABLE IF NOT EXISTS bulk_message_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaignId INTEGER NOT NULL,
                    contactId INTEGER NOT NULL,
                    contactName TEXT NOT NULL,
                    contactSurname TEXT,
                    contactPhone TEXT NOT NULL,
                    templateName TEXT NOT NULL,
                    messageContent TEXT NOT NULL,
                    scheduledAt TEXT NOT NULL,
                    sentAt TEXT,
                    deliveredAt TEXT,
                    readAt TEXT,
                    status TEXT NOT NULL DEFAULT 'scheduled',
                    errorMessage TEXT,
                    messageId TEXT,
                    FOREIGN KEY (campaignId) REFERENCES bulk_campaigns(id) ON DELETE CASCADE,
                    FOREIGN KEY (contactId) REFERENCES contacts(id) ON DELETE CASCADE
                )
            `);

            // Create indexes for performance
            this.db.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_user_id ON bulk_campaigns(userId);
                CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_status ON bulk_campaigns(status);
                CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_scheduled_at ON bulk_campaigns(scheduledAt);
                CREATE INDEX IF NOT EXISTS idx_bulk_message_logs_campaign_id ON bulk_message_logs(campaignId);
                CREATE INDEX IF NOT EXISTS idx_bulk_message_logs_status ON bulk_message_logs(status);
                CREATE INDEX IF NOT EXISTS idx_bulk_message_logs_scheduled_at ON bulk_message_logs(scheduledAt);
                CREATE INDEX IF NOT EXISTS idx_bulk_message_logs_sent_at ON bulk_message_logs(sentAt);
                CREATE INDEX IF NOT EXISTS idx_bulk_message_logs_message_id ON bulk_message_logs(messageId);
            `);

            console.log('[BulkSenderManager] Database tables created successfully');
        } catch (error) {
            console.error('[BulkSenderManager] Error creating tables:', error);
        }
    }

    private setupMessageAckListeners() {
        // Listen for WhatsApp message acknowledgments
        this.whatsappManager.on('message_ack', (messageId: string, ack: number) => {
            this.updateMessageStatus(messageId, ack);
        });
    }

    private async updateMessageStatus(messageId: string, ack: number) {
        try {
            const now = new Date().toISOString();
            let status = 'sent';
            let updateField = 'sentAt';
            
            // Map WhatsApp acknowledgment codes to status
            switch (ack) {
                case 1: // Sent to server
                    status = 'sent';
                    updateField = 'sentAt';
                    break;
                case 2: // Delivered to recipient
                    status = 'delivered';
                    updateField = 'deliveredAt';
                    break;
                case 3: // Read by recipient
                    status = 'read';
                    updateField = 'readAt';
                    break;
                default:
                    return; // Unknown ack code
            }

            // Update message log
            const updateQuery = `
                UPDATE bulk_message_logs 
                SET status = ?, ${updateField} = ?
                WHERE messageId = ?
            `;
            
            const updateLog = this.db.db.prepare(updateQuery);
            const result = updateLog.run(status, now, messageId);
            
            if (result.changes > 0) {
                // Get the message details for campaign update
                const messageLog = this.db.db.prepare(`
                    SELECT id, campaignId FROM bulk_message_logs WHERE messageId = ?
                `).get(messageId) as { id: number; campaignId: number } | undefined;

                if (messageLog) {
                    // Update campaign statistics
                    await this.updateCampaignStats(messageId, status);
                    
                    // Emit real-time update
                    this.emit('message-status-updated', {
                        messageId: messageLog.id,
                        campaignId: messageLog.campaignId,
                        status,
                        timestamp: now,
                        whatsappMessageId: messageId
                    });
                    
                    // Check if campaign is completed
                    await this.checkCampaignCompletion(messageLog.campaignId);
                }
            }
        } catch (error) {
            console.error('[BulkSenderManager] Error updating message status:', error);
        }
    }

    private async updateCampaignStats(messageId: string, status: string) {
        try {
            // Get campaign ID from message
            const messageLog = this.db.db.prepare(`
                SELECT campaignId FROM bulk_message_logs WHERE messageId = ?
            `).get(messageId) as { campaignId: number } | undefined;

            if (!messageLog) return;

            let updateField = '';
            switch (status) {
                case 'sent':
                    updateField = 'sentCount';
                    break;
                case 'delivered':
                    updateField = 'deliveredCount';
                    break;
                case 'read':
                    updateField = 'readCount';
                    break;
                case 'failed':
                    updateField = 'failedCount';
                    break;
                default:
                    return;
            }

            const updateCampaign = this.db.db.prepare(`
                UPDATE bulk_campaigns 
                SET ${updateField} = ${updateField} + 1
                WHERE id = ?
            `);
            
            updateCampaign.run(messageLog.campaignId);
            
            // Emit campaign stats update
            this.emit('campaign-stats-updated', {
                campaignId: messageLog.campaignId,
                status,
                field: updateField
            });
            
        } catch (error) {
            console.error('[BulkSenderManager] Error updating campaign stats:', error);
        }
    }

    private async checkCampaignCompletion(campaignId: number) {
        try {
            const campaign = this.db.db.prepare(`
                SELECT totalMessages, sentCount, failedCount, deliveredCount, readCount, status, campaignName FROM bulk_campaigns WHERE id = ?
            `).get(campaignId) as { totalMessages: number; sentCount: number; failedCount: number; deliveredCount: number; readCount: number; status: string; campaignName: string } | undefined;

            if (!campaign) return;

            // Check if there are any pending messages
            const pendingMessages = this.db.db.prepare(`
                SELECT COUNT(*) as count FROM bulk_message_logs 
                WHERE campaignId = ? AND status = 'scheduled'
            `).get(campaignId) as { count: number };

            const processedMessages = campaign.sentCount + campaign.failedCount;
            
            // Campaign is completed when all messages are processed OR no pending messages remain
            if ((processedMessages >= campaign.totalMessages) || (pendingMessages.count === 0 && campaign.status !== 'completed')) {
                const updateCampaign = this.db.db.prepare(`
                    UPDATE bulk_campaigns 
                    SET status = 'completed', completedAt = ?
                    WHERE id = ?
                `);
                
                updateCampaign.run(new Date().toISOString(), campaignId);
                
                this.emit('campaign-completed', { campaignId, campaignName: campaign.campaignName });
            }
        } catch (error) {
            console.error('[BulkSenderManager] Error checking campaign completion:', error);
        }
    }

    // Bulk Settings Management
    async getBulkSettings(userId: number): Promise<{ success: boolean; settings?: BulkSettings; error?: string }> {
        try {
            const settings = this.db.db.prepare(`
                SELECT * FROM bulk_settings WHERE userId = ? ORDER BY id DESC LIMIT 1
            `).get(userId) as any;

            if (!settings) {
                // Return default settings
                return {
                    success: true,
                    settings: {
                        startHour: 9,
                        startMinute: 0,
                        endHour: 17,
                        endMinute: 0,
                        intervalSeconds: 30,
                        intervalMinutes: 0,
                        maxMessagesPerDay: 1000,
                        isActive: true
                    }
                };
            }

            return {
                success: true,
                settings: {
                    startHour: settings.startHour,
                    startMinute: settings.startMinute || 0,
                    endHour: settings.endHour,
                    endMinute: settings.endMinute || 0,
                    intervalSeconds: settings.intervalSeconds,
                    intervalMinutes: settings.intervalMinutes,
                    maxMessagesPerDay: settings.maxMessagesPerDay,
                    isActive: settings.isActive === 1
                }
            };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error getting bulk settings:', error);
            return { success: false, error: error.message };
        }
    }

    calculateMessagesPerDay(settings: BulkSettings): number {
        // Convert start and end times to minutes for more accurate calculation
        const startTimeMinutes = settings.startHour * 60 + settings.startMinute;
        const endTimeMinutes = settings.endHour * 60 + settings.endMinute;
        
        let workingMinutes: number;
        
        if (startTimeMinutes <= endTimeMinutes) {
            // Same day (e.g., 9:30 AM to 5:45 PM)
            workingMinutes = endTimeMinutes - startTimeMinutes;
        } else {
            // Cross midnight (e.g., 10:30 PM to 6:15 AM)
            workingMinutes = (24 * 60) - startTimeMinutes + endTimeMinutes;
        }
        
        const intervalTotalSeconds = settings.intervalSeconds + (settings.intervalMinutes * 60);
        const messagesPerMinute = 60 / intervalTotalSeconds;
        return Math.floor(messagesPerMinute * workingMinutes);
    }

    // Contact Management for Bulk Sender
    async getContactsBySource(): Promise<{ success: boolean; contactsBySource?: any; error?: string }> {
        try {
            const sourceCounts = this.db.db.prepare(`
                SELECT source, COUNT(*) as count 
                FROM contacts 
                GROUP BY source 
                ORDER BY source
            `).all();

            const contactsBySource: { [key: string]: { count: number } } = {};
            
            sourceCounts.forEach((item: any) => {
                const source = item.source || 'unknown';
                contactsBySource[source] = { count: item.count };
            });

            return { success: true, contactsBySource };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error getting contacts by source:', error);
            return { success: false, error: error.message };
        }
    }

    async getContactsBySourcePaginated(source: string, page: number = 1, limit: number = 100): Promise<{ success: boolean; contacts?: any[]; pagination?: any; error?: string }> {
        try {
            const offset = (page - 1) * limit;
            
            const contacts = this.db.db.prepare(`
                SELECT id, name, surname, phone, email, source 
                FROM contacts 
                WHERE source = ?
                ORDER BY name
                LIMIT ? OFFSET ?
            `).all(source, limit, offset);

            const totalCount = this.db.db.prepare(`
                SELECT COUNT(*) as count FROM contacts WHERE source = ?
            `).get(source) as { count: number };

            const pagination = {
                page,
                limit,
                total: totalCount.count,
                totalPages: Math.ceil(totalCount.count / limit)
            };

            return { success: true, contacts, pagination };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error getting contacts by source paginated:', error);
            return { success: false, error: error.message };
        }
    }

    // Campaign Management
    async createBulkCampaign(userId: number, campaignName: string, templateId: number, contactIds: number[]): Promise<{ success: boolean; campaignId?: number; error?: string }> {
        try {
            // Validate template exists
            const template = this.db.db.prepare(`
                SELECT id, name, content FROM templates WHERE id = ?
            `).get(templateId) as any;

            if (!template) {
                return { success: false, error: 'Template not found' };
            }

            // Validate contacts exist
            const contacts = this.db.db.prepare(`
                SELECT id, name, surname, phone FROM contacts 
                WHERE id IN (${contactIds.map(() => '?').join(',')})
            `).all(...contactIds) as any[];

            if (contacts.length !== contactIds.length) {
                return { success: false, error: 'Some contacts not found' };
            }

            const now = new Date().toISOString();
            
            // Create campaign
            const insertCampaign = this.db.db.prepare(`
                INSERT INTO bulk_campaigns 
                (userId, campaignName, templateId, contactIds, scheduledAt, status, createdAt, totalMessages)
                VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)
            `);

            const result = insertCampaign.run(
                userId,
                campaignName,
                templateId,
                JSON.stringify(contactIds),
                now,
                now,
                contacts.length
            );

            const campaignId = result.lastInsertRowid as number;

            // Create message logs for each contact
            await this.createMessageLogs(campaignId, template, contacts);

            this.emit('campaign-created', { campaignId, campaignName, totalMessages: contacts.length });
            
            return { success: true, campaignId };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error creating bulk campaign:', error);
            return { success: false, error: error.message };
        }
    }

    private async createMessageLogs(campaignId: number, template: any, contacts: any[]) {
        try {
            const insertLog = this.db.db.prepare(`
                INSERT INTO bulk_message_logs 
                (campaignId, contactId, contactName, contactSurname, contactPhone, templateName, messageContent, scheduledAt, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
            `);

            const templateContent = JSON.parse(template.content);
            const now = new Date().toISOString();

            const transaction = this.db.db.transaction((contacts: any[]) => {
                for (const contact of contacts) {
                    // Process template with contact variables
                    const processedContent = this.templateManager.processTemplateWithVariables(
                        { 
                            id: template.id,
                            name: template.name,
                            content: templateContent 
                        },
                        {
                            name: contact.name || '',
                            surname: contact.surname || '',
                            phone: contact.phone || '',
                            email: contact.email || '',
                            birthday: contact.birthday || ''
                        }
                    );

                    insertLog.run(
                        campaignId,
                        contact.id,
                        contact.name || '',
                        contact.surname || '',
                        contact.phone,
                        template.name,
                        processedContent.text,
                        now
                    );
                }
            });

            transaction(contacts);
        } catch (error) {
            console.error('[BulkSenderManager] Error creating message logs:', error);
            throw error;
        }
    }

    async getBulkCampaigns(userId: number, page: number = 1, limit: number = 50): Promise<{ success: boolean; campaigns?: BulkMessage[]; pagination?: any; error?: string }> {
        try {
            const offset = (page - 1) * limit;
            
            const campaigns = this.db.db.prepare(`
                SELECT bc.*, t.name as templateName
                FROM bulk_campaigns bc
                LEFT JOIN templates t ON bc.templateId = t.id
                WHERE bc.userId = ?
                ORDER BY bc.createdAt DESC
                LIMIT ? OFFSET ?
            `).all(userId, limit, offset) as any[];

            const totalCount = this.db.db.prepare(`
                SELECT COUNT(*) as count FROM bulk_campaigns WHERE userId = ?
            `).get(userId) as { count: number };

            const pagination = {
                page,
                limit,
                total: totalCount.count,
                totalPages: Math.ceil(totalCount.count / limit)
            };

            return { success: true, campaigns, pagination };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error getting bulk campaigns:', error);
            return { success: false, error: error.message };
        }
    }

    async getBulkMessages(campaignId: number, page: number = 1, limit: number = 100, statusFilter?: string): Promise<{ success: boolean; messages?: MessageLog[]; pagination?: any; error?: string }> {
        try {
            let whereClause = 'WHERE bml.campaignId = ?';
            let queryParams: any[] = [campaignId];

            // Status filtering based on computed current status
            if (statusFilter && statusFilter !== 'all') {
                switch (statusFilter.toLowerCase()) {
                    case 'scheduled':
                        whereClause += ' AND bml.status = ? AND bml.sentAt IS NULL';
                        queryParams.push('scheduled');
                        break;
                    case 'sent':
                        whereClause += ' AND bml.sentAt IS NOT NULL AND bml.deliveredAt IS NULL AND bml.readAt IS NULL AND bml.status != ?';
                        queryParams.push('failed');
                        break;
                    case 'delivered':
                        whereClause += ' AND bml.deliveredAt IS NOT NULL AND bml.readAt IS NULL';
                        break;
                    case 'read':
                        whereClause += ' AND bml.readAt IS NOT NULL';
                        break;
                    case 'failed':
                        whereClause += ' AND bml.status = ?';
                        queryParams.push('failed');
                        break;
                    case 'cancelled':
                        whereClause += ' AND bml.status = ?';
                        queryParams.push('cancelled');
                        break;
                }
            }

            // Get total count for pagination
            const countQuery = `
                SELECT COUNT(*) as total 
                FROM bulk_message_logs bml 
                ${whereClause}
            `;

            const countResult = this.db.db.prepare(countQuery).get(...queryParams) as { total: number };
            const total = countResult.total;
            const totalPages = Math.ceil(total / limit);

            // Get messages with pagination - add computed current status
            const messagesQuery = `
                SELECT 
                    bml.id,
                    bml.campaignId,
                    bml.contactId,
                    c.name as contactName,
                    c.surname as contactSurname,
                    c.phone as contactPhone,
                    bml.templateName,
                    bml.scheduledAt,
                    bml.sentAt,
                    bml.deliveredAt,
                    bml.readAt,
                    bml.status,
                    bml.errorMessage,
                    CASE 
                        WHEN bml.readAt IS NOT NULL THEN 'read'
                        WHEN bml.deliveredAt IS NOT NULL THEN 'delivered'
                        WHEN bml.sentAt IS NOT NULL AND bml.status != 'failed' THEN 'sent'
                        WHEN bml.status = 'failed' THEN 'failed'
                        WHEN bml.status = 'cancelled' THEN 'cancelled'
                        ELSE 'scheduled'
                    END as currentStatus
                FROM bulk_message_logs bml 
                LEFT JOIN contacts c ON bml.contactId = c.id 
                ${whereClause}
                ORDER BY bml.scheduledAt DESC 
                LIMIT ? OFFSET ?
            `;

            const offset = (page - 1) * limit;
            const messages = this.db.db.prepare(messagesQuery).all(...queryParams, limit, offset) as any[];

            // Update the status field to reflect the current status
            const processedMessages = messages.map(msg => ({
                ...msg,
                status: msg.currentStatus
            }));

            return {
                success: true,
                messages: processedMessages,
                pagination: {
                    page,
                    totalPages,
                    total,
                    limit
                }
            };
        } catch (error) {
            console.error('Error getting bulk messages:', error);
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error occurred' 
            };
        }
    }

    async cancelBulkCampaign(campaignId: number): Promise<{ success: boolean; error?: string }> {
        try {
            const updateCampaign = this.db.db.prepare(`
                UPDATE bulk_campaigns 
                SET status = 'cancelled', completedAt = ?
                WHERE id = ? AND status IN ('scheduled', 'sending')
            `);

            const updateMessages = this.db.db.prepare(`
                UPDATE bulk_message_logs 
                SET status = 'cancelled'
                WHERE campaignId = ? AND status IN ('scheduled')
            `);

            const transaction = this.db.db.transaction(() => {
                updateCampaign.run(new Date().toISOString(), campaignId);
                updateMessages.run(campaignId);
            });

            transaction();

            this.emit('campaign-cancelled', { campaignId });
            return { success: true };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error cancelling campaign:', error);
            return { success: false, error: error.message };
        }
    }

    async cancelCampaignMessages(campaignId: number, messageIds: number[]): Promise<{ success: boolean; error?: string }> {
        try {
            if (messageIds.length === 0) {
                return { success: false, error: 'No messages selected for cancellation' };
            }

            const placeholders = messageIds.map(() => '?').join(',');
            const updateMessages = this.db.db.prepare(`
                UPDATE bulk_message_logs 
                SET status = 'cancelled'
                WHERE id IN (${placeholders}) AND campaignId = ? AND status = 'scheduled'
            `);

            const result = updateMessages.run(...messageIds, campaignId);

            // Delete cancelled messages from database
            if (result.changes > 0) {
                const deleteMessages = this.db.db.prepare(`
                    DELETE FROM bulk_message_logs 
                    WHERE id IN (${placeholders}) AND campaignId = ? AND status = 'cancelled'
                `);
                deleteMessages.run(...messageIds, campaignId);

                // Update campaign total count
                const updateCampaign = this.db.db.prepare(`
                    UPDATE bulk_campaigns 
                    SET totalMessages = totalMessages - ?
                    WHERE id = ?
                `);
                updateCampaign.run(result.changes, campaignId);
            }

            this.emit('messages-cancelled', { campaignId, messageIds });
            return { success: true };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error cancelling messages:', error);
            return { success: false, error: error.message };
        }
    }

    async cancelSingleMessage(messageId: number): Promise<{ success: boolean; error?: string }> {
        try {
            // Update message status to cancelled
            const stmt = this.db.db.prepare(`
                UPDATE bulk_message_logs 
                SET status = 'cancelled', updatedAt = datetime('now')
                WHERE id = ?
            `);
            
            const result = stmt.run(messageId);
            
            if (result.changes > 0) {
                this.emit('messageStatusUpdated', { messageId, status: 'cancelled' });
                return { success: true };
            } else {
                return { success: false, error: 'Message not found' };
            }
        } catch (error) {
            console.error('Error cancelling single message:', error);
            return { success: false, error: 'Failed to cancel message' };
        }
    }

    async getAllScheduledMessageIds(campaignId: number, statusFilter?: string): Promise<{ success: boolean; messageIds?: number[]; error?: string }> {
        try {
            let query = `
                SELECT bml.id
                FROM bulk_message_logs bml
                WHERE bml.campaignId = ?
            `;
            
            const params: any[] = [campaignId];
            
            // Enhanced status filtering - same logic as getBulkMessages
            if (statusFilter && statusFilter !== 'all') {
                switch (statusFilter.toLowerCase()) {
                    case 'scheduled':
                        query += ' AND bml.status = ? AND bml.sentAt IS NULL';
                        params.push('scheduled');
                        break;
                    case 'sent':
                        query += ' AND bml.sentAt IS NOT NULL AND bml.deliveredAt IS NULL AND bml.readAt IS NULL AND bml.status != ?';
                        params.push('failed');
                        break;
                    case 'delivered':
                        query += ' AND bml.deliveredAt IS NOT NULL AND bml.readAt IS NULL';
                        break;
                    case 'read':
                        query += ' AND bml.readAt IS NOT NULL';
                        break;
                    case 'failed':
                        query += ' AND bml.status = ?';
                        params.push('failed');
                        break;
                    case 'cancelled':
                        query += ' AND bml.status = ?';
                        params.push('cancelled');
                        break;
                }
            }
            
            query += ' ORDER BY bml.scheduledAt DESC';
            
            const stmt = this.db.db.prepare(query);
            const results = stmt.all(...params);
            
            const messageIds = results.map((row: any) => row.id);
            
            return {
                success: true,
                messageIds
            };
        } catch (error) {
            console.error('Error getting all scheduled message IDs:', error);
            return { success: false, error: 'Failed to get message IDs' };
        }
    }

    async deleteMessages(messageIds: number[]): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
        try {
            if (messageIds.length === 0) {
                return { success: false, error: 'No messages selected for deletion' };
            }

            const placeholders = messageIds.map(() => '?').join(',');
            const deleteStmt = this.db.db.prepare(`
                DELETE FROM bulk_message_logs 
                WHERE id IN (${placeholders})
            `);

            const result = deleteStmt.run(...messageIds);

            // Update campaign totals
            const updateCampaigns = this.db.db.prepare(`
                UPDATE bulk_campaigns 
                SET totalMessages = (
                    SELECT COUNT(*) FROM bulk_message_logs 
                    WHERE campaignId = bulk_campaigns.id
                )
                WHERE id IN (
                    SELECT DISTINCT campaignId FROM bulk_message_logs 
                    WHERE id IN (${placeholders})
                )
            `);

            this.emit('messages-deleted', { messageIds, deletedCount: result.changes });
            return { success: true, deletedCount: result.changes };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error deleting messages:', error);
            return { success: false, error: error.message };
        }
    }

    async getBulkCampaignsWithFilter(userId: number, page: number = 1, limit: number = 50, nameFilter?: string, statusFilter?: string): Promise<{ success: boolean; campaigns?: BulkMessage[]; pagination?: any; error?: string }> {
        try {
            const offset = (page - 1) * limit;
            
            let whereClause = 'WHERE bc.userId = ?';
            let params: any[] = [userId];
            
            if (nameFilter && nameFilter.trim()) {
                whereClause += ' AND bc.campaignName LIKE ?';
                params.push(`%${nameFilter.trim()}%`);
            }
            
            if (statusFilter && statusFilter !== 'all') {
                whereClause += ' AND bc.status = ?';
                params.push(statusFilter);
            }
            
            const campaigns = this.db.db.prepare(`
                SELECT bc.*, t.name as templateName
                FROM bulk_campaigns bc
                LEFT JOIN templates t ON bc.templateId = t.id
                ${whereClause}
                ORDER BY bc.createdAt DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset) as any[];

            const totalCount = this.db.db.prepare(`
                SELECT COUNT(*) as count FROM bulk_campaigns bc ${whereClause}
            `).get(...params) as { count: number };

            const pagination = {
                page,
                limit,
                total: totalCount.count,
                totalPages: Math.ceil(totalCount.count / limit)
            };

            return { success: true, campaigns, pagination };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error getting filtered campaigns:', error);
            return { success: false, error: error.message };
        }
    }

    // Statistics
    async getBulkStatistics(): Promise<{ success: boolean; statistics?: BulkStatistics; error?: string }> {
        try {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekStart = new Date(today.getTime() - (today.getDay() * 24 * 60 * 60 * 1000));
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const yearStart = new Date(now.getFullYear(), 0, 1);

            // Get overall status counts using computed current status
            const statusCounts = this.db.db.prepare(`
                SELECT 
                    COUNT(CASE WHEN readAt IS NOT NULL THEN 1 END) as read,
                    COUNT(CASE WHEN deliveredAt IS NOT NULL AND readAt IS NULL THEN 1 END) as delivered,
                    COUNT(CASE WHEN sentAt IS NOT NULL AND deliveredAt IS NULL AND readAt IS NULL AND status != 'failed' THEN 1 END) as sent,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
                    COUNT(CASE WHEN status = 'scheduled' AND sentAt IS NULL THEN 1 END) as scheduled,
                    COUNT(*) as total
                FROM bulk_message_logs
            `).get() as any;

            // Calculate percentages
            const total = statusCounts.total || 1; // Avoid division by zero
            const statusPercentages = {
                scheduled: Math.round((statusCounts.scheduled / total) * 100),
                sent: Math.round((statusCounts.sent / total) * 100),
                delivered: Math.round((statusCounts.delivered / total) * 100),
                read: Math.round((statusCounts.read / total) * 100),
                failed: Math.round((statusCounts.failed / total) * 100),
                cancelled: Math.round((statusCounts.cancelled / total) * 100)
            };

            // Get daily statistics for the last 30 days
            const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
            const dailyStatsQuery = this.db.db.prepare(`
                SELECT 
                    DATE(scheduledAt) as date,
                    COUNT(CASE WHEN readAt IS NOT NULL THEN 1 END) as read,
                    COUNT(CASE WHEN deliveredAt IS NOT NULL AND readAt IS NULL THEN 1 END) as delivered,
                    COUNT(CASE WHEN sentAt IS NOT NULL AND deliveredAt IS NULL AND readAt IS NULL AND status != 'failed' THEN 1 END) as sent,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
                    COUNT(CASE WHEN status = 'scheduled' AND sentAt IS NULL THEN 1 END) as scheduled
                FROM bulk_message_logs 
                WHERE scheduledAt >= ?
                GROUP BY DATE(scheduledAt)
                ORDER BY date DESC
            `);

            const dailyStatsRows = dailyStatsQuery.all(thirtyDaysAgo.toISOString()) as any[];
            const dailyStats: { [date: string]: any } = {};
            
            dailyStatsRows.forEach(row => {
                dailyStats[row.date] = {
                    scheduled: row.scheduled,
                    sent: row.sent,
                    delivered: row.delivered,
                    read: row.read,
                    failed: row.failed,
                    cancelled: row.cancelled
                };
            });

            // Legacy period stats for backward compatibility
            const getStatsForPeriod = (startDate: Date) => {
                return this.db.db.prepare(`
                    SELECT 
                        COUNT(CASE WHEN sentAt IS NOT NULL AND deliveredAt IS NULL AND readAt IS NULL AND status != 'failed' THEN 1 END) as sent,
                        COUNT(CASE WHEN deliveredAt IS NOT NULL AND readAt IS NULL THEN 1 END) as delivered,
                        COUNT(CASE WHEN readAt IS NOT NULL THEN 1 END) as read,
                        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
                    FROM bulk_message_logs 
                    WHERE sentAt >= ?
                `).get(startDate.toISOString()) as any;
            };

            const todayStats = getStatsForPeriod(today);
            const weekStats = getStatsForPeriod(weekStart);
            const monthStats = getStatsForPeriod(monthStart);
            const yearStats = getStatsForPeriod(yearStart);

            const campaignStats = this.db.db.prepare(`
                SELECT 
                    COUNT(*) as totalCampaigns,
                    COUNT(CASE WHEN status IN ('scheduled', 'sending') THEN 1 END) as activeCampaigns
                FROM bulk_campaigns
            `).get() as any;

            const statistics: BulkStatistics = {
                total: statusCounts.total,
                statusCounts: {
                    scheduled: statusCounts.scheduled,
                    sent: statusCounts.sent,
                    delivered: statusCounts.delivered,
                    read: statusCounts.read,
                    failed: statusCounts.failed,
                    cancelled: statusCounts.cancelled
                },
                statusPercentages,
                dailyStats,
                today: todayStats,
                week: weekStats,
                month: monthStats,
                year: yearStats,
                totalCampaigns: campaignStats.totalCampaigns,
                activeCampaigns: campaignStats.activeCampaigns
            };

            return { success: true, statistics };
        } catch (error: any) {
            console.error('[BulkSenderManager] Error getting bulk statistics:', error);
            return { success: false, error: error.message };
        }
    }

    private async initializeDefaultSettings() {
        try {
            const existingSettings = this.db.db.prepare(`
                SELECT COUNT(*) as count FROM bulk_settings
            `).get() as { count: number };

            if (existingSettings.count === 0) {
                // Create default settings for user ID 1 (will be updated when user logs in)
                await this.saveBulkSettings(1, {
                    startHour: 9,
                    startMinute: 0,
                    endHour: 17,
                    endMinute: 0,
                    intervalSeconds: 30,
                    intervalMinutes: 0,
                    maxMessagesPerDay: 1000,
                    isActive: true
                });
            }
        } catch (error) {
            console.error('[BulkSenderManager] Error initializing default settings:', error);
        }
    }

    // Cleanup
    destroy() {
        console.log('[BulkSender] Destroying bulk sender manager...');
        
        // Stop all scheduled tasks
        this.stopAllScheduledTasks();
        
        // Clear old interval if it exists
        if (this.sendingInterval) {
            clearInterval(this.sendingInterval);
            this.sendingInterval = null;
        }
        
        this.removeAllListeners();
        console.log('[BulkSender] Bulk sender manager destroyed');
    }

    async deleteCampaigns(campaignIds: number[]): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
        try {
            if (!campaignIds || campaignIds.length === 0) {
                return { success: false, error: 'No campaign IDs provided' };
            }

            const placeholders = campaignIds.map(() => '?').join(',');
            
            // First, delete all related message logs
            const deleteMessageLogs = this.db.db.prepare(`
                DELETE FROM bulk_message_logs 
                WHERE campaignId IN (${placeholders})
            `);
            deleteMessageLogs.run(...campaignIds);

            // Then delete the campaigns
            const deleteCampaigns = this.db.db.prepare(`
                DELETE FROM bulk_campaigns 
                WHERE id IN (${placeholders})
            `);
            const result = deleteCampaigns.run(...campaignIds);

            this.emit('campaigns-deleted', { campaignIds, deletedCount: result.changes });

            return { 
                success: true, 
                deletedCount: result.changes 
            };
        } catch (error) {
            console.error('[BulkSenderManager] Error deleting campaigns:', error);
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error occurred' 
            };
        }
    }

    async getCampaignCounts(userId: number, nameFilter?: string): Promise<{ success: boolean; counts?: any; error?: string }> {
        try {
            let whereClause = 'WHERE userId = ?';
            let queryParams: any[] = [userId];

            if (nameFilter && nameFilter.trim()) {
                whereClause += ' AND campaignName LIKE ?';
                queryParams.push(`%${nameFilter.trim()}%`);
            }

            const countsQuery = `
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'scheduled' THEN 1 END) as scheduled,
                    COUNT(CASE WHEN status = 'sending' THEN 1 END) as sending,
                    COUNT(CASE WHEN status = 'paused' THEN 1 END) as paused,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled
                FROM bulk_campaigns
                ${whereClause}
            `;

            const counts = this.db.db.prepare(countsQuery).get(...queryParams);

            return {
                success: true,
                counts
            };
        } catch (error) {
            console.error('Error getting campaign counts:', error);
            return { success: false, error: 'Failed to get campaign counts' };
        }
    }

    async getMessageCounts(campaignId: number): Promise<{ success: boolean; counts?: any; error?: string }> {
        try {
            const countsQuery = `
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'scheduled' AND sentAt IS NULL THEN 1 END) as scheduled,
                    COUNT(CASE WHEN sentAt IS NOT NULL AND deliveredAt IS NULL AND readAt IS NULL AND status != 'failed' THEN 1 END) as sent,
                    COUNT(CASE WHEN deliveredAt IS NOT NULL AND readAt IS NULL THEN 1 END) as delivered,
                    COUNT(CASE WHEN readAt IS NOT NULL THEN 1 END) as read,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled
                FROM bulk_message_logs
                WHERE campaignId = ?
            `;

            const counts = this.db.db.prepare(countsQuery).get(campaignId);

            return {
                success: true,
                counts
            };
        } catch (error) {
            console.error('Error getting message counts:', error);
            return { success: false, error: 'Failed to get message counts' };
        }
    }

    // New function to get all messages across all campaigns
    async getAllBulkMessages(userId: number, page: number = 1, limit: number = 100, statusFilter?: string, campaignFilter?: string): Promise<{ success: boolean; messages?: any[]; pagination?: any; error?: string }> {
        try {
            let whereClause = 'WHERE bc.userId = ?';
            let queryParams: any[] = [userId];

            // Enhanced status filtering based on computed current status
            if (statusFilter && statusFilter !== 'all') {
                switch (statusFilter.toLowerCase()) {
                    case 'scheduled':
                        whereClause += ' AND bml.status = ? AND bml.sentAt IS NULL';
                        queryParams.push('scheduled');
                        break;
                    case 'sent':
                        whereClause += ' AND bml.sentAt IS NOT NULL AND bml.deliveredAt IS NULL AND bml.readAt IS NULL AND bml.status != ?';
                        queryParams.push('failed');
                        break;
                    case 'delivered':
                        whereClause += ' AND bml.deliveredAt IS NOT NULL AND bml.readAt IS NULL';
                        break;
                    case 'read':
                        whereClause += ' AND bml.readAt IS NOT NULL';
                        break;
                    case 'failed':
                        whereClause += ' AND bml.status = ?';
                        queryParams.push('failed');
                        break;
                    case 'cancelled':
                        whereClause += ' AND bml.status = ?';
                        queryParams.push('cancelled');
                        break;
                }
            }

            // Filter by campaign if specified
            if (campaignFilter && campaignFilter !== 'all') {
                whereClause += ' AND bc.campaignName LIKE ?';
                queryParams.push(`%${campaignFilter}%`);
            }

            // Get total count for pagination
            const countQuery = `
                SELECT COUNT(*) as total 
                FROM bulk_message_logs bml 
                LEFT JOIN bulk_campaigns bc ON bml.campaignId = bc.id
                ${whereClause}
            `;

            const countResult = this.db.db.prepare(countQuery).get(...queryParams) as { total: number };
            const total = countResult.total;
            const totalPages = Math.ceil(total / limit);

            // Get messages with campaign info and computed status
            const messagesQuery = `
                SELECT 
                    bml.id,
                    bml.campaignId,
                    bc.campaignName,
                    bml.contactId,
                    c.name as contactName,
                    c.surname as contactSurname,
                    c.phone as contactPhone,
                    bml.templateName,
                    bml.scheduledAt,
                    bml.sentAt,
                    bml.deliveredAt,
                    bml.readAt,
                    bml.status,
                    bml.errorMessage,
                    CASE 
                        WHEN bml.readAt IS NOT NULL THEN 'read'
                        WHEN bml.deliveredAt IS NOT NULL THEN 'delivered'
                        WHEN bml.sentAt IS NOT NULL AND bml.status != 'failed' THEN 'sent'
                        WHEN bml.status = 'failed' THEN 'failed'
                        WHEN bml.status = 'cancelled' THEN 'cancelled'
                        ELSE 'scheduled'
                    END as currentStatus
                FROM bulk_message_logs bml 
                LEFT JOIN contacts c ON bml.contactId = c.id 
                LEFT JOIN bulk_campaigns bc ON bml.campaignId = bc.id
                ${whereClause}
                ORDER BY bml.scheduledAt DESC 
                LIMIT ? OFFSET ?
            `;

            const offset = (page - 1) * limit;
            const messages = this.db.db.prepare(messagesQuery).all(...queryParams, limit, offset) as any[];

            // Update the status field to reflect the current status
            const processedMessages = messages.map(msg => ({
                ...msg,
                status: msg.currentStatus
            }));

            return {
                success: true,
                messages: processedMessages,
                pagination: {
                    page,
                    totalPages,
                    total,
                    limit
                }
            };
        } catch (error) {
            console.error('Error getting all bulk messages:', error);
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error occurred' 
            };
        }
    }

    // New function to get all message counts across campaigns
    async getAllMessageCounts(userId: number, campaignFilter?: string): Promise<{ success: boolean; counts?: any; error?: string }> {
        try {
            let whereClause = 'WHERE bc.userId = ?';
            let queryParams: any[] = [userId];

            if (campaignFilter && campaignFilter !== 'all') {
                whereClause += ' AND bc.campaignName LIKE ?';
                queryParams.push(`%${campaignFilter}%`);
            }

            const countsQuery = `
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN bml.status = 'scheduled' AND bml.sentAt IS NULL THEN 1 END) as scheduled,
                    COUNT(CASE WHEN bml.sentAt IS NOT NULL AND bml.deliveredAt IS NULL AND bml.readAt IS NULL AND bml.status != 'failed' THEN 1 END) as sent,
                    COUNT(CASE WHEN bml.deliveredAt IS NOT NULL AND bml.readAt IS NULL THEN 1 END) as delivered,
                    COUNT(CASE WHEN bml.readAt IS NOT NULL THEN 1 END) as read,
                    COUNT(CASE WHEN bml.status = 'failed' THEN 1 END) as failed,
                    COUNT(CASE WHEN bml.status = 'cancelled' THEN 1 END) as cancelled
                FROM bulk_message_logs bml
                LEFT JOIN bulk_campaigns bc ON bml.campaignId = bc.id
                ${whereClause}
            `;

            const counts = this.db.db.prepare(countsQuery).get(...queryParams);

            return {
                success: true,
                counts
            };
        } catch (error) {
            console.error('Error getting all message counts:', error);
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error occurred' 
            };
        }
    }
} 