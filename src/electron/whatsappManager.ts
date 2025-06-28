import WhatsAppWebJS from 'whatsapp-web.js';
import QRCode from 'qrcode';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import fsSyc from 'fs';
import os from 'os';

const { Client, LocalAuth, Events } = WhatsAppWebJS;

interface SessionInfo {
    name: string;
    phoneNumber: string;
    profilePicUrl?: string;
    platform: string;
    connectedAt: Date;
    sessionDuration: string;
}

export class WhatsAppManager extends EventEmitter {
    private client: any = null;
    private qrString: string | null = null;
    private sessionInfo: SessionInfo | null = null;
    private connectedAt: Date | null = null;
    private currentUsername: string | null = null;
    private isInitializing: boolean = false;
    private isDestroying: boolean = false;

    constructor() {
        super();
        // Increase max listeners to prevent memory leak warnings
        this.setMaxListeners(100000);
        this.cleanupOrphanedSessions();
    }

    private async cleanupOrphanedSessions(): Promise<void> {
        try {
            console.log('[WhatsApp] Cleaning up orphaned sessions on startup...');
            const desktopPath = path.join(os.homedir(), 'Desktop');
            const sessionsDir = path.join(desktopPath, 'WhatsAppSessions');
            
            // Only clean if sessions directory exists
            if (!fsSyc.existsSync(sessionsDir)) {
                console.log('[WhatsApp] No sessions directory found, nothing to clean');
                return;
            }
            
            // Clean up any .wwebjs_cache folders that might be left behind
            const cacheDir = path.join(process.cwd(), '.wwebjs_cache');
            if (fsSyc.existsSync(cacheDir)) {
                await fs.rm(cacheDir, { recursive: true, force: true });
                console.log('[WhatsApp] Cleaned up .wwebjs_cache folder');
            }
            
            console.log('[WhatsApp] Orphaned sessions cleanup completed');
        } catch (error) {
            console.error('[WhatsApp] Failed to cleanup orphaned sessions:', error);
        }
    }

    async initialize(username: string): Promise<boolean> {
        try {
            // Prevent duplicate initialization
            if (this.isInitializing) {
                console.log('[WhatsApp] Already initializing, skipping duplicate request');
                return false;
            }

            // Check if already connected for this user
            if (this.client && this.currentUsername === username && !this.isDestroying) {
                console.log('[WhatsApp] Already connected for this user, skipping initialization');
                return true;
            }

            this.isInitializing = true;
            console.log(`[WhatsApp] Initializing WhatsApp for user: ${username}`);
            
            // Clean up existing client if it exists
            if (this.client && !this.isDestroying) {
                console.log('[WhatsApp] Cleaning up existing client before new initialization');
                await this.destroy();
            }

            this.currentUsername = username;
            
            const sessionPath = await this.getSessionPath(username);
            const sessionExists = fsSyc.existsSync(sessionPath);
            
            console.log(`[WhatsApp] Session path: ${sessionPath}`);
            console.log(`[WhatsApp] Session exists: ${sessionExists}`);

            // Ensure session directory exists
            await fs.mkdir(sessionPath, { recursive: true });

            this.client = new Client({
                authStrategy: new LocalAuth({
                    clientId: username,
                    dataPath: sessionPath
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu'
                    ]
                }
            });

            this.setupEventHandlers();
            
            console.log('[WhatsApp] Starting client initialization...');
            await this.client.initialize();
            
            return true;
        } catch (error) {
            console.error('[WhatsApp] Failed to initialize:', error);
            // Reset states on error
            this.client = null;
            this.qrString = null;
            this.sessionInfo = null;
            this.connectedAt = null;
            return false;
        } finally {
            this.isInitializing = false;
        }
    }

