/**
 * Maps common media-device errors to actionable Portuguese messages.
 * @param {unknown} error
 * @returns {string}
 */
function cameraErrorMessage(error) {
  if (!(error instanceof DOMException)) return "Não foi possível abrir a câmera.";
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Permissão da câmera negada. Autorize o acesso nas configurações do navegador.";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "Nenhuma câmera foi encontrada neste dispositivo.";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "A câmera está em uso por outro aplicativo. Feche-o e tente novamente.";
  }
  if (error.name === "OverconstrainedError") {
    return "A câmera não oferece a resolução solicitada.";
  }
  return "Não foi possível iniciar a câmera. Verifique as permissões e tente novamente.";
}

/**
 * Controls a live camera stream and captures JPEG blobs without saving to the gallery.
 */
export class CameraController {
  #video;
  #canvas;
  #stream = null;
  #startRequestId = 0;
  #capturing = false;
  #onMessage;

  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLCanvasElement} canvas
   * @param {(message: string) => void} onMessage
   */
  constructor(video, canvas, onMessage) {
    this.#video = video;
    this.#canvas = canvas;
    this.#onMessage = onMessage;
    document.addEventListener("visibilitychange", this.#handleVisibility);
  }

  #handleVisibility = () => {
    if (document.hidden && this.#stream) {
      this.stop();
      this.#onMessage("Câmera encerrada ao sair do app. Toque em Iniciar captura para reabrir.");
    }
  };

  async start() {
    if (this.#stream) return true;
    if (document.hidden) return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.#onMessage("A câmera requer HTTPS ou um navegador compatível.");
      return false;
    }

    const requestId = ++this.#startRequestId;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (requestId !== this.#startRequestId || document.hidden) {
        stream.getTracks().forEach((track) => track.stop());
        if (requestId === this.#startRequestId) {
          this.#onMessage("Câmera encerrada ao sair do app. Toque em Iniciar captura para reabrir.");
        }
        return false;
      }
      this.#stream = stream;
      this.#video.srcObject = stream;
      await this.#video.play();
      if (
        requestId !== this.#startRequestId
        || document.hidden
        || this.#stream !== stream
        || !stream.getTracks().some((track) => track.readyState === "live")
      ) {
        stream.getTracks().forEach((track) => track.stop());
        if (this.#stream === stream) this.#stream = null;
        if (this.#video.srcObject === stream) this.#video.srcObject = null;
        if (requestId === this.#startRequestId) {
          this.#onMessage("Câmera encerrada ao sair do app. Toque em Iniciar captura para reabrir.");
        }
        return false;
      }
      this.#onMessage("Câmera pronta.");
      return true;
    } catch (error) {
      if (requestId === this.#startRequestId) {
        this.stop();
        this.#onMessage(cameraErrorMessage(error));
      }
      return false;
    }
  }

  stop() {
    this.#startRequestId += 1;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#video.srcObject = null;
  }

  async capture() {
    if (this.#capturing) return null;
    if (!this.#stream || this.#video.videoWidth === 0 || this.#video.videoHeight === 0) {
      throw new Error("A câmera ainda não está pronta.");
    }

    this.#capturing = true;
    try {
      this.#canvas.width = this.#video.videoWidth;
      this.#canvas.height = this.#video.videoHeight;
      const context = this.#canvas.getContext("2d");
      if (!context) throw new Error("Não foi possível preparar a captura.");
      context.drawImage(this.#video, 0, 0, this.#canvas.width, this.#canvas.height);

      const blob = await new Promise((resolve, reject) => {
        this.#canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("Não foi possível gerar a foto.")),
          "image/jpeg",
          0.85,
        );
      });
      return blob;
    } finally {
      this.#capturing = false;
    }
  }

  destroy() {
    document.removeEventListener("visibilitychange", this.#handleVisibility);
    this.stop();
  }
}
