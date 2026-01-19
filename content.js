/**
 * Civitai Collection Downloader - Content Script
 * Injected into civitai.com/collections/* pages
 */

(function() {
  'use strict';

  // Extract collection ID from URL
  function getCollectionId() {
    const match = window.location.pathname.match(/\/collections\/(\d+)/);
    return match ? match[1] : null;
  }

  // Get collection name from page
  function getCollectionName() {
    // Try different selectors for collection name
    const selectors = [
      'h1',
      '[class*="CollectionHeader"] h1',
      '[class*="collection"] h1',
      '.mantine-Title-root',
      '[data-testid="collection-title"]',
      'main h1',
      'header h1'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        const text = element.textContent.trim();
        // Filter out generic text
        if (text !== 'Collections' && text.length > 0 && text.length < 200) {
          return text;
        }
      }
    }

    // Try to get from document title
    const title = document.title;
    if (title && title.includes('|')) {
      const parts = title.split('|');
      if (parts[0].trim()) {
        return parts[0].trim();
      }
    }

    // Try to extract from Next.js data
    const nextData = document.querySelector('#__NEXT_DATA__');
    if (nextData) {
      try {
        const data = JSON.parse(nextData.textContent);
        const name = findInObject(data, 'name', 3);
        if (name && typeof name === 'string' && name.length < 200) {
          return name;
        }
      } catch (e) {
        // Ignore
      }
    }

    return null;
  }

  // Helper to find a key in nested object
  function findInObject(obj, key, maxDepth = 5, currentDepth = 0) {
    if (currentDepth > maxDepth || !obj || typeof obj !== 'object') return null;
    
    if (obj[key] !== undefined) return obj[key];
    
    for (const value of Object.values(obj)) {
      if (typeof value === 'object') {
        const result = findInObject(value, key, maxDepth, currentDepth + 1);
        if (result !== null) return result;
      }
    }
    
    return null;
  }

  // Helper to check if URL is a video
  function isVideoUrl(url) {
    return url && /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url);
  }

  // Get all visible IMAGE URLs from the page (excludes videos - those are handled by getVideoUrls)
  function getVisibleImageUrls() {
    const images = new Set();
    
    console.log('[Civitai Downloader] Scanning for images...');
    
    // Find all image elements
    document.querySelectorAll('img').forEach(img => {
      // Check multiple sources
      const sources = [
        img.src,
        img.dataset.src,
        img.dataset.lazySrc,
        img.getAttribute('data-nimg') ? img.src : null,
      ].filter(Boolean);
      
      // Also check srcset for high-res versions
      if (img.srcset) {
        const srcsetParts = img.srcset.split(',');
        srcsetParts.forEach(part => {
          const url = part.trim().split(' ')[0];
          if (url) sources.push(url);
        });
      }
      
      sources.forEach(src => {
        // Only add images, not videos
        if (src && (src.includes('image.civitai.com') || src.includes('civitai.com')) && !isVideoUrl(src)) {
          const fullUrl = getFullResolutionUrl(src);
          images.add(fullUrl);
        }
      });
    });
    
    // Check picture elements
    document.querySelectorAll('picture source').forEach(source => {
      const srcset = source.srcset;
      if (srcset) {
        const srcsetParts = srcset.split(',');
        srcsetParts.forEach(part => {
          const url = part.trim().split(' ')[0];
          if (url && url.includes('civitai') && !isVideoUrl(url)) {
            images.add(getFullResolutionUrl(url));
          }
        });
      }
    });

    // Also check for background images
    document.querySelectorAll('[style*="background"]').forEach(el => {
      const style = el.getAttribute('style') || '';
      const matches = style.matchAll(/url\(['"]?([^'")\s]+)['"]?\)/g);
      for (const match of matches) {
        if (match[1] && match[1].includes('civitai') && !isVideoUrl(match[1])) {
          images.add(getFullResolutionUrl(match[1]));
        }
      }
    });
    
    // Check computed styles for background images
    document.querySelectorAll('div, a, span').forEach(el => {
      try {
        const computedStyle = window.getComputedStyle(el);
        const bgImage = computedStyle.backgroundImage;
        if (bgImage && bgImage !== 'none') {
          const match = bgImage.match(/url\(['"]?([^'")\s]+)['"]?\)/);
          if (match && match[1] && match[1].includes('civitai') && !isVideoUrl(match[1])) {
            images.add(getFullResolutionUrl(match[1]));
          }
        }
      } catch (e) {
        // Ignore errors
      }
    });

    console.log('[Civitai Downloader] Found', images.size, 'images');
    return Array.from(images);
  }
  
  // Get video URLs specifically
  function getVideoUrls() {
    const videosByUuid = new Map(); // Use Map to dedupe by UUID
    
    // Helper to extract UUID from civitai URL
    function getVideoUuid(url) {
      // URL format: https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/UUID/...
      const match = url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i);
      return match ? match[1] : null;
    }
    
    // Helper to get format priority (prefer mp4 over webm for compatibility)
    function getFormatPriority(url) {
      if (url.includes('.mp4')) return 2;
      if (url.includes('.webm')) return 1;
      return 0;
    }
    
    // Helper to add video with deduplication
    function addVideo(url) {
      if (!url || !url.includes('civitai')) return;
      
      const uuid = getVideoUuid(url);
      if (uuid) {
        const existing = videosByUuid.get(uuid);
        if (!existing || getFormatPriority(url) > getFormatPriority(existing)) {
          videosByUuid.set(uuid, url);
        }
      } else {
        // No UUID found, use URL as key
        videosByUuid.set(url, url);
      }
    }
    
    // Find all video elements
    document.querySelectorAll('video').forEach(video => {
      addVideo(video.src);
      video.querySelectorAll('source').forEach(source => {
        addVideo(source.src);
      });
    });
    
    // Check for video file links
    document.querySelectorAll('a').forEach(a => {
      const href = a.href || '';
      if (href.match(/\.(mp4|webm|mov|avi|mkv)(\?|$)/i)) {
        addVideo(href);
      }
    });
    
    // Check data attributes for video URLs
    document.querySelectorAll('[data-video-url], [data-src*=".mp4"], [data-src*=".webm"]').forEach(el => {
      const videoUrl = el.dataset.videoUrl || el.dataset.src;
      addVideo(videoUrl);
    });
    
    const uniqueVideos = Array.from(videosByUuid.values());
    console.log('[Civitai Downloader] Found', uniqueVideos.length, 'unique videos');
    return uniqueVideos;
  }

  // Get all post links from the collection page
  function getPostLinks() {
    const links = new Set();
    
    document.querySelectorAll('a[href*="/posts/"]').forEach(a => {
      const href = a.href;
      if (href.includes('civitai.com/posts/')) {
        links.add(href);
      }
    });

    return Array.from(links);
  }

  // Get all image links from the collection page (for image collections)
  function getImageLinks() {
    const links = new Set();
    
    document.querySelectorAll('a[href*="/images/"]').forEach(a => {
      const href = a.href;
      if (href.includes('civitai.com/images/')) {
        links.add(href);
      }
    });

    return Array.from(links);
  }

  // Convert thumbnail URL to full resolution URL
  function getFullResolutionUrl(url) {
    // Civitai image URLs often have width parameters
    // Remove width constraints to get full resolution
    try {
      const urlObj = new URL(url);
      
      // Remove width/height parameters
      urlObj.searchParams.delete('width');
      urlObj.searchParams.delete('w');
      urlObj.searchParams.delete('height');
      urlObj.searchParams.delete('h');
      
      // Try to get original quality
      if (urlObj.pathname.includes('/width=')) {
        urlObj.pathname = urlObj.pathname.replace(/\/width=\d+/, '/original=true');
      }
      
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  // Get collection type (images, posts, models, etc.)
  function getCollectionType() {
    // Check for indicators of collection type
    const postLinks = document.querySelectorAll('a[href*="/posts/"]');
    const imageLinks = document.querySelectorAll('a[href*="/images/"]');
    const modelLinks = document.querySelectorAll('a[href*="/models/"]');
    
    if (postLinks.length > 0 && imageLinks.length === 0) {
      return 'Posts';
    } else if (imageLinks.length > 0 && postLinks.length === 0) {
      return 'Images';
    } else if (modelLinks.length > 0) {
      return 'Models';
    } else if (postLinks.length > 0 && imageLinks.length > 0) {
      return 'Mixed';
    }
    
    return 'Unknown';
  }

  // Count visible items
  function getItemCount() {
    const postLinks = getPostLinks();
    const imageLinks = getImageLinks();
    const visibleImages = getVisibleImageUrls();
    
    // Count actual content items on the page
    // Priority: links to images/posts > visible images > grid items
    
    // First, count actual collection items (links to images or posts)
    const actualItems = Math.max(postLinks.length, imageLinks.length);
    if (actualItems > 0) {
      console.log('[Civitai Downloader] Item count from links:', actualItems);
      return actualItems;
    }
    
    // Count visible images (excluding tiny icons)
    const significantImages = visibleImages.filter(url => {
      // Filter out small thumbnails/icons (usually have small width in URL)
      return !url.includes('/width=32') && !url.includes('/width=48') && !url.includes('/width=64');
    });
    
    if (significantImages.length > 0) {
      console.log('[Civitai Downloader] Item count from images:', significantImages.length);
      return significantImages.length;
    }
    
    // Count grid items as last resort
    const gridItems = document.querySelectorAll('[class*="MasonryGrid"] > div > a, [class*="MasonryCol"] > div');
    if (gridItems.length > 0) {
      console.log('[Civitai Downloader] Item count from grid:', gridItems.length);
      return gridItems.length;
    }
    
    console.log('[Civitai Downloader] Item count: unknown');
    return 0;
  }

  // Scroll to load more content (for infinite scroll pages)
  async function scrollToLoadMore(maxScrolls = 50) {
    console.log('[Civitai Downloader] Starting scroll to load all content...');
    
    let scrollCount = 0;
    let lastItemCount = 0;
    let noNewContentCount = 0;
    
    // Get initial count
    const getItemsCount = () => {
      const images = document.querySelectorAll('img[src*="civitai"]').length;
      const links = document.querySelectorAll('a[href*="/images/"], a[href*="/posts/"]').length;
      return Math.max(images, links);
    };
    
    lastItemCount = getItemsCount();
    console.log('[Civitai Downloader] Initial items:', lastItemCount);
    
    while (scrollCount < maxScrolls && noNewContentCount < 3) {
      // Scroll down
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      });
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Also try clicking "Load More" button if present
      try {
        // Find load more button using valid CSS selectors
        let loadMoreBtn = document.querySelector('button[class*="load"], button[class*="Load"], [class*="LoadMore"], [class*="loadMore"]');
        
        // If not found, try finding by text content
        if (!loadMoreBtn) {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.toLowerCase().includes('load more') || 
                btn.textContent.toLowerCase().includes('show more')) {
              loadMoreBtn = btn;
              break;
            }
          }
        }
        
        if (loadMoreBtn) {
          loadMoreBtn.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (e) {
        // Ignore click errors
        console.log('[Civitai Downloader] No load more button found or click failed');
      }
      
      // Check if new items loaded
      const currentCount = getItemsCount();
      console.log('[Civitai Downloader] Scroll', scrollCount + 1, '- Items:', currentCount);
      
      if (currentCount === lastItemCount) {
        noNewContentCount++;
      } else {
        noNewContentCount = 0;
        lastItemCount = currentCount;
      }
      
      scrollCount++;
    }
    
    console.log('[Civitai Downloader] Finished scrolling. Total items found:', lastItemCount);
    
    // Scroll back to top
    window.scrollTo(0, 0);
  }

  // Message handler for communication with background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Civitai Downloader] Content script received:', request.action);
    
    try {
      switch (request.action) {
        case 'ping':
          sendResponse({ pong: true });
          return false;
          
        case 'getPageInfo':
          const pageInfo = {
            collectionId: getCollectionId(),
            collectionName: getCollectionName(),
            collectionType: getCollectionType(),
            itemCount: getItemCount()
          };
          console.log('[Civitai Downloader] Page info:', pageInfo);
          sendResponse(pageInfo);
          return false; // Sync response
  
        case 'getImageUrls':
          sendResponse({
            images: getVisibleImageUrls()
          });
          return false;
  
        case 'getPostLinks':
          sendResponse({
            posts: getPostLinks()
          });
          return false;
  
        case 'getImageLinks':
          sendResponse({
            images: getImageLinks()
          });
          return false;
  
        case 'getAllLinks':
          sendResponse({
            posts: getPostLinks(),
            images: getImageLinks(),
            directImages: getVisibleImageUrls(),
            videos: getVideoUrls()
          });
          return false;
  
        case 'scrollAndCollect':
          (async () => {
            try {
              await scrollToLoadMore(request.maxScrolls || 10);
              sendResponse({
                posts: getPostLinks(),
                images: getImageLinks(),
                directImages: getVisibleImageUrls(),
                videos: getVideoUrls()
              });
            } catch (e) {
              console.error('[Civitai Downloader] Error scrolling:', e);
              sendResponse({ error: e.message });
            }
          })();
          return true; // Keep channel open for async response
  
        default:
          sendResponse({ error: 'Unknown action' });
          return false;
      }
    } catch (error) {
      console.error('[Civitai Downloader] Error in message handler:', error);
      sendResponse({ error: error.message });
      return false;
    }
  });

  // Notify background that content script is ready
  chrome.runtime.sendMessage({
    action: 'contentScriptReady',
    collectionId: getCollectionId()
  });

})();
