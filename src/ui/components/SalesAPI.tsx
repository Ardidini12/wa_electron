import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SalesAPI.css';

interface Sale {
  id: number;
  salesId: number;
  data: string;
  town: string;
  fetchedAt: string;
  createdAt: string;
  parsedData: {
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
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface TimerData {
  minutes: number;
  seconds: number;
  timeUntilNextFetch: number;
  isActive: boolean;
  whatsAppConnected: boolean;
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
  id: number;
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
  msg1Id?: number;
}

const SalesAPI: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'sales-list' | 'settings' | 'scheduled-messages'>('sales-list');
  
  // Sales List State with persistent values from localStorage
  const [sales, setSales] = useState<Sale[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ 
    page: 1, 
    limit: parseInt(localStorage.getItem('salesAPI_itemsPerPage') || '100'), 
    total: 0, 
    totalPages: 1 
  });
  const [search, setSearch] = useState('');
  const [townFilter, setTownFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState(localStorage.getItem('salesAPI_sortBy') || 'createdAt');
  const [sortOrder, setSortOrder] = useState(localStorage.getItem('salesAPI_sortOrder') || 'DESC');
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [selectedSales, setSelectedSales] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [timerData, setTimerData] = useState<TimerData>({ minutes: 2, seconds: 0, timeUntilNextFetch: 120000, isActive: false, whatsAppConnected: false });
  const [stats, setStats] = useState<any>({});

  // Settings state
  const [salesSettings, setSalesSettings] = useState<SalesSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Scheduled Messages state
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [messagesPagination, setMessagesPagination] = useState<Pagination>({ 
    page: 1, 
    limit: parseInt(localStorage.getItem('salesAPI_messagesPerPage') || '100'), 
    total: 0, 
    totalPages: 1 
  });
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState('all');
  const [messageTypeFilter, setMessageTypeFilter] = useState('all');
  const [townFilterMessages, setTownFilterMessages] = useState('all');
  const [messagesStats, setMessagesStats] = useState<any>(null);
  const [goToPage, setGoToPage] = useState<string>('');

  // Refs for textareas to support character insertion
  const msg1TextareaRef = useRef<HTMLTextAreaElement>(null);
  const msg2TextareaRef = useRef<HTMLTextAreaElement>(null);
  const [lastFocusedTextarea, setLastFocusedTextarea] = useState<'msg1' | 'msg2'>('msg1');

  // Function to insert character at cursor position
  const insertCharacter = (char: string) => {
    // Use the last focused textarea
    const targetTextarea = lastFocusedTextarea === 'msg2' ? msg2TextareaRef.current : msg1TextareaRef.current;
    const messageType = lastFocusedTextarea;

    if (targetTextarea) {
      // Store the current scroll position
      const scrollTop = targetTextarea.scrollTop;
      const start = targetTextarea.selectionStart || 0;
      const end = targetTextarea.selectionEnd || 0;
      const currentValue = targetTextarea.value;
      const newValue = currentValue.substring(0, start) + char + currentValue.substring(end);
      
      // Update the appropriate state
      updateMessageSettings(messageType, { content: newValue });
      
      // Restore focus and cursor position while maintaining scroll position
      setTimeout(() => {
        if (targetTextarea) {
          targetTextarea.focus();
          targetTextarea.setSelectionRange(start + char.length, start + char.length);
          targetTextarea.scrollTop = scrollTop; // Maintain scroll position
        }
      }, 0);
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(char);
    }
  };

  // Function to process variables in message content for preview
  const processMessageVariables = (content: string): string => {
    if (!content) return content;
    
    // Sample data for preview
    const sampleData = {
      name: 'ABC Company Ltd',
      'name[0]': 'ABC',
      'name[1]': 'Company',
      phone: '+355691234567',
      town: 'Tirane',
      current_date: new Date().toLocaleDateString('en-GB'),
      current_time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      current_datetime: new Date().toLocaleString('en-GB'),
      document_date: new Date().toLocaleDateString('en-GB')
    };
    
    let processedContent = content;
    
    // Replace variables with sample data
    Object.entries(sampleData).forEach(([key, value]) => {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      processedContent = processedContent.replace(regex, value);
    });
    
    return processedContent;
  };

  // Load sales on component mount and when pagination/search/filter changes
  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      const response = await window.electron.salesAPI.getSales(
        pagination.page,
        pagination.limit,
        search,
        townFilter,
        dateFrom,
        dateTo,
        sortBy,
        sortOrder
      );
      
      if (response.success) {
        setSales(response.sales || []);
        setPagination(response.pagination);
      } else {
        setError(response.error || 'Failed to load sales');
      }
    } catch (err: any) {
      setError('Error loading sales: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, search, townFilter, dateFrom, dateTo, sortBy, sortOrder]);

  // Separate function for search to avoid circular dependencies
  const performSearch = useCallback(async () => {
    try {
      const response = await window.electron.salesAPI.getSales(
        1, // Reset to first page on search
        pagination.limit,
        search,
        townFilter,
        dateFrom,
        dateTo,
        sortBy,
        sortOrder
      );
      
      if (response.success) {
        setSales(response.sales || []);
        setPagination(() => ({
          ...response.pagination,
          page: 1 // Ensure we're on first page
        }));
      } else {
        setError(response.error || 'Failed to load sales');
      }
    } catch (err: any) {
      setError('Error loading sales: ' + err.message);
    }
  }, [pagination.limit, search, townFilter, dateFrom, dateTo, sortBy, sortOrder]);

  // Load stats
  const loadStats = async () => {
    try {
      const response = await window.electron.salesAPI.getStats();
      setStats(response);
    } catch (err: any) {
      console.error('Error loading stats:', err);
    }
  };

  // Load settings
  const loadSettings = async () => {
    try {
      setSettingsLoading(true);
      const response = await window.electron.salesAPI.getSalesSettings();
      if (response.success) {
        setSalesSettings(response.settings);
      } else {
        setError(response.error || 'Failed to load settings');
      }
    } catch (err: any) {
      setError('Error loading settings: ' + err.message);
    } finally {
      setSettingsLoading(false);
    }
  };

  // Load scheduled messages
  const loadScheduledMessages = async () => {
    try {
      setMessagesLoading(true);
      const response = await window.electron.salesAPI.getScheduledMessages(
        messagesPagination.page,
        messagesPagination.limit,
        statusFilter,
        messageTypeFilter,
        townFilterMessages
      );
      if (response.success) {
        setScheduledMessages(response.messages || []);
        setMessagesPagination(response.pagination);
      } else {
        setError(response.error || 'Failed to load scheduled messages');
      }
    } catch (err: any) {
      setError('Error loading scheduled messages: ' + err.message);
    } finally {
      setMessagesLoading(false);
    }
  };

  // Load messages stats
  const loadMessagesStats = async () => {
    try {
      const response = await window.electron.salesAPI.getScheduledMessagesStats();
      setMessagesStats(response);
    } catch (err: any) {
      console.error('Error loading messages stats:', err);
    }
  };

  useEffect(() => {
    loadSales();
    loadStats();
  }, []);

  // Load data when tab changes
  useEffect(() => {
    if (activeTab === 'settings') {
      loadSettings();
    } else if (activeTab === 'scheduled-messages') {
      loadScheduledMessages();
      loadMessagesStats();
    }
  }, [activeTab]);

  // Reload scheduled messages when filters change
  useEffect(() => {
    if (activeTab === 'scheduled-messages') {
      loadScheduledMessages();
    }
  }, [messagesPagination.page, messagesPagination.limit, statusFilter, messageTypeFilter, townFilterMessages]);

  // Reset selection when sales change
  useEffect(() => {
    setSelectedSales([]);
    setSelectAll(false);
  }, [sales]);

  // Set up event listeners
  useEffect(() => {
    const handleTimerUpdate = (timerData: TimerData) => {
      setTimerData(timerData);
    };

    const handleFetchStart = () => {
      setFetchLoading(true);
      setError('');
    };

    const handleFetchSuccess = (data: { newSalesCount: number; message: string }) => {
      setFetchLoading(false);
      setSuccessMessage(data.message);
      setTimeout(() => setSuccessMessage(''), 3000);
      loadSales();
      loadStats();
    };

    const handleFetchError = (message: string) => {
      setFetchLoading(false);
      setError(message);
    };

    const handleMessageSent = (data: { messageId: number; contactName: string; messageType: string }) => {
      setSuccessMessage(`Message ${data.messageType.toUpperCase()} sent to ${data.contactName}`);
      setTimeout(() => setSuccessMessage(''), 3000);
      if (activeTab === 'scheduled-messages') {
        loadScheduledMessages();
        loadMessagesStats();
      }
    };

    const handleMessageFailed = (data: { messageId: number; contactName: string; messageType: string; error: string }) => {
      setError(`Failed to send ${data.messageType.toUpperCase()} to ${data.contactName}: ${data.error}`);
      if (activeTab === 'scheduled-messages') {
        loadScheduledMessages();
        loadMessagesStats();
      }
    };

    const handleMessageStatusUpdated = (data: { 
      messageId: number; 
      salesId: number; 
      status: string; 
      timestamp: string; 
      whatsappMessageId?: string; 
      sendAt?: string;
      sentAt?: string;
      deliveredAt?: string;
      readAt?: string;
    }) => {
      console.log('[SalesAPI UI] 📱 Message status updated:', data);
      
      // Update the message in the current list
      setScheduledMessages(prev => prev.map(msg => {
        if (msg.id === data.messageId) {
          const updates: any = {
            ...msg,
            status: data.status as any
          };
          
          // Update all timestamp fields if provided (from complete message data)
          if (data.sentAt !== undefined) {
            updates.sentAt = data.sentAt;
          }
          if (data.deliveredAt !== undefined) {
            updates.deliveredAt = data.deliveredAt;
          }
          if (data.readAt !== undefined) {
            updates.readAt = data.readAt;
          }
          
          // Fallback: Set the appropriate timestamp field based on status and timestamp
          if (!data.sentAt && !data.deliveredAt && !data.readAt) {
            if (data.status === 'sent') {
              updates.sentAt = data.timestamp;
            } else if (data.status === 'delivered') {
              updates.deliveredAt = data.timestamp;
            } else if (data.status === 'read') {
              updates.readAt = data.timestamp;
            }
          }
          
          // Update sendAt if provided (for MSG2 scheduling)
          if (data.sendAt) {
            updates.sendAt = data.sendAt;
          }
          
          console.log('[SalesAPI UI] 🔄 Updated message:', updates);
          return updates;
        }
        return msg;
      }));
      
      // Update stats
      loadMessagesStats();
    };

    const loadInitialTimerState = async () => {
      try {
        const timerState = await window.electron.salesAPI.getTimerState();
        setTimerData(timerState);
      } catch (err) {
        console.error('Error loading initial timer state:', err);
      }
    };

    // Set up event listeners
    window.electron.salesAPI.onTimerUpdate(handleTimerUpdate);
    window.electron.salesAPI.onFetchStart(handleFetchStart);
    window.electron.salesAPI.onFetchSuccess(handleFetchSuccess);
    window.electron.salesAPI.onFetchError(handleFetchError);
    window.electron.salesAPI.onMessageSent(handleMessageSent);
    window.electron.salesAPI.onMessageFailed(handleMessageFailed);
    window.electron.salesAPI.onMessageStatusUpdated(handleMessageStatusUpdated);

    // Load initial timer state
    loadInitialTimerState();

    // Cleanup function
    return () => {
      // Note: The actual cleanup would depend on how the IPC events are implemented
    };
  }, [activeTab]);

  // Handle search
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  };

  // Handle town filter change
  const handleTownFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTownFilter(e.target.value);
  };

