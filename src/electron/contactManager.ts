import { EventEmitter } from 'events';
import { DatabaseManager } from './databaseManager.js';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { stringify } from 'csv-stringify/sync';
import XLSX from 'xlsx';
import os from 'os';

interface Contact {
    id?: number;
    name: string;
    surname: string;
    email: string;
    phone: string;
    birthday: string;
    source?: string;
    createdAt?: string;
    updatedAt?: string;
}

interface ContactImportResult {
    success: boolean;
    contacts?: any[];
    fileName?: string;
    error?: string;
}

interface ContactProcessResult {
    importedCount: number;
    skippedCount: number;
    errors: string[];
}

interface ContactExportResult {
    success: boolean;
    filePath?: string;
    fileName?: string;
    error?: string;
}

export class ContactManager extends EventEmitter {
    private db: DatabaseManager;

    constructor() {
        super();
        // Increase max listeners to prevent memory leak warnings
        this.setMaxListeners(100000);
        this.db = new DatabaseManager();
    }

    // Get contacts with pagination and search
    async getContacts(page: number = 1, limit: number = 100, search: string = ''): Promise<{ success: boolean; contacts?: Contact[]; pagination?: any; error?: string }> {
        try {
            const result = this.db.getContacts(page, limit, search);
            return { success: true, ...result };
        } catch (error: any) {
            console.error('ContactManager: Error getting contacts:', error);
            return { success: false, error: error.message };
        }
    }

    // Get all contact IDs for bulk operations
    async getAllContactIds(search: string = ''): Promise<{ success: boolean; contactIds?: number[]; error?: string }> {
        try {
            const contactIds = this.db.getAllContactIds(search);
            return { success: true, contactIds };
        } catch (error: any) {
            console.error('ContactManager: Error getting all contact IDs:', error);
            return { success: false, error: error.message };
        }
    }

    // Add a new contact
    async addContact(contactData: Partial<Contact>): Promise<{ success: boolean; contact?: Contact; error?: string }> {
        try {
            // Validate required fields
            if (!contactData.phone) {
                return { success: false, error: 'Phone number is required' };
            }

            // Check for duplicate phone number
            const existingContacts = this.db.getContacts(1, 1, contactData.phone);
            if (existingContacts.contacts.length > 0) {
                return { success: false, error: 'A contact with this phone number already exists' };
            }

            const contact = this.db.addContact({
                ...contactData,
                source: contactData.source || 'manual'
            });

            this.emit('contact-added', contact);
            return { success: true, contact };
        } catch (error: any) {
            console.error('ContactManager: Error adding contact:', error);
            return { success: false, error: error.message };
        }
    }

    // Update an existing contact
    async updateContact(contactId: number, contactData: Partial<Contact>): Promise<{ success: boolean; contact?: Contact; error?: string }> {
        try {
            // Validate required fields
            if (!contactData.phone) {
                return { success: false, error: 'Phone number is required' };
            }

            // Check for duplicate phone number (excluding current contact)
            const existingContacts = this.db.getContacts(1, 999999, contactData.phone);
            const duplicateContact = existingContacts.contacts.find((c: any) => c.id !== contactId && c.phone === contactData.phone);
            if (duplicateContact) {
                return { success: false, error: 'A contact with this phone number already exists' };
            }

            const contact = this.db.updateContact(contactId, contactData);
            this.emit('contact-updated', contact);
            return { success: true, contact };
        } catch (error: any) {
            console.error('ContactManager: Error updating contact:', error);
            return { success: false, error: error.message };
        }
    }

