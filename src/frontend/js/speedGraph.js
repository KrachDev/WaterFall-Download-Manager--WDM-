/**
 * Real-Time Bandwidth Waveform Graph
 * Smooth 60FPS HTML5 Canvas rendering of current download speed
 */
class SpeedGraph {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.points = new Array(30).fill(0);
    this.peakSpeed = 0;
    this.currentSpeed = 0;
    this.peakTextElem = document.getElementById('graph-peak-text');

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.render();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * (window.devicePixelRatio || 1);
    this.canvas.height = rect.height * (window.devicePixelRatio || 1);
    this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  }

  update(speedBytesPerSec) {
    this.currentSpeed = speedBytesPerSec;
    if (speedBytesPerSec > this.peakSpeed) {
      this.peakSpeed = speedBytesPerSec;
      if (this.peakTextElem) {
        this.peakTextElem.textContent = `PEAK: ${this.formatSpeed(this.peakSpeed)}`;
      }
    }
    this.points.shift();
    this.points.push(speedBytesPerSec);
  }

  formatSpeed(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB/s';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB/s';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB/s';
    return bytes + ' B/s';
  }

  render() {
    requestAnimationFrame(() => this.render());
    if (!this.canvas) return;

    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);

    this.ctx.clearRect(0, 0, width, height);

    const maxVal = Math.max(...this.points, 1024 * 100); // minimum scale 100 KB/s
    const step = width / (this.points.length - 1);

    // Draw area gradient
    const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0, 210, 255, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 112, 243, 0.0)');

    this.ctx.beginPath();
    this.ctx.moveTo(0, height);

    for (let i = 0; i < this.points.length; i++) {
      const x = i * step;
      const y = height - (this.points[i] / maxVal) * (height - 6);
      if (i === 0) this.ctx.lineTo(x, y);
      else this.ctx.lineTo(x, y);
    }

    this.ctx.lineTo(width, height);
    this.ctx.closePath();
    this.ctx.fillStyle = gradient;
    this.ctx.fill();

    // Draw top glowing stroke line
    this.ctx.beginPath();
    for (let i = 0; i < this.points.length; i++) {
      const x = i * step;
      const y = height - (this.points[i] / maxVal) * (height - 6);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.strokeStyle = '#00d2ff';
    this.ctx.lineWidth = 2;
    this.ctx.shadowColor = '#00d2ff';
    this.ctx.shadowBlur = 8;
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
  }
}

window.speedGraph = new SpeedGraph('speed-canvas');
