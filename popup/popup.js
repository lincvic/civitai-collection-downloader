/**
 * Civitai Collection Downloader - Dashboard Script
 */

// State management
let currentState = 'notOnCollection';
let collectionData = null;
let sourceTab = null;
let downloadProgress = {
  queued: 0,
  downloading: 0,
  completed: 0,
  skipped: 0,
  failed: 0,
  total: 0,
  failedItems: []
};

// Detect OS
const isWindows = navigator.platform.indexOf('Win') > -1;
const pathSeparator = isWindows ? '\\' : '/';
const downloadsPrefix = isWindows ? 'Downloads\\Civitai\\' : 'Downloads/Civitai/';

// DOM Elements
const elements = {
  // State panels
  notOnCollection: document.getElementById('notOnCollection'),
  collectionInfo: document.getElementById('collectionInfo'),
  downloadingState: document.getElementById('downloadingState'),
  completedState: document.getElementById('completedState'),
  errorState: document.getElementById('errorState'),
  
  // Collection info
  collectionId: document.getElementById('collectionId'),
  collectionName: document.getElementById('collectionName'),
  itemCount: document.getElementById('itemCount'),
  itemType: document.getElementById('itemType'),
  folderName: document.getElementById('folderName'),
  pathPrefix: document.getElementById('pathPrefix'),
  
  // Progress
  progressPercent: document.getElementById('progressPercent'),
  progressFill: document.getElementById('progressFill'),
  queuedCount: document.getElementById('queuedCount'),
  downloadingCount: document.getElementById('downloadingCount'),
  completedCount: document.getElementById('completedCount'),
  skippedCount: document.getElementById('skippedCount'),
  failedCount: document.getElementById('failedCount'),
  currentFile: document.getElementById('currentFile'),
  
  // Options
  skipExisting: document.getElementById('skipExisting'),
  
  // Completed
  totalDownloaded: document.getElementById('totalDownloaded'),
  savedFolder: document.getElementById('savedFolder'),
  failedList: document.getElementById('failedList'),
  failedItems: document.getElementById('failedItems'),
  
  // Error
  errorMessage: document.getElementById('errorMessage'),
  
  // Buttons
  startDownload: document.getElementById('startDownload'),
  pauseBtn: document.getElementById('pauseBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  newDownload: document.getElementById('newDownload'),
  retryBtn: document.getElementById('retryBtn'),
  goToSourceTab: document.getElementById('goToSourceTab'),
  
  // Source tab
  sourceTabUrl: document.getElementById('sourceTabUrl')
};

// Initialize dashboard
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Set OS-appropriate path prefix
  if (elements.pathPrefix) {
    elements.pathPrefix.textContent = downloadsPrefix;
  }
  
  // Get source tab from storage
  const storage = await chrome.storage.local.get('sourceTab');
  sourceTab = storage.sourceTab;
  
  if (sourceTab?.url) {
    // Update source tab display
    updateSourceTabDisplay(sourceTab.url);
    
    if (sourceTab.url.includes('civitai.com/collections/')) {
      // Extract collection ID from URL
      const match = sourceTab.url.match(/collections\/(\d+)/);
      if (match) {
        const collectionId = match[1];
        await loadCollectionInfo(collectionId, sourceTab.tabId);
      } else {
        showState('notOnCollection');
      }
    } else {
      showState('notOnCollection');
    }
  } else {
    showState('notOnCollection');
  }
  
  // Set up event listeners
  setupEventListeners();
  
  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener(handleMessage);
  
  // Check if there's an ongoing download
  chrome.runtime.sendMessage({ action: 'getDownloadStatus' }, (response) => {
    if (response?.status === 'downloading') {
      downloadProgress = response.progress;
      showState('downloadingState');
      updateProgressUI();
    }
  });
}

function updateSourceTabDisplay(url) {
  if (elements.sourceTabUrl) {
    try {
      const urlObj = new URL(url);
      elements.sourceTabUrl.textContent = urlObj.pathname;
      elements.sourceTabUrl.title = url;
    } catch {
      elements.sourceTabUrl.textContent = url;
    }
  }
}

