/**
 * Civitai Collection Downloader - API Utilities
 * Handles communication with Civitai's API endpoints
 * Based on: https://github.com/madlaxcb/CivitAI-Collection-Downloader
 */

const CivitaiAPI = {
  BASE_URL: 'https://civitai.com',
  API_URL: 'https://civitai.com/api',
  apiKey: null, // Set via setApiKey()
  
  // Rate limiting
  requestDelay: 300, // ms between API requests
  lastRequestTime: 0,

  /**
   * Set API key for authenticated requests
   */
  setApiKey(key) {
    this.apiKey = key;
    console.log('[CivitaiAPI] API key', key ? 'set' : 'cleared');
  },

  /**
   * Get stored API key from chrome.storage
   */
  async loadApiKey() {
    try {
      const result = await chrome.storage.local.get('civitaiApiKey');
      this.apiKey = result.civitaiApiKey || null;
      return this.apiKey;
    } catch (e) {
      console.error('[CivitaiAPI] Failed to load API key:', e);
      return null;
    }
  },

  /**
   * Wait for rate limit
   */
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
  },

  /**
   * Make an API request with automatic rate limiting and timeout
   */
  async fetch(url, options = {}) {
    await this.waitForRateLimit();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
    
    // Build headers - keep it minimal for API calls
    const headers = {
      'Accept': 'application/json',
      ...options.headers
    };
    
    // Add API key if available (for NSFW content access)
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    console.log('[CivitaiAPI] Fetching:', url.substring(0, 100) + '...');
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers
      });
      
      clearTimeout(timeoutId);
      
      console.log('[CivitaiAPI] Response status:', response.status);
      
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error('[CivitaiAPI] Response error:', response.status, text.substring(0, 200));
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('[CivitaiAPI] Fetch error:', error.message);
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }
  },

  /**
   * Get collection info by ID using the API
   */
  async getCollectionInfo(collectionId) {
    try {
      // Try the tRPC endpoint first
      const input = JSON.stringify({ id: parseInt(collectionId) });
      const url = `${this.API_URL}/trpc/collection.getById?input=${encodeURIComponent(input)}`;
      const data = await this.fetch(url, { timeout: 10000 });
      
      if (data.result?.data) {
        const col = data.result.data;
        return {
          id: collectionId,
          name: col.name || `Collection ${collectionId}`,
          itemCount: col.metadata?.itemCount || col._count?.items || 0,
          type: col.type || 'Mixed',
          description: col.description || ''
        };
      }
    } catch (e) {
      console.log('[CivitaiAPI] getCollectionInfo failed:', e.message);
    }
    
    // Return minimal info as fallback
    return {
      id: collectionId,
      name: `Collection ${collectionId}`,
      itemCount: 0,
      type: 'Unknown'
    };
  },

  /**
   * Get all items in a collection using the tRPC API
   * Based on: https://github.com/madlaxcb/CivitAI-Collection-Downloader
   */
  async getCollectionItems(collectionId, options = {}) {
    const items = [];
    let cursor = null;
    const maxItems = options.maxItems || 10000; // Safety limit
    
    console.log(`[CivitaiAPI] Fetching collection ${collectionId} items via tRPC API...`);
    
    // Load API key if available (required for private/NSFW collections)
    if (!this.apiKey) {
      await this.loadApiKey();
    }
    
    let page = 1;
    while (items.length < maxItems) {
      // Build the tRPC request data - matching the Python tool's format
      const requestData = {
        json: {
          collectionId: parseInt(collectionId),
          period: "AllTime",
          sort: "Newest",
          browsingLevel: 31, // 1(PG) + 2(PG-13) + 4(R) + 8(X) + 16(XXX)
          include: ["cosmetics"],
          cursor: cursor,
          authed: true
        }
      };
      
      // Add meta field only for the first request (when cursor is null)
      if (cursor === null) {
        requestData.meta = { values: { cursor: ["undefined"] } };
      }
      
      // Encode the input parameter
      const encodedInput = encodeURIComponent(JSON.stringify(requestData));
      const url = `${this.API_URL}/trpc/image.getInfinite?input=${encodedInput}`;
      
      console.log(`[CivitaiAPI] Fetching page ${page}, current items: ${items.length}`);
      
      const data = await this.fetch(url, { timeout: 30000 });
      
      // tRPC returns data in result.data.json format
      const result = data?.result?.data?.json;
      
      if (!result || !result.items || result.items.length === 0) {
        console.log('[CivitaiAPI] No more items found');
        break;
      }
      
      // Add items to our collection
      items.push(...result.items);
      
      console.log(`[CivitaiAPI] Got ${result.items.length} items, total: ${items.length}`);
      
      // Check for next page cursor
      cursor = result.nextCursor;
      if (!cursor) {
        console.log('[CivitaiAPI] No next cursor, finished');
        break;
      }
      
      // Progress callback
      if (options.onProgress) {
        options.onProgress(items.length);
      }
      
      page++;
      
      // Small delay between requests to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    console.log(`[CivitaiAPI] Total items fetched: ${items.length}`);
    return items;
  },

  /**
   * Convert tRPC API item to our internal format
   * The tRPC API returns items with URL info that needs to be converted to full URLs
   */
  getItemMediaFromTrpc(item) {
    if (!item) return null;
    
    // tRPC returns URL as UUID - we need to construct full URL
    let url = item.url;
    const filename = item.name || `media_${item.id}`;
    
    // If URL is not a full URL, construct it using the filename
    if (url && !url.startsWith('http')) {
      url = this.getFullImageUrl(url, filename);
    }
    
    if (!url) return null;
    
    // Determine type from item.type or filename extension
    let mediaType = 'image';
    if (item.type === 'video' || this.isVideoUrl(url) || this.isVideoUrl(filename)) {
      mediaType = 'video';
    }
    
    return {
      id: item.id,
      url: url,
      width: item.width,
      height: item.height,
      name: filename,
      type: mediaType,
      postId: item.postId
    };
  },

  /**
   * Check if URL is a video
   */
  isVideoUrl(url) {
    return url && /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url);
  },

  /**
   * Get images from a post
   */
  async getPostImages(postId) {
    try {
      const url = `${this.API_URL}/trpc/post.get?input=${encodeURIComponent(JSON.stringify({ id: parseInt(postId) }))}`;
      const data = await this.fetch(url);
      
      if (data.result?.data?.images) {
        return data.result.data.images.map(img => ({
          id: img.id,
          url: this.getFullImageUrl(img.url),
          width: img.width,
          height: img.height,
          name: img.name || `image_${img.id}`,
          nsfw: img.nsfw,
          meta: img.meta
        }));
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching post images:', error);
      return [];
    }
  },

  /**
   * Get image details
   */
  async getImageDetails(imageId) {
    try {
      const url = `${this.API_URL}/trpc/image.get?input=${encodeURIComponent(JSON.stringify({ id: parseInt(imageId) }))}`;
      const data = await this.fetch(url);
      
      if (data.result?.data) {
        const img = data.result.data;
        return {
          id: img.id,
          url: this.getFullImageUrl(img.url),
          width: img.width,
          height: img.height,
          name: img.name || `image_${img.id}`,
          postId: img.postId
        };
      }
      
      return null;
    } catch (error) {
      console.error('Error fetching image details:', error);
      return null;
    }
  },

  // CDN key for Civitai image URLs
  CDN_KEY: 'xG1nkqKTMzGDvpLrqFT7WA',

  /**
   * Convert Civitai image URL/UUID to full resolution URL
   */
  getFullImageUrl(url, filename = null) {
    if (!url) return null;
    
    // If it's already a full URL, process it
    if (url.startsWith('http')) {
      try {
        const urlObj = new URL(url);
        // Remove any width/transform parameters to get original
        urlObj.searchParams.delete('width');
        urlObj.searchParams.delete('w');
        urlObj.searchParams.delete('transcode');
        return urlObj.toString();
      } catch {
        return url;
      }
    }
    
    // If it's a UUID (from tRPC API), construct the full CDN URL
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(url)) {
      // Construct URL: https://image.civitai.com/{CDN_KEY}/{UUID}/original=true/{filename}
      const fname = filename || `${url}.jpeg`;
      return `https://image.civitai.com/${this.CDN_KEY}/${url}/original=true/${fname}`;
    }
    
    // If it's a relative path, construct full URL
    if (url.includes('/')) {
      return `https://image.civitai.com${url.startsWith('/') ? '' : '/'}${url}`;
    }
    
    return `https://image.civitai.com/${this.CDN_KEY}/${url}/original=true`;
  },

  /**
   * Extract image ID from URL
   */
  extractImageId(url) {
    // Try to extract from /images/{id} path
    const match = url.match(/\/images\/(\d+)/);
    if (match) return match[1];
    
    // Try to extract from image URL filename
    const filenameMatch = url.match(/\/(\d+)\.(jpg|jpeg|png|webp|gif)/i);
    if (filenameMatch) return filenameMatch[1];
    
    return null;
  },

  /**
   * Extract post ID from URL
   */
  extractPostId(url) {
    const match = url.match(/\/posts\/(\d+)/);
    return match ? match[1] : null;
  },

  /**
   * Parse HTML to extract image URLs (fallback when API fails)
   */
  parseImagesFromHtml(html) {
    const images = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Find all images
    doc.querySelectorAll('img').forEach(img => {
      const src = img.src || img.dataset.src;
      if (src && src.includes('image.civitai.com')) {
        images.push(this.getFullImageUrl(src));
      }
    });
    
    // Also check Next.js data
    const nextData = doc.querySelector('#__NEXT_DATA__');
    if (nextData) {
      try {
        const data = JSON.parse(nextData.textContent);
        this.extractImagesFromNextData(data, images);
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    return [...new Set(images)]; // Remove duplicates
  },

  /**
   * Extract images from Next.js hydration data
   */
  extractImagesFromNextData(data, images = []) {
    const traverse = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      
      if (obj.url && typeof obj.url === 'string' && obj.url.includes('civitai')) {
        images.push(this.getFullImageUrl(obj.url));
      }
      
      if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else {
        Object.values(obj).forEach(traverse);
      }
    };
    
    traverse(data);
    return images;
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CivitaiAPI;
}
