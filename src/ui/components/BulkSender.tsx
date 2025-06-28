import React, { useState, useEffect } from 'react';
import './BulkSender.css';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

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

interface ContactsBySource {
  [source: string]: {
    count: number;
  };
}

interface Template {
  id: number;
  name: string;
  content: string;
  variables: string[];
}

interface Campaign {
  id: number;
  campaignName: string;
  templateId: number;
  status: 'scheduled' | 'sending' | 'paused' | 'completed' | 'cancelled';
  createdAt: string;
  totalMessages: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
}

interface MessageLog {
  id: number;
  contactName: string;
  contactSurname: string;
  contactPhone: string;
  templateName: string;
  scheduledAt: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  status: 'scheduled' | 'sent' | 'delivered' | 'read' | 'failed' | 'cancelled';
  errorMessage?: string;
}

interface Statistics {
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
  today: { sent: number; delivered: number; read: number; failed: number };
  week: { sent: number; delivered: number; read: number; failed: number };
  month: { sent: number; delivered: number; read: number; failed: number };
  year: { sent: number; delivered: number; read: number; failed: number };
  totalCampaigns: number;
  activeCampaigns: number;
}

type ActiveSection = 'settings' | 'contacts' | 'templates' | 'messages' | 'all-messages' | 'statistics';