function setupEventListeners() {
  elements.startDownload.addEventListener('click', startDownload);
  elements.pauseBtn.addEventListener('click', togglePause);
  elements.cancelBtn.addEventListener('click', cancelDownload);
  elements.newDownload.addEventListener('click', resetToInfo);
  elements.retryBtn.addEventListener('click', retryLoad);
  if (elements.goToSourceTab) {
    elements.goToSourceTab.addEventListener('click', goToSourceTab);
  }
}

async function goToSourceTab() {
  if (sourceTab?.tabId) {
    try {
      // Switch to the source tab
      await chrome.tabs.update(sourceTab.tabId, { active: true });
      // Focus the window containing the tab
      const tab = await chrome.tabs.get(sourceTab.tabId);
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch (e) {
      console.error('Could not switch to source tab:', e);
      showError('Collection tab not found. Please navigate to a Civitai collection and click the extension icon again.');
    }
  }
}

async function loadCollectionInfo(collectionId, tabId) {
  showState('collectionInfo');
  elements.collectionId.textContent = `#${collectionId}`;
  elements.collectionName.textContent = 'Loading...';
  elements.collectionName.classList.add('loading');
  
  try {
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out')), 10000);
    });
    
    // Send message to background to fetch collection info
    const messagePromise = chrome.runtime.sendMessage({
      action: 'getCollectionInfo',
      collectionId: collectionId,
      tabId: tabId
    });
    
    // Race between the message and timeout
    const response = await Promise.race([messagePromise, timeoutPromise]);
    
    if (response?.error) {
      throw new Error(response.error);
    }
    
    collectionData = response?.data || {
      id: collectionId,
      name: `Collection ${collectionId}`,
      itemCount: 0,
      type: 'Mixed'
    };
    
    elements.collectionName.textContent = collectionData.name || `Collection ${collectionId}`;
    elements.collectionName.classList.remove('loading');
    // Show item count with + if there might be more (infinite scroll)
    const count = collectionData.itemCount || 0;
    elements.itemCount.textContent = count > 0 ? `${count}+` : '?';
    elements.itemType.textContent = collectionData.type || 'Mixed';
    
    // Set default folder name
    const safeName = (collectionData.name || `collection-${collectionId}`)
      .replace(/[^a-zA-Z0-9-_\s]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 50);
    elements.folderName.value = safeName || `collection-${collectionId}`;
    
  } catch (error) {
    console.error('Error loading collection:', error);
    // Even on error, show the UI with minimal info instead of error state
    collectionData = {
      id: collectionId,
      name: `Collection ${collectionId}`,
      itemCount: 0,
      type: 'Unknown'
    };
    elements.collectionName.textContent = `Collection ${collectionId}`;
    elements.collectionName.classList.remove('loading');
    elements.itemCount.textContent = '?';
    elements.itemType.textContent = 'Unknown';
    elements.folderName.value = `collection-${collectionId}`;
  }
}

async function startDownload() {
  if (!collectionData) {
    showError('No collection data available');
    return;
  }
  
  if (!sourceTab?.tabId) {
    showError('Source tab not found. Please click the extension icon again from the collection page.');
    return;
  }
  
  // Verify source tab is still valid
  try {
    const tab = await chrome.tabs.get(sourceTab.tabId);
    if (!tab || !tab.url?.includes('civitai.com/collections/')) {
      showError('The collection page has been closed or navigated away. Please click the extension icon again from the collection page.');
      return;
    }
  } catch (e) {
    showError('The collection page has been closed. Please click the extension icon again from the collection page.');
    return;
  }
  
  const downloadMode = document.querySelector('input[name="downloadMode"]:checked').value;
  const folderName = elements.folderName.value.trim() || 'civitai-download';
  const skipExisting = elements.skipExisting?.checked ?? true;
  
  // Reset progress
  downloadProgress = {
    queued: 0,
    downloading: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    total: 0,
    failedItems: []
  };
  
  showState('downloadingState');
  
  // Show collecting status
  elements.progressPercent.textContent = '...';
  elements.currentFile.textContent = 'Scrolling collection page to load all media...';
  updateProgressUI();
  
  // Switch to source tab briefly to allow content script to work
  try {
    await chrome.tabs.update(sourceTab.tabId, { active: true });
  } catch (e) {
    console.log('Could not focus source tab:', e);
  }
  
  try {
    // Send download request to background with source tab info
    chrome.runtime.sendMessage({
      action: 'startDownload',
      collectionId: collectionData.id,
      collectionName: collectionData.name,
      downloadMode: downloadMode,
      folderName: folderName,
      skipExisting: skipExisting,
      sourceTabId: sourceTab.tabId
    });
  } catch (error) {
    console.error('Error starting download:', error);
    showError(error.message || 'Failed to start download');
  }
}

