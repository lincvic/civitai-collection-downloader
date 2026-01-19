/**
 * Civitai Collection Downloader - Popup Script
 */

// State management
let currentState = 'notOnCollection';
let collectionData = null;
let downloadProgress = {
  queued: 0,
  downloading: 0,
  completed: 0,
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
  failedCount: document.getElementById('failedCount'),
  currentFile: document.getElementById('currentFile'),
  
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
  retryBtn: document.getElementById('retryBtn')
};

// Initialize popup
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Set OS-appropriate path prefix
  if (elements.pathPrefix) {
    elements.pathPrefix.textContent = downloadsPrefix;
  }
  
  // Check current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab?.url?.includes('civitai.com/collections/')) {
    // Extract collection ID from URL
    const match = tab.url.match(/collections\/(\d+)/);
    if (match) {
      const collectionId = match[1];
      await loadCollectionInfo(collectionId, tab.id);
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

function setupEventListeners() {
  elements.startDownload.addEventListener('click', startDownload);
  elements.pauseBtn.addEventListener('click', togglePause);
  elements.cancelBtn.addEventListener('click', cancelDownload);
  elements.newDownload.addEventListener('click', resetToInfo);
  elements.retryBtn.addEventListener('click', retryLoad);
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
  if (!collectionData) return;
  
  const downloadMode = document.querySelector('input[name="downloadMode"]:checked').value;
  const folderName = elements.folderName.value.trim() || 'civitai-download';
  
  // Reset progress
  downloadProgress = {
    queued: 0,
    downloading: 0,
    completed: 0,
    failed: 0,
    total: 0,
    failedItems: []
  };
  
  showState('downloadingState');
  
  // Show collecting status
  elements.progressPercent.textContent = '...';
  elements.currentFile.textContent = 'Scrolling page to load all media...';
  updateProgressUI();
  
  try {
    // Send download request to background
    chrome.runtime.sendMessage({
      action: 'startDownload',
      collectionId: collectionData.id,
      collectionName: collectionData.name,
      downloadMode: downloadMode,
      folderName: folderName
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
  console.log('[Popup] Received message:', message.action);
  
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
      console.error('[Popup] Download error:', message.error);
      showError(message.error);
      break;
      
    case 'currentFile':
      elements.currentFile.textContent = message.filename || '-';
      break;
  }
}

function updateProgressUI() {
  const { queued, downloading, completed, failed, total } = downloadProgress;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressFill.style.width = `${percent}%`;
  elements.queuedCount.textContent = queued;
  elements.downloadingCount.textContent = downloading;
  elements.completedCount.textContent = completed;
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