    private setupEventHandlers() {
        if (!this.client) return;

        this.client.on('qr', (qr: string) => {
            console.log('[WhatsApp] QR Code generated - scan with your phone');
            this.qrString = qr;
            this.emit('qr', qr);
        });

        this.client.on('authenticated', async () => {
            console.log('[WhatsApp] Authentication successful - session saved');
            this.emit('authenticated');
        });

        this.client.on('auth_failure', (msg: string) => {
            console.error('[WhatsApp] Authentication failed:', msg);
            this.qrString = null;
            this.sessionInfo = null;
            this.emit('auth_failure', msg);
        });

        this.client.on('ready', async () => {
            console.log('[WhatsApp] Client is ready and connected');
            this.connectedAt = new Date();
            
            try {
                await this.extractSessionInfo();
                console.log('[WhatsApp] Session info extracted:', this.sessionInfo);
                this.emit('ready', this.sessionInfo);
            } catch (error) {
                console.error('[WhatsApp] Failed to extract session info:', error);
            }
        });

        this.client.on('disconnected', (reason: string) => {
            console.log(`[WhatsApp] Client disconnected. Reason: ${reason}`);
            this.qrString = null;
            this.sessionInfo = null;
            this.connectedAt = null;
            this.emit('disconnected', reason);
        });

        // Set up global message acknowledgment listener
        this.client.on('message_ack', (msg: any, ack: number) => {
            console.log(`[WhatsApp] 📨 Global message ack received: messageId=${msg.id._serialized}, ack=${ack}`);
            this.emit('message_ack', msg.id._serialized, ack);
        });
    }

    private async extractSessionInfo() {
        if (!this.client) return;

        try {
            console.log('[WhatsApp] Extracting session information...');
            
            const clientInfo = this.client.info;
            console.log('[WhatsApp] Raw client info:', clientInfo);
            
            // Get profile picture
            let profilePicUrl = '';
            try {
                profilePicUrl = await this.client.getProfilePicUrl(clientInfo.wid._serialized);
                console.log('[WhatsApp] Profile picture URL retrieved');
            } catch (error) {
                console.log('[WhatsApp] No profile picture available');
            }

            this.sessionInfo = {
                name: clientInfo.pushname || 'Unknown',
                phoneNumber: clientInfo.wid.user || 'Unknown',
                profilePicUrl,
                platform: clientInfo.platform || 'Unknown',
                connectedAt: this.connectedAt || new Date(),
                sessionDuration: this.getSessionDuration()
            };

            console.log('[WhatsApp] Session info created:', {
                name: this.sessionInfo.name,
                phoneNumber: this.sessionInfo.phoneNumber,
                platform: this.sessionInfo.platform,
                hasProfilePic: !!profilePicUrl,
                connectedAt: this.sessionInfo.connectedAt,
                duration: this.sessionInfo.sessionDuration
            });

            // Save to auth manager
            if (this.currentUsername) {
                console.log('[WhatsApp] Saving session to database...');
                const { AuthManager } = await import('./authManager.js');
                const authManager = new AuthManager();
                authManager.saveWhatsAppSession(this.currentUsername, {
                    phoneNumber: this.sessionInfo.phoneNumber,
                    name: this.sessionInfo.name,
                    platform: this.sessionInfo.platform,
                    profilePicUrl
                });
                console.log('[WhatsApp] Session saved to database');
            }
        } catch (error) {
            console.error('[WhatsApp] Error extracting session info:', error);
        }
    }

