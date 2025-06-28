import React, { useState, useEffect, useCallback } from 'react';
import './Contacts.css';

interface Contact {
  id: number;
  name: string;
  surname: string;
  email: string;
  phone: string;
  birthday: string;
  source?: string;
  createdAt?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const Contacts: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 100, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [addContactLoading, setAddContactLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [activeView, setActiveView] = useState<'contacts' | 'add' | 'edit' | 'import'>('contacts');
  const [contactToEdit, setContactToEdit] = useState<Contact | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    surname: '',
    email: '',
    phone: '',
    birthday: ''
  });
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  
  // Import/Export state
  const [importLoading, setImportLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [validContacts, setValidContacts] = useState<any[]>([]);
  const [skippedContacts, setSkippedContacts] = useState<any[]>([]);
  const [importTab, setImportTab] = useState<'valid' | 'skipped'>('valid');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [importFileName, setImportFileName] = useState('');
  const [importProgress, setImportProgress] = useState({
    status: '',
    step: '',
    progress: 0
  });
  const [previewPagination, setPreviewPagination] = useState({
    page: 1,
    limit: 50,
    totalPages: 1
  });
  const [editingContact, setEditingContact] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    surname: '',
    email: '',
    phone: '',
    birthday: ''
  });

  // Load contacts on component mount and when pagination/search changes
  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await window.electron.contacts.getContacts(
        pagination.page,
        pagination.limit,
        search
      );
      
      if (response.success) {
        setContacts(response.contacts);
        setPagination(response.pagination);
      } else {
        setError(response.error || 'Failed to load contacts');
      }
    } catch (err: any) {
      setError('Error loading contacts: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, search]);

  // Separate function for search to avoid circular dependencies
  const performSearch = useCallback(async () => {
    try {
      const response = await window.electron.contacts.getContacts(
        1, // Reset to first page on search
        pagination.limit,
        search
      );
      
      if (response.success) {
        setContacts(response.contacts);
        setPagination(() => ({
          ...response.pagination,
          page: 1 // Ensure we're on first page
        }));
      } else {
        setError(response.error || 'Failed to load contacts');
      }
    } catch (err: any) {
      setError('Error loading contacts: ' + err.message);
    }
  }, [pagination.limit, search]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Reset selection when contacts change
  useEffect(() => {
    setSelectedContacts([]);
    setSelectAll(false);
  }, [contacts]);

  // Handle pagination
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  // Handle search
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  };

  // Handle search submit (with debounce)
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
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
    }, 300);
    
    setSearchTimeout(timeout);
  };

  // Debounced search when search input changes
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
  }, [search, performSearch]);

  // Handle checkbox selection
  const toggleContactSelection = (contactId: number) => {
    setSelectedContacts(prev => {
      if (prev.includes(contactId)) {
        return prev.filter(id => id !== contactId);
      } else {
        return [...prev, contactId];
      }
    });
  };

  // Handle select all
  const toggleSelectAll = async () => {
    if (selectAll) {
      setSelectedContacts([]);
    } else {
      setSelectAllLoading(true);
      try {
        const response = await window.electron.contacts.getAllContactIds(search);
        if (response.success) {
          setSelectedContacts(response.contactIds);
          
          setSuccessMessage(`Selected all ${response.contactIds.length} contacts`);
          setTimeout(() => setSuccessMessage(''), 3000);
        } else {
          setError(response.error || 'Failed to get all contacts');
        }
      } catch (err: any) {
        setError('Error getting all contacts: ' + err.message);
      } finally {
        setSelectAllLoading(false);
      }
    }
    setSelectAll(!selectAll);
  };

  // Handle delete selected contacts
  const handleDeleteSelected = async () => {
    if (selectedContacts.length === 0) return;
    
    if (!window.confirm(`Are you sure you want to delete ${selectedContacts.length} contact(s)?`)) {
      return;
    }
    
    setDeleteLoading(true);
    try {
      const response = await window.electron.contacts.deleteContacts(selectedContacts);
      if (response.success) {
        setSuccessMessage(`Successfully deleted ${response.deletedCount} contact(s)`);
        setTimeout(() => setSuccessMessage(''), 3000);
        
        // Refresh contacts and reset selection
        setSelectedContacts([]);
        setSelectAll(false);
        // Reset pagination to page 1 and force reload
        setPagination(prev => ({ ...prev, page: 1 }));
        // Force immediate reload without waiting for pagination effect
        const contactsResponse = await window.electron.contacts.getContacts(1, pagination.limit, search);
        if (contactsResponse.success) {
          setContacts(contactsResponse.contacts);
          setPagination(contactsResponse.pagination);
        }
      } else {
        setError(response.error || 'Failed to delete contacts');
      }
    } catch (err: any) {
      setError('Error deleting contacts: ' + err.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  // Handle form input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const showAddContactForm = () => {
    setFormData({
      name: '',
      surname: '',
      email: '',
      phone: '',
      birthday: ''
    });
    setContactToEdit(null);
    setActiveView('add');
    setError('');
  };

  const showEditContactForm = (contact: Contact) => {
    setFormData({
      name: contact.name || '',
      surname: contact.surname || '',
      email: contact.email || '',
      phone: contact.phone || '',
      birthday: contact.birthday || ''
    });
    setContactToEdit(contact);
    setActiveView('edit');
    setError('');
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddContactLoading(true);
    
    try {
      const response = await window.electron.contacts.addContact(formData);
      if (response.success) {
        setSuccessMessage('Contact added successfully');
        setTimeout(() => setSuccessMessage(''), 3000);
        setActiveView('contacts');
        await loadContacts();
      } else {
        setError(response.error || 'Failed to add contact');
      }
    } catch (err: any) {
      setError('Error adding contact: ' + err.message);
    } finally {
      setAddContactLoading(false);
    }
  };

  const handleUpdateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactToEdit) return;
    
    setAddContactLoading(true);
    
    try {
      const response = await window.electron.contacts.updateContact(contactToEdit.id, formData);
      if (response.success) {
        setSuccessMessage('Contact updated successfully');
        setTimeout(() => setSuccessMessage(''), 3000);
        setActiveView('contacts');
        await loadContacts();
      } else {
        setError(response.error || 'Failed to update contact');
      }
    } catch (err: any) {
      setError('Error updating contact: ' + err.message);
    } finally {
      setAddContactLoading(false);
    }
  };

  // Import/Export handlers
  const handleImportFile = async () => {
    try {
      const fileResult = await window.electron.app.openFileDialog({
        title: 'Select Contact File',
        filters: [
          { name: 'Contact Files', extensions: ['csv', 'xlsx', 'xls', 'json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!fileResult.success || !fileResult.filePaths.length) {
        return;
      }

      const filePath = fileResult.filePaths[0];
      setImportLoading(true);
      setError('');

      // Set initial progress
      setImportProgress({
        status: 'active',
        step: 'Loading file',
        progress: 10
      });

      const response = await window.electron.contacts.importFile(filePath);
      if (response.success) {
        setImportProgress({
          status: 'active',
          step: 'Processing contacts',
          progress: 40
        });

        // Process contacts using backend logic
        const processResult = await window.electron.contacts.processImport(response.contacts);
        const { valid, skipped } = processResult;

        setValidContacts(valid);
        setSkippedContacts(skipped);
        setImportFileName(response.fileName);
        setImportTab('valid');
        setPreviewPagination(prev => ({ ...prev, page: 1 }));

        setImportProgress({
          status: 'complete',
          step: 'Ready to import',
          progress: 100
        });

        setSuccessMessage(
          `Loaded ${response.contacts.length} contacts from ${response.fileName} ` +
          `(${valid.length} valid, ${skipped.length} skipped)`
        );

        setActiveView('import');
      } else {
        setError(response.error || 'Failed to import file');
      }
    } catch (err: any) {
      setError('Error importing file: ' + err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (validContacts.length === 0) return;

    // Check for any duplicates in valid contacts before importing
    const duplicatesInValid = validContacts.filter(contact => contact.duplicate || contact.inDatabase);
    if (duplicatesInValid.length > 0) {
      setError(`Cannot import: ${duplicatesInValid.length} contact(s) have duplicate phone numbers. Please resolve duplicates first.`);
      return;
    }

    setImportLoading(true);
    try {
      // Only import valid contacts without duplicates
      const response = await window.electron.contacts.importContacts(validContacts, skipDuplicates);
      if (response.success) {
        setSuccessMessage(`Successfully imported ${response.importedCount} contacts. Skipped: ${response.skippedCount}`);
        if (response.errors.length > 0) {
          setError(`Some errors occurred: ${response.errors.slice(0, 3).join(', ')}${response.errors.length > 3 ? '...' : ''}`);
        }
        setTimeout(() => {
          setSuccessMessage('');
          setError('');
        }, 5000);
        
        setActiveView('contacts');
        // Clear import state
        setValidContacts([]);
        setSkippedContacts([]);
        setImportFileName('');
        setImportProgress({ status: '', step: '', progress: 0 });
        // Reset form states to prevent sticking
        setSearch('');
        setSelectedContacts([]);
        setSelectAll(false);
        await loadContacts();
      } else {
        setError(response.error || 'Failed to import contacts');
      }
    } catch (err: any) {
      setError('Error importing contacts: ' + err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const handleExport = async (format: 'csv' | 'excel' | 'json') => {
    setExportLoading(true);
    try {
      const response = await window.electron.contacts.exportContacts(format);
      if (response.success) {
        setSuccessMessage(`Contacts exported to: ${response.fileName}`);
        setTimeout(() => setSuccessMessage(''), 5000);
      } else {
        setError(response.error || 'Failed to export contacts');
      }
    } catch (err: any) {
      setError('Error exporting contacts: ' + err.message);
    } finally {
      setExportLoading(false);
    }
  };

  const formatPhone = (phone: string) => {
    return phone || 'N/A';
  };

  // Get paginated contacts for preview
  const getPaginatedPreviewContacts = () => {
    const currentContacts = importTab === 'valid' ? validContacts : skippedContacts;
    const startIndex = (previewPagination.page - 1) * previewPagination.limit;
    const endIndex = startIndex + previewPagination.limit;
    
    // Update total pages
    const totalPages = Math.ceil(currentContacts.length / previewPagination.limit);
    if (totalPages !== previewPagination.totalPages) {
      setPreviewPagination(prev => ({ ...prev, totalPages }));
    }
    
    return currentContacts.slice(startIndex, endIndex);
  };

  const handlePreviewPageChange = (newPage: number) => {
    setPreviewPagination(prev => ({ ...prev, page: newPage }));
  };

  // Move contact between valid and skipped
  const moveContact = (contact: any, destination: 'valid' | 'skipped') => {
    if (destination === 'valid') {
      setValidContacts(prev => [...prev, contact]);
      setSkippedContacts(prev => prev.filter(c => c.id !== contact.id));
    } else {
      setSkippedContacts(prev => [...prev, contact]);
      setValidContacts(prev => prev.filter(c => c.id !== contact.id));
    }
  };

  // Start editing contact in preview
  const startEditing = (contact: any) => {
    setEditingContact(contact);
    setEditFormData({
      name: contact.name || '',
      surname: contact.surname || '',
      email: contact.email || '',
      phone: contact.phone || '',
      birthday: contact.birthday || ''
    });
  };

  // Check if phone exists in database
  const checkPhoneInDatabase = async (phone: string): Promise<boolean> => {
    try {
      return await window.electron.contacts.checkPhoneExists(phone);
    } catch {
      return false;
    }
  };

  // Handle edit form input change
  const handleEditInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));

    // Real-time duplicate checking for phone field
    if (name === 'phone' && value.trim()) {
      const inDatabase = await checkPhoneInDatabase(value.trim());
      const duplicateInImport = [...validContacts, ...skippedContacts].some(c => 
        c.id !== editingContact.id && c.phone === value.trim()
      );

      // Update the contact being edited with real-time duplicate status
      const updatedContact = {
        ...editingContact,
        inDatabase,
        duplicate: inDatabase || duplicateInImport,
        skipReason: inDatabase ? 'Phone number already exists in database' : 
                    duplicateInImport ? 'Duplicate phone number in import file' : null
      };

      if (importTab === 'valid') {
        setValidContacts(prev => 
          prev.map(c => c.id === editingContact.id ? updatedContact : c)
        );
      } else {
        setSkippedContacts(prev => 
          prev.map(c => c.id === editingContact.id ? updatedContact : c)
        );
      }
    }
  };

  // Save edited contact
  const saveEditedContact = async () => {
    if (!editFormData.phone.trim()) {
      return;
    }

    const trimmedPhone = editFormData.phone.trim();

    // Check for duplicates in both lists
    const duplicateInValid = validContacts.some(c => 
      c.id !== editingContact.id && c.phone === trimmedPhone
    );
    const duplicateInSkipped = skippedContacts.some(c => 
      c.id !== editingContact.id && c.phone === trimmedPhone
    );

    // Check if phone exists in database
    const inDatabase = await checkPhoneInDatabase(trimmedPhone);

    const isDuplicate = inDatabase || duplicateInValid || duplicateInSkipped;

    const updatedContact = {
      ...editingContact,
      name: editFormData.name || '',
      surname: editFormData.surname || '',
      email: editFormData.email || '',
      phone: trimmedPhone,
      birthday: editFormData.birthday || '',
      inDatabase,
      duplicate: isDuplicate,
      valid: !isDuplicate,
      skipReason: inDatabase ? 'Phone number already exists in database' : 
                  (duplicateInValid || duplicateInSkipped) ? 'Duplicate phone number in import file' : null
    };

    // Update all contacts with same phone to reflect duplicate status
    const updateDuplicateStatus = (contactList: any[]) => {
      return contactList.map(c => {
        if (c.phone === trimmedPhone && c.id !== editingContact.id) {
          return {
            ...c,
            duplicate: true,
            valid: false,
            skipReason: 'Duplicate phone number in import file'
          };
        }
        return c;
      });
    };

    // Move contact to appropriate list based on validity
    if (isDuplicate) {
      // Move to skipped if it's a duplicate
      if (importTab === 'valid') {
        setValidContacts(prev => prev.filter(c => c.id !== editingContact.id));
        setSkippedContacts(prev => [...updateDuplicateStatus(prev), updatedContact]);
      } else {
        setSkippedContacts(prev => updateDuplicateStatus(prev.map(c => c.id === editingContact.id ? updatedContact : c)));
      }
    } else {
      // Move to valid if it's not a duplicate
      if (importTab === 'skipped') {
        setSkippedContacts(prev => prev.filter(c => c.id !== editingContact.id));
        setValidContacts(prev => [...updateDuplicateStatus(prev), updatedContact]);
      } else {
        setValidContacts(prev => updateDuplicateStatus(prev.map(c => c.id === editingContact.id ? updatedContact : c)));
      }
    }

    setEditingContact(null);
  };

  const renderImportPreview = () => {
    const currentContacts = getPaginatedPreviewContacts();
    const totalContacts = importTab === 'valid' ? validContacts.length : skippedContacts.length;

    return (
      <div className="contact-form-container">
        <div className="contact-form-header">
          <h3>Import Preview - {importFileName}</h3>
          <button
            className="btn-secondary"
            onClick={() => setActiveView('contacts')}
          >
            Cancel Import
          </button>
        </div>

        {successMessage && (
          <div className="success-message">
            <span className="success-icon">✅</span>
            {successMessage}
          </div>
        )}

        {/* Import progress */}
        {importProgress.status === 'active' && (
          <div className="import-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${importProgress.progress}%` }}
              ></div>
            </div>
            <p>{importProgress.step} ({importProgress.progress}%)</p>
          </div>
        )}

        {/* Tabs for Valid and Skipped contacts */}
        <div className="import-tabs">
          <button
            className={`tab-button ${importTab === 'valid' ? 'active' : ''}`}
            onClick={() => {
              setImportTab('valid');
              setPreviewPagination(prev => ({ ...prev, page: 1 }));
            }}
          >
            Valid Contacts ({validContacts.length})
          </button>
          <button
            className={`tab-button ${importTab === 'skipped' ? 'active' : ''}`}
            onClick={() => {
              setImportTab('skipped');
              setPreviewPagination(prev => ({ ...prev, page: 1 }));
            }}
          >
            Skipped Contacts ({skippedContacts.length})
          </button>
        </div>

        <div className="import-options">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
            />
            Skip duplicate phone numbers from existing contacts
          </label>
        </div>

        {totalContacts === 0 ? (
          <div className="empty-state">
            <p>No {importTab} contacts found.</p>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="contacts-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Surname</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Birthday</th>
                    <th>Source</th>
                    {importTab === 'skipped' && <th>Reason</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentContacts.map((contact) => (
                    <tr key={contact.id} className={contact.duplicate ? 'duplicate-row' : ''}>
                      <td>
                        {editingContact?.id === contact.id ? (
                          <input
                            type="text"
                            name="name"
                            value={editFormData.name}
                            onChange={handleEditInputChange}
                            className="edit-input"
                          />
                        ) : (
                          contact.name || 'N/A'
                        )}
                      </td>
                      <td>
                        {editingContact?.id === contact.id ? (
                          <input
                            type="text"
                            name="surname"
                            value={editFormData.surname}
                            onChange={handleEditInputChange}
                            className="edit-input"
                          />
                        ) : (
                          contact.surname || 'N/A'
                        )}
                      </td>
                      <td>
                        {editingContact?.id === contact.id ? (
                          <input
                            type="email"
                            name="email"
                            value={editFormData.email}
                            onChange={handleEditInputChange}
                            className="edit-input"
                          />
                        ) : (
                          contact.email || 'N/A'
                        )}
                      </td>
                      <td>
                        {editingContact?.id === contact.id ? (
                          <input
                            type="text"
                            name="phone"
                            value={editFormData.phone}
                            onChange={handleEditInputChange}
                            className="edit-input"
                            required
                          />
                        ) : (
                          <div>
                            <span className={
                              !contact.phone ? 'missing-phone' : 
                              contact.inDatabase ? 'duplicate-phone' :
                              contact.duplicate ? 'duplicate-phone' : ''
                            }>
                              {contact.phone || 'Missing'}
                            </span>
                            {(contact.duplicate || contact.inDatabase) && (
                              <div className="duplicate-message">
                                {contact.skipReason}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        {editingContact?.id === contact.id ? (
                          <input
                            type="date"
                            name="birthday"
                            value={editFormData.birthday || ''}
                            onChange={handleEditInputChange}
                            className="edit-input"
                          />
                        ) : (
                          contact.birthday || 'N/A'
                        )}
                      </td>
                      <td>{contact.source}</td>
                      {importTab === 'skipped' && <td>{contact.skipReason}</td>}
                      <td>
                        {editingContact?.id === contact.id ? (
                          <div className="edit-actions">
                            <button
                              className="btn-save"
                              onClick={saveEditedContact}
                              title="Save changes"
                            >
                              ✓
                            </button>
                            <button
                              className="btn-cancel"
                              onClick={() => setEditingContact(null)}
                              title="Cancel editing"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="preview-actions">
                            <button
                              className="btn-edit"
                              onClick={() => startEditing(contact)}
                              title="Edit contact"
                            >
                              ✏️
                            </button>
                            {importTab === 'valid' ? (
                              <button
                                className="btn-skip"
                                onClick={() => moveContact(contact, 'skipped')}
                                title="Skip this contact"
                              >
                                ⏭️
                              </button>
                            ) : (
                              <button
                                className="btn-restore"
                                onClick={() => moveContact(contact, 'valid')}
                                title="Move to valid contacts"
                              >
                                ↩️
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination for preview */}
            {previewPagination.totalPages > 1 && (
              <div className="pagination">
                <button
                  className={`pagination-btn ${previewPagination.page === 1 ? 'disabled' : ''}`}
                  onClick={() => handlePreviewPageChange(1)}
                  disabled={previewPagination.page === 1}
                >
                  First
                </button>
                <button
                  className={`pagination-btn ${previewPagination.page === 1 ? 'disabled' : ''}`}
                  onClick={() => handlePreviewPageChange(previewPagination.page - 1)}
                  disabled={previewPagination.page === 1}
                >
                  Previous
                </button>
                
                <span className="pagination-info">
                  {previewPagination.page} of {previewPagination.totalPages}
                </span>
                
                <button
                  className={`pagination-btn ${previewPagination.page === previewPagination.totalPages ? 'disabled' : ''}`}
                  onClick={() => handlePreviewPageChange(previewPagination.page + 1)}
                  disabled={previewPagination.page === previewPagination.totalPages}
                >
                  Next
                </button>
                <button
                  className={`pagination-btn ${previewPagination.page === previewPagination.totalPages ? 'disabled' : ''}`}
                  onClick={() => handlePreviewPageChange(previewPagination.totalPages)}
                  disabled={previewPagination.page === previewPagination.totalPages}
                >
                  Last
                </button>
              </div>
            )}

            <div className="import-summary">
              <p>
                Showing {currentContacts.length} of {totalContacts} {importTab} contacts
                {importTab === 'valid' && ` • Ready to import ${validContacts.length} valid contacts`}
              </p>
            </div>
          </>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setActiveView('contacts')}
          >
            Cancel
          </button>
          {validContacts.length > 0 && (
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirmImport}
              disabled={importLoading}
            >
              {importLoading ? (
                <>
                  <span className="loading-spinner small">
                    <div className="spinner"></div>
                  </span>
                  Importing...
                </>
              ) : (
                `Import ${validContacts.length} Valid Contacts`
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderContactForm = () => {
    return (
      <div className="contact-form-container">
        <div className="contact-form-header">
          <h3>{activeView === 'add' ? 'Add New Contact' : 'Edit Contact'}</h3>
          <button
            className="btn-secondary"
            onClick={() => setActiveView('contacts')}
          >
            Back to Contacts
          </button>
        </div>

        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            {error}
          </div>
        )}

        <form onSubmit={activeView === 'add' ? handleAddContact : handleUpdateContact} className="contact-form">
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="name">Name</label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="Enter first name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="surname">Surname</label>
              <input
                type="text"
                id="surname"
                name="surname"
                value={formData.surname}
                onChange={handleInputChange}
                placeholder="Enter last name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="Enter email address"
              />
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone*</label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                placeholder="Enter phone number"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="birthday">Birthday</label>
              <input
                type="date"
                id="birthday"
                name="birthday"
                value={formData.birthday}
                onChange={handleInputChange}
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setActiveView('contacts')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={addContactLoading}
            >
              {addContactLoading ? (
                <>
                  <span className="loading-spinner small">
                    <div className="spinner"></div>
                  </span>
                  Processing...
                </>
              ) : activeView === 'add' ? 'Add Contact' : 'Update Contact'}
            </button>
          </div>
        </form>
      </div>
    );
  };

  const renderContactsTable = () => {
    return (
      <div className="contacts-container">
        <div className="contacts-header">
          <h3>Contacts ({pagination.total})</h3>
          <div className="contacts-actions">
            <button
              className="btn-primary"
              onClick={showAddContactForm}
            >
              <span className="btn-icon">➕</span>
              Add Contact
            </button>
            <button 
              className="btn-secondary"
              onClick={handleImportFile}
              disabled={importLoading}
            >
              {importLoading ? (
                <>
                  <span className="loading-spinner small">
                    <div className="spinner"></div>
                  </span>
                  Importing...
                </>
              ) : (
                <>
                  <span className="btn-icon">📥</span>
                  Import
                </>
              )}
            </button>
            <div className="export-dropdown">
              <button 
                className="btn-secondary"
                disabled={exportLoading || contacts.length === 0}
              >
                {exportLoading ? (
                  <>
                    <span className="loading-spinner small">
                      <div className="spinner"></div>
                    </span>
                    Exporting...
                  </>
                ) : (
                  <>
                    <span className="btn-icon">📤</span>
                    Export ▼
                  </>
                )}
              </button>
              <div className="dropdown-content">
                <button onClick={() => handleExport('csv')}>Export as CSV</button>
                <button onClick={() => handleExport('excel')}>Export as Excel</button>
                <button onClick={() => handleExport('json')}>Export as JSON</button>
              </div>
            </div>
            {selectedContacts.length > 0 && (
              <button
                className="btn-danger"
                onClick={handleDeleteSelected}
                disabled={deleteLoading}
              >
                {deleteLoading ? (
                  <span className="loading-spinner small">
                    <div className="spinner"></div>
                  </span>
                ) : (
                  <span className="btn-icon">🗑️</span>
                )}
                Delete Selected ({selectedContacts.length})
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            {error}
          </div>
        )}

        {successMessage && (
          <div className="success-message">
            <span className="success-icon">✅</span>
            {successMessage}
          </div>
        )}

        <div className="search-section">
          <form onSubmit={handleSearchSubmit} className="search-form">
            <input
              type="text"
              className="search-input"
              placeholder="Search contacts..."
              value={search}
              onChange={handleSearchChange}
            />
            <button 
              className="search-button" 
              type="submit"
              disabled={searchLoading}
            >
              {searchLoading ? (
                <span className="loading-spinner small">
                  <div className="spinner"></div>
                </span>
              ) : (
                '🔍'
              )}
            </button>
          </form>
        </div>

        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner">
              <div className="spinner"></div>
            </div>
            <p>Loading contacts...</p>
          </div>
        ) : contacts.length === 0 ? (
          <div className="empty-state">
            <p>No contacts found. {search && 'Try a different search term or'} Add a new contact to get started.</p>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="contacts-table">
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
                    <th>Name</th>
                    <th>Surname</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Birthday</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map(contact => (
                    <tr key={contact.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedContacts.includes(contact.id)}
                          onChange={() => toggleContactSelection(contact.id)}
                        />
                      </td>
                      <td>{contact.name || 'N/A'}</td>
                      <td>{contact.surname || 'N/A'}</td>
                      <td>{contact.email || 'N/A'}</td>
                      <td>{formatPhone(contact.phone)}</td>
                      <td>{contact.birthday || 'N/A'}</td>
                      <td>
                        <div className="action-buttons">
                          <button
                            className="btn-edit"
                            onClick={() => showEditContactForm(contact)}
                            title="Edit contact"
                          >
                            ✏️
                          </button>
                          <button
                            className="btn-delete"
                            onClick={async () => {
                              if (!window.confirm(`Are you sure you want to delete ${contact.name || 'this contact'}?`)) {
                                return;
                              }
                              
                              setDeleteLoading(true);
                              try {
                                const response = await window.electron.contacts.deleteContacts([contact.id]);
                                if (response.success) {
                                                                  setSuccessMessage(`Successfully deleted contact`);
                                setTimeout(() => setSuccessMessage(''), 3000);
                                // Force immediate reload to show remaining contacts
                                const contactsResponse = await window.electron.contacts.getContacts(pagination.page, pagination.limit, search);
                                if (contactsResponse.success) {
                                  setContacts(contactsResponse.contacts);
                                  setPagination(contactsResponse.pagination);
                                }
                                } else {
                                  setError(response.error || 'Failed to delete contact');
                                }
                              } catch (err: any) {
                                setError('Error deleting contact: ' + err.message);
                              } finally {
                                setDeleteLoading(false);
                              }
                            }}
                            title="Delete contact"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination controls */}
            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button
                  className={`pagination-btn ${pagination.page === 1 ? 'disabled' : ''}`}
                  onClick={() => handlePageChange(1)}
                  disabled={pagination.page === 1}
                >
                  First
                </button>
                <button
                  className={`pagination-btn ${pagination.page === 1 ? 'disabled' : ''}`}
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                >
                  Previous
                </button>
                
                <span className="pagination-info">
                  {pagination.page} of {pagination.totalPages}
                </span>
                
                <button
                  className={`pagination-btn ${pagination.page === pagination.totalPages ? 'disabled' : ''}`}
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                >
                  Next
                </button>
                <button
                  className={`pagination-btn ${pagination.page === pagination.totalPages ? 'disabled' : ''}`}
                  onClick={() => handlePageChange(pagination.totalPages)}
                  disabled={pagination.page === pagination.totalPages}
                >
                  Last
                </button>
              </div>
            )}

            {/* Items per page selector */}
            <div className="pagination-controls">
              <div className="items-per-page">
                <span>Items per page:</span>
                <select 
                  value={pagination.limit}
                  onChange={(e) => {
                    const newLimit = parseInt(e.target.value);
                    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
                  }}
                >
                  <option value="10">10</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="500">500</option>
                </select>
              </div>
              
              <div className="page-jump">
                <span>Go to page:</span>
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target as HTMLFormElement);
                    const page = parseInt(formData.get('pageNumber') as string);
                    if (page > 0 && page <= pagination.totalPages) {
                      handlePageChange(page);
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
                  <button type="submit" className="btn-secondary">Go</button>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="contacts-page">
      {activeView === 'contacts' && renderContactsTable()}
      {(activeView === 'add' || activeView === 'edit') && renderContactForm()}
      {activeView === 'import' && renderImportPreview()}
    </div>
  );
};

export default Contacts; 