    // Delete multiple contacts
    async deleteContacts(contactIds: number[]): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
        try {
            if (!contactIds || contactIds.length === 0) {
                return { success: false, error: 'No contacts selected for deletion' };
            }

            const result = this.db.deleteContacts(contactIds);
            this.emit('contacts-deleted', { contactIds, deletedCount: result.deletedCount });
            return { success: true, deletedCount: result.deletedCount };
        } catch (error: any) {
            console.error('ContactManager: Error deleting contacts:', error);
            return { success: false, error: error.message };
        }
    }

    // Parse contact file for import
    async parseContactFile(filePath: string): Promise<ContactImportResult> {
        try {
            const ext = path.extname(filePath).toLowerCase();
            let contacts: any[] = [];

            if (ext === '.csv') {
                contacts = await this.parseCSVFile(filePath);
            } else if (ext === '.xlsx' || ext === '.xls') {
                contacts = this.parseExcelFile(filePath);
            } else if (ext === '.json') {
                contacts = this.parseJSONFile(filePath);
            } else {
                return { success: false, error: `Unsupported file format: ${ext}` };
            }

            // Process and validate contacts
            const processedContacts = contacts.map(contact => this.mapContactFields(contact));

            return {
                success: true,
                contacts: processedContacts,
                fileName: path.basename(filePath)
            };
        } catch (error: any) {
            console.error('ContactManager: Error parsing contact file:', error);
            return { success: false, error: error.message };
        }
    }

    // Import contacts to database
    async importContacts(contacts: any[], skipDuplicates: boolean = true): Promise<{ success: boolean; importedCount?: number; skippedCount?: number; errors?: string[]; error?: string }> {
        try {
            if (!contacts || contacts.length === 0) {
                return { success: false, error: 'No contacts to import' };
            }

            // Validate contacts before import
            const validContacts = contacts.filter(contact => {
                return contact.phone && contact.phone.trim() && 
                       !contact.duplicate && !contact.inDatabase;
            });

            if (validContacts.length === 0) {
                return { success: false, error: 'No valid contacts to import' };
            }

            const result = this.db.importContacts(validContacts, skipDuplicates);
            this.emit('contacts-imported', result);
            return { success: true, ...result };
        } catch (error: any) {
            console.error('ContactManager: Error importing contacts:', error);
            return { success: false, error: error.message };
        }
    }

    // Export contacts to file
    async exportContacts(format: 'csv' | 'excel' | 'json'): Promise<ContactExportResult> {
        try {
            const result = this.db.exportContacts(format);
            const filePath = await this.saveExportFile(result.data, result.format);
            
            this.emit('contacts-exported', { format, filePath, count: result.data.length });
            return {
                success: true,
                filePath,
                fileName: path.basename(filePath)
            };
        } catch (error: any) {
            console.error('ContactManager: Error exporting contacts:', error);
            return { success: false, error: error.message };
        }
    }

    // Process contacts for import preview
    async processContactsForImport(contacts: any[]): Promise<{ valid: any[]; skipped: any[] }> {
        try {
            // Get existing contacts to check for duplicates
            const existingResponse = this.db.getContacts(1, 999999, '');
            const existingPhones = new Set(
                existingResponse.contacts.map((c: any) => c.phone?.toString().trim()).filter(Boolean)
            );

            const valid: any[] = [];
            const skipped: any[] = [];
            const phoneOccurrences = new Map();

            // First pass: identify all phone numbers and their occurrences
            contacts.forEach((contact: any) => {
                const phone = contact.phone ? contact.phone.toString().trim() : '';
                if (phone) {
                    if (!phoneOccurrences.has(phone)) {
                        phoneOccurrences.set(phone, []);
                    }
                    phoneOccurrences.get(phone).push(contact);
                }
            });

            // Second pass: process each contact
            contacts.forEach((contact: any) => {
                const processedContact = {
                    id: `temp_${Math.random().toString(36).substr(2, 9)}`,
                    name: contact.name || '',
                    surname: contact.surname || '',
                    email: contact.email || '',
                    phone: contact.phone ? contact.phone.toString().trim() : '',
                    birthday: contact.birthday || '',
                    source: `imported`,
                    valid: true,
                    duplicate: false,
                    inDatabase: false,
                    skipReason: null as string | null
                };

                // Check for required phone number
                if (!processedContact.phone) {
                    processedContact.valid = false;
                    processedContact.skipReason = 'Missing phone number';
                    skipped.push(processedContact);
                    return;
                }

                const phoneOccurs = phoneOccurrences.get(processedContact.phone);
                const isFileHasDuplicates = phoneOccurs && phoneOccurs.length > 1;
                const inDatabase = existingPhones.has(processedContact.phone);

                if (inDatabase) {
                    processedContact.inDatabase = true;
                    processedContact.duplicate = true;
                    processedContact.valid = false;
                    processedContact.skipReason = 'Phone number already exists in database';
                    skipped.push(processedContact);
                } else if (isFileHasDuplicates) {
                    processedContact.valid = false;
                    processedContact.duplicate = true;
                    processedContact.skipReason = 'Duplicate phone number in import file';
                    skipped.push(processedContact);
                } else {
                    valid.push(processedContact);
                }
            });

            return { valid, skipped };
        } catch (error: any) {
            console.error('ContactManager: Error processing contacts for import:', error);
            return { valid: [], skipped: [] };
        }
    }

    // Check if phone number exists in database
    async checkPhoneExists(phone: string): Promise<boolean> {
        try {
            const response = this.db.getContacts(1, 1, phone.trim());
            return response.contacts.some((c: any) => c.phone?.toString().trim() === phone.trim());
        } catch (error) {
            console.error('ContactManager: Error checking phone existence:', error);
            return false;
        }
    }

    // Private helper methods
    private async parseCSVFile(filePath: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const contacts: any[] = [];
            
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data: any) => {
                    const normalizedData: any = {};
                    Object.keys(data).forEach(key => {
                        const lowerKey = key.toLowerCase().trim();
                        normalizedData[lowerKey] = data[key]?.toString().trim() || '';
                    });
                    contacts.push(normalizedData);
                })
                .on('end', () => resolve(contacts))
                .on('error', reject);
        });
    }

    private parseExcelFile(filePath: string): any[] {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet);
        
        return rawData.map((row: any) => {
            const normalizedRow: any = {};
            Object.keys(row).forEach(key => {
                const lowerKey = key.toLowerCase().trim();
                normalizedRow[lowerKey] = row[key]?.toString().trim() || '';
            });
            return normalizedRow;
        });
    }

    private parseJSONFile(filePath: string): any[] {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const jsonData = JSON.parse(fileContent);
        
        const contacts = Array.isArray(jsonData) ? jsonData : jsonData.contacts || [];
        return contacts;
    }

    private mapContactFields(contact: any): any {
        return {
            name: contact.name || contact.firstname || contact.first_name || contact.first || '',
            surname: contact.surname || contact.lastname || contact.last_name || contact.last || '',
            email: contact.email || contact.emailaddress || contact.email_address || '',
            phone: contact.phone || contact.phonenumber || contact.phone_number || contact.mobile || contact.cell || '',
            birthday: contact.birthday || contact.birthdate || contact.birth_date || contact.dob || ''
        };
    }

    private async saveExportFile(data: any[], format: string): Promise<string> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `contacts_export_${timestamp}`;
        
        // Create exports directory in Desktop/WhatsAppData
        const desktopPath = path.join(os.homedir(), 'Desktop');
        const dataDir = path.join(desktopPath, 'WhatsAppData', 'exports');
        
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        let filePath: string;
        
        if (format === 'csv') {
            filePath = path.join(dataDir, `${fileName}.csv`);
            const csvData = stringify(data, { header: true });
            fs.writeFileSync(filePath, csvData);
        } else if (format === 'excel') {
            filePath = path.join(dataDir, `${fileName}.xlsx`);
            const worksheet = XLSX.utils.json_to_sheet(data);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Contacts');
            XLSX.writeFile(workbook, filePath);
        } else {
            filePath = path.join(dataDir, `${fileName}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        }
        
        return filePath;
    }

    // Get statistics
    getStats(): any {
        try {
            const allContacts = this.db.getContacts(1, 999999, '');
            return {
                totalContacts: allContacts.pagination.total,
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            console.error('ContactManager: Error getting stats:', error);
            return { totalContacts: 0, lastUpdated: new Date().toISOString() };
        }
    }
} 