/**
 * Civitai Collection Downloader - Background Service Worker
 * Orchestrates the download workflow
 */

// Import utilities (for service worker context, we'll inline the functionality)
// Note: Service workers don't support ES modules in all browsers, so we'll use importScripts
importScripts('utils/api.js', 'utils/download.js');

// Handle extension icon click - open dashboard in new tab
chrome.action.onClicked.addListener(async (tab) => {
  // Store the source tab info for the dashboard to use
  const sourceTabInfo = {
    tabId: tab.id,
    url: tab.url
  };
  
  // Save source tab info
  await chrome.storage.local.set({ sourceTab: sourceTabInfo });
  
  // Check if dashboard is already open
  const dashboardUrl = chrome.runtime.getURL('popup/popup.html');
  const existingTabs = await chrome.tabs.query({ url: dashboardUrl });
  
  if (existingTabs.length > 0) {
    // Focus existing dashboard tab
    await chrome.tabs.update(existingTabs[0].id, { active: true });
    await chrome.windows.update(existingTabs[0].windowId, { focused: true });
    // Send message to refresh with new source tab
    chrome.tabs.sendMessage(existingTabs[0].id, { 
      action: 'sourceTabChanged', 
      sourceTab: sourceTabInfo 
    });
  } else {
    // Open new dashboard tab
    chrome.tabs.create({ url: dashboardUrl });
  }
});

// State management
let currentDownload = {
  active: false,
  collectionId: null,
  collectionName: null,
  folderName: null,
  mode: 'images',
  progress: {
    total: 0,
    queued: 0,
    downloading: 0,
    completed: 0,
    failed: 0,
    failedItems: []
  }
};

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true; // Keep channel open for async responses
});

async function handleMessage(request, sender, sendResponse) {
  try {
    switch (request.action) {
      case 'getCollectionInfo':
        const info = await getCollectionInfo(request.collectionId, request.tabId);
        sendResponse({ data: info });
        break;

      case 'startDownload':
        await startDownload(request);
        sendResponse({ success: true });
        break;

      case 'pauseDownload':
        downloadManager.pause();
        sendResponse({ success: true });
        break;

      case 'resumeDownload':
        downloadManager.resume();
        sendResponse({ success: true });
        break;

      case 'cancelDownload':
        downloadManager.cancel();
        currentDownload.active = false;
        sendResponse({ success: true });
        break;

      case 'getDownloadStatus':
        sendResponse({
          status: downloadManager.getStatus(),
          progress: downloadManager.getProgress()
        });
        break;

      case 'contentScriptReady':
        console.log('Content script ready for collection:', request.collectionId);
        sendResponse({ acknowledged: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ error: error.message });
  }
}

/**
 * Get collection info by fetching from content script (primary) and API (fallback)
 * Note: Civitai doesn't have a public API for collections, so we rely heavily on page scraping
 */
async function getCollectionInfo(collectionId, tabId) {
  let pageInfo = null;
  
  // Ensure content script is injected
  await ensureContentScriptInjected(tabId);
  
  // Try to get info from content script first (most reliable)
  try {
    pageInfo = await sendToContentScriptWithTimeout(tabId, { action: 'getPageInfo' }, 5000);
    console.log('Page info from content script:', pageInfo);
  } catch (error) {
    console.log('Could not get page info from content script:', error.message);
    // Try injecting and retrying
    try {
      await injectContentScript(tabId);
      await sleep(500);
      pageInfo = await sendToContentScriptWithTimeout(tabId, { action: 'getPageInfo' }, 5000);
      console.log('Page info after injection:', pageInfo);
    } catch (e) {
      console.log('Still failed after injection:', e.message);
    }
  }

  // Return merged info, preferring page data
  return {
    id: collectionId,
    name: pageInfo?.collectionName || `Collection ${collectionId}`,
    itemCount: pageInfo?.itemCount || 0,
    type: pageInfo?.collectionType || 'Mixed',
    description: ''
  };
}

/**
 * Verify tab exists and is on a collection page
 */
async function verifySourceTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      throw new Error('Tab not found');
    }
    if (!tab.url || !tab.url.includes('civitai.com/collections/')) {
      throw new Error('Tab is not on a Civitai collection page');
    }
    return tab;
  } catch (e) {
    console.error('Tab verification failed:', e);
    throw new Error('Source tab is no longer valid. Please click the extension icon again from the collection page.');
  }
}

/**
 * Ensure content script is injected and ready
 */
async function ensureContentScriptInjected(tabId) {
  // First verify the tab exists
  await verifySourceTab(tabId);
  
  // Try to ping the content script
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Ping timeout')), 2000);
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      if (response?.pong) {
        console.log('Content script is ready');
        return true;
      }
    } catch (e) {
      console.log(`Ping attempt ${attempt + 1} failed:`, e.message);
      
      // Try to inject content script
      if (attempt < 2) {
        await injectContentScript(tabId);
        await sleep(500);
      }
    }
  }
  
  throw new Error('Could not connect to content script');
}

