/**
 * Civitai Collection Downloader - API Utilities
 * Handles communication with Civitai's API endpoints
 */

const CivitaiAPI = {
  BASE_URL: 'https://civitai.com',
  API_URL: 'https://civitai.com/api',
  
  // Rate limiting
  requestDelay: 500, // ms between API requests
  lastRequestTime: 0,

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
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 8000);
    
    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include', // Include cookies for authentication
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }
  },

  /**
   * Get collection info by ID
   * Note: Civitai doesn't have a public API for collections, so this may fail
   */
  async getCollectionInfo(collectionId) {
    // Return minimal info immediately - we rely on content script for real data
    return {
      id: collectionId,
      name: `Collection ${collectionId}`,
      itemCount: 0,
      type: 'Unknown'
    };
  },

  /**
   * Get all items in a collection with pagination
   */
  async getCollectionItems(collectionId, options = {}) {
    const items = [];
    let cursor = null;
    const limit = options.limit || 100;
    const maxItems = options.maxItems || Infinity;
    
    try {
      while (items.length < maxItems) {
        const input = {
          collectionId: parseInt(collectionId),
          limit: limit
        };
        
        if (cursor) {
          input.cursor = cursor;
        }
        
        const url = `${this.API_URL}/trpc/collection.getAllCollectionItems?input=${encodeURIComponent(JSON.stringify(input))}`;
        const data = await this.fetch(url);
        
        if (!data.result?.data?.items) {
          break;
        }
        
        const newItems = data.result.data.items;
        items.push(...newItems);
        
        // Check for next page
        cursor = data.result.data.nextCursor;
        if (!cursor || newItems.length < limit) {
          break;
        }
        
        // Progress callback
        if (options.onProgress) {
          options.onProgress(items.length);
        }
      }
    } catch (error) {
      console.error('Error fetching collection items:', error);
    }
    
    return items;
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

  /**
   * Convert Civitai image URL to full resolution
   */
  getFullImageUrl(url) {
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
    
    // If it's a relative path or just filename, construct full URL
    // Civitai stores images on image.civitai.com
    if (url.includes('/')) {
      return `https://image.civitai.com${url.startsWith('/') ? '' : '/'}${url}`;
    }
    
    return `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/${url}/original=true`;
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
