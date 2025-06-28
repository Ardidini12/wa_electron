import { EventEmitter } from 'events';
import { DatabaseManager } from './databaseManager.js';

interface Template {
    id?: number;
    name: string;
    content: {
        text: string;
        images: string[];
    };
    createdAt?: string;
    updatedAt?: string;
}

interface TemplateValidation {
    isValid: boolean;
    errors: string[];
}

export class TemplateManager extends EventEmitter {
    private db: DatabaseManager;

    constructor() {
        super();
        // Increase max listeners to prevent memory leak warnings
        this.setMaxListeners(100000);
        this.db = new DatabaseManager();
    }

    // Get templates with pagination and search
    async getTemplates(page: number = 1, limit: number = 10, search: string = ''): Promise<{ success: boolean; templates?: Template[]; pagination?: any; error?: string }> {
        try {
            const result = this.db.getTemplates(page, limit, search);
            return { success: true, ...result };
        } catch (error: any) {
            console.error('TemplateManager: Error getting templates:', error);
            return { success: false, error: error.message };
        }
    }

    // Get all template IDs for bulk operations
    async getAllTemplateIds(search: string = ''): Promise<{ success: boolean; templateIds?: number[]; error?: string }> {
        try {
            const templateIds = this.db.getAllTemplateIds(search);
            return { success: true, templateIds };
        } catch (error: any) {
            console.error('TemplateManager: Error getting all template IDs:', error);
            return { success: false, error: error.message };
        }
    }

    // Add a new template
    async addTemplate(templateData: Partial<Template>): Promise<{ success: boolean; template?: Template; error?: string }> {
        try {
            // Validate template data
            const validation = this.validateTemplate(templateData);
            if (!validation.isValid) {
                return { success: false, error: validation.errors.join(', ') };
            }

            // Check for duplicate template name
            const existingTemplates = this.db.getTemplates(1, 1, templateData.name || '');
            if (existingTemplates.templates.some((t: any) => t.name.toLowerCase() === templateData.name?.toLowerCase())) {
                return { success: false, error: 'A template with this name already exists' };
            }

            // Process template content
            const processedTemplate = this.processTemplateContent(templateData);
            const template = this.db.addTemplate(processedTemplate);

            this.emit('template-added', template);
            return { success: true, template };
        } catch (error: any) {
            console.error('TemplateManager: Error adding template:', error);
            return { success: false, error: error.message };
        }
    }

    // Update an existing template
    async updateTemplate(templateId: number, templateData: Partial<Template>): Promise<{ success: boolean; template?: Template; error?: string }> {
        try {
            // Validate template data
            const validation = this.validateTemplate(templateData);
            if (!validation.isValid) {
                return { success: false, error: validation.errors.join(', ') };
            }

            // Check for duplicate template name (excluding current template)
            const existingTemplates = this.db.getTemplates(1, 999999, templateData.name || '');
            const duplicateTemplate = existingTemplates.templates.find((t: any) => 
                t.id !== templateId && t.name.toLowerCase() === templateData.name?.toLowerCase()
            );
            if (duplicateTemplate) {
                return { success: false, error: 'A template with this name already exists' };
            }

            // Process template content
            const processedTemplate = this.processTemplateContent(templateData);
            const template = this.db.updateTemplate(templateId, processedTemplate);

            this.emit('template-updated', template);
            return { success: true, template };
        } catch (error: any) {
            console.error('TemplateManager: Error updating template:', error);
            return { success: false, error: error.message };
        }
    }