/**
 * Inject content script into tab
 */
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    console.log('Content script injected successfully');
    await sleep(300); // Wait for script to initialize
  } catch (e) {
    console.error('Failed to inject content script:', e);
    throw e;
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send message to content script with timeout and retry
 */
async function sendToContentScriptWithTimeout(tabId, message, timeout = 5000, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Content script timeout'));
        }, timeout);
        
        chrome.tabs.sendMessage(tabId, message, (response) => {
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      return response;
    } catch (e) {
      console.log(`Message attempt ${attempt + 1} failed:`, e.message);
      if (attempt < retries) {
        // Re-inject content script and retry
        try {
          await injectContentScript(tabId);
        } catch (injectError) {
          // Continue to next attempt
        }
      } else {
        throw e;
      }
    }
  }
}

/**
 * Start the download process
 */
async function startDownload(options) {
  const { collectionId, collectionName, downloadMode, folderName, sourceTabId, skipExisting } = options;
  
  currentDownload = {
    active: true,
    collectionId,
    collectionName,
    folderName,
    sourceTabId, // Store source tab ID for use in collectImageUrls
    mode: downloadMode,
    skipExisting: skipExisting !== false, // Default to true
    progress: {
      total: 0,
      queued: 0,
      downloading: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      failedItems: []
    }
  };

  // Initialize download manager
  downloadManager.init({
    basePath: `Civitai/${folderName}`,
    skipExisting: skipExisting !== false,
    onProgress: (progress) => {
      currentDownload.progress = progress;
      broadcastProgress(progress);
    },
    onComplete: (progress) => {
      currentDownload.active = false;
      currentDownload.progress = progress;
      broadcastComplete(progress);
    },
    onError: (item, error) => {
      console.error('Download error:', item.filename, error);
    },
    onFileStart: (filename) => {
      broadcastCurrentFile(filename);
    },
    onFileSkipped: (filename) => {
      broadcastCurrentFile(`Skipped: ${filename}`);
    }
  });

  try {
    // Collect all image URLs to download
    const imageUrls = await collectImageUrls(collectionId, downloadMode);
    
    if (imageUrls.length === 0) {
      throw new Error('No images found in this collection');
    }

    // Add to download queue
    const downloadItems = imageUrls.map((url, index) => ({
      id: `img_${index}`,
      url: url.url || url,
      filename: url.filename || generateFilename(url.url || url, index),
      subfolder: url.subfolder || ''
    }));

    downloadManager.addToQueue(downloadItems);
    
    // Start downloading
    downloadManager.start();

  } catch (error) {
    console.error('Error starting download:', error);
    broadcastError(error.message);
  }
}

/**
 * Collect all image URLs from the collection
 * Note: Civitai doesn't have a public API for collections, so we rely on DOM scraping
 */
async function collectImageUrls(collectionId, mode) {
  const images = [];
  
  try {
    // Use stored source tab ID, or fall back to active tab
    let tabId = currentDownload.sourceTabId;
    
    if (!tabId) {
      // Try to find a tab with the collection page
      const tabs = await chrome.tabs.query({ url: '*://civitai.com/collections/*' });
      if (tabs.length > 0) {
        tabId = tabs[0].id;
      } else {
        throw new Error('No collection tab found. Please keep the Civitai collection page open.');
      }
    }

    console.log('Collecting images from tab:', tabId, 'mode:', mode);
    
    // Verify tab exists and is on collection page
    const tab = await verifySourceTab(tabId);
    console.log('Source tab verified:', tab.url);
    
    // Ensure content script is injected and ready
    await ensureContentScriptInjected(tabId);

    // First, scroll to load all content
    let pageData;
    try {
      console.log('Starting scroll and collect...');
      pageData = await sendToContentScriptWithTimeout(tabId, { 
        action: 'scrollAndCollect',
        maxScrolls: 30
      }, 90000, 1); // 90 second timeout, 1 retry
    } catch (e) {
      console.log('Scroll and collect failed, trying getAllLinks:', e.message);
      try {
        pageData = await sendToContentScriptWithTimeout(tabId, { 
          action: 'getAllLinks'
        }, 15000, 2); // 15 second timeout, 2 retries
      } catch (e2) {
        console.log('getAllLinks also failed:', e2.message);
        throw new Error('Could not communicate with the collection page. Please refresh the page and try again.');
      }
    }

    console.log('Page data collected:', {
      posts: pageData?.posts?.length || 0,
      images: pageData?.images?.length || 0,
      directImages: pageData?.directImages?.length || 0,
      videos: pageData?.videos?.length || 0
    });

    if (mode === 'posts' && pageData?.posts?.length > 0) {
      // Fetch each post and get its images
      console.log(`Fetching images from ${pageData.posts.length} posts...`);
      
      for (let i = 0; i < pageData.posts.length; i++) {
        const postUrl = pageData.posts[i];
        const postId = CivitaiAPI.extractPostId(postUrl);
        
        if (postId) {
          console.log(`Fetching post ${i + 1}/${pageData.posts.length}: ${postId}`);
          const postImages = await getImagesFromPost(postId);
          
          postImages.forEach((img, idx) => {
            images.push({
              url: img.url,
              filename: `post_${postId}_${idx + 1}_${img.name || 'image'}.jpg`,
              subfolder: `post_${postId}`
            });
          });
        }
      }
    }
    
    // Also add direct images from the page
    if (pageData?.directImages?.length > 0) {
      console.log(`Adding ${pageData.directImages.length} direct images from page`);
      pageData.directImages.forEach((url, idx) => {
        images.push({
          url: url,
          filename: generateFilename(url, idx)
        });
      });
    }
    
    // Add videos from the page
    if (pageData?.videos?.length > 0) {
      console.log(`Adding ${pageData.videos.length} videos from page`);
      pageData.videos.forEach((url, idx) => {
        images.push({
          url: url,
          filename: generateFilename(url, `video_${idx}`)
        });
      });
    }
    
    // If we have image links but no direct images, fetch image details
    if (images.length === 0 && pageData?.images?.length > 0) {
      console.log(`Fetching details for ${pageData.images.length} image links`);
      
      for (const imageUrl of pageData.images) {
        const imageId = CivitaiAPI.extractImageId(imageUrl);
        if (imageId) {
          try {
            const imageDetails = await CivitaiAPI.getImageDetails(imageId);
            if (imageDetails?.url) {
              images.push({
                url: imageDetails.url,
                filename: generateFilename(imageDetails.url, imageId)
              });
            }
          } catch (e) {
            // If API fails, construct URL directly
            images.push({
              url: imageUrl,
              filename: `image_${imageId}.jpg`
            });
          }
        }
      }
    }

  } catch (error) {
    console.error('Error collecting image URLs:', error);
  }

  // Helper to extract UUID from civitai URL for deduplication
  function getMediaUuid(url) {
    const match = url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i);
    return match ? match[1] : null;
  }

  // Remove duplicates - use UUID for videos to catch same video in different formats
  const uniqueUrls = new Map();
  const seenUuids = new Set();
  
  images.forEach(img => {
    if (!img.url) return;
    
    const uuid = getMediaUuid(img.url);
    
    // For URLs with UUID, dedupe by UUID
    if (uuid) {
      if (!seenUuids.has(uuid)) {
        seenUuids.add(uuid);
        uniqueUrls.set(img.url, img);
      }
    } else {
      // For URLs without UUID, dedupe by full URL
      if (!uniqueUrls.has(img.url)) {
        uniqueUrls.set(img.url, img);
      }
    }
  });

  console.log(`Collected ${uniqueUrls.size} unique images`);
  return Array.from(uniqueUrls.values());
}

