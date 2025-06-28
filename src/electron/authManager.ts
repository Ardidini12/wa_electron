import bcrypt from 'bcryptjs';
import { EventEmitter } from 'events';
import Store from 'electron-store';
import { DatabaseManager } from './databaseManager.js';
import crypto from 'crypto';

interface User {
    id: number;
    username: string;
    name: string;
    passwordHash: string;
    createdAt: Date;
    lastLogin?: Date;
}

interface LoginCredentials {
    username: string;
    password: string;
    rememberMe?: boolean;
}

interface RegisterData {
    name: string;
    username: string;
    password: string;
}

interface WhatsAppSession {
    username: string;
    sessionData: any;
    phoneNumber?: string;
    name?: string;
    platform?: string;
    connectedAt: Date;
    lastActivity: Date;
    isActive: boolean;
}

interface SavedCredentials {
    username: string;
    name: string;
    encryptedPassword: string; // Encrypted password for auto-fill
    rememberMe: boolean;
    savedAt: string;
}

export class AuthManager extends EventEmitter {
    private db: DatabaseManager;
    private sessionStore: Store;
    private currentUser: User | null = null;
    private rememberMe: boolean = false;
    private currentUsername: string | null = null;
    private readonly encryptionKey = 'whatsapp-bulk-sender-password-encryption-2025';

    constructor() {
        super();
        // Increase max listeners to prevent memory leak warnings
        this.setMaxListeners(100000);
        this.db = new DatabaseManager();
        
        this.sessionStore = new Store({
            name: 'sessions',
            encryptionKey: 'whatsapp-bulk-sender-sessions-2025'
        });
    }