    private getSessionDuration(): string {
        if (!this.connectedAt) return '0m';
        
        const now = new Date();
        const diffMs = now.getTime() - this.connectedAt.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffDays > 0) {
            return `${diffDays}d ${diffHours % 24}h`;
        } else if (diffHours > 0) {
            return `${diffHours}h ${diffMins % 60}m`;
        } else {
            return `${diffMins}m`;
        }
    }

    async getQRCode(): Promise<string | null> {
        if (!this.qrString) return null;
        
        try {
            const qrCodeDataURL = await QRCode.toDataURL(this.qrString, {
                width: 256,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            });
            return qrCodeDataURL;
        } catch (error) {
            console.error('Failed to generate QR code:', error);
            return null;
        }
    }

    getStatus(): { connected: boolean; sessionInfo: SessionInfo | null } {
        return {
            connected: this.client?.info ? true : false,
            sessionInfo: this.sessionInfo
        };
    }

    getSessionInfo(): SessionInfo | null {
        if (this.sessionInfo && this.connectedAt) {
            return {
                ...this.sessionInfo,
                sessionDuration: this.getSessionDuration()
            };
        }
        return this.sessionInfo;
    }

    async logout(): Promise<boolean> {
        try {
            console.log('[WhatsApp] Logging out and deleting session...');
            
            if (this.client) {
                console.log('[WhatsApp] Destroying client connection...');
                try {
                    await this.client.destroy();
                } catch (error: any) {
                    console.log('[WhatsApp] Client destroy error (expected):', error.message);
                }
                this.client = null;
            }

            // Delete ALL session files for this user
            if (this.currentUsername) {
                await this.cleanupAllUserSessions(this.currentUsername);

                // Deactivate session in database
                console.log('[WhatsApp] Deactivating session in database...');
                const { AuthManager } = await import('./authManager.js');
                const authManager = new AuthManager();
                authManager.deactivateWhatsAppSession(this.currentUsername);
                console.log('[WhatsApp] Session deactivated in database');
            }

            // Reset state
            this.qrString = null;
            this.sessionInfo = null;
            this.connectedAt = null;
            this.currentUsername = null;

            console.log('[WhatsApp] Logout completed successfully');
            return true;
        } catch (error) {
            console.error('[WhatsApp] Logout failed:', error);
            return false;
        }
    }

    private async cleanupAllUserSessions(username: string): Promise<void> {
        try {
            console.log(`[WhatsApp] Cleaning up all sessions for user: ${username}`);
            
            // Clean up WhatsAppSessions folder
            const desktopPath = path.join(os.homedir(), 'Desktop');
            const sessionsDir = path.join(desktopPath, 'WhatsAppSessions');
            const userSessionDir = path.join(sessionsDir, username.replace(/[^a-zA-Z0-9]/g, '_'));
            
            if (fsSyc.existsSync(userSessionDir)) {
                await fs.rm(userSessionDir, { recursive: true, force: true });
                console.log('[WhatsApp] WhatsAppSessions folder cleaned');
            }
            
            // Also clean up any .wwebjs_auth folders that might exist
            const authDir = path.join(sessionsDir, '.wwebjs_auth');
            if (fsSyc.existsSync(authDir)) {
                const authUserDir = path.join(authDir, `session-${username}`);
                if (fsSyc.existsSync(authUserDir)) {
                    await fs.rm(authUserDir, { recursive: true, force: true });
                    console.log('[WhatsApp] .wwebjs_auth folder cleaned');
                }
            }
            
            // Clean up any other potential session folders
            if (fsSyc.existsSync(sessionsDir)) {
                const files = await fs.readdir(sessionsDir);
                for (const file of files) {
                    if (file.includes(username) || file.includes(username.replace(/[^a-zA-Z0-9]/g, '_'))) {
                        const filePath = path.join(sessionsDir, file);
                        const stat = await fs.stat(filePath);
                        if (stat.isDirectory()) {
                            await fs.rm(filePath, { recursive: true, force: true });
                            console.log(`[WhatsApp] Cleaned up session folder: ${file}`);
                        }
                    }
                }
            }
            
            console.log('[WhatsApp] All session files cleaned successfully');
        } catch (error) {
            console.error('[WhatsApp] Failed to cleanup sessions:', error);
        }
    }

    async destroy(): Promise<boolean> {
        try {
            if (this.isDestroying) {
                console.log('[WhatsApp] Already destroying, skipping duplicate request');
                return true;
            }

            this.isDestroying = true;
            console.log('[WhatsApp] Destroying WhatsApp client...');
            
            if (this.client) {
                try {
                    await this.client.destroy();
                } catch (error: any) {
                    console.log('[WhatsApp] Client destroy error (expected if already destroyed):', error.message);
                }
                this.client = null;
                console.log('[WhatsApp] Client destroyed successfully');
            } else {
                console.log('[WhatsApp] No client to destroy');
            }

            // Reset state
            this.qrString = null;
            this.sessionInfo = null;
            this.connectedAt = null;

            console.log('[WhatsApp] Destroy completed');
            return true;
        } catch (error) {
            console.error('[WhatsApp] Failed to destroy client:', error);
            return false;
        } finally {
            this.isDestroying = false;
        }
    }

    private async getSessionPath(username: string): Promise<string> {
        const desktopPath = path.join(os.homedir(), 'Desktop');
        const sessionsDir = path.join(desktopPath, 'WhatsAppSessions');
        const userSessionDir = path.join(sessionsDir, username.replace(/[^a-zA-Z0-9]/g, '_'));
        
        return userSessionDir;
    }

    // Bulk messaging methods (for future implementation)
    async sendMessage(to: string, message: string): Promise<string | null> {
        if (!this.client || !this.client.info) {
            throw new Error('WhatsApp client not ready');
        }

        try {
            const sentMessage = await this.client.sendMessage(to, message);
            console.log(`[WhatsApp] 📤 Full message object:`, JSON.stringify(sentMessage, null, 2));
            
            // Extract message ID with comprehensive fallback methods
            let messageId = null;
            if (sentMessage) {
                // Try multiple ways to get the ID
                if (sentMessage.id) {
                    if (typeof sentMessage.id === 'string') {
                        messageId = sentMessage.id;
                    } else if (sentMessage.id._serialized) {
                        messageId = sentMessage.id._serialized;
                    } else if (sentMessage.id.id) {
                        messageId = sentMessage.id.id;
                    }
                } else if (sentMessage._data && sentMessage._data.id) {
                    if (typeof sentMessage._data.id === 'string') {
                        messageId = sentMessage._data.id;
                    } else if (sentMessage._data.id._serialized) {
                        messageId = sentMessage._data.id._serialized;
                    }
                } else if (sentMessage.rawData && sentMessage.rawData.id) {
                    messageId = sentMessage.rawData.id._serialized || sentMessage.rawData.id;
                }
                
                // If still no ID, generate one from timestamp and recipient
                if (!messageId) {
                    const timestamp = Date.now();
                    messageId = `${to}_${timestamp}_text`;
                    console.log(`[WhatsApp] 🔧 Generated fallback ID: ${messageId}`);
                }
            }
            
            if (messageId) {
                console.log(`[WhatsApp] ✅ Message sent with ID: ${messageId}`);
            } else {
                console.log(`[WhatsApp] ⚠️ Failed to extract message ID from response`);
            }
            
            return messageId;
        } catch (error) {
            console.error('Failed to send message:', error);
            throw error;
        }
    }

    async sendMessageWithMedia(to: string, message: string, mediaUrls: string[]): Promise<string | null> {
        if (!this.client || !this.client.info) {
            throw new Error('WhatsApp client not ready');
        }

        try {
            // Import MessageMedia from whatsapp-web.js
            const whatsappWebJs = await import('whatsapp-web.js');
            const MessageMedia = whatsappWebJs.default.MessageMedia;
            
            let lastMessageId = null;

            // Send each media file with caption (text message)
            for (const mediaUrl of mediaUrls) {
                try {
                    let media;
                    
                    // Check if it's a base64 image
                    if (mediaUrl.startsWith('data:image/')) {
                        // Extract base64 data and mime type
                        const [mimeInfo, base64Data] = mediaUrl.split(',');
                        const mimeType = mimeInfo.split(':')[1].split(';')[0];
                        
                        media = new MessageMedia(mimeType, base64Data);
                    } else if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
                        // Handle URL images
                        media = await MessageMedia.fromUrl(mediaUrl);
                    } else {
                        // Handle local file paths
                        const fs = await import('fs');
                        const path = await import('path');
                        
                        if (fs.existsSync(mediaUrl)) {
                            const fileData = fs.readFileSync(mediaUrl, { encoding: 'base64' });
                            const ext = path.extname(mediaUrl).toLowerCase();
                            let mimeType = 'image/jpeg'; // default
                            
                            if (ext === '.png') mimeType = 'image/png';
                            else if (ext === '.gif') mimeType = 'image/gif';
                            else if (ext === '.webp') mimeType = 'image/webp';
                            
                            media = new MessageMedia(mimeType, fileData);
                        } else {
                            console.error(`File not found: ${mediaUrl}`);
                            continue;
                        }
                    }
                    
                    // Send media with caption (text message)
                    const options: any = {};
                    if (message && message.trim()) {
                        options.caption = message;
                    }
                    
                    // Wait for the message to be sent and get the actual message object
                    const mediaMessage = await this.client.sendMessage(to, media, options);
                    console.log(`[WhatsApp] 📤 Full media message object:`, JSON.stringify(mediaMessage, null, 2));
                    
                    // Extract message ID from the actual message object
                    if (mediaMessage) {
                        // Try multiple ways to get the ID
                        if (mediaMessage.id) {
                            if (typeof mediaMessage.id === 'string') {
                                lastMessageId = mediaMessage.id;
                            } else if (mediaMessage.id._serialized) {
                                lastMessageId = mediaMessage.id._serialized;
                            } else if (mediaMessage.id.id) {
                                lastMessageId = mediaMessage.id.id;
                            }
                        } else if (mediaMessage._data && mediaMessage._data.id) {
                            if (typeof mediaMessage._data.id === 'string') {
                                lastMessageId = mediaMessage._data.id;
                            } else if (mediaMessage._data.id._serialized) {
                                lastMessageId = mediaMessage._data.id._serialized;
                            }
                        } else if (mediaMessage.rawData && mediaMessage.rawData.id) {
                            lastMessageId = mediaMessage.rawData.id._serialized || mediaMessage.rawData.id;
                        }
                        
                        // If still no ID, try to generate one from timestamp and recipient
                        if (!lastMessageId) {
                            const timestamp = Date.now();
                            lastMessageId = `${to}_${timestamp}_media`;
                            console.log(`[WhatsApp] 🔧 Generated fallback ID: ${lastMessageId}`);
                        }
                    }
                    
                    if (lastMessageId) {
                        console.log(`[WhatsApp] ✅ Media message sent with ID: ${lastMessageId}`);
                    } else {
                        console.log(`[WhatsApp] ⚠️ Failed to extract media message ID`);
                    }
                    
                    // Only send caption with first image to avoid duplicate text
                    message = '';
                } catch (mediaError) {
                    console.error(`Failed to send media ${mediaUrl}:`, mediaError);
                    throw mediaError;
                }
            }
            
            // If no media but text exists, send text only
            if (!lastMessageId && message && message.trim()) {
                const textMessage = await this.client.sendMessage(to, message);
                console.log(`[WhatsApp] 📤 Full text message object:`, JSON.stringify(textMessage, null, 2));
                
                if (textMessage) {
                    // Try multiple ways to get the ID
                    if (textMessage.id) {
                        if (typeof textMessage.id === 'string') {
                            lastMessageId = textMessage.id;
                        } else if (textMessage.id._serialized) {
                            lastMessageId = textMessage.id._serialized;
                        } else if (textMessage.id.id) {
                            lastMessageId = textMessage.id.id;
                        }
                    } else if (textMessage._data && textMessage._data.id) {
                        if (typeof textMessage._data.id === 'string') {
                            lastMessageId = textMessage._data.id;
                        } else if (textMessage._data.id._serialized) {
                            lastMessageId = textMessage._data.id._serialized;
                        }
                    } else if (textMessage.rawData && textMessage.rawData.id) {
                        lastMessageId = textMessage.rawData.id._serialized || textMessage.rawData.id;
                    }
                    
                    // If still no ID, generate one
                    if (!lastMessageId) {
                        const timestamp = Date.now();
                        lastMessageId = `${to}_${timestamp}_text`;
                        console.log(`[WhatsApp] 🔧 Generated fallback ID: ${lastMessageId}`);
                    }
                }
                
                if (lastMessageId) {
                    console.log(`[WhatsApp] ✅ Text message sent with ID: ${lastMessageId}`);
                } else {
                    console.log(`[WhatsApp] ⚠️ Failed to extract text message ID`);
                }
            }
            
            return lastMessageId;
        } catch (error) {
            console.error('Failed to send message with media:', error);
            throw error;
        }
    }

    async sendBulkMessages(contacts: string[], message: string, delay: number = 1000): Promise<{ success: number; failed: number }> {
        if (!this.client || !this.client.info) {
            throw new Error('WhatsApp client not ready');
        }

        let success = 0;
        let failed = 0;

        for (const contact of contacts) {
            try {
                await this.sendMessage(contact, message);
                success++;
                
                // Add delay between messages to avoid rate limiting
                if (delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                console.error(`Failed to send message to ${contact}:`, error);
                failed++;
            }
        }

        return { success, failed };
    }
} 