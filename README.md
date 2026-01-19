# Civitai Collection Downloader

A Chrome extension that allows you to download all images, posts, and videos from Civitai collections with ease.

![Extension Preview](./icons/icon128.png)

## Features

- **Download entire collections** - Download all images from any Civitai collection with one click
- **Support for both image and post collections** - Handles collections containing direct images or posts (extracts all images from each post)
- **Authentication support** - Uses your logged-in Civitai session automatically
- **Progress tracking** - Real-time progress updates with download status
- **Rate limiting** - Built-in delays to avoid overwhelming the server
- **Organized downloads** - Images are saved to organized folders under `Downloads/Civitai/`
- **Resume capability** - Pause and resume downloads
- **Polished UI** - Modern dark theme matching Civitai's aesthetic

## Installation

### From Source (Developer Mode)

1. **Clone or download this repository**
   ```bash
   git clone https://github.com/lincvic/civitai-collection-downloader.git
   ```

2. **Open Chrome Extensions page**
   - Navigate to `chrome://extensions/` in Chrome
   - Or go to Menu → More Tools → Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top right corner

4. **Load the extension**
   - Click "Load unpacked"
   - Select the `civitai-c-extension` folder (the one containing `manifest.json`)

5. **Pin the extension (optional)**
   - Click the puzzle piece icon in the Chrome toolbar
   - Pin "Civitai Collection Downloader" for easy access

## Usage

1. **Navigate to a Civitai collection**
   - Go to any collection page on Civitai (e.g., `https://civitai.com/collections/12345`)

2. **Open the extension**
   - Click the extension icon in your Chrome toolbar

3. **Configure download options**
   - Choose download mode:
     - **Images Only**: Downloads only direct image items in the collection
     - **Posts + All Images**: Fetches each post and downloads all images within
   - Set a custom folder name (optional)

4. **Start downloading**
   - Click "Start Download"
   - Monitor progress in real-time
   - Pause, resume, or cancel as needed

5. **Find your images**
   - Images are saved to: `Downloads/Civitai/{folder-name}/`

## File Structure

```
civitai-c-extension/
├── manifest.json          # Extension manifest (v3)
├── background.js          # Service worker for download orchestration
├── content.js             # Content script for page parsing
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.js           # Popup logic
│   └── popup.css          # Styled UI
├── utils/
│   ├── api.js             # Civitai API helpers
│   └── download.js        # Download queue manager
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   └── generate-icons.js  # Icon generation script
└── README.md
```

## Technical Details

### Permissions Used

- `downloads` - To save files to your computer
- `activeTab` - To read the current collection page
- `storage` - To save user preferences
- `scripting` - To inject content scripts
- `host_permissions` for `civitai.com` and `image.civitai.com`

### How It Works

1. **Content Script** detects when you're on a collection page and extracts visible items
2. **Background Service Worker** fetches collection data via Civitai's API
3. **Download Manager** queues and processes downloads with rate limiting
4. **Popup UI** provides a polished interface for controlling downloads

### Rate Limiting

- 500ms delay between API requests
- 200ms delay between file downloads
- Maximum 3 concurrent downloads

## Troubleshooting

### "No images found in this collection"
- Make sure you're logged in to Civitai if the collection is private
- Some collections may contain only models, which aren't downloadable as images

### Downloads failing
- Check your internet connection
- Ensure Civitai isn't experiencing issues
- Try reducing concurrent downloads (edit `utils/download.js`)

### Extension not detecting collection
- Refresh the page
- Make sure the URL contains `/collections/`
- Check the console for errors (right-click extension icon → Inspect popup)

## Development

### Regenerating Icons

If you need to regenerate the icons:

```bash
npm install
npm run generate-icons
```

### Modifying the Extension

1. Make your changes
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

## Legal Notice

This extension is intended for personal use to download content from collections you have access to. Please respect:

- Civitai's Terms of Service
- Content creators' rights and licenses
- Copyright laws in your jurisdiction

Only download content you have permission to access and use.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.