const BulkSender: React.FC = () => {
  const [activeSection, setActiveSection] = useState<ActiveSection>('settings');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Settings state
  const [settings, setSettings] = useState<BulkSettings>({
    startHour: 9,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    intervalSeconds: 30,
    intervalMinutes: 0,
    maxMessagesPerDay: 1000,
    isActive: true
  });
  const [messagesPerDay, setMessagesPerDay] = useState(0);

  // Contacts state
  const [contactsBySource, setContactsBySource] = useState<ContactsBySource>({});
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [sourceContacts, setSourceContacts] = useState<{ [source: string]: any[] }>({});
  const [sourcePagination, setSourcePagination] = useState<{ [source: string]: any }>({});
  const [sourceSelections, setSourceSelections] = useState<{ [source: string]: number[] }>({});

  // Templates state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templatePreview, setTemplatePreview] = useState('');

  // Campaign state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsPagination, setCampaignsPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [campaignMessages, setCampaignMessages] = useState<{ [campaignId: number]: MessageLog[] }>({});
  const [messagesPagination, setMessagesPagination] = useState<{ [campaignId: number]: any }>({});
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [campaignStatusFilters, setCampaignStatusFilters] = useState<{ [campaignId: number]: string }>({});
  const [campaignNameFilter, setCampaignNameFilter] = useState<string>('');
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<string>('all');

  // New campaign state
  const [newCampaignName, setNewCampaignName] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<number[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  // Statistics state
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [statsTimeframe, setStatsTimeframe] = useState<'today' | 'week' | 'month' | 'year'>('today');

  // New state for enhanced scheduled messages
  const [messageStatusCheckInterval, setMessageStatusCheckInterval] = useState<NodeJS.Timeout | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);

  // Add debounced search state
  const [searchDebounceTimer, setSearchDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<number>>(new Set());

  // Add new state for counts
  const [campaignCounts, setCampaignCounts] = useState<any>(null);
  const [messageCounts, setMessageCounts] = useState<{ [campaignId: number]: any }>({});

  // Add new state for all messages view
  const [allMessages, setAllMessages] = useState<any[]>([]);
  const [allMessagesPagination, setAllMessagesPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: 50 });
  const [allMessagesStatusFilter, setAllMessagesStatusFilter] = useState<string>('all');
  const [allMessagesCampaignFilter, setAllMessagesCampaignFilter] = useState<string>('all');
  const [allMessagesCounts, setAllMessagesCounts] = useState<any>(null);
  const [selectedAllMessages, setSelectedAllMessages] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadInitialData();
    setupEventListeners();
    requestNotificationPermission();
    
    return () => {
      // Cleanup intervals and timers
      if (messageStatusCheckInterval) {
        clearInterval(messageStatusCheckInterval);
      }
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
    };
  }, []);

  const setupEventListeners = () => {
    if (window.electron?.bulk) {
      window.electron.bulk.onMessageStatusUpdated((data: any) => {
        console.log('Message status updated:', data);
        refreshCampaignData();
      });

      window.electron.bulk.onCampaignCompleted((data: any) => {
        console.log('Campaign completed:', data);
        setSuccess(`Campaign "${data.campaignName}" completed successfully!`);
        refreshCampaignData();
      });

      window.electron.bulk.onCampaignCancelled((data: any) => {
        console.log('Campaign cancelled:', data);
        setSuccess(`Campaign "${data.campaignName}" cancelled.`);
        refreshCampaignData();
      });

      window.electron.bulk.onMessageSent((data: any) => {
        console.log('Message sent:', data);
        refreshCampaignData();
      });

      window.electron.bulk.onMessageFailed((data: any) => {
        console.log('Message failed:', data);
        refreshCampaignData();
      });

      // Real-time message status updates
      window.electron.bulk.onBulkMessageStatusUpdated((data: any) => {
        console.log('Real-time message status updated:', data);
        
        // Update the specific message in the campaign messages list
        setCampaignMessages(prevMessages => {
          const updatedMessages = { ...prevMessages };
          Object.keys(updatedMessages).forEach(campaignId => {
            updatedMessages[parseInt(campaignId)] = updatedMessages[parseInt(campaignId)].map((message: MessageLog) => 
              message.id === data.messageId 
                ? { 
                    ...message, 
                    status: data.status,
                    sentAt: data.status === 'sent' ? data.timestamp : message.sentAt,
                    deliveredAt: data.status === 'delivered' ? data.timestamp : message.deliveredAt,
                    readAt: data.status === 'read' ? data.timestamp : message.readAt
                  }
                : message
            );
          });
          return updatedMessages;
        });

        // Update all messages list if viewing that section
        if (activeSection === 'all-messages') {
          setAllMessages(prevMessages => 
            prevMessages.map((message: any) => 
              message.id === data.messageId 
                ? { 
                    ...message, 
                    status: data.status,
                    sentAt: data.status === 'sent' ? data.timestamp : message.sentAt,
                    deliveredAt: data.status === 'delivered' ? data.timestamp : message.deliveredAt,
                    readAt: data.status === 'read' ? data.timestamp : message.readAt
                  }
                : message
            )
          );
        }
        
        // Refresh campaign data to update stats
        refreshCampaignData();
      });

      window.electron.bulk.onBulkCampaignStatsUpdated((data: any) => {
        console.log('Campaign stats updated:', data);
        refreshCampaignData();
      });

      window.electron.bulk.onBulkMessageFailed((data: any) => {
        console.log('Bulk message failed:', data);
        
        // Update the specific message with error details
        setCampaignMessages(prevMessages => {
          const updatedMessages = { ...prevMessages };
          Object.keys(updatedMessages).forEach(campaignId => {
            updatedMessages[parseInt(campaignId)] = updatedMessages[parseInt(campaignId)].map((message: MessageLog) => 
              message.id === data.messageId 
                ? { 
                    ...message, 
                    status: 'failed',
                    errorMessage: data.errorMessage
                  }
                : message
            );
          });
          return updatedMessages;
        });
        
        refreshCampaignData();
      });

      window.electron.bulk.onBulkCampaignCancelled((data: any) => {
        console.log('Campaign cancelled:', data);
        refreshCampaignData();
      });
    }
  };

  const loadInitialData = async () => {
    await Promise.all([
      loadSettings(),
      loadContactsBySource(),
      loadTemplates(),
      loadCampaigns(),
      loadStatistics()
    ]);
  };

  const refreshCampaignData = async () => {
    await Promise.all([
      loadCampaigns(),
      loadStatistics()
    ]);
    
    // Refresh messages for selected campaign if any
    if (selectedCampaign) {
      const currentLimit = messagesPagination[selectedCampaign.id]?.limit || 50;
      await loadCampaignMessages(selectedCampaign.id, messagesPagination[selectedCampaign.id]?.page || 1, campaignStatusFilters[selectedCampaign.id], currentLimit);
    }
  };

  const loadSettings = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userId = user.id || 1; // Default to 1 if no user ID
      const result = await window.electron.bulk.getSettings(userId);
      if (result.success && result.settings) {
        setSettings(result.settings);
        calculateMessagesPerDay(result.settings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userId = user.id || 1; // Default to 1 if no user ID
      const result = await window.electron.bulk.saveSettings(userId, settings);
      if (result.success) {
        setSuccess('Settings saved successfully!');
        calculateMessagesPerDay(settings);
      } else {
        setError(result.error || 'Failed to save settings');
      }
    } catch (error) {
      setError('Error saving settings');
      console.error('Error saving settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateMessagesPerDay = async (currentSettings: BulkSettings) => {
    try {
      const result = await window.electron.bulk.calculateMessagesPerDay(currentSettings);
      setMessagesPerDay(result);
    } catch (error) {
      console.error('Error calculating messages per day:', error);
    }
  };

  const loadContactsBySource = async () => {
    try {
      const result = await window.electron.bulk.getContactsBySource();
      if (result.success && result.contactsBySource) {
        setContactsBySource(result.contactsBySource);
        // Initialize with first source expanded if available
        if (Object.keys(result.contactsBySource).length > 0) {
          const firstSource = Object.keys(result.contactsBySource)[0];
          setExpandedSources(new Set([firstSource]));
          loadSourceContacts(firstSource);
        }
      }
    } catch (error) {
      console.error('Error loading contacts by source:', error);
    }
  };

  const loadSourceContacts = async (source: string, page: number = 1) => {
    try {
      setLoading(true);
      const result = await window.electron.bulk.getContactsBySourcePaginated(source, page, 50);
      if (result.success) {
        setSourceContacts(prev => ({
          ...prev,
          [source]: result.contacts || []
        }));
        setSourcePagination(prev => ({
          ...prev,
          [source]: result.pagination || { page: 1, totalPages: 1, total: 0 }
        }));
      }
    } catch (error) {
      console.error('Error loading source contacts:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const result = await window.electron.templates.getTemplates(1, 1000, '');
      if (result.success && result.templates) {
        const templatesWithVariables = result.templates.map((template: any) => ({
          ...template,
          variables: template.variables || []
        }));
        setTemplates(templatesWithVariables);
      }
    } catch (error) {
      console.error('Error loading templates:', error);
      setError('Failed to load templates');
    }
  };

  const loadCampaigns = async (page: number = 1) => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userId = user.id || 1;
      
      // Load campaigns and counts in parallel
      const [campaignsResult, countsResult] = await Promise.all([
        window.electron.bulk.getCampaignsWithFilter(
          userId, 
          page, 
          20, 
          campaignNameFilter || undefined, 
          campaignStatusFilter !== 'all' ? campaignStatusFilter : undefined
        ),
        window.electron.bulk.getCampaignCounts(userId, campaignNameFilter || undefined)
      ]);
      
      if (campaignsResult.success) {
        setCampaigns(campaignsResult.campaigns || []);
        setCampaignsPagination(campaignsResult.pagination || { page: 1, totalPages: 1, total: 0 });
      }
      
      if (countsResult.success) {
        setCampaignCounts(countsResult.counts);
      }
    } catch (error) {
      console.error('Error loading campaigns:', error);
    }
  };

  // Debounced search effect
  useEffect(() => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    
    const timer = setTimeout(() => {
      loadCampaigns(1);
    }, 300); // 300ms debounce
    
    setSearchDebounceTimer(timer);
    
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [campaignNameFilter, campaignStatusFilter]);

  const loadCampaignMessages = async (campaignId: number, page: number = 1, statusFilter?: string, limit: number = 50) => {
    try {
      setLoading(true);
      
      // Use passed filter or get from state
      const activeFilter = statusFilter !== undefined ? statusFilter : (campaignStatusFilters[campaignId] || 'all');
      
      // Load messages and counts in parallel
      const [messagesResult, countsResult] = await Promise.all([
        window.electron.bulk.getMessages(campaignId, page, limit, activeFilter),
        window.electron.bulk.getMessageCounts(campaignId)
      ]);
      
      if (messagesResult.success) {
        setCampaignMessages(prev => ({
          ...prev,
          [campaignId]: messagesResult.messages || []
        }));
        setMessagesPagination(prev => ({
          ...prev,
          [campaignId]: messagesResult.pagination || { page: 1, totalPages: 1, total: 0, limit }
        }));
      }
      
      if (countsResult.success) {
        setMessageCounts(prev => ({
          ...prev,
          [campaignId]: countsResult.counts
        }));
      }
    } catch (error) {
      console.error('Error loading campaign messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStatistics = async () => {
    try {
      const result = await window.electron.bulk.getStatistics();
      if (result.success && result.statistics) {
        setStatistics(result.statistics);
      }
    } catch (error) {
      console.error('Error loading statistics:', error);
    }
  };

  const previewTemplate = async (template: Template) => {
    try {
      // Get proper template preview from backend
      const result = await window.electron.templates.previewTemplate(template);
      if (result.success && result.preview) {
        setTemplatePreview(result.preview.text || 'No text content available');
      } else {
        // Fallback to showing raw content
        let content = '';
        if (typeof template.content === 'string') {
          try {
            const templateObj = JSON.parse(template.content);
            content = templateObj.text || templateObj.content || 'No text content available';
          } catch {
            content = template.content;
          }
        } else if (template.content && typeof template.content === 'object') {
          const templateObj = template.content as any;
          content = templateObj.text || templateObj.content || 'No text content available';
        } else {
          content = 'Template content not available';
        }
        setTemplatePreview(content);
      }
    } catch (error) {
      console.error('Error previewing template:', error);
      setTemplatePreview('Failed to load template content');
    }
  };

  const createCampaign = async () => {
    if (!newCampaignName.trim()) {
      setError('Please enter a campaign name');
      return;
    }
    if (!selectedTemplate) {
      setError('Please select a template');
      return;
    }
    if (selectedContacts.length === 0) {
      setError('Please select at least one contact');
      return;
    }

    try {
      setLoading(true);
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userId = user.id || 1; // Default to 1 if no user ID
      const result = await window.electron.bulk.createCampaign(
        userId,
        newCampaignName,
        selectedTemplate.id,
        selectedContacts
      );
      
      if (result.success) {
        setSuccess(`Campaign "${newCampaignName}" created successfully!`);
        setNewCampaignName('');
        setSelectedContacts([]);
        setSelectedTemplate(null);
        setTemplatePreview('');
        await loadCampaigns();
      } else {
        setError(result.error || 'Failed to create campaign');
      }
    } catch (error) {
      setError('Error creating campaign');
      console.error('Error creating campaign:', error);
    } finally {
      setLoading(false);
    }
  };

  const cancelCampaign = async (campaignId: number) => {
    if (!confirm('Are you sure you want to cancel this campaign?')) return;

    try {
      setLoading(true);
      const result = await window.electron.bulk.cancelCampaign(campaignId);
      if (result.success) {
        setSuccess('Campaign cancelled successfully!');
        await loadCampaigns();
      } else {
        setError(result.error || 'Failed to cancel campaign');
      }
    } catch (error) {
      setError('Error cancelling campaign');
      console.error('Error cancelling campaign:', error);
    } finally {
      setLoading(false);
    }
  };

  const cancelSelectedMessages = async (campaignId: number) => {
    if (selectedMessages.size === 0) return;
    if (!confirm(`Are you sure you want to cancel ${selectedMessages.size} selected messages?`)) return;

    try {
      setLoading(true);
      const messageIds = Array.from(selectedMessages);
      const result = await window.electron.bulk.cancelCampaignMessages(campaignId, messageIds);
      if (result.success) {
        setSuccess(`${selectedMessages.size} messages cancelled successfully!`);
        setSelectedMessages(new Set());
        const currentLimit = messagesPagination[campaignId]?.limit || 50;
        await loadCampaignMessages(campaignId, messagesPagination[campaignId]?.page || 1, campaignStatusFilters[campaignId], currentLimit);
      } else {
        setError(result.error || 'Failed to cancel messages');
      }
    } catch (error) {
      setError('Error cancelling messages');
      console.error('Error cancelling messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const cancelSingleMessage = async (messageId: number, campaignId: number) => {
    if (!confirm('Are you sure you want to cancel this message?')) return;

    try {
      setLoading(true);
      const result = await window.electron.bulk.cancelSingleMessage(messageId);
      if (result.success) {
        setSuccess('Message cancelled successfully!');
        const currentLimit = messagesPagination[campaignId]?.limit || 50;
        await loadCampaignMessages(campaignId, messagesPagination[campaignId]?.page || 1, campaignStatusFilters[campaignId], currentLimit);
      } else {
        setError(result.error || 'Failed to cancel message');
      }
    } catch (error) {
      setError('Error cancelling message');
      console.error('Error cancelling message:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMessageSelection = (messageId: number) => {
    setSelectedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const selectAllMessages = async (campaignId: number) => {
    try {
      setSelectAllLoading(true);
      const statusFilter = campaignStatusFilters[campaignId] || 'all';
      const result = await window.electron.bulk.getAllScheduledMessageIds(campaignId, statusFilter);
      
      if (result.success && result.messageIds) {
        setSelectedMessages(new Set(result.messageIds));
        setSuccess(`Selected all ${result.messageIds.length} messages`);
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError('Failed to select all messages: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      setError('Error selecting all messages: ' + error);
    } finally {
      setSelectAllLoading(false);
    }
  };

  const deselectAllMessages = () => {
    setSelectedMessages(new Set());
  };

  const deleteSelectedMessages = async () => {
    if (selectedMessages.size === 0) {
      setError('No messages selected for deletion');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedMessages.size} selected message(s)? This action cannot be undone.`)) {
      return;
    }

    try {
      setLoading(true);
      const messageIds = Array.from(selectedMessages);
      const result = await window.electron.bulk.deleteMessages(messageIds);
      
      if (result.success) {
        setSuccess(`Successfully deleted ${result.deletedCount} message(s)`);
        setSelectedMessages(new Set());
        if (selectedCampaign) {
          const currentLimit = messagesPagination[selectedCampaign.id]?.limit || 50;
          await loadCampaignMessages(selectedCampaign.id, messagesPagination[selectedCampaign.id]?.page || 1, campaignStatusFilters[selectedCampaign.id], currentLimit);
        }
        await loadCampaigns();
      } else {
        setError(result.error || 'Failed to delete messages');
      }
    } catch (error) {
      setError('Error deleting messages');
      console.error('Error deleting messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSourceExpansion = (source: string) => {
    const newExpanded = new Set(expandedSources);
    if (newExpanded.has(source)) {
      newExpanded.delete(source);
    } else {
      newExpanded.add(source);
      if (!sourceContacts[source]) {
        loadSourceContacts(source);
      }
    }
    setExpandedSources(newExpanded);
  };

  const handleContactSelection = (source: string, contactId: number) => {
    setSourceSelections(prev => {
      const currentSelection = prev[source] || [];
      const newSelection = currentSelection.includes(contactId)
        ? currentSelection.filter(id => id !== contactId)
        : [...currentSelection, contactId];
      
      return { ...prev, [source]: newSelection };
    });
    
    // Update global selected contacts
    const allSelected = Object.values(sourceSelections).flat();
    const isSelected = allSelected.includes(contactId);
    setSelectedContacts(prev => 
      isSelected ? prev.filter(id => id !== contactId) : [...prev, contactId]
    );
  };

  const selectAllSourceContacts = (source: string) => {
    const contacts = sourceContacts[source] || [];
    const allIds = contacts.map(contact => contact.id);
    setSourceSelections(prev => ({ ...prev, [source]: allIds }));
    setSelectedContacts(prev => [...new Set([...prev, ...allIds])]);
  };

  const deselectAllSourceContacts = (source: string) => {
    const contacts = sourceContacts[source] || [];
    const allIds = contacts.map(contact => contact.id);
    setSourceSelections(prev => ({ ...prev, [source]: [] }));
    setSelectedContacts(prev => prev.filter(id => !allIds.includes(id)));
  };

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'scheduled': return '#6c757d'; // Gray
      case 'sending': return '#17a2b8';   // Info blue
      case 'sent': return '#007bff';      // Primary blue
      case 'delivered': return '#28a745'; // Success green
      case 'read': return '#20c997';      // Teal (brighter green)
      case 'failed': return '#dc3545';    // Danger red
      case 'cancelled': return '#ffc107'; // Warning yellow
      case 'completed': return '#28a745'; // Success green
      default: return '#6c757d';          // Default gray
    }
  };

  const renderSettings = () => (
    <div className="bulk-section">
      <div className="section-header">
        <h3>Bulk Sender Settings</h3>
        <button 
          className="save-button"
          onClick={saveSettings}
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="settings-grid">
        <div className="setting-group">
          <label>Active Hours</label>
          <div className="time-range">
            <div className="time-inputs">
              <select
                value={settings.startHour}
                onChange={(e) => setSettings({...settings, startHour: parseInt(e.target.value)})}
              >
                {Array.from({length: 24}, (_, i) => (
                  <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                ))}
              </select>
              <span>:</span>
              <select
                value={settings.startMinute}
                onChange={(e) => setSettings({...settings, startMinute: parseInt(e.target.value)})}
              >
                {Array.from({length: 60}, (_, i) => (
                  <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                ))}
              </select>
            </div>
            <span>to</span>
            <div className="time-inputs">
              <select
                value={settings.endHour}
                onChange={(e) => setSettings({...settings, endHour: parseInt(e.target.value)})}
              >
                {Array.from({length: 24}, (_, i) => (
                  <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                ))}
              </select>
              <span>:</span>
              <select
                value={settings.endMinute}
                onChange={(e) => setSettings({...settings, endMinute: parseInt(e.target.value)})}
              >
                {Array.from({length: 60}, (_, i) => (
                  <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="setting-group">
          <label>Send Interval</label>
          <div className="interval-inputs">
            <input
              type="number"
              min="0"
              max="59"
              value={settings.intervalMinutes}
              onChange={(e) => setSettings({...settings, intervalMinutes: parseInt(e.target.value) || 0})}
              placeholder="Minutes"
            />
            <span>min</span>
            <input
              type="number"
              min="1"
              max="59"
              value={settings.intervalSeconds}
              onChange={(e) => setSettings({...settings, intervalSeconds: parseInt(e.target.value) || 1})}
              placeholder="Seconds"
            />
            <span>sec</span>
          </div>
        </div>

        <div className="setting-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.isActive}
              onChange={(e) => setSettings({...settings, isActive: e.target.checked})}
            />
            Enable Bulk Sender
          </label>
        </div>
      </div>

      <div className="settings-info">
        <div className="info-card">
          <h4>Calculated Messages Per Day</h4>
          <div className="messages-count">{messagesPerDay.toLocaleString()}</div>
          <p>Based on your current settings</p>
        </div>
      </div>
    </div>
  );

  const renderContacts = () => (
    <div className="bulk-section">
      <div className="section-header">
        <h3>Contacts by Source</h3>
        <div className="total-selected">
          Total Selected: {selectedContacts.length}
        </div>
      </div>

      <div className="sources-list">
        {Object.entries(contactsBySource).map(([source, data]) => (
          <div key={source} className="source-item">
            <div className="source-header" onClick={() => toggleSourceExpansion(source)}>
              <div className="source-info">
                <span className="expand-icon">
                  {expandedSources.has(source) ? '▼' : '▶'}
                </span>
                <span className="source-name">{source}</span>
                <span className="source-count">({data.count} contacts)</span>
              </div>
              {sourceSelections[source] && sourceSelections[source].length > 0 && (
                <div className="source-selected">
                  {sourceSelections[source].length} selected
                </div>
              )}
            </div>

            {expandedSources.has(source) && (
              <div className="source-content">
                <div className="source-actions">
                  <button onClick={() => selectAllSourceContacts(source)}>Select All</button>
                  <button onClick={() => deselectAllSourceContacts(source)}>Deselect All</button>
                </div>

                {sourceContacts[source] && (
                  <>
                    <div className="contacts-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Select</th>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Email</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sourceContacts[source].map((contact: any) => (
                            <tr key={contact.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={sourceSelections[source]?.includes(contact.id) || false}
                                  onChange={() => handleContactSelection(source, contact.id)}
                                />
                              </td>
                              <td>{contact.name} {contact.surname}</td>
                              <td>{contact.phone}</td>
                              <td>{contact.email || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {sourcePagination[source]?.totalPages > 1 && (
                      <div className="pagination">
                        <button
                          disabled={sourcePagination[source].page === 1}
                          onClick={() => loadSourceContacts(source, sourcePagination[source].page - 1)}
                        >
                          Previous
                        </button>
                        <span>Page {sourcePagination[source].page} of {sourcePagination[source].totalPages}</span>
                        <button
                          disabled={sourcePagination[source].page === sourcePagination[source].totalPages}
                          onClick={() => loadSourceContacts(source, sourcePagination[source].page + 1)}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderTemplates = () => (
    <div className="bulk-section">
      <div className="section-header">
        <h3>Template Selection</h3>
        {selectedTemplate && (
          <div className="selected-template-info">
            Selected: {selectedTemplate.name}
          </div>
        )}
      </div>

      <div className="templates-grid">
        {templates.length === 0 ? (
          <div className="no-templates">
            <p>No templates available. Please create templates first.</p>
          </div>
        ) : (
          templates.map(template => (
            <div 
              key={template.id}
              className={`template-card ${selectedTemplate?.id === template.id ? 'selected' : ''}`}
              onClick={() => {
                setSelectedTemplate(template);
                previewTemplate(template);
              }}
            >
              <div className="template-info">
                <h4>{template.name || 'Untitled Template'}</h4>
                <div className="template-content">
                  {(() => {
                    try {
                      let content: any = template.content;
                      if (typeof content === 'string') {
                        content = JSON.parse(content);
                      }
                      
                      return (
                        <div>
                          {content.text && (
                            <p>{content.text.substring(0, 100)}{content.text.length > 100 ? '...' : ''}</p>
                          )}
                          {content.images && content.images.length > 0 && (
                            <div className="template-images-preview">
                              <span className="image-count">📷 {content.images.length} image{content.images.length > 1 ? 's' : ''}</span>
                            </div>
                          )}
                          {!content.text && (!content.images || content.images.length === 0) && (
                            <p>No content available</p>
                          )}
                        </div>
                      );
                    } catch (error) {
                      return <p>Template content not available</p>;
                    }
                  })()}
                </div>
                {template.variables && template.variables.length > 0 && (
                  <div className="template-variables">
                    Variables: {template.variables.join(', ')}
                  </div>
                )}
              </div>
              <div className="template-radio">
                <input
                  type="radio"
                  name="selectedTemplate"
                  checked={selectedTemplate?.id === template.id}
                  onChange={() => {
                    setSelectedTemplate(template);
                    previewTemplate(template);
                  }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {selectedTemplate && (
        <div className="template-preview">
          <h4>Template Preview</h4>
          <div className="preview-content">
            {templatePreview && (
              <div className="preview-text">
                {templatePreview}
              </div>
            )}
            {(() => {
              try {
                let content: any = selectedTemplate.content;
                if (typeof content === 'string') {
                  content = JSON.parse(content);
                }
                
                if (content.images && content.images.length > 0) {
                  return (
                    <div className="preview-images">
                      <h5>Images ({content.images.length}):</h5>
                      <div className="images-grid">
                        {content.images.map((image: string, index: number) => (
                          <div key={index} className="image-preview">
                            {image.startsWith('data:image/') ? (
                              <img src={image} alt={`Template image ${index + 1}`} />
                            ) : (
                              <div className="image-placeholder">
                                📷 Image {index + 1}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                return null;
              } catch (error) {
                return null;
              }
            })()}
          </div>
        </div>
      )}

      {selectedTemplate && selectedContacts.length > 0 && (
        <div className="campaign-creation">
          <h4>Create Campaign</h4>
          <div className="campaign-form">
            <input
              type="text"
              placeholder="Campaign Name"
              value={newCampaignName}
              onChange={(e) => setNewCampaignName(e.target.value)}
            />
            <button
              className="create-campaign-button"
              onClick={createCampaign}
              disabled={loading || !newCampaignName.trim()}
            >
              {loading ? 'Creating...' : `Create Campaign (${selectedContacts.length} contacts)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderMessages = () => (
    <div className="bulk-section">
      <div className="section-header">
        <h3>Bulk Messages & Campaigns</h3>
        {selectedCampaigns.size > 0 && (
          <div className="bulk-campaign-actions">
            <button
              className="delete-selected-button"
              onClick={deleteSelectedCampaigns}
              disabled={loading}
            >
              Delete Selected ({selectedCampaigns.size})
            </button>
          </div>
        )}
      </div>

      <div className="campaigns-section">
        <div className="campaigns-header">
          <h4>Campaigns</h4>
          <div className="campaign-filters">
            <input
              type="text"
              placeholder="Search campaigns..."
              value={campaignNameFilter}
              onChange={(e) => setCampaignNameFilter(e.target.value)}
              className="campaign-search"
            />
            <select
              value={campaignStatusFilter}
              onChange={(e) => setCampaignStatusFilter(e.target.value)}
              className="campaign-status-filter"
            >
              <option value="all">All Statuses {campaignCounts ? `(${campaignCounts.total})` : ''}</option>
              <option value="scheduled">Scheduled {campaignCounts ? `(${campaignCounts.scheduled})` : ''}</option>
              <option value="sending">Sending {campaignCounts ? `(${campaignCounts.sending})` : ''}</option>
              <option value="paused">Paused {campaignCounts ? `(${campaignCounts.paused})` : ''}</option>
              <option value="completed">Completed {campaignCounts ? `(${campaignCounts.completed})` : ''}</option>
              <option value="cancelled">Cancelled {campaignCounts ? `(${campaignCounts.cancelled})` : ''}</option>
            </select>
            <div className="campaign-selection-controls">
              <button onClick={selectAllCampaigns} className="select-all-btn">
                Select All
              </button>
              <button onClick={deselectAllCampaigns} className="deselect-all-btn">
                Deselect All
              </button>
            </div>
          </div>
        </div>
        <div className="campaigns-list">
          {campaigns.map(campaign => (
            <div key={campaign.id} className="campaign-card">
              <div className="campaign-header">
                <div className="campaign-select">
                  <input
                    type="checkbox"
                    checked={selectedCampaigns.has(campaign.id)}
                    onChange={() => handleCampaignSelection(campaign.id)}
                  />
                </div>
                <div className="campaign-title-section">
                  <h5>{campaign.campaignName}</h5>
                  <div className="campaign-template">Template: {(campaign as any).templateName || 'Unknown'}
                  </div>
                </div>
                <div className="campaign-status" style={{ color: getStatusColor(campaign.status) }}>
                  {campaign.status.toUpperCase()}
                </div>
              </div>
              
              <div className="campaign-stats">
                <div className="stat">
                  <span className="stat-label">Total:</span>
                  <span className="stat-value">{campaign.totalMessages}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Sent:</span>
                  <span className="stat-value">{campaign.sentCount}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Delivered:</span>
                  <span className="stat-value">{campaign.deliveredCount}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Read:</span>
                  <span className="stat-value">{campaign.readCount}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Failed:</span>
                  <span className="stat-value">{campaign.failedCount}</span>
                </div>
              </div>

              <div className="campaign-progress">
                <div className="progress-bar">
                  <div 
                    className="progress-fill"
                    style={{ 
                      width: `${campaign.totalMessages > 0 ? Math.min(((campaign.sentCount + campaign.deliveredCount + campaign.readCount + campaign.failedCount) / campaign.totalMessages) * 100, 100) : 0}%` 
                    }}
                  />
                </div>
                <span className="progress-text">
                  {campaign.totalMessages > 0 ? Math.round(((campaign.sentCount + campaign.deliveredCount + campaign.readCount + campaign.failedCount) / campaign.totalMessages) * 100) : 0}% {campaign.status === 'sending' ? 'Sent' : 'Complete'}
                </span>
              </div>

              <div className="campaign-actions">
                <button
                  onClick={() => {
                    setSelectedCampaign(campaign);
                    // Always reset pagination to first page when viewing messages
                    setMessagesPagination(prev => ({
                      ...prev,
                      [campaign.id]: { page: 1, totalPages: 1, total: 0, limit: 50 }
                    }));
                    // Reset status filter for this campaign
                    setCampaignStatusFilters(prev => ({
                      ...prev,
                      [campaign.id]: 'all'
                    }));
                    loadCampaignMessages(campaign.id, 1, 'all', 50);
                  }}
                >
                  View Messages
                </button>
                {hasScheduledMessages(campaign) && (
                  <button
                    className="cancel-button"
                    onClick={() => cancelCampaign(campaign.id)}
                  >
                    Cancel
                  </button>
                )}
              </div>

              <div className="campaign-date">
                Created: {new Date(campaign.createdAt).toLocaleString()}
              </div>

              {/* Messages display for selected campaign */}
              {selectedCampaign && selectedCampaign.id === campaign.id && (
                <div className="campaign-messages-inline">
                  <div className="messages-header">
                    <h5>Messages for "{selectedCampaign.campaignName}"</h5>
                    <div className="messages-actions">
                      {selectedMessages.size > 0 && hasScheduledMessages(selectedCampaign) && (
                        <>
                          <button 
                            className="cancel-selected-button"
                            onClick={() => cancelSelectedMessages(selectedCampaign.id)}
                            disabled={loading}
                          >
                            Cancel Selected ({selectedMessages.size})
                          </button>
                          <button 
                            className="delete-selected-button"
                            onClick={deleteSelectedMessages}
                            disabled={loading}
                          >
                            Delete Selected ({selectedMessages.size})
                          </button>
                        </>
                      )}
                      <button onClick={() => setSelectedCampaign(null)}>Close</button>
                    </div>
                  </div>

                  <div className="messages-controls">
                    <div className="controls-row">
                      <div className="filter-section">
                        <label>Filter by status:</label>
                        <select 
                          value={campaignStatusFilters[selectedCampaign.id] || 'all'} 
                          onChange={(e) => {
                            const newFilter = e.target.value;
                            setCampaignStatusFilters(prev => ({
                              ...prev,
                              [selectedCampaign.id]: newFilter
                            }));
                            // Reset pagination to page 1 for new filter
                            setMessagesPagination(prev => ({
                              ...prev,
                              [selectedCampaign.id]: { 
                                ...(prev[selectedCampaign.id] || {}), 
                                page: 1 
                              }
                            }));
                            // Clear any selected messages when changing filter
                            setSelectedMessages(new Set());
                            // Pass the new filter directly to avoid async state issues
                            loadCampaignMessages(selectedCampaign.id, 1, newFilter);
                          }}
                        >
                          <option value="all">All Messages {messageCounts[selectedCampaign.id] ? `(${messageCounts[selectedCampaign.id].total})` : ''}</option>
                          <option value="scheduled">Scheduled {messageCounts[selectedCampaign.id] ? `(${messageCounts[selectedCampaign.id].scheduled})` : ''}</option>
                          <option value="sent">Sent {messageCounts[selectedCampaign.id] ? `(${messageCounts[selectedCampaign.id].sent})` : ''}</option>
                          <option value="delivered">Delivered {messageCounts[selectedCampaign.id] ? `(${messageCounts[selectedCampaign.id].delivered})` : ''}</option>
                          <option value="read">Read {messageCounts[selectedCampaign.id] ? `(${messageCounts[selectedCampaign.id].read})` : ''}</option>
                          <option value="failed">Failed {messageCounts[selectedCampaign.id] ? `(${messageCounts[selectedCampaign.id].failed})` : ''}</option>
                          <option value="cancelled">Cancelled {messageCounts[selectedCampaign.id] ? `(${messageCounts[selectedCampaign.id].cancelled})` : ''}</option>
                        </select>
                      </div>
                      
                      <div className="selection-controls">
                        <button 
                          onClick={() => selectAllMessages(selectedCampaign.id)}
                          disabled={selectAllLoading}
                        >
                          {selectAllLoading ? (
                            <>
                              <span className="spinner">⏳</span> Selecting...
                            </>
                          ) : (
                            'Select All Pages'
                          )}
                        </button>
                        <button onClick={deselectAllMessages}>Deselect All</button>
                        <span className="selected-count">
                          {selectedMessages.size} selected
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="messages-list">
                    {(campaignMessages[selectedCampaign.id] || []).map((message: MessageLog) => (
                      <div key={message.id} className="message-card">
                        <div className="message-header">
                          <div className="message-select">
                            <input
                              type="checkbox"
                              checked={selectedMessages.has(message.id!)}
                              onChange={() => handleMessageSelection(message.id!)}
                            />
                          </div>
                          <div className="message-contact">
                            <strong>{message.contactName} {message.contactSurname}</strong>
                            <span className="message-phone">{message.contactPhone}</span>
                            <div className="message-template">Template: {message.templateName}</div>
                          </div>
                          <div className="message-status-section">
                            <span 
                              className="message-status-badge" 
                              style={{ 
                                backgroundColor: getStatusColor(message.status),
                                color: 'white',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: 'bold'
                              }}
                            >
                              {message.status.toUpperCase()}
                            </span>
                          </div>
                          {message.status === 'scheduled' && (
                            <button 
                              className="cancel-single-button"
                              onClick={() => cancelSingleMessage(message.id!, selectedCampaign.id)}
                              disabled={loading}
                            >
                              Cancel
                            </button>
                          )}
                        </div>

                        <div className="message-details">
                          <div className="message-times">
                            <div className="timestamp-row">
                              <strong>Scheduled:</strong> {formatTimestamp(message.scheduledAt)}
                            </div>
                            {message.sentAt && (
                              <div className="timestamp-row">
                                <strong>Sent:</strong> {formatTimestamp(message.sentAt)}
                              </div>
                            )}
                            {message.deliveredAt && (
                              <div className="timestamp-row">
                                <strong>Delivered:</strong> {formatTimestamp(message.deliveredAt)}
                              </div>
                            )}
                            {message.readAt && (
                              <div className="timestamp-row">
                                <strong>Read:</strong> {formatTimestamp(message.readAt)}
                              </div>
                            )}
                          </div>

                          {message.errorMessage && (
                            <div className="message-error">
                              <strong>Error:</strong> {message.errorMessage}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Enhanced pagination controls */}
                  {messagesPagination[selectedCampaign.id] && (
                    <div className="enhanced-pagination" style={{ display: 'block', visibility: 'visible' }}>
                      <div className="pagination-controls-row">
                        <div className="items-per-page">
                          <span>Items per page:</span>
                          <select 
                            value={messagesPagination[selectedCampaign.id]?.limit || 50}
                            onChange={async (e) => {
                              const newLimit = parseInt(e.target.value);
                              setMessagesPagination(prev => ({
                                ...prev,
                                [selectedCampaign.id]: { 
                                  ...prev[selectedCampaign.id], 
                                  limit: newLimit, 
                                  page: 1 
                                }
                              }));
                              
                              // Load messages with new limit directly
                              try {
                                setLoading(true);
                                const statusFilter = campaignStatusFilters[selectedCampaign.id] || 'all';
                                const [messagesResult, countsResult] = await Promise.all([
                                  window.electron.bulk.getMessages(selectedCampaign.id, 1, newLimit, statusFilter),
                                  window.electron.bulk.getMessageCounts(selectedCampaign.id)
                                ]);
                                
                                if (messagesResult.success) {
                                  setCampaignMessages(prev => ({
                                    ...prev,
                                    [selectedCampaign.id]: messagesResult.messages || []
                                  }));
                                  setMessagesPagination(prev => ({
                                    ...prev,
                                    [selectedCampaign.id]: messagesResult.pagination ? { ...messagesResult.pagination, limit: newLimit } : { page: 1, totalPages: 1, total: 0, limit: newLimit }
                                  }));
                                }
                                
                                if (countsResult.success) {
                                  setMessageCounts(prev => ({
                                    ...prev,
                                    [selectedCampaign.id]: countsResult.counts
                                  }));
                                }
                              } catch (error) {
                                console.error('Error loading campaign messages:', error);
                              } finally {
                                setLoading(false);
                              }
                            }}
                          >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </select>
                        </div>
                        
                        <div className="page-jump">
                          <span>Go to page:</span>
                          <form 
                            onSubmit={(e) => {
                              e.preventDefault();
                              const formData = new FormData(e.currentTarget);
                              const page = parseInt(formData.get('pageNumber') as string);
                              const maxPages = messagesPagination[selectedCampaign.id]?.totalPages || 1;
                              const currentLimit = messagesPagination[selectedCampaign.id]?.limit || 50;
                              
                              if (page && page >= 1 && page <= maxPages) {
                                loadCampaignMessages(selectedCampaign.id, page, campaignStatusFilters[selectedCampaign.id], currentLimit);
                                e.currentTarget.reset();
                              }
                            }}
                          >
                            <input 
                              type="number" 
                              name="pageNumber" 
                              min="1" 
                              max={messagesPagination[selectedCampaign.id]?.totalPages || 1} 
                              placeholder="Page"
                            />
                            <button type="submit">Go</button>
                          </form>
                        </div>
                      </div>
                      
                      <div className="pagination-buttons">
                        <button
                          disabled={messagesPagination[selectedCampaign.id]?.page === 1}
                          onClick={() => {
                            const currentLimit = messagesPagination[selectedCampaign.id]?.limit || 50;
                            loadCampaignMessages(selectedCampaign.id, 1, campaignStatusFilters[selectedCampaign.id], currentLimit);
                          }}
                        >
                          First
                        </button>
                        <button
                          disabled={messagesPagination[selectedCampaign.id]?.page === 1}
                          onClick={() => {
                            const currentLimit = messagesPagination[selectedCampaign.id]?.limit || 50;
                            loadCampaignMessages(selectedCampaign.id, messagesPagination[selectedCampaign.id].page - 1, campaignStatusFilters[selectedCampaign.id], currentLimit);
                          }}
                        >
                          Previous
                        </button>
                        <span className="page-info">
                          Page {messagesPagination[selectedCampaign.id]?.page} of {messagesPagination[selectedCampaign.id]?.totalPages}
                        </span>
                        <button
                          disabled={messagesPagination[selectedCampaign.id]?.page === messagesPagination[selectedCampaign.id]?.totalPages}
                          onClick={() => {
                            const currentLimit = messagesPagination[selectedCampaign.id]?.limit || 50;
                            loadCampaignMessages(selectedCampaign.id, messagesPagination[selectedCampaign.id].page + 1, campaignStatusFilters[selectedCampaign.id], currentLimit);
                          }}
                        >
                          Next
                        </button>
                        <button
                          disabled={messagesPagination[selectedCampaign.id]?.page === messagesPagination[selectedCampaign.id]?.totalPages}
                          onClick={() => {
                            const currentLimit = messagesPagination[selectedCampaign.id]?.limit || 50;
                            loadCampaignMessages(selectedCampaign.id, messagesPagination[selectedCampaign.id].totalPages, campaignStatusFilters[selectedCampaign.id], currentLimit);
                          }}
                        >
                          Last
                        </button>
                      </div>
                      
                      <div className="pagination-info">
                        Showing {messagesPagination[selectedCampaign.id]?.page > 0 ? ((messagesPagination[selectedCampaign.id].page - 1) * (messagesPagination[selectedCampaign.id].limit || 50)) + 1 : 0} 
                        - {Math.min((messagesPagination[selectedCampaign.id]?.page || 1) * (messagesPagination[selectedCampaign.id].limit || 50), messagesPagination[selectedCampaign.id]?.total || 0)} 
                        of {messagesPagination[selectedCampaign.id]?.total || 0} messages
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {campaignsPagination.totalPages > 1 && (
          <div className="pagination">
            <button
              disabled={campaignsPagination.page === 1}
              onClick={() => loadCampaigns(campaignsPagination.page - 1)}
            >
              Previous
            </button>
            <span>Page {campaignsPagination.page} of {campaignsPagination.totalPages}</span>
            <button
              disabled={campaignsPagination.page === campaignsPagination.totalPages}
              onClick={() => loadCampaigns(campaignsPagination.page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderAllMessages = () => (
    <div className="bulk-section">
      <div className="section-header">
        <h3>All Messages Across Campaigns</h3>
        {selectedAllMessages.size > 0 && (
          <div className="bulk-message-actions">
            <button
              className="delete-selected-button"
              onClick={async () => {
                if (selectedAllMessages.size === 0) return;
                if (!confirm(`Are you sure you want to delete ${selectedAllMessages.size} selected message(s)?`)) return;
                
                try {
                  setLoading(true);
                  const messageIds = Array.from(selectedAllMessages);
                  const result = await window.electron.bulk.deleteMessages(messageIds);
                  
                  if (result.success) {
                    setSuccess(`Successfully deleted ${result.deletedCount} message(s)`);
                    setSelectedAllMessages(new Set());
                    await loadAllMessages(1, allMessagesPagination.limit || 50);
                  } else {
                    setError(result.error || 'Failed to delete messages');
                  }
                } catch (error) {
                  setError('Error deleting messages');
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              Delete Selected ({selectedAllMessages.size})
            </button>
          </div>
        )}
      </div>

      <div className="all-messages-filters">
        <div className="filter-row">
          <div className="filter-section">
            <label>Filter by campaign:</label>
            <select
              value={allMessagesCampaignFilter}
              onChange={(e) => {
                setAllMessagesCampaignFilter(e.target.value);
                setAllMessagesPagination(prev => ({ ...prev, page: 1 }));
                setSelectedAllMessages(new Set());
              }}
              className="campaign-dropdown"
            >
              <option value="all">All Campaigns {allMessagesCounts ? `(${allMessagesCounts.total} messages)` : ''}</option>
              {availableCampaigns.map(campaign => (
                <option key={campaign.id} value={campaign.campaignName}>
                  {campaign.campaignName}
                </option>
              ))}
            </select>
          </div>
        
          <div className="filter-section">
            <label>Filter by status:</label>
            <select 
              value={allMessagesStatusFilter} 
              onChange={(e) => setAllMessagesStatusFilter(e.target.value)}
            >
              <option value="all">All Messages {allMessagesCounts ? `(${allMessagesCounts.total})` : ''}</option>
              <option value="scheduled">Scheduled {allMessagesCounts ? `(${allMessagesCounts.scheduled})` : ''}</option>
              <option value="sent">Sent {allMessagesCounts ? `(${allMessagesCounts.sent})` : ''}</option>
              <option value="delivered">Delivered {allMessagesCounts ? `(${allMessagesCounts.delivered})` : ''}</option>
              <option value="read">Read {allMessagesCounts ? `(${allMessagesCounts.read})` : ''}</option>
              <option value="failed">Failed {allMessagesCounts ? `(${allMessagesCounts.failed})` : ''}</option>
              <option value="cancelled">Cancelled {allMessagesCounts ? `(${allMessagesCounts.cancelled})` : ''}</option>
            </select>
          </div>
          
          <div className="selection-controls">
            <button onClick={selectAllAllMessages}>Select All</button>
            <button onClick={deselectAllAllMessages}>Deselect All</button>
            <span className="selected-count">
              {selectedAllMessages.size} selected
            </span>
          </div>
        </div>
      </div>

      <div className="all-messages-list">
        {allMessages.map((message: any) => (
          <div key={message.id} className="message-card">
            <div className="message-header">
              <div className="message-select">
                <input
                  type="checkbox"
                  checked={selectedAllMessages.has(message.id)}
                  onChange={() => handleAllMessageSelection(message.id)}
                />
              </div>
              <div className="message-contact">
                <strong>{message.contactName} {message.contactSurname}</strong>
                <span className="message-phone">{message.contactPhone}</span>
                <div className="message-template">Template: {message.templateName}</div>
                <div className="message-campaign">Campaign: {message.campaignName}</div>
              </div>
              <div className="message-status-section">
                <span 
                  className="message-status-badge" 
                  style={{ 
                    backgroundColor: getStatusColor(message.status),
                    color: 'white',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                >
                  {message.status.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="message-details">
              <div className="message-times">
                <div className="timestamp-row">
                  <strong>Scheduled:</strong> {formatTimestamp(message.scheduledAt)}
                </div>
                {message.sentAt && (
                  <div className="timestamp-row">
                    <strong>Sent:</strong> {formatTimestamp(message.sentAt)}
                  </div>
                )}
                {message.deliveredAt && (
                  <div className="timestamp-row">
                    <strong>Delivered:</strong> {formatTimestamp(message.deliveredAt)}
                  </div>
                )}
                {message.readAt && (
                  <div className="timestamp-row">
                    <strong>Read:</strong> {formatTimestamp(message.readAt)}
                  </div>
                )}
              </div>

              {message.errorMessage && (
                <div className="message-error">
                  <strong>Error:</strong> {message.errorMessage}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {allMessagesPagination && (
        <div className="enhanced-pagination" style={{ display: 'block', visibility: 'visible' }}>
          <div className="pagination-controls-row">
            <div className="items-per-page">
              <span>Items per page:</span>
              <select 
                value={allMessagesPagination.limit || 50}
                onChange={async (e) => {
                  const newLimit = parseInt(e.target.value);
                  setAllMessagesPagination(prev => ({
                    ...prev,
                    limit: newLimit,
                    page: 1
                  }));
                  
                  // Load messages with new limit directly
                  try {
                    setLoading(true);
                    const user = JSON.parse(localStorage.getItem('user') || '{}');
                    const userId = user.id || 1;
                    
                    const [messagesResult, countsResult] = await Promise.all([
                      window.electron.bulk.getAllMessages(
                        userId, 
                        1, 
                        newLimit, 
                        allMessagesStatusFilter !== 'all' ? allMessagesStatusFilter : undefined,
                        allMessagesCampaignFilter !== 'all' ? allMessagesCampaignFilter : undefined
                      ),
                      window.electron.bulk.getAllMessageCounts(
                        userId, 
                        allMessagesCampaignFilter !== 'all' ? allMessagesCampaignFilter : undefined
                      )
                    ]);
                    
                    if (messagesResult.success) {
                      setAllMessages(messagesResult.messages || []);
                      setAllMessagesPagination(messagesResult.pagination ? { ...messagesResult.pagination, limit: newLimit } : { page: 1, totalPages: 1, total: 0, limit: newLimit });
                    }
                    
                    if (countsResult.success) {
                      setAllMessagesCounts(countsResult.counts);
                    }
                  } catch (error) {
                    console.error('Error loading all messages:', error);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
            
            <div className="page-jump">
              <span>Go to page:</span>
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const page = parseInt(formData.get('pageNumber') as string);
                  const maxPages = allMessagesPagination.totalPages || 1;
                  
                  if (page && page >= 1 && page <= maxPages) {
                    loadAllMessages(page, allMessagesPagination.limit);
                    e.currentTarget.reset();
                  }
                }}
              >
                <input 
                  type="number" 
                  name="pageNumber" 
                  min="1" 
                  max={allMessagesPagination.totalPages || 1} 
                  placeholder="Page"
                />
                <button type="submit">Go</button>
              </form>
            </div>
          </div>
          
          <div className="pagination-buttons">
            <button
              disabled={allMessagesPagination.page === 1}
              onClick={() => loadAllMessages(1, allMessagesPagination.limit)}
            >
              First
            </button>
            <button
              disabled={allMessagesPagination.page === 1}
              onClick={() => loadAllMessages(allMessagesPagination.page - 1, allMessagesPagination.limit)}
            >
              Previous
            </button>
            <span className="page-info">
              Page {allMessagesPagination.page} of {allMessagesPagination.totalPages}
            </span>
            <button
              disabled={allMessagesPagination.page === allMessagesPagination.totalPages}
              onClick={() => loadAllMessages(allMessagesPagination.page + 1, allMessagesPagination.limit)}
            >
              Next
            </button>
            <button
              disabled={allMessagesPagination.page === allMessagesPagination.totalPages}
              onClick={() => loadAllMessages(allMessagesPagination.totalPages, allMessagesPagination.limit)}
            >
              Last
            </button>
          </div>
          
          <div className="pagination-info">
            Showing {allMessagesPagination.page > 0 ? ((allMessagesPagination.page - 1) * (allMessagesPagination.limit || 50)) + 1 : 0} 
            - {Math.min((allMessagesPagination.page || 1) * (allMessagesPagination.limit || 50), allMessagesPagination.total || 0)} 
            of {allMessagesPagination.total || 0} messages
          </div>
        </div>
      )}
    </div>
  );

  const renderStatistics = () => {
    // Prepare chart data
    const prepareChartData = () => {
      if (!statistics) return null;
      
      const statusLabels = ['Scheduled', 'Sent', 'Delivered', 'Read', 'Failed', 'Cancelled'];
      const statusColors = [
        'rgba(108, 117, 125, 0.8)', // Scheduled - Gray
        'rgba(0, 123, 255, 0.8)',   // Sent - Blue
        'rgba(40, 167, 69, 0.8)',   // Delivered - Green
        'rgba(32, 201, 151, 0.8)',  // Read - Teal
        'rgba(220, 53, 69, 0.8)',   // Failed - Red
        'rgba(255, 193, 7, 0.8)'    // Cancelled - Yellow
      ];
      
      const statusData = [
        statistics.statusCounts.scheduled,
        statistics.statusCounts.sent,
        statistics.statusCounts.delivered,
        statistics.statusCounts.read,
        statistics.statusCounts.failed,
        statistics.statusCounts.cancelled
      ];

      // Pie chart data
      const pieData = {
        labels: statusLabels,
        datasets: [
          {
            data: statusData,
            backgroundColor: statusColors,
            borderColor: statusColors.map(color => color.replace('0.8', '1')),
            borderWidth: 2
          }
        ]
      };

      // Bar chart data for daily stats
      const dailyDates = Object.keys(statistics.dailyStats || {}).slice(-7);
      const barData = {
        labels: dailyDates.map(date => {
          const d = new Date(date);
          return `${d.getMonth() + 1}/${d.getDate()}`;
        }),
        datasets: [
          {
            label: 'Scheduled',
            data: dailyDates.map(date => statistics.dailyStats[date]?.scheduled || 0),
            backgroundColor: 'rgba(108, 117, 125, 0.6)',
            borderColor: 'rgba(108, 117, 125, 1)',
            borderWidth: 1
          },
          {
            label: 'Sent',
            data: dailyDates.map(date => statistics.dailyStats[date]?.sent || 0),
            backgroundColor: 'rgba(0, 123, 255, 0.6)',
            borderColor: 'rgba(0, 123, 255, 1)',
            borderWidth: 1
          },
          {
            label: 'Delivered',
            data: dailyDates.map(date => statistics.dailyStats[date]?.delivered || 0),
            backgroundColor: 'rgba(40, 167, 69, 0.6)',
            borderColor: 'rgba(40, 167, 69, 1)',
            borderWidth: 1
          },
          {
            label: 'Read',
            data: dailyDates.map(date => statistics.dailyStats[date]?.read || 0),
            backgroundColor: 'rgba(32, 201, 151, 0.6)',
            borderColor: 'rgba(32, 201, 151, 1)',
            borderWidth: 1
          },
          {
            label: 'Failed',
            data: dailyDates.map(date => statistics.dailyStats[date]?.failed || 0),
            backgroundColor: 'rgba(220, 53, 69, 0.6)',
            borderColor: 'rgba(220, 53, 69, 1)',
            borderWidth: 1
          }
        ]
      };

      return { pieData, barData };
    };

    const chartData = statistics ? prepareChartData() : null;

    return (
      <div className="bulk-section">
        <div className="section-header">
          <h3>Bulk Sender Statistics</h3>
          <div className="timeframe-selector">
            <select
              value={statsTimeframe}
              onChange={(e) => setStatsTimeframe(e.target.value as any)}
            >
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
            </select>
            <button
              className="btn btn-outline-secondary"
              onClick={loadStatistics}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {statistics && (
          <div className="statistics-content">
            {/* Summary Cards */}
            <div className="stats-summary">
              <div className="summary-card">
                <h4>Total Messages</h4>
                <div className="stat-number">{statistics.total}</div>
              </div>
              <div className="summary-card">
                <h4>Total Campaigns</h4>
                <div className="stat-number">{statistics.totalCampaigns}</div>
              </div>
              <div className="summary-card">
                <h4>Active Campaigns</h4>
                <div className="stat-number">{statistics.activeCampaigns}</div>
              </div>
            </div>

            {/* Status Breakdown */}
            <div className="stats-breakdown">
              <h4>Message Status Breakdown</h4>
              <div className="status-grid">
                {Object.entries(statistics.statusCounts).map(([status, count]) => (
                  <div key={status} className={`status-card ${status}`}>
                    <div className="status-count">{count}</div>
                    <div className="status-label">{status.charAt(0).toUpperCase() + status.slice(1)}</div>
                    <div className="status-percentage">
                      {statistics.statusPercentages[status as keyof typeof statistics.statusPercentages]}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Real Charts Section */}
            <div className="charts-section">
              <div className="chart-container">
                <div className="pie-chart-container">
                  <h4>Status Distribution</h4>
                  {chartData && chartData.pieData && (
                    <Pie 
                      data={chartData.pieData} 
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: {
                            position: 'bottom' as const,
                          },
                          tooltip: {
                            callbacks: {
                              label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                                return `${label}: ${value} (${percentage}%)`;
                              }
                            }
                          }
                        }
                      }}
                      height={250}
                    />
                  )}
                </div>
                
                <div className="bar-chart-container">
                  <h4>Daily Message Activity</h4>
                  {chartData && chartData.barData && (
                    <Bar 
                      data={chartData.barData} 
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: {
                            position: 'top' as const,
                          },
                        },
                        scales: {
                          x: {
                            stacked: false,
                          },
                          y: {
                            stacked: false,
                            beginAtZero: true,
                            ticks: {
                              stepSize: 1
                            }
                          }
                        }
                      }}
                      height={250}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Legacy stats grid for backward compatibility */}
            <div className="stats-grid">
              <div className="stat-card sent">
                <h4>Sent</h4>
                <div className="stat-number">{statistics[statsTimeframe]?.sent || statistics.statusCounts.sent}</div>
              </div>
              <div className="stat-card delivered">
                <h4>Delivered</h4>
                <div className="stat-number">{statistics[statsTimeframe]?.delivered || statistics.statusCounts.delivered}</div>
              </div>
              <div className="stat-card read">
                <h4>Read</h4>
                <div className="stat-number">{statistics[statsTimeframe]?.read || statistics.statusCounts.read}</div>
              </div>
              <div className="stat-card failed">
                <h4>Failed</h4>
                <div className="stat-number">{statistics[statsTimeframe]?.failed || statistics.statusCounts.failed}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Request notification permission
  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationsEnabled(permission === 'granted');
    }
  };

  // Send browser notification
  const sendNotification = (title: string, message: string) => {
    if (notificationsEnabled && 'Notification' in window) {
      try {
        new Notification(title, { body: message });
      } catch (err) {
        console.error('Error sending notification:', err);
      }
    }
  };

  // Setup real-time message status checking
  useEffect(() => {
    if (!selectedCampaign) return;

    // Clear existing interval
    if (messageStatusCheckInterval) {
      clearInterval(messageStatusCheckInterval);
    }

    // Initialize status map with current messages
    const currentMessages = campaignMessages[selectedCampaign.id] || [];
    const statusMap = new Map<number, string>();
    currentMessages.forEach(message => {
      statusMap.set(message.id!, message.status);
    });

    // Set up interval for status checking
    const interval = setInterval(async () => {
      try {
        const statusFilter = campaignStatusFilters[selectedCampaign.id] || 'all';
        const result = await window.electron.bulk.getMessages(selectedCampaign.id, messagesPagination[selectedCampaign.id]?.page || 1, 50, statusFilter);
        if (result.success && result.messages) {
          // Check for status changes and send notifications
          result.messages.forEach((message: MessageLog) => {
            const previousStatus = statusMap.get(message.id!);
            if (previousStatus && previousStatus !== message.status) {
              const recipient = `${message.contactName} ${message.contactSurname}`.trim();
              let statusText = '';
              
              switch (message.status) {
                case 'sent':
                  statusText = 'sent to';
                  break;
                case 'delivered':
                  statusText = 'delivered to';
                  break;
                case 'read':
                  statusText = 'read by';
                  break;
                case 'failed':
                  statusText = 'failed to send to';
                  break;
                default:
                  statusText = `${message.status} for`;
              }
              
              sendNotification(
                `Message ${statusText}`,
                `Message was ${statusText} ${recipient}`
              );
            }
            
            // Update status in map
            statusMap.set(message.id!, message.status);
          });

          // Update the messages
          setCampaignMessages(prev => ({
            ...prev,
            [selectedCampaign.id]: result.messages
          }));
        }
      } catch (error) {
        console.error('Error checking message statuses:', error);
      }
    }, 10000); // Check every 10 seconds

    setMessageStatusCheckInterval(interval);

    return () => {
      if (interval) {
        clearInterval(interval);
        setMessageStatusCheckInterval(null);
      }
    };
  }, [selectedCampaign, campaignStatusFilters]);

  // Enhanced format timestamp function
  const formatTimestamp = (timestamp: string | undefined): string => {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  // Enhanced campaign selection functions
  const handleCampaignSelection = (campaignId: number) => {
    setSelectedCampaigns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(campaignId)) {
        newSet.delete(campaignId);
      } else {
        newSet.add(campaignId);
      }
      return newSet;
    });
  };

  const selectAllCampaigns = () => {
    // Select ALL campaigns, not just scheduled/sending ones
    const allCampaignIds = campaigns.map(c => c.id);
    setSelectedCampaigns(new Set(allCampaignIds));
  };

  const deselectAllCampaigns = () => {
    setSelectedCampaigns(new Set());
  };

  // Bulk delete campaigns
  const deleteSelectedCampaigns = async () => {
    if (selectedCampaigns.size === 0) {
      setError('No campaigns selected for deletion');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedCampaigns.size} selected campaign(s)? This action cannot be undone.`)) {
      return;
    }

    try {
      setLoading(true);
      const campaignIds = Array.from(selectedCampaigns);
      const result = await window.electron.bulk.deleteCampaigns(campaignIds);
      
      if (result.success) {
        setSuccess(`Successfully deleted ${result.deletedCount} campaign(s)`);
        setSelectedCampaigns(new Set());
        await loadCampaigns();
      } else {
        setError(result.error || 'Failed to delete campaigns');
      }
    } catch (error) {
      setError('Error deleting campaigns');
      console.error('Error deleting campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  // Check if campaign has scheduled messages
  const hasScheduledMessages = (campaign: Campaign): boolean => {
    return campaign.status === 'scheduled' || campaign.status === 'sending';
  };

  // New function to load all messages across campaigns
  const loadAllMessages = async (page: number = 1, limit: number = 50) => {
    try {
      setLoading(true);
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userId = user.id || 1;
      
      const [messagesResult, countsResult] = await Promise.all([
        window.electron.bulk.getAllMessages(
          userId, 
          page, 
          limit, 
          allMessagesStatusFilter !== 'all' ? allMessagesStatusFilter : undefined,
          allMessagesCampaignFilter !== 'all' ? allMessagesCampaignFilter : undefined
        ),
        window.electron.bulk.getAllMessageCounts(
          userId, 
          allMessagesCampaignFilter !== 'all' ? allMessagesCampaignFilter : undefined
        )
      ]);
      
      if (messagesResult.success) {
        setAllMessages(messagesResult.messages || []);
        setAllMessagesPagination(messagesResult.pagination || { page: 1, totalPages: 1, total: 0, limit });
      }
      
      if (countsResult.success) {
        setAllMessagesCounts(countsResult.counts);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
    } finally {
      setLoading(false);
    }
  };

  // Add state for available campaigns list
  const [availableCampaigns, setAvailableCampaigns] = useState<{ id: number; campaignName: string }[]>([]);

  // Load available campaigns for dropdown
  const loadAvailableCampaigns = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userId = user.id || 1;
      
      const result = await window.electron.bulk.getCampaignsWithFilter(userId, 1, 1000, '', 'all');
      if (result.success && result.campaigns) {
        setAvailableCampaigns(result.campaigns.map((c: any) => ({ 
          id: c.id, 
          campaignName: c.campaignName 
        })));
      }
    } catch (error) {
      console.error('Error loading campaigns for dropdown:', error);
    }
  };

  // Load all messages when section becomes active or filters change
  useEffect(() => {
    if (activeSection === 'all-messages') {
      loadAvailableCampaigns();
      loadAllMessages(1, allMessagesPagination.limit || 50);
    }
  }, [activeSection, allMessagesStatusFilter, allMessagesCampaignFilter]);

  // Handle all messages selection
  const handleAllMessageSelection = (messageId: number) => {
    setSelectedAllMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const selectAllAllMessages = () => {
    const allIds = allMessages.map(m => m.id);
    setSelectedAllMessages(new Set(allIds));
  };

  const deselectAllAllMessages = () => {
    setSelectedAllMessages(new Set());
  };

  return (
    <div className="bulk-sender">
      {(error || success) && (
        <div className="message-overlay" onClick={clearMessages}>
          <div className={`message-popup ${error ? 'error' : 'success'}`}>
            <span className="message-icon">{error ? '⚠️' : '✅'}</span>
            <span className="message-text">{error || success}</span>
            <button className="message-close" onClick={clearMessages}>×</button>
          </div>
        </div>
      )}

      <div className="bulk-header">
        <h2>Bulk Sender</h2>
        <div className="bulk-nav">
          <button 
            className={`nav-button ${activeSection === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveSection('settings')}
          >
            ⚙️ Settings
          </button>
          <button 
            className={`nav-button ${activeSection === 'contacts' ? 'active' : ''}`}
            onClick={() => setActiveSection('contacts')}
          >
            👥 Contacts
          </button>
          <button 
            className={`nav-button ${activeSection === 'templates' ? 'active' : ''}`}
            onClick={() => setActiveSection('templates')}
          >
            📝 Templates
          </button>
          <button 
            className={`nav-button ${activeSection === 'messages' ? 'active' : ''}`}
            onClick={() => setActiveSection('messages')}
          >
            💬 Messages
          </button>
          <button 
            className={`nav-button ${activeSection === 'all-messages' ? 'active' : ''}`}
            onClick={() => setActiveSection('all-messages')}
          >
            📄 All Messages
          </button>
          <button 
            className={`nav-button ${activeSection === 'statistics' ? 'active' : ''}`}
            onClick={() => setActiveSection('statistics')}
          >
            📊 Statistics
          </button>
        </div>
      </div>

      <div className="bulk-content">
        {activeSection === 'settings' && renderSettings()}
        {activeSection === 'contacts' && renderContacts()}
        {activeSection === 'templates' && renderTemplates()}
        {activeSection === 'messages' && renderMessages()}
        {activeSection === 'all-messages' && renderAllMessages()}
        {activeSection === 'statistics' && renderStatistics()}
      </div>
    </div>
  );
};

export default BulkSender; 