    private encryptPassword(password: string): string {
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(password, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        // Prepend IV to encrypted data
        return iv.toString('hex') + ':' + encrypted;
    }

    private decryptPassword(encryptedPassword: string): string {
        try {
            const algorithm = 'aes-256-cbc';
            const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
            
            // Split IV and encrypted data
            const parts = encryptedPassword.split(':');
            if (parts.length !== 2) {
                throw new Error('Invalid encrypted password format');
            }
            
            const iv = Buffer.from(parts[0], 'hex');
            const encryptedData = parts[1];
            
            const decipher = crypto.createDecipheriv(algorithm, key, iv);
            let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            console.error('Error decrypting password:', error);
            return '';
        }
    }

    async register(userData: RegisterData): Promise<{ success: boolean; message: string; user?: User }> {
        try {
            const result = await this.db.createUser(userData);
            
            if (result.success && result.user) {
                // Convert database user to our User interface
                const user: User = {
                    id: result.user.id!,
                    username: result.user.username!,
                    name: result.user.name!,
                    passwordHash: '', // Don't expose password hash
                    createdAt: new Date(result.user.createdAt!)
                };

                this.emit('user-registered', user);
                return { 
                    success: true, 
                    message: result.message, 
                    user 
                };
            }
            
            return { success: false, message: result.message };
        } catch (error) {
            console.error('Registration error:', error);
            return { 
                success: false, 
                message: 'Registration failed. Please try again.' 
            };
        }
    }

    async login(credentials: LoginCredentials): Promise<{ success: boolean; message: string; user?: User }> {
        try {
            const { username, password, rememberMe } = credentials;
            
            const result = await this.db.authenticateUser(username, password);
            
            if (result.success && result.user) {
                // Convert database user to our User interface
                const user: User = {
                    id: result.user.id!,
                    username: result.user.username!,
                    name: result.user.name!,
                    passwordHash: '', // Don't expose password hash
                    createdAt: new Date(result.user.createdAt!),
                    lastLogin: result.user.lastLogin ? new Date(result.user.lastLogin) : undefined
                };

                // Set current user
                this.currentUser = user;
                this.rememberMe = rememberMe || false;
                this.currentUsername = username;

                // Save session if remember me
                if (rememberMe) {
                    this.sessionStore.set('currentSession', {
                        username,
                        rememberMe: true,
                        loginTime: new Date().toISOString()
                    });
                    
                    // Save credentials for auto-fill (including encrypted password)
                    const encryptedPassword = this.encryptPassword(password);
                    this.sessionStore.set('savedCredentials', {
                        username,
                        name: user.name,
                        encryptedPassword,
                        rememberMe: true,
                        savedAt: new Date().toISOString()
                    } as SavedCredentials);
                }

                this.emit('user-logged-in', user);

                return { 
                    success: true, 
                    message: result.message, 
                    user 
                };
            }
            
            return { success: false, message: result.message };
        } catch (error) {
            console.error('Login error:', error);
            return { 
                success: false, 
                message: 'Login failed. Please try again.' 
            };
        }
    }

    async logout(): Promise<{ success: boolean; message: string }> {
        try {
            if (this.currentUser) {
                this.emit('user-logged-out', this.currentUser.username);
            }

            this.currentUser = null;
            this.rememberMe = false;
            this.currentUsername = null;

            // Clear current session but keep saved credentials if they exist
            this.sessionStore.delete('currentSession');

            return { 
                success: true, 
                message: 'Logout successful' 
            };

        } catch (error) {
            console.error('Logout error:', error);
            return { 
                success: false, 
                message: 'Logout failed' 
            };
        }
    }

    getStoredUser(): User | null {
        const session = this.sessionStore.get('currentSession') as any;
        if (session && session.rememberMe && session.username) {
            const user = this.getUserByUsername(session.username);
            if (user) {
                this.currentUser = user;
                this.currentUsername = session.username;
                this.rememberMe = true;
                
                return user;
            }
        }

        return null;
    }

    getSavedCredentials(): { username: string; name: string; password: string; rememberMe: boolean } | null {
        const savedCreds = this.sessionStore.get('savedCredentials') as SavedCredentials;
        if (savedCreds && savedCreds.rememberMe) {
            const decryptedPassword = savedCreds.encryptedPassword ? this.decryptPassword(savedCreds.encryptedPassword) : '';
            return {
                username: savedCreds.username,
                name: savedCreds.name,
                password: decryptedPassword,
                rememberMe: savedCreds.rememberMe
            };
        }
        return null;
    }

    async getSavedPassword(username: string): Promise<string | null> {
        try {
            const savedCreds = this.sessionStore.get('savedCredentials') as SavedCredentials;
            if (savedCreds && savedCreds.rememberMe && savedCreds.username === username && savedCreds.encryptedPassword) {
                return this.decryptPassword(savedCreds.encryptedPassword);
            }
            return null;
        } catch (error) {
            console.error('Error getting saved password:', error);
            return null;
        }
    }

    async getSavedCredentialsWithPassword(): Promise<{ username: string; name: string; password: string; rememberMe: boolean } | null> {
        const savedCreds = this.sessionStore.get('savedCredentials') as SavedCredentials;
        if (savedCreds && savedCreds.rememberMe && savedCreds.encryptedPassword) {
            const decryptedPassword = this.decryptPassword(savedCreds.encryptedPassword);
            return {
                username: savedCreds.username,
                name: savedCreds.name,
                password: decryptedPassword,
                rememberMe: savedCreds.rememberMe
            };
        }
        return null;
    }

    async autoLoginWithSavedCredentials(): Promise<{ success: boolean; message: string; user?: User }> {
        try {
            const savedCreds = await this.getSavedCredentialsWithPassword();
            if (!savedCreds || !savedCreds.password) {
                return { success: false, message: 'No saved credentials found' };
            }

            // Use the regular login method with saved credentials
            return await this.login({
                username: savedCreds.username,
                password: savedCreds.password,
                rememberMe: true
            });
        } catch (error) {
            console.error('Auto-login error:', error);
            return { 
                success: false, 
                message: 'Auto-login failed' 
            };
        }
    }

    clearSavedCredentials(): void {
        this.sessionStore.delete('savedCredentials');
    }

    getCurrentUser(): User | null {
        if (this.currentUser) {
            // Remove password hash from returned user
            const userResponse = { ...this.currentUser };
            delete (userResponse as any).passwordHash;
            return userResponse;
        }
        return null;
    }

    getUserByUsername(username: string): User | null {
        const dbUser = this.db.getUserByUsername(username);
        
        if (!dbUser) return null;

        // Convert database user to our User interface
        return {
            id: dbUser.id!,
            username: dbUser.username!,
            name: dbUser.name!,
            passwordHash: '', // Don't expose password hash
            createdAt: new Date(dbUser.createdAt!),
            lastLogin: dbUser.lastLogin ? new Date(dbUser.lastLogin) : undefined
        };
    }

    async changePassword(username: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
        try {
            // This would need to be implemented in DatabaseManager
            // For now, return not implemented
            return { success: false, message: 'Change password not implemented yet' };
        } catch (error) {
            console.error('Change password error:', error);
            return { 
                success: false, 
                message: 'Failed to change password' 
            };
        }
    }

    async deleteUser(username: string, password: string): Promise<{ success: boolean; message: string }> {
        try {
            // This would need to be implemented in DatabaseManager
            // For now, return not implemented
            return { success: false, message: 'Delete user not implemented yet' };
        } catch (error) {
            console.error('Delete user error:', error);
            return { 
                success: false, 
                message: 'Failed to delete user' 
            };
        }
    }

    getAllUsers(): Partial<User>[] {
        // This would need to be implemented in DatabaseManager
        // For now, return empty array
        return [];
    }

    private isValidUsername(username: string): boolean {
        // Username must be 3-20 characters long and contain only letters, numbers, and underscores
        const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
        return usernameRegex.test(username);
    }

    // WhatsApp session management
    saveWhatsAppSession(username: string, sessionData: any): void {
        const session: WhatsAppSession = {
            username,
            sessionData,
            phoneNumber: sessionData.phoneNumber,
            name: sessionData.name,
            platform: sessionData.platform,
            connectedAt: new Date(),
            lastActivity: new Date(),
            isActive: true
        };

        this.db.saveWhatsAppSession({
            username,
            sessionData: JSON.stringify(sessionData),
            phoneNumber: sessionData.phoneNumber,
            name: sessionData.name,
            platform: sessionData.platform,
            connectedAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            isActive: 1
        });
    }

    getWhatsAppSession(username: string): WhatsAppSession | null {
        const dbSession = this.db.getWhatsAppSession(username);
        
        if (!dbSession || !dbSession.isActive) return null;

        return {
            username: dbSession.username,
            sessionData: JSON.parse(dbSession.sessionData),
            phoneNumber: dbSession.phoneNumber,
            name: dbSession.name,
            platform: dbSession.platform,
            connectedAt: new Date(dbSession.connectedAt),
            lastActivity: new Date(dbSession.lastActivity),
            isActive: Boolean(dbSession.isActive)
        };
    }

    deactivateWhatsAppSession(username: string): void {
        this.db.deactivateWhatsAppSession(username);
    }

    // Clear all users (for development/testing)
    clearAllUsers(): void {
        // This would need to be implemented in DatabaseManager
        // For now, just clear session store
        this.sessionStore.clear();
        this.currentUser = null;
        this.rememberMe = false;
        this.currentUsername = null;
        this.emit('all-users-cleared');
    }

    // Get storage statistics
    getStorageStats(): any {
        const dbStats = this.db.getStats();
        return {
            userCount: dbStats?.users || 0,
            activeSessionCount: dbStats?.activeSessions || 0,
            totalSessions: dbStats?.activeSessions || 0,
            storeSize: 0,
            indexSize: 0,
            sessionStoreSize: this.sessionStore.size,
            databaseStats: dbStats
        };
    }
} 