function togglePause() {
  const isPaused = elements.pauseBtn.textContent.trim() === 'Resume';
  
  chrome.runtime.sendMessage({
    action: isPaused ? 'resumeDownload' : 'pauseDownload'
  });
  
  elements.pauseBtn.innerHTML = isPaused 
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/>
        <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>
       </svg> Pause`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <polygon points="5,3 19,12 5,21" fill="currentColor"/>
       </svg> Resume`;
}

function cancelDownload() {
  chrome.runtime.sendMessage({ action: 'cancelDownload' });
  resetToInfo();
}

function resetToInfo() {
  downloadProgress = {
    queued: 0,
    downloading: 0,
    completed: 0,
    failed: 0,
    total: 0,
    failedItems: []
  };
  showState('collectionInfo');
}

function retryLoad() {
  init();
}

function handleMessage(message) {
  console.log('[Dashboard] Received message:', message.action);
  
  switch (message.action) {
    case 'progressUpdate':
      downloadProgress = message.progress;
      updateProgressUI();
      break;
      
    case 'downloadComplete':
      downloadProgress = message.progress;
      showCompleted();
      break;
      
    case 'downloadError':
      console.error('[Dashboard] Download error:', message.error);
      showError(message.error);
      break;
      
    case 'currentFile':
      elements.currentFile.textContent = message.filename || '-';
      break;
      
    case 'sourceTabChanged':
      // Update source tab when user clicks extension icon from a different tab
      sourceTab = message.sourceTab;
      if (sourceTab?.url) {
        updateSourceTabDisplay(sourceTab.url);
        // Reload collection info
        if (sourceTab.url.includes('civitai.com/collections/')) {
          const match = sourceTab.url.match(/collections\/(\d+)/);
          if (match) {
            loadCollectionInfo(match[1], sourceTab.tabId);
          }
        } else {
          showState('notOnCollection');
        }
      }
      break;
  }
}

function updateProgressUI() {
  const { queued, downloading, completed, skipped, failed, total } = downloadProgress;
  const done = completed + skipped;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressFill.style.width = `${percent}%`;
  elements.queuedCount.textContent = queued;
  elements.downloadingCount.textContent = downloading;
  elements.completedCount.textContent = completed;
  if (elements.skippedCount) {
    elements.skippedCount.textContent = skipped || 0;
  }
  elements.failedCount.textContent = failed;
}

function showCompleted() {
  showState('completedState');
  
  elements.totalDownloaded.textContent = downloadProgress.completed;
  const folderPath = isWindows 
    ? `Downloads\\Civitai\\${elements.folderName.value}\\`
    : `Downloads/Civitai/${elements.folderName.value}/`;
  elements.savedFolder.textContent = folderPath;
  
  if (downloadProgress.failedItems && downloadProgress.failedItems.length > 0) {
    elements.failedList.classList.remove('hidden');
    elements.failedItems.innerHTML = downloadProgress.failedItems
      .map(item => `<li>${item}</li>`)
      .join('');
  } else {
    elements.failedList.classList.add('hidden');
  }
}

function showError(message) {
  showState('errorState');
  elements.errorMessage.textContent = message;
}

function showState(state) {
  currentState = state;
  
  // Hide all state panels
  elements.notOnCollection.classList.add('hidden');
  elements.collectionInfo.classList.add('hidden');
  elements.downloadingState.classList.add('hidden');
  elements.completedState.classList.add('hidden');
  elements.errorState.classList.add('hidden');
  
  // Show requested state
  const panel = elements[state];
  if (panel) {
    panel.classList.remove('hidden');
  }
}
