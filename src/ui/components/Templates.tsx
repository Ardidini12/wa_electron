import React, { useState, useEffect, useCallback, useRef } from 'react';
import './Templates.css';

interface Template {
  id: number;
  name: string;
  content: {
    text: string;
    images: string[];
  };
  createdAt?: string;
  updatedAt?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const Templates: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [addTemplateLoading, setAddTemplateLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [activeView, setActiveView] = useState<'templates' | 'add' | 'edit'>('templates');
  const [templateToEdit, setTemplateToEdit] = useState<Template | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    content: {
      text: '',
      images: [] as string[]
    }
  });
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load templates on component mount and when pagination/search changes
  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const response = await window.electron.templates.getTemplates(
        pagination.page,
        pagination.limit,
        search
      );
      
      if (response.success) {
        setTemplates(response.templates);
        setPagination(response.pagination);
      } else {
        setError(response.error || 'Failed to load templates');
      }
    } catch (err: any) {
      setError('Error loading templates: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, search]);

  // Separate function for search to avoid circular dependencies
  const performSearch = useCallback(async () => {
    try {
      const response = await window.electron.templates.getTemplates(
        1, // Reset to first page on search
        pagination.limit,
        search
      );
      
      if (response.success) {
        setTemplates(response.templates);
        setPagination(() => ({
          ...response.pagination,
          page: 1 // Ensure we're on first page
        }));
      } else {
        setError(response.error || 'Failed to load templates');
      }
    } catch (err: any) {
      setError('Error loading templates: ' + err.message);
    }
  }, [pagination.limit, search]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Reset selection when templates change
  useEffect(() => {
    setSelectedTemplates([]);
    setSelectAll(false);
  }, [templates]);

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
  const toggleTemplateSelection = (templateId: number) => {
    setSelectedTemplates(prev => {
      if (prev.includes(templateId)) {
        return prev.filter(id => id !== templateId);
      } else {
        return [...prev, templateId];
      }
    });
  };

  // Handle select all
  const toggleSelectAll = async () => {
    if (selectAll) {
      setSelectedTemplates([]);
    } else {
      setSelectAllLoading(true);
      try {
        const response = await window.electron.templates.getAllTemplateIds(search);
        if (response.success) {
          setSelectedTemplates(response.templateIds);
          
          setSuccessMessage(`Selected all ${response.templateIds.length} templates`);
          setTimeout(() => setSuccessMessage(''), 3000);
        } else {
          setError(response.error || 'Failed to get all templates');
        }
      } catch (err: any) {
        setError('Error getting all templates: ' + err.message);
      } finally {
        setSelectAllLoading(false);
      }
    }
    setSelectAll(!selectAll);
  };

  // Handle delete selected templates
  const handleDeleteSelected = async () => {
    if (selectedTemplates.length === 0) return;
    
    if (!window.confirm(`Are you sure you want to delete ${selectedTemplates.length} template(s)?`)) {
      return;
    }
    
    setDeleteLoading(true);
    try {
      const response = await window.electron.templates.deleteTemplates(selectedTemplates);
      if (response.success) {
        setSuccessMessage(`Successfully deleted ${response.deletedCount} template(s)`);
        setTimeout(() => setSuccessMessage(''), 3000);
        
        // Refresh templates and reset selection
        setSelectedTemplates([]);
        setSelectAll(false);
        await loadTemplates();
      } else {
        setError(response.error || 'Failed to delete templates');
      }
    } catch (err: any) {
      setError('Error deleting templates: ' + err.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  // Handle form input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    if (name === 'name') {
      setFormData(prev => ({ ...prev, name: value }));
    } else if (name === 'text') {
      setFormData(prev => ({
        ...prev,
        content: { ...prev.content, text: value }
      }));
    }
  };

  // Handle image upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setFormData(prev => ({
          ...prev,
          content: {
            ...prev.content,
            images: [...prev.content.images, result]
          }
        }));
      }
    };
    reader.readAsDataURL(file);
    
    // Reset the input
    e.target.value = '';
  };

  // Handle remove image
  const handleRemoveImage = (index: number) => {
    setFormData(prev => ({
      ...prev,
      content: {
        ...prev.content,
        images: prev.content.images.filter((_, i) => i !== index)
      }
    }));
  };

  const handleAddNew = () => {
    setFormData({
      name: '',
      content: {
        text: '',
        images: []
      }
    });
    setTemplateToEdit(null);
    setActiveView('add');
    setError('');
  };

  const handleEdit = (template: Template) => {
    setFormData({
      name: template.name,
      content: {
        text: template.content.text,
        images: [...template.content.images]
      }
    });
    setTemplateToEdit(template);
    setActiveView('edit');
    setError('');
  };

  const handleAddTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddTemplateLoading(true);
    
    try {
      const response = await window.electron.templates.addTemplate(formData);
      if (response.success) {
        setSuccessMessage('Template added successfully');
        setTimeout(() => setSuccessMessage(''), 3000);
        setActiveView('templates');
        // Reset form states to prevent sticking
        setSearch('');
        setSelectedTemplates([]);
        setSelectAll(false);
        await loadTemplates();
      } else {
        setError(response.error || 'Failed to add template');
      }
    } catch (err: any) {
      setError('Error adding template: ' + err.message);
    } finally {
      setAddTemplateLoading(false);
    }
  };

  const handleUpdateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateToEdit) return;
    
    setAddTemplateLoading(true);
    
    try {
      const response = await window.electron.templates.updateTemplate(templateToEdit.id, formData);
      if (response.success) {
        setSuccessMessage('Template updated successfully');
        setTimeout(() => setSuccessMessage(''), 3000);
        setActiveView('templates');
        // Reset form states to prevent sticking
        setSearch('');
        setSelectedTemplates([]);
        setSelectAll(false);
        await loadTemplates();
      } else {
        setError(response.error || 'Failed to update template');
      }
    } catch (err: any) {
      setError('Error updating template: ' + err.message);
    } finally {
      setAddTemplateLoading(false);
    }
  };

  // Insert special characters at cursor position
  const insertCharacter = (char: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = formData.content.text;

    // Insert the character at cursor position
    const newText = text.substring(0, start) + char + text.substring(end);
    
    // Update form data
    setFormData(prev => ({
      ...prev,
      content: {
        ...prev.content,
        text: newText
      }
    }));

    // Set cursor position after the inserted character
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + char.length, start + char.length);
    }, 10);
  };

  const renderTemplateForm = () => {
    return (
      <div className="template-form-container">
        <div className="template-form-header">
          <h3>{activeView === 'add' ? 'Add New Template' : 'Edit Template'}</h3>
          <button
            className="btn-secondary"
            onClick={() => setActiveView('templates')}
          >
            Back to Templates
          </button>
        </div>

        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            {error}
          </div>
        )}

        <form onSubmit={activeView === 'add' ? handleAddTemplate : handleUpdateTemplate} className="template-form">
          <div className="form-group">
            <label htmlFor="name">Template Name*</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Enter template name"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="text">Template Content</label>
            
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
            
            <textarea
              id="text"
              name="text"
              value={formData.content.text}
              onChange={handleInputChange}
              placeholder="Enter template content"
              rows={5}
              ref={textareaRef}
            />
          </div>

          <div className="form-group">
            <div className="info-box">
              <h4>Template Variables</h4>
              <p>You can use the following variables in your template content:</p>
              <div className="variables-grid">
                <div className="variable-group">
                  <strong>Contact Variables:</strong>
                  <ul>
                    <li><code>{'{name}'}</code> - Contact's name</li>
                    <li><code>{'{surname}'}</code> - Contact's surname</li>
                    <li><code>{'{phone}'}</code> - Contact's phone number</li>
                    <li><code>{'{email}'}</code> - Contact's email</li>
                    <li><code>{'{birthday}'}</code> - Contact's birthday</li>
                  </ul>
                </div>
                <div className="variable-group">
                  <strong>Date/Time Variables:</strong>
                  <ul>
                    <li><code>{'{date}'}</code> - Current date (e.g., 6/8/2023)</li>
                    <li><code>{'{time}'}</code> - Current time (e.g., 3:45:30 PM)</li>
                    <li><code>{'{datetime}'}</code> - Current date and time</li>
                    <li><code>{'{day}'}</code> - Current day of month</li>
                    <li><code>{'{month}'}</code> - Current month number</li>
                    <li><code>{'{year}'}</code> - Current year</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="form-group">
            <div className="info-box">
              <h4>WhatsApp Formatting</h4>
              <p>You can format your text using these WhatsApp formatting options:</p>
              <ul className="formatting-list">
                <li><code>*bold*</code> - Makes text <strong>bold</strong></li>
                <li><code>_italic_</code> - Makes text <em>italic</em></li>
                <li><code>~strikethrough~</code> - Makes text <s>strikethrough</s></li>
                <li><code>```monospace```</code> - Makes text <code>monospace</code></li>
              </ul>
            </div>
          </div>

          <div className="form-group">
            <label>Images</label>
            <div className="image-upload">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="file-input"
              />
            </div>
            
            {formData.content.images.length > 0 && (
              <div className="image-preview-grid">
                {formData.content.images.map((image, index) => (
                  <div key={index} className="image-preview">
                    <img
                      src={image}
                      alt={`Template image ${index + 1}`}
                    />
                    <button
                      type="button"
                      className="remove-image-btn"
                      onClick={() => handleRemoveImage(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setActiveView('templates')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={addTemplateLoading}
            >
              {addTemplateLoading ? (
                <>
                  <span className="loading-spinner small">
                    <div className="spinner"></div>
                  </span>
                  {activeView === 'add' ? 'Adding...' : 'Updating...'}
                </>
              ) : (
                activeView === 'add' ? 'Add Template' : 'Update Template'
              )}
            </button>
          </div>
        </form>
      </div>
    );
  };

  const renderTemplatesTable = () => {
    return (
      <div className="templates-container">
        <div className="templates-header">
          <h3>Message Templates</h3>
          <div className="templates-actions">
            <button 
              className="btn-primary"
              onClick={handleAddNew}
            >
              <span className="btn-icon">➕</span>
              Add New Template
            </button>
            <button
              className="btn-danger"
              onClick={handleDeleteSelected}
              disabled={selectedTemplates.length === 0 || deleteLoading}
            >
              {deleteLoading ? (
                <>
                  <span className="loading-spinner small">
                    <div className="spinner"></div>
                  </span>
                  Deleting...
                </>
              ) : (
                <>
                  <span className="btn-icon">🗑️</span>
                  Delete Selected ({selectedTemplates.length})
                </>
              )}
            </button>
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
              placeholder="Search templates..."
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
            <p>Loading templates...</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="empty-state">
            <p>No templates found. {search && 'Try a different search term or'} Add a new template to get started.</p>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="templates-table">
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
                    <th>Content Preview</th>
                    <th>Images</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(template => (
                    <tr key={template.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedTemplates.includes(template.id)}
                          onChange={() => toggleTemplateSelection(template.id)}
                        />
                      </td>
                      <td className="template-name">{template.name}</td>
                      <td className="template-content">
                        {template.content.text.length > 100 
                          ? template.content.text.substring(0, 100) + '...'
                          : template.content.text || 'No content'
                        }
                      </td>
                      <td className="template-images">
                        {template.content.images.length > 0 ? (
                          <div className="image-preview-container">
                            <div className="image-thumbnails">
                              {template.content.images.slice(0, 3).map((image, index) => (
                                <img
                                  key={index}
                                  src={image}
                                  alt={`Template image ${index + 1}`}
                                  className="image-thumbnail"
                                  onClick={() => setPreviewImage(image)}
                                  title="Click to view full size"
                                />
                              ))}
                              {template.content.images.length > 3 && (
                                <span className="more-images">
                                  +{template.content.images.length - 3} more
                                </span>
                              )}
                            </div>
                            <span className="image-count">
                              📷 {template.content.images.length}
                            </span>
                          </div>
                        ) : (
                          'No images'
                        )}
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button
                            className="btn-edit"
                            onClick={() => handleEdit(template)}
                            title="Edit template"
                          >
                            ✏️
                          </button>
                          <button
                            className="btn-delete"
                            onClick={() => {
                              setSelectedTemplates([template.id]);
                              handleDeleteSelected();
                            }}
                            title="Delete template"
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
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
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
    <div className="templates-page">
      {activeView === 'templates' && renderTemplatesTable()}
      {(activeView === 'add' || activeView === 'edit') && renderTemplateForm()}
      
      {/* Image Preview Modal */}
      {previewImage && (
        <div className="image-preview-modal" onClick={() => setPreviewImage(null)}>
          <div className="image-preview-content" onClick={(e) => e.stopPropagation()}>
            <button 
              className="close-preview-btn"
              onClick={() => setPreviewImage(null)}
              title="Close preview"
            >
              ✕
            </button>
            <img 
              src={previewImage} 
              alt="Preview" 
              className="preview-image-full"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Templates; 