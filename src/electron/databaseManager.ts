import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import bcrypt from 'bcryptjs';

interface User {
    id: number;
    username: string;
    name: string;
    passwordHash: string;
    createdAt: string;
    lastLogin?: string;
}

interface WhatsAppSession {
    id: number;
    username: string;
    sessionData: string;
    phoneNumber?: string;
    name?: string;
    platform?: string;
    connectedAt: string;
    lastActivity: string;
    isActive: number;
}

interface BulkMessage {
    id: number;
    userId: number;
    campaignName: string;
    message: string;
    recipients: string;
    status: 'pending' | 'sending' | 'completed' | 'failed';
    createdAt: string;
    completedAt?: string;
    successCount: number;
    failedCount: number;
}

export class DatabaseManager {
    private db!: Database.Database;
    private dbPath: string;

    constructor() {
        // Store database in Desktop/WhatsAppData folder
        const desktopPath = path.join(os.homedir(), 'Desktop');
        const dataDir = path.join(desktopPath, 'WhatsAppData');
        
        // Ensure directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        this.dbPath = path.join(dataDir, 'whatsapp_bulk_sender.db');
        this.initializeDatabase();
    }

    private initializeDatabase() {
        this.db = new Database(this.dbPath, {
            // Performance optimizations for large datasets
            verbose: undefined, // Disable verbose logging for production
            timeout: 30000, // 30 second timeout
            fileMustExist: false
        });

        // Enable WAL mode for better performance and concurrency
        this.db.pragma('journal_mode = WAL');
        
        // Optimize for performance over safety (can be adjusted based on needs)
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('cache_size = -64000'); // 64MB cache
        this.db.pragma('temp_store = memory');
        this.db.pragma('mmap_size = 268435456'); // 256MB memory map
        
        // Auto-vacuum to prevent database bloat
        this.db.pragma('auto_vacuum = INCREMENTAL');
        
        this.createTables();
        this.createIndexes();
    }

