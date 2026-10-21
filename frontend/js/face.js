/**
 * Face capture module.
 * Renders a camera preview into a container element,
 * lets the user take a snapshot, and returns a Blob.
 */

export class FaceCapture {
  /**
   * @param {HTMLElement} container  — element where the camera UI is injected
   * @param {Function}    onCapture  — called with (blob, dataURL) after snapshot
   */
  constructor(container, onCapture) {
    this.container = container;
    this.onCapture = onCapture;
    this.stream    = null;
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div class="face-preview-wrap">
        <video id="fc-video" autoplay playsinline muted></video>
        <canvas id="fc-canvas" class="hidden"></canvas>
        <div class="face-actions">
          <button class="btn btn-primary btn-sm" id="fc-snap">📷 Take photo</button>
          <button class="btn btn-secondary btn-sm hidden" id="fc-retake">↩ Retake</button>
        </div>
        <p id="fc-msg" style="font-size:.8rem;color:#475569;margin-top:.4rem"></p>
      </div>
    `;

    this.video   = this.container.querySelector('#fc-video');
    this.canvas  = this.container.querySelector('#fc-canvas');
    this.snapBtn = this.container.querySelector('#fc-snap');
    this.retakeBtn = this.container.querySelector('#fc-retake');
    this.msg     = this.container.querySelector('#fc-msg');

    this.snapBtn.addEventListener('click', () => this._snap());
    this.retakeBtn.addEventListener('click', () => this._retake());
  }

  async start() {
    this.msg.textContent = 'Requesting camera access…';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      this.video.srcObject = this.stream;
      this.msg.textContent = 'Position the customer\'s face and tap "Take photo".';
    } catch (err) {
      this.msg.textContent = `Camera unavailable: ${err.message}. Use manual fallback.`;
      this.snapBtn.disabled = true;
    }
  }

  _snap() {
    const w = this.video.videoWidth  || 320;
    const h = this.video.videoHeight || 240;
    this.canvas.width  = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0, w, h);

    this.canvas.classList.remove('hidden');
    this.video.classList.add('hidden');
    this.snapBtn.classList.add('hidden');
    this.retakeBtn.classList.remove('hidden');
    this.msg.textContent = 'Preview — looks good? Save the registration to store this photo.';

    this.canvas.toBlob((blob) => {
      const url = this.canvas.toDataURL('image/jpeg');
      this.onCapture(blob, url);
    }, 'image/jpeg', 0.85);
  }

  _retake() {
    this.canvas.classList.add('hidden');
    this.video.classList.remove('hidden');
    this.snapBtn.classList.remove('hidden');
    this.retakeBtn.classList.add('hidden');
    this.msg.textContent = 'Position the customer\'s face and tap "Take photo".';
    this.onCapture(null, null); // signal cleared
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }
}