  // Handle date filter changes
  const handleDateFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDateFrom(e.target.value);
  };

  const handleDateToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDateTo(e.target.value);
  };

  // Handle sort changes
  const handleSortByChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSortBy = e.target.value;
    setSortBy(newSortBy);
    localStorage.setItem('salesAPI_sortBy', newSortBy);
  };

  const handleSortOrderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSortOrder = e.target.value;
    setSortOrder(newSortOrder);
    localStorage.setItem('salesAPI_sortOrder', newSortOrder);
  };

  // Clear date filters
  const clearDateFilters = () => {
    setDateFrom('');
    setDateTo('');
  };

  // Handle search submit (with debounce)
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  
  // Debounced search when search input or filter changes
  useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    setSearchLoading(true);
    
    const timeout = setTimeout(async () => {
      try {
        await performSearch();
      } finally {
        setSearchLoading(false);
      }
    }, 500);
    
    setSearchTimeout(timeout);
    
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [search, townFilter, dateFrom, dateTo, sortBy, sortOrder, performSearch]);

  // Handle pagination
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handleLimitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLimit = parseInt(e.target.value);
    localStorage.setItem('salesAPI_itemsPerPage', newLimit.toString());
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  // Handle manual fetch
  const handleManualFetch = async () => {
    try {
      setFetchLoading(true);
      const response = await window.electron.salesAPI.manualFetch();
      if (response.success) {
        setSuccessMessage(response.message);
        setTimeout(() => setSuccessMessage(''), 3000);
        loadSales();
        loadStats();
      } else {
        setError(response.message);
      }
    } catch (err: any) {
      setError('Manual fetch failed: ' + err.message);
    } finally {
      setFetchLoading(false);
    }
  };

  // Handle checkbox selection
  const toggleSaleSelection = (saleId: number) => {
    setSelectedSales(prev => {
      if (prev.includes(saleId)) {
        return prev.filter(id => id !== saleId);
      } else {
        return [...prev, saleId];
      }
    });
  };

  // Handle select all
  const toggleSelectAll = async () => {
    if (selectAll) {
      setSelectedSales([]);
    } else {
      setSelectAllLoading(true);
      try {
        const response = await window.electron.salesAPI.getAllSalesIds(search, townFilter, dateFrom, dateTo);
        if (response.success) {
          setSelectedSales(response.salesIds);
          
          setSuccessMessage(`Selected all ${response.salesIds.length} sales`);
          setTimeout(() => setSuccessMessage(''), 3000);
        } else {
          setError(response.error || 'Failed to get all sales');
        }
      } catch (err: any) {
        setError('Error getting all sales: ' + err.message);
      } finally {
        setSelectAllLoading(false);
      }
    }
    setSelectAll(!selectAll);
  };

  // Handle delete selected
  const handleDeleteSelected = async () => {
    if (selectedSales.length === 0) return;
    
    if (!confirm(`Are you sure you want to delete ${selectedSales.length} selected sales?`)) {
      return;
    }
    
    try {
      setLoading(true);
      const response = await window.electron.salesAPI.deleteSales(selectedSales);
      
      if (response.success) {
        setSuccessMessage(`Successfully deleted ${response.deletedCount} sales`);
        setTimeout(() => setSuccessMessage(''), 3000);
        loadSales();
        loadStats();
        setSelectedSales([]);
        setSelectAll(false);
      } else {
        setError(response.error || 'Failed to delete sales');
      }
    } catch (err: any) {
      setError('Error deleting sales: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  // Format phone number for display
  const formatPhone = (phone: string) => {
    if (!phone) return '';
    return phone.replace('@c.us', '');
  };

  // Settings handlers
  const handleSaveSettings = async () => {
    if (!salesSettings) return;
    
    try {
      setSettingsLoading(true);
      const response = await window.electron.salesAPI.saveSalesSettings(salesSettings);
      if (response.success) {
        setSettingsSaved(true);
        setSuccessMessage('Settings saved successfully');
        setTimeout(() => {
          setSettingsSaved(false);
          setSuccessMessage('');
        }, 3000);
      } else {
        setError(response.error || 'Failed to save settings');
      }
    } catch (err: any) {
      setError('Error saving settings: ' + err.message);
    } finally {
      setSettingsLoading(false);
    }
  };

  const updateSettings = (updates: Partial<SalesSettings>) => {
    if (salesSettings) {
      setSalesSettings({ ...salesSettings, ...updates });
    }
  };

  const updateMessageSettings = (messageType: 'msg1' | 'msg2', updates: any) => {
    if (salesSettings) {
      setSalesSettings({
        ...salesSettings,
        [messageType]: { ...salesSettings[messageType], ...updates }
      });
    }
  };

  // Scheduled messages handlers
  const handleMessagePageChange = (newPage: number) => {
    setMessagesPagination(prev => ({ ...prev, page: newPage }));
  };

  const handleMessageLimitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLimit = parseInt(e.target.value);
    localStorage.setItem('salesAPI_messagesPerPage', newLimit.toString());
    setMessagesPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const toggleMessageSelection = (messageId: number) => {
    const newSelected = new Set(selectedMessages);
    if (newSelected.has(messageId)) {
      newSelected.delete(messageId);
    } else {
      newSelected.add(messageId);
    }
    setSelectedMessages(newSelected);
  };

  const toggleSelectAllMessages = async () => {
    if (selectedMessages.size === scheduledMessages.length && scheduledMessages.length > 0) {
      setSelectedMessages(new Set());
    } else {
      try {
        const response = await window.electron.salesAPI.getAllScheduledMessageIds(
          statusFilter,
          messageTypeFilter,
          townFilterMessages
        );
        if (response.success) {
          setSelectedMessages(new Set(response.messageIds));
        }
      } catch (err: any) {
        setError('Error selecting all messages: ' + err.message);
      }
    }
  };

  const handleCancelSelectedMessages = async () => {
    if (selectedMessages.size === 0) return;

    if (!confirm(`Cancel ${selectedMessages.size} selected messages?`)) return;

    try {
      const response = await window.electron.salesAPI.cancelScheduledMessages(Array.from(selectedMessages));
      if (response.success) {
        setSuccessMessage(`Cancelled ${response.cancelledCount} messages`);
        setTimeout(() => setSuccessMessage(''), 3000);
        loadScheduledMessages();
        loadMessagesStats();
        setSelectedMessages(new Set());
      } else {
        setError(response.error || 'Failed to cancel messages');
      }
    } catch (err: any) {
      setError('Error cancelling messages: ' + err.message);
    }
  };

  const handleDeleteSelectedMessages = async () => {
    if (selectedMessages.size === 0) return;

    if (!confirm(`Delete ${selectedMessages.size} selected messages? This action cannot be undone.`)) return;

    try {
      const response = await window.electron.salesAPI.deleteScheduledMessages(Array.from(selectedMessages));
      if (response.success) {
        setSuccessMessage(`Deleted ${response.deletedCount} messages`);
        setTimeout(() => setSuccessMessage(''), 3000);
        loadScheduledMessages();
        loadMessagesStats();
        setSelectedMessages(new Set());
      } else {
        setError(response.error || 'Failed to delete messages');
      }
    } catch (err: any) {
      setError('Error deleting messages: ' + err.message);
    }
  };

  const handleCancelSingleMessage = async (messageId: number) => {
    if (!confirm('Cancel this message?')) return;

    try {
      const response = await window.electron.salesAPI.cancelScheduledMessages([messageId]);
      if (response.success) {
        setSuccessMessage('Message cancelled successfully');
        setTimeout(() => setSuccessMessage(''), 3000);
        loadScheduledMessages();
        loadMessagesStats();
      } else {
        setError(response.error || 'Failed to cancel message');
      }
    } catch (err: any) {
      setError('Error cancelling message: ' + err.message);
    }
  };

  const handleGoToPage = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(goToPage);
    if (pageNum && pageNum >= 1 && pageNum <= messagesPagination.totalPages) {
      handleMessagePageChange(pageNum);
      setGoToPage('');
    }
  };

  // Render pagination
  const renderPagination = () => {
    const startItem = (pagination.page - 1) * pagination.limit + 1;
    const endItem = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
      <div className="sales-pagination">
        <div className="pagination-info">
          Showing {startItem} to {endItem} of {pagination.total} sales
        </div>
        <div className="pagination-controls">
          <select value={pagination.limit} onChange={handleLimitChange}>
            <option value={10}>10 per page</option>
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
            <option value={200}>200 per page</option>
            <option value={500}>500 per page</option>
            <option value={1000}>1000 per page</option>
          </select>
          
          <div className="pagination-nav">
            <button 
              onClick={() => handlePageChange(1)} 
              disabled={pagination.page === 1}
            >
              First
            </button>
            <button 
              onClick={() => handlePageChange(pagination.page - 1)} 
              disabled={pagination.page === 1}
            >
              Previous
            </button>
            
            <span className="page-info">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            
            <button 
              onClick={() => handlePageChange(pagination.page + 1)} 
              disabled={pagination.page === pagination.totalPages}
            >
              Next
            </button>
            <button 
              onClick={() => handlePageChange(pagination.totalPages)} 
              disabled={pagination.page === pagination.totalPages}
            >
              Last
            </button>
          </div>
          
          <div className="go-to-page">
            <span>Go to page:</span>
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target as HTMLFormElement);
                const page = parseInt(formData.get('pageNumber') as string);
                if (page > 0 && page <= pagination.totalPages) {
                  handlePageChange(page);
                  (e.target as HTMLFormElement).reset();
                } else if (page) {
                  setError(`Page ${page} is not valid. Please enter a page number between 1 and ${pagination.totalPages}.`);
                  setTimeout(() => setError(''), 3000);
                }
              }}
              className="page-jump-form"
            >
              <input 
                type="number" 
                name="pageNumber" 
                min="1" 
                max={pagination.totalPages} 
                placeholder="Page #"
              />
              <button type="submit">Go</button>
            </form>
          </div>
        </div>
      </div>
    );
  };

  // Render sales list content
  const renderSalesListContent = () => {
    return (
      <div className="sales-list-section">
        {/* Status and Timer Section */}
        <div className="sales-status-section">
          <div className="fetch-status">
            <div className="status-item">
              <label>Auto-fetch Status:</label>
              <span className={`status-badge ${fetchLoading ? 'fetching' : timerData.isActive && timerData.whatsAppConnected ? 'idle' : 'inactive'}`}>
                {fetchLoading ? 'Fetching...' : timerData.isActive && timerData.whatsAppConnected ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="status-item">
              <label>WhatsApp:</label>
              <span className={`status-badge ${timerData.whatsAppConnected ? 'idle' : 'inactive'}`}>
                {timerData.whatsAppConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="status-item">
              <label>Next fetch in:</label>
              <span className="timer">
                {String(timerData.minutes).padStart(2, '0')}:{String(timerData.seconds).padStart(2, '0')}
              </span>
            </div>
            <div className="status-item">
              <button 
                className="manual-fetch-btn" 
                onClick={handleManualFetch}
                disabled={fetchLoading}
              >
                {fetchLoading ? 'Fetching...' : 'Manual Fetch'}
              </button>
            </div>
          </div>
          
          {/* Stats Section */}
          <div className="sales-stats">
            <div className="stat-item">
              <label>Total Sales:</label>
              <span>{stats.total || 0}</span>
            </div>
            <div className="stat-item">
              <label>Today:</label>
              <span>{stats.todayCount || 0}</span>
            </div>
            {stats.townStats && stats.townStats.map((townStat: any) => (
              <div key={townStat.town} className="stat-item">
                <label>{townStat.town}:</label>
                <span>{townStat.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            {error}
            <button onClick={() => setError('')} className="close-btn">×</button>
          </div>
        )}

        {successMessage && (
          <div className="success-message">
            <span className="success-icon">✓</span>
            {successMessage}
            <button onClick={() => setSuccessMessage('')} className="close-btn">×</button>
          </div>
        )}

        {/* Search and Filter Section */}
        <div className="sales-filters">
          <div className="search-section">
            <input
              type="text"
              placeholder="Search sales (name, phone, document number...)"
              value={search}
              onChange={handleSearchChange}
              className="search-input"
            />
            {searchLoading && <span className="search-spinner">🔄</span>}
          </div>
          
          <div className="filter-section">
            <select value={townFilter} onChange={handleTownFilterChange}>
              <option value="all">All Towns</option>
              <option value="tirane">Tirane</option>
              <option value="fier">Fier</option>
              <option value="vlore">Vlore</option>
            </select>
          </div>

          <div className="date-filter-section">
            <label>Date Range:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={handleDateFromChange}
              placeholder="From date"
              title="From date"
            />
            <span>to</span>
            <input
              type="date"
              value={dateTo}
              onChange={handleDateToChange}
              placeholder="To date"
              title="To date"
            />
            {(dateFrom || dateTo) && (
              <button 
                onClick={clearDateFilters}
                className="clear-date-btn"
                title="Clear date filters"
              >
                ✕
              </button>
            )}
          </div>

          <div className="sort-section">
            <label>Sort by:</label>
            <select value={sortBy} onChange={handleSortByChange}>
              <option value="createdAt">Fetch Date</option>
              <option value="documentDate">Document Date</option>
              <option value="fetchedAt">Fetched At</option>
            </select>
            <select value={sortOrder} onChange={handleSortOrderChange}>
              <option value="DESC">Newest First</option>
              <option value="ASC">Oldest First</option>
            </select>
          </div>
        </div>

        {/* Actions Section */}
        {selectedSales.length > 0 && (
          <div className="bulk-actions">
            <span>{selectedSales.length} sales selected</span>
            <button 
              className="delete-btn" 
              onClick={handleDeleteSelected}
              disabled={loading}
            >
              Delete Selected ({selectedSales.length})
            </button>
          </div>
        )}

        {/* Sales Table */}
        <div className="sales-table-container" style={{ maxHeight: '600px', overflowY: 'auto' }}>
          <table className="sales-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={toggleSelectAll}
                    disabled={selectAllLoading}
                  />
                  {selectAllLoading && (
                    <span className="loading-spinner small">
                      <div className="spinner"></div>
                    </span>
                  )}
                </th>
                <th>Sale API ID</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Town</th>
                <th>Document</th>
                <th>Date</th>
                <th>Code</th>
                <th>Category</th>
                <th>Fetched At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="loading-cell">
                    <div className="loading-spinner">Loading sales...</div>
                  </td>
                </tr>
              ) : sales.length === 0 ? (
                <tr>
                  <td colSpan={10} className="no-data-cell">
                    No sales found
                  </td>
                </tr>
              ) : (
                sales.map((sale) => (
                  <tr key={sale.id} className={selectedSales.includes(sale.id) ? 'selected' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedSales.includes(sale.id)}
                        onChange={() => toggleSaleSelection(sale.id)}
                      />
                    </td>
                    <td>{sale.parsedData.id}</td>
                    <td>{sale.parsedData.businessEntity.name}</td>
                    <td>{formatPhone(sale.parsedData.businessEntity.phone)}</td>
                    <td>{sale.parsedData.businessEntity.town}</td>
                    <td>{sale.parsedData.documentNumber}</td>
                    <td>{formatDate(sale.parsedData.documentDate)}</td>
                    <td>{sale.parsedData.businessEntity.code}</td>
                    <td>{sale.parsedData.businessEntity.categories[0]?.name || 'N/A'}</td>
                    <td>{formatDate(sale.fetchedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {sales.length > 0 && renderPagination()}
      </div>
    );
  };

  // Render settings content
  const renderSettingsContent = () => {
    if (settingsLoading) {
      return (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <span>Loading settings...</span>
        </div>
      );
    }

    if (!salesSettings) {
      return (
        <div className="settings-section">
          <p>Failed to load settings. Please try refreshing the page.</p>
        </div>
      );
    }

    return (
      <div className="settings-section">
        <h3>Sales Message Settings</h3>
        <p>Configure automatic messaging for new sales contacts</p>

        <div className="setting-group">
          <label>
            <input
              type="checkbox"
              checked={salesSettings.isAutoSchedulingEnabled}
              onChange={(e) => updateSettings({ isAutoSchedulingEnabled: e.target.checked })}
            />
            Enable Auto-Scheduling
          </label>
          <p className="setting-description">
            Automatically schedule messages when new sales are fetched from API
          </p>
        </div>

        <div className="setting-group">
          <h4>Business Hours</h4>
          <p className="setting-description">Messages will only be sent during these hours</p>
          <div className="time-inputs">
            <div className="time-input">
              <label>Start Time:</label>
              <input
                type="time"
                value={`${salesSettings.startHour.toString().padStart(2, '0')}:${salesSettings.startMinute.toString().padStart(2, '0')}`}
                onChange={(e) => {
                  const [hour, minute] = e.target.value.split(':').map(Number);
                  updateSettings({ startHour: hour, startMinute: minute });
                }}
              />
            </div>
            <div className="time-input">
              <label>End Time:</label>
              <input
                type="time"
                value={`${salesSettings.endHour.toString().padStart(2, '0')}:${salesSettings.endMinute.toString().padStart(2, '0')}`}
                onChange={(e) => {
                  const [hour, minute] = e.target.value.split(':').map(Number);
                  updateSettings({ endHour: hour, endMinute: minute });
                }}
              />
            </div>
          </div>
        </div>

        {/* Template Variables Info */}
        <div className="setting-group">
          <div className="info-box">
            <h4>Template Variables</h4>
            <p>You can use the following variables in your message content:</p>
            <div className="variables-grid">
              <div className="variable-group">
                <strong>Contact Variables:</strong>
                <ul>
                  <li><code>{'{name}'}</code> - Full name</li>
                  <li><code>{'{name[0]}'}</code> - First name</li>
                  <li><code>{'{name[1]}'}</code> - Last name</li>
                  <li><code>{'{phone}'}</code> - Phone number</li>
                  <li><code>{'{town}'}</code> - Town</li>
                </ul>
              </div>
              <div className="variable-group">
                <strong>Date/Time Variables:</strong>
                <ul>
                  <li><code>{'{current_date}'}</code> - Current date (DD/MM/YYYY)</li>
                  <li><code>{'{current_time}'}</code> - Current time (HH:MM)</li>
                  <li><code>{'{current_datetime}'}</code> - Current date and time</li>
                  <li><code>{'{document_date}'}</code> - Sales document date</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Albanian Characters */}
          <div className="character-buttons">
            <span className="character-label">Albanian Characters:</span>
            <button 
              type="button" 
              className="char-btn"
              onClick={() => insertCharacter('Ç')}
              title="Ç"
            >
              Ç
            </button>
            <button 
              type="button" 
              className="char-btn"
              onClick={() => insertCharacter('ç')}
              title="ç"
            >
              ç
            </button>
            <button 
              type="button" 
              className="char-btn"
              onClick={() => insertCharacter('Ë')}
              title="Ë"
            >
              Ë
            </button>
            <button 
              type="button" 
              className="char-btn"
              onClick={() => insertCharacter('ë')}
              title="ë"
            >
              ë
            </button>
          </div>
        </div>

        {/* MSG1 Settings */}
        <div className="setting-group">
          <h4>Message 1 (Initial Contact)</h4>
          <div className="message-settings">
            <label>Message Content:</label>
            <textarea
              ref={msg1TextareaRef}
              className="message-content"
              value={salesSettings.msg1.content}
              onChange={(e) => updateMessageSettings('msg1', { content: e.target.value })}
              onFocus={() => setLastFocusedTextarea('msg1')}
              placeholder="Enter your initial contact message... Use variables like {name}, {name[0]}, {town}, etc."
              rows={4}
            />
            
            {/* Content Preview */}
            {salesSettings.msg1.content && (
              <div className="content-preview">
                <h5>Preview (with sample data):</h5>
                <div className="preview-box">
                  {processMessageVariables(salesSettings.msg1.content).split('\n').map((line, index) => (
                    <div key={index}>{line || '\u00A0'}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="image-settings">
              <label>Images:</label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  const imagePromises = files.map(file => {
                    return new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onload = (e) => resolve(e.target?.result as string);
                      reader.readAsDataURL(file);
                    });
                  });
                  const imageDataUrls = await Promise.all(imagePromises);
                  updateMessageSettings('msg1', { images: [...salesSettings.msg1.images, ...imageDataUrls] });
                }}
              />
              
              {/* Image Preview */}
              {salesSettings.msg1.images.length > 0 && (
                <div className="selected-images">
                  <h5>Selected Images:</h5>
                  <div className="image-preview-grid">
                    {salesSettings.msg1.images.map((image, index) => (
                      <div key={index} className="image-preview-item">
                        <img 
                          src={image} 
                          alt={`Preview ${index + 1}`}
                          style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '4px' }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const newImages = salesSettings.msg1.images.filter((_, i) => i !== index);
                            updateMessageSettings('msg1', { images: newImages });
                          }}
                          className="remove-image-btn"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="delay-inputs">
              <h5>Send Delay:</h5>
              <div className="delay-input">
                <label>Days:</label>
                <input
                  type="number"
                  min="0"
                  value={salesSettings.msg1.delayDays}
                  onChange={(e) => updateMessageSettings('msg1', { delayDays: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="delay-input">
                <label>Hours:</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={salesSettings.msg1.delayHours}
                  onChange={(e) => updateMessageSettings('msg1', { delayHours: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="delay-input">
                <label>Minutes:</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={salesSettings.msg1.delayMinutes}
                  onChange={(e) => updateMessageSettings('msg1', { delayMinutes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="delay-input">
                <label>Seconds:</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={salesSettings.msg1.delaySeconds}
                  onChange={(e) => updateMessageSettings('msg1', { delaySeconds: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>
        </div>

        {/* MSG2 Settings */}
        <div className="setting-group">
          <h4>Message 2 (Follow-up)</h4>
          
          {/* Variables Section for MSG2 */}
          <div className="info-box">
            <h4>Available Variables</h4>
            <p>Copy and paste these variables into your message:</p>
            
            <div className="variables-list">
              <div className="variable-category">
                <div className="variable-group">
                  <strong>Contact Variables:</strong>
                  <ul>
                    <li><code>{'{name}'}</code> - Full name</li>
                    <li><code>{'{name[0]}'}</code> - First name</li>
                    <li><code>{'{name[1]}'}</code> - Last name</li>
                    <li><code>{'{phone}'}</code> - Phone number</li>
                    <li><code>{'{town}'}</code> - Town</li>
                  </ul>
                </div>
              </div>

              <div className="variable-category">
                <div className="variable-group">
                  <strong>Date/Time Variables:</strong>
                  <ul>
                    <li><code>{'{current_date}'}</code> - Current date</li>
                    <li><code>{'{current_time}'}</code> - Current time</li>
                    <li><code>{'{current_datetime}'}</code> - Current date and time</li>
                    <li><code>{'{document_date}'}</code> - Document date</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Albanian Characters */}
          <div className="character-buttons">
            <span className="character-label">Albanian Characters:</span>
            <button 
              type="button" 
              className="char-btn"
              onClick={() => insertCharacter('Ç')}
              title="Ç"
            >
              Ç
            </button>
            <button 
              type="button" 
              className="char-btn"
              onClick={() => insertCharacter('ç')}
              title="ç"
            >
              ç
            </button>
            <button 
              type="button" 
              className="char-btn"
              onClick={() => insertCharacter('Ë')}
              title="Ë"
            >
              Ë
            </button>
            <button 
              type="button" 
              className="char-btn"
              onClick={() => insertCharacter('ë')}
              title="ë"
            >
              ë
            </button>
          </div>

          <div className="message-settings">
            <label>Message Content:</label>
            <textarea
              ref={msg2TextareaRef}
              className="message-content"
              value={salesSettings.msg2.content}
              onChange={(e) => updateMessageSettings('msg2', { content: e.target.value })}
              onFocus={() => setLastFocusedTextarea('msg2')}
              placeholder="Enter your follow-up message... Use variables like {name}, {name[0]}, {town}, etc."
              rows={4}
            />
            
            {/* Content Preview */}
            {salesSettings.msg2.content && (
              <div className="content-preview">
                <h5>Preview (with sample data):</h5>
                <div className="preview-box">
                  {processMessageVariables(salesSettings.msg2.content).split('\n').map((line, index) => (
                    <div key={index}>{line || '\u00A0'}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="image-settings">
              <label>Images:</label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  const imagePromises = files.map(file => {
                    return new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onload = (e) => resolve(e.target?.result as string);
                      reader.readAsDataURL(file);
                    });
                  });
                  const imageDataUrls = await Promise.all(imagePromises);
                  updateMessageSettings('msg2', { images: [...salesSettings.msg2.images, ...imageDataUrls] });
                }}
              />
              
              {/* Image Preview */}
              {salesSettings.msg2.images.length > 0 && (
                <div className="selected-images">
                  <h5>Selected Images:</h5>
                  <div className="image-preview-grid">
                    {salesSettings.msg2.images.map((image, index) => (
                      <div key={index} className="image-preview-item">
                        <img 
                          src={image} 
                          alt={`Preview ${index + 1}`}
                          style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '4px' }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const newImages = salesSettings.msg2.images.filter((_, i) => i !== index);
                            updateMessageSettings('msg2', { images: newImages });
                          }}
                          className="remove-image-btn"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="delay-inputs">
              <h5>Send Delay (after MSG1 is sent):</h5>
              <div className="delay-input">
                <label>Days:</label>
                <input
                  type="number"
                  min="0"
                  value={salesSettings.msg2.delayDays}
                  onChange={(e) => updateMessageSettings('msg2', { delayDays: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="delay-input">
                <label>Hours:</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={salesSettings.msg2.delayHours}
                  onChange={(e) => updateMessageSettings('msg2', { delayHours: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="delay-input">
                <label>Minutes:</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={salesSettings.msg2.delayMinutes}
                  onChange={(e) => updateMessageSettings('msg2', { delayMinutes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="delay-input">
                <label>Seconds:</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={salesSettings.msg2.delaySeconds}
                  onChange={(e) => updateMessageSettings('msg2', { delaySeconds: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="settings-actions">
          <button
            onClick={handleSaveSettings}
            disabled={settingsLoading}
            className={`save-settings-btn ${settingsSaved ? 'saved' : ''}`}
          >
            {settingsLoading ? 'Saving...' : settingsSaved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    );
  };

  // Render scheduled messages content
  const renderScheduledMessagesContent = () => {
    return (
      <div className="scheduled-messages-section">
        <h3>Scheduled Messages</h3>
        
        {/* Stats */}
        {messagesStats && (
          <div className="messages-stats">
            <div className="stat-item">
              <label>Total:</label>
              <span>{messagesStats.total}</span>
            </div>
            <div className="stat-item">
              <label>Scheduled:</label>
              <span>{messagesStats.byStatus.scheduled}</span>
            </div>
            <div className="stat-item">
              <label>Waiting:</label>
              <span>{messagesStats.byStatus.waiting_for_msg1 || 0}</span>
            </div>
            <div className="stat-item">
              <label>Sent:</label>
              <span>{messagesStats.byStatus.sent}</span>
            </div>
            <div className="stat-item">
              <label>Delivered:</label>
              <span>{messagesStats.byStatus.delivered || 0}</span>
            </div>
            <div className="stat-item">
              <label>Read:</label>
              <span>{messagesStats.byStatus.read || 0}</span>
            </div>
            <div className="stat-item">
              <label>Failed:</label>
              <span>{messagesStats.byStatus.failed}</span>
            </div>
            <div className="stat-item">
              <label>MSG1:</label>
              <span>{messagesStats.byType.msg1}</span>
            </div>
            <div className="stat-item">
              <label>MSG2:</label>
              <span>{messagesStats.byType.msg2}</span>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="messages-filters">
          <div className="filter-section">
            <label>Status:</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="waiting_for_msg1">Waiting for MSG1</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="read">Read</option>
              <option value="cancelled">Cancelled</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="filter-section">
            <label>Message Type:</label>
            <select value={messageTypeFilter} onChange={(e) => setMessageTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              <option value="msg1">Message 1</option>
              <option value="msg2">Message 2</option>
            </select>
          </div>

          <div className="filter-section">
            <label>Town:</label>
            <select value={townFilterMessages} onChange={(e) => setTownFilterMessages(e.target.value)}>
              <option value="all">All Towns</option>
              <option value="tirane">Tirane</option>
              <option value="fier">Fier</option>
              <option value="vlore">Vlore</option>
            </select>
          </div>
        </div>

        {/* Bulk actions */}
        <div className="bulk-actions">
          <button
            className="select-all-btn"
            onClick={toggleSelectAllMessages}
            disabled={messagesLoading}
          >
            {selectedMessages.size === scheduledMessages.length && scheduledMessages.length > 0 
              ? 'Deselect All' 
              : `Select All${messagesPagination.total > 0 ? ` (${messagesPagination.total})` : ''}`}
          </button>
          
          <button
            className="cancel-btn"
            onClick={handleCancelSelectedMessages}
            disabled={selectedMessages.size === 0 || messagesLoading}
          >
            Cancel Selected ({selectedMessages.size})
          </button>
          
          <button
            className="delete-btn"
            onClick={handleDeleteSelectedMessages}
            disabled={selectedMessages.size === 0 || messagesLoading}
          >
            Delete Selected ({selectedMessages.size})
          </button>
        </div>

        {/* Messages table */}
        <div className="messages-table-container">
          {messagesLoading ? (
            <div className="loading-spinner">
              <div className="spinner"></div>
              <span>Loading scheduled messages...</span>
            </div>
          ) : (
            <table className="messages-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selectedMessages.size === scheduledMessages.length && scheduledMessages.length > 0}
                      onChange={toggleSelectAllMessages}
                    />
                  </th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Town</th>
                  <th>Type</th>
                  <th>Status & Timestamps</th>
                  <th>Send At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {scheduledMessages.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="no-data">No scheduled messages found</td>
                  </tr>
                ) : (
                  scheduledMessages.map((message) => (
                    <tr key={message.id} className={selectedMessages.has(message.id) ? 'selected' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedMessages.has(message.id)}
                          onChange={() => toggleMessageSelection(message.id)}
                        />
                      </td>
                      <td>{message.contactName}</td>
                      <td>{formatPhone(message.contactPhone)}</td>
                      <td>{message.town}</td>
                      <td>
                        <span className={`message-type ${message.messageType}`}>
                          {message.messageType.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <div className="status-timestamps">
                          <div className="status-row">
                            <span className={`status-badge ${message.status}`}>
                              {message.status === 'waiting_for_msg1' ? 'Waiting for MSG1' : 
                               message.status.charAt(0).toUpperCase() + message.status.slice(1)}
                            </span>
                          </div>
                          <div className="timestamps">
                            <div><strong>Scheduled:</strong> {formatDate(message.scheduledAt)}</div>
                            {message.sentAt && (
                              <div><strong>Sent:</strong> {formatDate(message.sentAt)}</div>
                            )}
                            {message.deliveredAt && (
                              <div><strong>Delivered:</strong> {formatDate(message.deliveredAt)}</div>
                            )}
                            {message.readAt && (
                              <div><strong>Read:</strong> {formatDate(message.readAt)}</div>
                            )}
                            {message.errorMessage && (
                              <div className="error-timestamp">
                                <strong>Error:</strong> {message.errorMessage}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        {message.status === 'waiting_for_msg1' || message.sendAt === '9999-12-31T23:59:59.999Z' 
                          ? 'Pending MSG1' 
                          : formatDate(message.sendAt)}
                      </td>
                      <td>
                        {(message.status === 'scheduled' || message.status === 'waiting_for_msg1') && (
                          <button
                            className="cancel-single-btn"
                            onClick={() => handleCancelSingleMessage(message.id)}
                            title="Cancel this message"
                          >
                            Cancel
                          </button>
                        )}
                        {message.errorMessage && (
                          <span className="error-indicator" title={message.errorMessage}>
                            ⚠️
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="messages-pagination">
          <div className="pagination-info">
            <span>
              Showing {messagesPagination.total === 0 ? 0 : ((messagesPagination.page - 1) * messagesPagination.limit) + 1} to{' '}
              {Math.min(messagesPagination.page * messagesPagination.limit, messagesPagination.total)} of{' '}
              {messagesPagination.total} messages
            </span>
          </div>
          
          <div className="pagination-controls">
            <label>Messages per page:</label>
            <select value={messagesPagination.limit} onChange={handleMessageLimitChange}>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
            </select>
          </div>
          
          <div className="pagination-nav">
            <button
              onClick={() => handleMessagePageChange(1)}
              disabled={messagesPagination.page === 1 || messagesLoading}
            >
              First
            </button>
            <button
              onClick={() => handleMessagePageChange(messagesPagination.page - 1)}
              disabled={messagesPagination.page === 1 || messagesLoading}
            >
              Previous
            </button>
            
            <span className="page-info">
              Page {messagesPagination.page} of {messagesPagination.totalPages}
            </span>
            
            <button
              onClick={() => handleMessagePageChange(messagesPagination.page + 1)}
              disabled={messagesPagination.page === messagesPagination.totalPages || messagesLoading}
            >
              Next
            </button>
            <button
              onClick={() => handleMessagePageChange(messagesPagination.totalPages)}
              disabled={messagesPagination.page === messagesPagination.totalPages || messagesLoading}
            >
              Last
            </button>
          </div>
          
          <div className="go-to-page">
            <span>Go to page:</span>
            <form onSubmit={handleGoToPage} className="page-jump-form">
              <input
                type="number"
                value={goToPage}
                onChange={(e) => setGoToPage(e.target.value)}
                min="1"
                max={messagesPagination.totalPages}
                placeholder="Page #"
              />
              <button type="submit">Go</button>
            </form>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="sales-api">
      <div className="sales-api-header">
        <h2>Sales API</h2>
        <div className="tab-navigation">
          <button 
            className={`tab-btn ${activeTab === 'sales-list' ? 'active' : ''}`}
            onClick={() => setActiveTab('sales-list')}
          >
            Sales List
          </button>
          <button 
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
          <button 
            className={`tab-btn ${activeTab === 'scheduled-messages' ? 'active' : ''}`}
            onClick={() => setActiveTab('scheduled-messages')}
          >
            Scheduled Messages
          </button>
        </div>
      </div>

      <div className="sales-api-content">
        {activeTab === 'sales-list' && renderSalesListContent()}
        {activeTab === 'settings' && renderSettingsContent()}
        {activeTab === 'scheduled-messages' && renderScheduledMessagesContent()}
      </div>
    </div>
  );
};

export default SalesAPI; 