/**
 * Get images from a post
 */
async function getImagesFromPost(postId) {
  try {
    // First try API
    const images = await CivitaiAPI.getPostImages(postId);
    if (images.length > 0) {
      return images;
    }

    // Fallback: fetch post page and parse HTML
    const response = await fetch(`https://civitai.com/posts/${postId}`, {
      credentials: 'include'
    });
    
    if (response.ok) {
      const html = await response.text();
      const imageUrls = CivitaiAPI.parseImagesFromHtml(html);
      return imageUrls.map((url, idx) => ({
        url: url,
        name: `image_${idx + 1}`
      }));
    }

    return [];
  } catch (error) {
    console.error(`Error fetching post ${postId}:`, error);
    return [];
  }
}

/**
 * Generate a filename from URL
 */
function generateFilename(url, id) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    const segments = path.split('/').filter(Boolean);
    
    // Try to get original filename
    let filename = segments[segments.length - 1];
    
    // Add ID prefix for uniqueness
    if (id !== undefined) {
      filename = `${id}_${filename}`;
    }
    
    // Check if it's a video or image and ensure proper extension
    const isVideo = url.match(/\.(mp4|webm|mov|avi|mkv)(\?|$)/i);
    const hasValidExtension = filename.match(/\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|avi|mkv)$/i);
    
    if (!hasValidExtension) {
      // Add appropriate extension
      filename += isVideo ? '.mp4' : '.jpg';
    }
    
    // Sanitize
    filename = filename.replace(/[<>:"/\\|?*]/g, '_');
    
    return filename;
  } catch {
    return `media_${id || Date.now()}.jpg`;
  }
}

/**
 * Send message to content script
 */
async function sendToContentScript(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Broadcast progress update to popup
 */
function broadcastProgress(progress) {
  chrome.runtime.sendMessage({
    action: 'progressUpdate',
    progress: progress
  }).catch(() => {
    // Popup might be closed, ignore error
  });
}

/**
 * Broadcast completion
 */
function broadcastComplete(progress) {
  chrome.runtime.sendMessage({
    action: 'downloadComplete',
    progress: progress
  }).catch(() => {
    // Popup might be closed
  });
}

/**
 * Broadcast current file being downloaded
 */
function broadcastCurrentFile(filename) {
  chrome.runtime.sendMessage({
    action: 'currentFile',
    filename: filename
  }).catch(() => {
    // Popup might be closed
  });
}

/**
 * Broadcast error
 */
function broadcastError(error) {
  chrome.runtime.sendMessage({
    action: 'downloadError',
    error: error
  }).catch(() => {
    // Popup might be closed
  });
}

// Log when service worker starts
console.log('Civitai Collection Downloader service worker started');
