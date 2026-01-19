/**
 * Icon generation script for Civitai Collection Downloader
 * Run with: node scripts/generate-icons.js
 * Requires: npm install canvas
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Create gradient background
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#3b82f6');
  gradient.addColorStop(1, '#8b5cf6');
  
  // Draw rounded rectangle
  const radius = size * 0.2;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Draw download arrow
  ctx.strokeStyle = 'white';
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  const centerX = size / 2;
  const arrowTop = size * 0.2;
  const arrowBottom = size * 0.58;
  const arrowWidth = size * 0.25;
  const lineY = size * 0.78;
  const lineHalfWidth = size * 0.3;
  
  // Vertical line
  ctx.beginPath();
  ctx.moveTo(centerX, arrowTop);
  ctx.lineTo(centerX, arrowBottom);
  ctx.stroke();
  
  // Arrow head
  ctx.beginPath();
  ctx.moveTo(centerX - arrowWidth, arrowBottom - arrowWidth);
  ctx.lineTo(centerX, arrowBottom);
  ctx.lineTo(centerX + arrowWidth, arrowBottom - arrowWidth);
  ctx.stroke();
  
  // Bottom line
  ctx.beginPath();
  ctx.moveTo(centerX - lineHalfWidth, lineY);
  ctx.lineTo(centerX + lineHalfWidth, lineY);
  ctx.stroke();
  
  return canvas;
}

// Ensure icons directory exists
const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate icons
sizes.forEach(size => {
  const canvas = generateIcon(size);
  const buffer = canvas.toBuffer('image/png');
  const filename = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filename, buffer);
  console.log(`Generated ${filename}`);
});

console.log('All icons generated successfully!');
