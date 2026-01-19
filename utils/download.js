/**
 * Civitai Collection Downloader - Download Manager
 * Handles download queue with rate limiting and progress tracking
 */

class DownloadManager {
  constructor() {
    this.queue = [];
    this.active = [];
    this.completed = [];
    this.failed = [];
    this.maxConcurrent = 3;
    this.downloadDelay = 200; // ms between downloads
    this.retryAttempts = 3;
    this.isPaused = false;
    this.isCancelled = false;
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.onFileStart = null;
    this.basePath = 'Civitai';
  }

  /**
   * Initialize download manager with options
   */
  init(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 3;
    this.downloadDelay = options.downloadDelay || 200;
    this.retryAttempts = options.retryAttempts || 3;
    this.basePath = options.basePath || 'Civitai';
    this.onProgress = options.onProgress || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;
    this.onFileStart = options.onFileStart || null;
    
    // Reset state
    this.queue = [];
    this.active = [];
    this.completed = [];
    this.failed = [];
    this.isPaused = false;
    this.isCancelled = false;
  }

  /**
   * Add items to the download queue
   */
  addToQueue(items) {
    const downloadItems = items.map((item, index) => ({
      id: item.id || `item_${Date.now()}_${index}`,
      url: item.url,
      filename: item.filename || this.extractFilename(item.url),
      subfolder: item.subfolder || '',
      retries: 0,
      status: 'queued'
    }));
    
    this.queue.push(...downloadItems);
    this.emitProgress();
    
    return downloadItems.length;
  }

  /**
   * Start processing the download queue
   */
  async start() {
    if (this.queue.length === 0 && this.active.length === 0) {
      this.emitComplete();
      return;
    }
    
    this.isCancelled = false;
    this.isPaused = false;
    
    // Process queue
    while (!this.isCancelled && (this.queue.length > 0 || this.active.length > 0)) {
      // Wait if paused
      while (this.isPaused && !this.isCancelled) {
        await this.sleep(100);
      }
      
      if (this.isCancelled) break;
      
      // Fill active slots
      while (this.active.length < this.maxConcurrent && this.queue.length > 0) {
        const item = this.queue.shift();
        this.active.push(item);
        this.processItem(item);
      }
      
      // Wait a bit before checking again
      await this.sleep(50);
    }
    
    // Wait for all active downloads to complete
    while (this.active.length > 0 && !this.isCancelled) {
      await this.sleep(100);
    }
    
    if (!this.isCancelled) {
      this.emitComplete();
    }
  }

  /**
   * Process a single download item
   */
  async processItem(item) {
    try {
      item.status = 'downloading';
      this.emitProgress();
      
      if (this.onFileStart) {
        this.onFileStart(item.filename);
      }
      
      // Build the full filename with path
      const fullPath = this.buildFilePath(item);
      
      // Initiate download using Chrome downloads API
      const downloadId = await this.downloadFile(item.url, fullPath);
      
      if (downloadId) {
        // Wait for download to complete
        await this.waitForDownload(downloadId);
        
        // Mark as completed
        item.status = 'completed';
        this.completed.push(item);
      } else {
        throw new Error('Failed to initiate download');
      }
      
    } catch (error) {
      console.error(`Download failed for ${item.url}:`, error);
      
      // Retry logic
      if (item.retries < this.retryAttempts) {
        item.retries++;
        item.status = 'queued';
        this.queue.unshift(item); // Add back to front of queue
      } else {
        item.status = 'failed';
        item.error = error.message;
        this.failed.push(item);
        
        if (this.onError) {
          this.onError(item, error);
        }
      }
    } finally {
      // Remove from active
      const index = this.active.findIndex(i => i.id === item.id);
      if (index > -1) {
        this.active.splice(index, 1);
      }
      
      this.emitProgress();
      
      // Delay between downloads
      await this.sleep(this.downloadDelay);
    }
  }

  /**
   * Download a file using Chrome downloads API
   */
  async downloadFile(url, filename) {
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: url,
        filename: filename,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (downloadId) {
          resolve(downloadId);
        } else {
          reject(new Error('Download failed to start'));
        }
      });
    });
  }

  /**
   * Wait for a download to complete
   */
  async waitForDownload(downloadId) {
    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        chrome.downloads.search({ id: downloadId }, (downloads) => {
          if (downloads.length === 0) {
            reject(new Error('Download not found'));
            return;
          }
          
          const download = downloads[0];
          
          switch (download.state) {
            case 'complete':
              resolve(download);
              break;
            case 'interrupted':
              reject(new Error(download.error || 'Download interrupted'));
              break;
            case 'in_progress':
              setTimeout(checkStatus, 100);
              break;
            default:
              setTimeout(checkStatus, 100);
          }
        });
      };
      
      checkStatus();
    });
  }

  /**
   * Build the full file path
   */
  buildFilePath(item) {
    const parts = [this.basePath];
    
    if (item.subfolder) {
      parts.push(item.subfolder);
    }
    
    parts.push(item.filename);
    
    return parts.join('/');
  }

  /**
   * Extract filename from URL
   */
  extractFilename(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      
      // Try to get filename from path
      const segments = pathname.split('/').filter(Boolean);
      let filename = segments[segments.length - 1];
      
      // Check if it's a video
      const isVideo = url.match(/\.(mp4|webm|mov|avi|mkv)(\?|$)/i);
      
      // If no valid extension, add appropriate one
      if (!filename.match(/\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|avi|mkv)$/i)) {
        const hasExt = filename.includes('.');
        if (!hasExt) {
          filename += isVideo ? '.mp4' : '.jpg';
        }
      }
      
      // Sanitize filename
      filename = filename.replace(/[<>:"/\\|?*]/g, '_');
      
      // Limit length
      if (filename.length > 200) {
        const ext = filename.match(/\.[^.]+$/)?.[0] || (isVideo ? '.mp4' : '.jpg');
        filename = filename.slice(0, 200 - ext.length) + ext;
      }
      
      return filename;
    } catch {
      return `media_${Date.now()}.jpg`;
    }
  }

  /**
   * Pause downloads
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume downloads
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Cancel all downloads
   */
  cancel() {
    this.isCancelled = true;
    this.isPaused = false;
    
    // Cancel active Chrome downloads
    this.active.forEach(item => {
      if (item.downloadId) {
        chrome.downloads.cancel(item.downloadId);
      }
    });
    
    // Clear queues
    this.queue = [];
    this.active = [];
  }

  /**
   * Get current progress
   */
  getProgress() {
    const total = this.queue.length + this.active.length + this.completed.length + this.failed.length;
    
    return {
      total: total,
      queued: this.queue.length,
      downloading: this.active.length,
      completed: this.completed.length,
      failed: this.failed.length,
      failedItems: this.failed.map(item => item.filename),
      isPaused: this.isPaused,
      isCancelled: this.isCancelled
    };
  }

  /**
   * Get download status
   */
  getStatus() {
    if (this.isCancelled) return 'cancelled';
    if (this.isPaused) return 'paused';
    if (this.queue.length === 0 && this.active.length === 0) return 'idle';
    return 'downloading';
  }

  /**
   * Emit progress update
   */
  emitProgress() {
    if (this.onProgress) {
      this.onProgress(this.getProgress());
    }
  }

  /**
   * Emit completion
   */
  emitComplete() {
    if (this.onComplete) {
      this.onComplete(this.getProgress());
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
const downloadManager = new DownloadManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DownloadManager, downloadManager };
}