    // Delete multiple templates
    async deleteTemplates(templateIds: number[]): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
        try {
            if (!templateIds || templateIds.length === 0) {
                return { success: false, error: 'No templates selected for deletion' };
            }

            const result = this.db.deleteTemplates(templateIds);
            this.emit('templates-deleted', { templateIds, deletedCount: result.deletedCount });
            return { success: true, deletedCount: result.deletedCount };
        } catch (error: any) {
            console.error('TemplateManager: Error deleting templates:', error);
            return { success: false, error: error.message };
        }
    }

    // Process template with variables
    processTemplateWithVariables(template: Template, variables: Record<string, string>): { text: string; images: string[] } {
        try {
            let processedText = template.content.text;

            // Replace contact variables
            processedText = processedText.replace(/{name}/g, variables.name || '');
            processedText = processedText.replace(/{surname}/g, variables.surname || '');
            processedText = processedText.replace(/{phone}/g, variables.phone || '');
            processedText = processedText.replace(/{email}/g, variables.email || '');
            processedText = processedText.replace(/{birthday}/g, variables.birthday || '');

            // Replace date/time variables
            const now = new Date();
            processedText = processedText.replace(/{date}/g, now.toLocaleDateString());
            processedText = processedText.replace(/{time}/g, now.toLocaleTimeString());
            processedText = processedText.replace(/{datetime}/g, now.toLocaleString());
            processedText = processedText.replace(/{day}/g, now.getDate().toString());
            processedText = processedText.replace(/{month}/g, (now.getMonth() + 1).toString());
            processedText = processedText.replace(/{year}/g, now.getFullYear().toString());

            return {
                text: processedText,
                images: [...template.content.images]
            };
        } catch (error) {
            console.error('TemplateManager: Error processing template variables:', error);
            return {
                text: template.content.text,
                images: [...template.content.images]
            };
        }
    }

    // Validate template content
    private validateTemplate(templateData: Partial<Template>): TemplateValidation {
        const errors: string[] = [];

        // Check required fields
        if (!templateData.name || templateData.name.trim().length === 0) {
            errors.push('Template name is required');
        }

        if (templateData.name && templateData.name.trim().length > 100) {
            errors.push('Template name must be less than 100 characters');
        }

        if (!templateData.content) {
            errors.push('Template content is required');
        } else {
            if (!templateData.content.text && (!templateData.content.images || templateData.content.images.length === 0)) {
                errors.push('Template must have either text content or images');
            }

            if (templateData.content.text && templateData.content.text.length > 4096) {
                errors.push('Template text must be less than 4096 characters');
            }

            if (templateData.content.images && templateData.content.images.length > 10) {
                errors.push('Template can have maximum 10 images');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Process template content before saving
    private processTemplateContent(templateData: Partial<Template>): any {
        return {
            name: templateData.name?.trim(),
            content: {
                text: templateData.content?.text?.trim() || '',
                images: templateData.content?.images || []
            }
        };
    }

    // Get template variables info
    getTemplateVariables(): { contactVariables: string[]; dateTimeVariables: string[]; formattingOptions: string[] } {
        return {
            contactVariables: [
                '{name} - Contact\'s name',
                '{surname} - Contact\'s surname', 
                '{phone} - Contact\'s phone number',
                '{email} - Contact\'s email',
                '{birthday} - Contact\'s birthday'
            ],
            dateTimeVariables: [
                '{date} - Current date',
                '{time} - Current time',
                '{datetime} - Current date and time',
                '{day} - Current day of month',
                '{month} - Current month number',
                '{year} - Current year'
            ],
            formattingOptions: [
                '*bold* - Makes text bold',
                '_italic_ - Makes text italic',
                '~strikethrough~ - Makes text strikethrough',
                '```monospace``` - Makes text monospace'
            ]
        };
    }

    // Preview template with sample data
    previewTemplate(template: Template): { text: string; images: string[] } {
        try {
            const sampleVariables = {
                name: 'John',
                surname: 'Doe',
                phone: '+1234567890',
                email: 'john.doe@example.com',
                birthday: '1990-01-01'
            };

            return this.processTemplateWithVariables(template, sampleVariables);
        } catch (error) {
            console.error('TemplateManager: Error previewing template:', error);
            return {
                text: template.content?.text || '',
                images: template.content?.images || []
            };
        }
    }

    // Get statistics
    getStats(): any {
        try {
            const allTemplates = this.db.getTemplates(1, 999999, '');
            return {
                totalTemplates: allTemplates.pagination.total,
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            console.error('TemplateManager: Error getting stats:', error);
            return { totalTemplates: 0, lastUpdated: new Date().toISOString() };
        }
    }

    // Search templates by content
    async searchTemplatesByContent(searchTerm: string): Promise<Template[]> {
        try {
            const allTemplates = this.db.getTemplates(1, 999999, '');
            return allTemplates.templates.filter((template: Template) => 
                template.content.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
                template.name.toLowerCase().includes(searchTerm.toLowerCase())
            );
        } catch (error) {
            console.error('TemplateManager: Error searching templates:', error);
            return [];
        }
    }

    // Get templates by usage (for analytics)
    getTemplateUsageStats(): any {
        try {
            // This would be implemented when message sending is added
            // For now, return basic stats
            const stats = this.getStats();
            return {
                ...stats,
                mostUsed: [],
                leastUsed: [],
                recentlyCreated: []
            };
        } catch (error) {
            console.error('TemplateManager: Error getting usage stats:', error);
            return { mostUsed: [], leastUsed: [], recentlyCreated: [] };
        }
    }
} 