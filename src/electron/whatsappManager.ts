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
    async sendMessage(to: string, message: string): Promise<boolean> {
        if (!this.client || !this.client.info) {
            throw new Error('WhatsApp client not ready');
        }

        try {
            await this.client.sendMessage(to, message);
            return true;
        } catch (error) {
            console.error('Failed to send message:', error);
            return false;
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
                await this.client.sendMessage(contact, message);
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