    private createTables() {
        // Users table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                passwordHash TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                lastLogin TEXT
            )
        `);

        // WhatsApp sessions table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS whatsapp_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                sessionData TEXT NOT NULL,
                phoneNumber TEXT,
                name TEXT,
                platform TEXT,
                connectedAt TEXT NOT NULL,
                lastActivity TEXT NOT NULL,
                isActive INTEGER DEFAULT 1,
                FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
            )
        `);

        // Bulk messages table for campaign management
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bulk_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                campaignName TEXT NOT NULL,
                message TEXT NOT NULL,
                recipients TEXT NOT NULL, -- JSON array of phone numbers
                status TEXT DEFAULT 'pending',
                createdAt TEXT NOT NULL,
                completedAt TEXT,
                successCount INTEGER DEFAULT 0,
                failedCount INTEGER DEFAULT 0,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Message logs table for detailed tracking
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS message_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaignId INTEGER NOT NULL,
                recipient TEXT NOT NULL,
                status TEXT NOT NULL, -- 'sent', 'failed', 'pending'
                sentAt TEXT,
                errorMessage TEXT,
                FOREIGN KEY (campaignId) REFERENCES bulk_messages(id) ON DELETE CASCADE
            )
        `);

        // Settings table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            )
        `);
    }

    private createIndexes() {
        // Critical indexes for performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
            CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(lastLogin);
            CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_username ON whatsapp_sessions(username);
            CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_active ON whatsapp_sessions(isActive);
            CREATE INDEX IF NOT EXISTS idx_bulk_messages_user_id ON bulk_messages(userId);
            CREATE INDEX IF NOT EXISTS idx_bulk_messages_status ON bulk_messages(status);
            CREATE INDEX IF NOT EXISTS idx_bulk_messages_created_at ON bulk_messages(createdAt);
            CREATE INDEX IF NOT EXISTS idx_message_logs_campaign_id ON message_logs(campaignId);
            CREATE INDEX IF NOT EXISTS idx_message_logs_status ON message_logs(status);
            CREATE INDEX IF NOT EXISTS idx_message_logs_sent_at ON message_logs(sentAt);
        `);
    }

    // User management methods
    async createUser(userData: { name: string; username: string; password: string }): Promise<{ success: boolean; message: string; user?: Partial<User> }> {
        try {
            const { name, username, password } = userData;
            
            // Validate input
            if (!name || !username || !password) {
                return { success: false, message: 'All fields are required' };
            }

            if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
                return { success: false, message: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores' };
            }

            if (password.length < 6) {
                return { success: false, message: 'Password must be at least 6 characters long' };
            }

            // Check if user exists
            const existingUser = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
            if (existingUser) {
                return { success: false, message: 'Username already exists' };
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, 12);
            
            // Insert user
            const insertUser = this.db.prepare(`
                INSERT INTO users (username, name, passwordHash, createdAt)
                VALUES (?, ?, ?, ?)
            `);
            
            const result = insertUser.run(username, name, passwordHash, new Date().toISOString());
            
            return {
                success: true,
                message: 'User created successfully',
                user: {
                    id: result.lastInsertRowid as number,
                    username,
                    name,
                    createdAt: new Date().toISOString()
                }
            };
        } catch (error) {
            console.error('Database error creating user:', error);
            return { success: false, message: 'Failed to create user' };
        }
    }

    async authenticateUser(username: string, password: string): Promise<{ success: boolean; message: string; user?: Partial<User> }> {
        try {
            const user = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User;
            
            if (!user) {
                return { success: false, message: 'Invalid username or password' };
            }

            const isValidPassword = await bcrypt.compare(password, user.passwordHash);
            if (!isValidPassword) {
                return { success: false, message: 'Invalid username or password' };
            }

            // Update last login
            this.db.prepare('UPDATE users SET lastLogin = ? WHERE id = ?')
                .run(new Date().toISOString(), user.id);

            return {
                success: true,
                message: 'Login successful',
                user: {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    createdAt: user.createdAt,
                    lastLogin: new Date().toISOString()
                }
            };
        } catch (error) {
            console.error('Database error authenticating user:', error);
            return { success: false, message: 'Authentication failed' };
        }
    }

    getUserByUsername(username: string): Partial<User> | null {
        try {
            const user = this.db.prepare('SELECT id, username, name, createdAt, lastLogin FROM users WHERE username = ?').get(username) as Partial<User>;
            return user || null;
        } catch (error) {
            console.error('Database error getting user:', error);
            return null;
        }
    }

    // WhatsApp session management
    saveWhatsAppSession(sessionData: Omit<WhatsAppSession, 'id'>): boolean {
        try {
            const upsertSession = this.db.prepare(`
                INSERT OR REPLACE INTO whatsapp_sessions 
                (username, sessionData, phoneNumber, name, platform, connectedAt, lastActivity, isActive)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            upsertSession.run(
                sessionData.username,
                sessionData.sessionData,
                sessionData.phoneNumber,
                sessionData.name,
                sessionData.platform,
                sessionData.connectedAt,
                sessionData.lastActivity,
                sessionData.isActive
            );
            
            return true;
        } catch (error) {
            console.error('Database error saving WhatsApp session:', error);
            return false;
        }
    }

    getWhatsAppSession(username: string): WhatsAppSession | null {
        try {
            const session = this.db.prepare('SELECT * FROM whatsapp_sessions WHERE username = ? AND isActive = 1').get(username) as WhatsAppSession;
            return session || null;
        } catch (error) {
            console.error('Database error getting WhatsApp session:', error);
            return null;
        }
    }

    deactivateWhatsAppSession(username: string): boolean {
        try {
            this.db.prepare('UPDATE whatsapp_sessions SET isActive = 0 WHERE username = ?').run(username);
            return true;
        } catch (error) {
            console.error('Database error deactivating session:', error);
            return false;
        }
    }

    // Bulk messaging methods
    createBulkMessage(messageData: Omit<BulkMessage, 'id' | 'createdAt' | 'successCount' | 'failedCount'>): number | null {
        try {
            const insertMessage = this.db.prepare(`
                INSERT INTO bulk_messages (userId, campaignName, message, recipients, status, createdAt, successCount, failedCount)
                VALUES (?, ?, ?, ?, ?, ?, 0, 0)
            `);
            
            const result = insertMessage.run(
                messageData.userId,
                messageData.campaignName,
                messageData.message,
                JSON.stringify(messageData.recipients),
                messageData.status,
                new Date().toISOString()
            );
            
            return result.lastInsertRowid as number;
        } catch (error) {
            console.error('Database error creating bulk message:', error);
            return null;
        }
    }

    // Performance-optimized pagination for large datasets
    getBulkMessages(userId: number, limit: number = 50, offset: number = 0): BulkMessage[] {
        try {
            const messages = this.db.prepare(`
                SELECT * FROM bulk_messages 
                WHERE userId = ? 
                ORDER BY createdAt DESC 
                LIMIT ? OFFSET ?
            `).all(userId, limit, offset) as BulkMessage[];
            
            return messages;
        } catch (error) {
            console.error('Database error getting bulk messages:', error);
            return [];
        }
    }

    // Batch operations for better performance
    logMessagesBatch(logs: Array<Omit<any, 'id'>>): boolean {
        try {
            const insertLog = this.db.prepare(`
                INSERT INTO message_logs (campaignId, recipient, status, sentAt, errorMessage)
                VALUES (?, ?, ?, ?, ?)
            `);
            
            const transaction = this.db.transaction((logs: any[]) => {
                for (const log of logs) {
                    insertLog.run(log.campaignId, log.recipient, log.status, log.sentAt, log.errorMessage);
                }
            });
            
            transaction(logs);
            return true;
        } catch (error) {
            console.error('Database error logging messages batch:', error);
            return false;
        }
    }

    // Database maintenance methods
    vacuum(): void {
        try {
            this.db.pragma('incremental_vacuum');
            console.log('Database vacuum completed');
        } catch (error) {
            console.error('Database vacuum error:', error);
        }
    }

    analyze(): void {
        try {
            this.db.exec('ANALYZE');
            console.log('Database analyze completed');
        } catch (error) {
            console.error('Database analyze error:', error);
        }
    }

    getStats(): any {
        try {
            const userCount = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
            const sessionCount = this.db.prepare('SELECT COUNT(*) as count FROM whatsapp_sessions WHERE isActive = 1').get() as { count: number };
            const campaignCount = this.db.prepare('SELECT COUNT(*) as count FROM bulk_messages').get() as { count: number };
            const messageLogCount = this.db.prepare('SELECT COUNT(*) as count FROM message_logs').get() as { count: number };
            
            // Get database file size
            const stats = fs.statSync(this.dbPath);
            const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
            
            return {
                users: userCount.count,
                activeSessions: sessionCount.count,
                campaigns: campaignCount.count,
                messageLogs: messageLogCount.count,
                databaseSizeMB: fileSizeInMB,
                databasePath: this.dbPath
            };
        } catch (error) {
            console.error('Database stats error:', error);
            return null;
        }
    }

    close(): void {
        try {
            this.db.close();
            console.log('Database connection closed');
        } catch (error) {
            console.error('Error closing database:', error);
        }
    }

    // Backup method
    backup(backupPath?: string): boolean {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const defaultBackupPath = path.join(path.dirname(this.dbPath), `backup_${timestamp}.db`);
            const finalBackupPath = backupPath || defaultBackupPath;
            
            this.db.backup(finalBackupPath);
            console.log(`Database backed up to: ${finalBackupPath}`);
            return true;
        } catch (error) {
            console.error('Database backup error:', error);
            return false;
        }
    }
} 