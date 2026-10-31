const objectUrls = new Map();

/**
 * Renders thumbnails and revokes URLs for records no longer in the queue.
 * @param {Array<Object>} photos
 * @param {{ onRemove: (id: number) => void, onRetry: (id: number) => void }} actions
 */
export function renderPhotos(photos, actions) {
  const list = document.querySelector("#photo-list");
  const empty = document.querySelector("#empty-queue");
  const queueCount = document.querySelector("#queue-count");
  const sendButton = document.querySelector("#send-button");
  const clearButton = document.querySelector("#clear-button");
  if (!list || !empty || !queueCount || !sendButton || !clearButton) {
    throw new Error("A interface da fila está incompleta.");
  }

  const ids = new Set(photos.map((photo) => photo.id));
  for (const [id, url] of objectUrls) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(url);
      objectUrls.delete(id);
    }
  }

  list.replaceChildren();
  empty.hidden = photos.length > 0;
  queueCount.textContent = `${photos.length} ${photos.length === 1 ? "foto" : "fotos"}`;

  const pendingCount = photos.filter((photo) => photo.status === "pendente").length;
  const busy = photos.some((photo) => photo.status === "enviando");
  sendButton.textContent = `Enviar (${pendingCount})`;
  sendButton.disabled = pendingCount === 0 || busy;
  clearButton.disabled = photos.length === 0 || busy;

  for (const photo of photos) {
    let url = objectUrls.get(photo.id);
    if (!url) {
      url = URL.createObjectURL(photo.blob);
      objectUrls.set(photo.id, url);
    }

    const card = document.createElement("article");
    card.className = `photo-card${photo.status === "erro" ? " is-error" : ""}`;
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Foto capturada ${new Date(photo.timestamp).toLocaleString("pt-BR")}`;
    image.loading = "lazy";

    const label = document.createElement("div");
    label.className = "photo-card-label";
    label.textContent = photo.status === "enviando"
      ? "Enviando…"
      : photo.status === "erro"
        ? `Erro${photo.lastError ? `: ${photo.lastError}` : ""}`
        : "Pendente";
    if (photo.lastError) label.title = photo.lastError;

    const actionsElement = document.createElement("div");
    actionsElement.className = "photo-card-actions";
    if (photo.status === "erro") {
      const retryButton = document.createElement("button");
      retryButton.className = "photo-action";
      retryButton.type = "button";
      retryButton.textContent = "Tentar";
      retryButton.disabled = busy;
      retryButton.setAttribute("aria-label", "Tentar enviar esta foto novamente");
      retryButton.addEventListener("click", () => actions.onRetry(photo.id));
      actionsElement.append(retryButton);
    }

    const removeButton = document.createElement("button");
    removeButton.className = "photo-action photo-action-remove";
    removeButton.type = "button";
    removeButton.textContent = "Remover";
    removeButton.disabled = photo.status === "enviando";
    removeButton.setAttribute("aria-label", "Remover esta foto da fila");
    removeButton.addEventListener("click", () => actions.onRemove(photo.id));
    actionsElement.append(removeButton);

    card.append(image, label, actionsElement);
    list.append(card);
  }
}

/**
 * Updates the accessible live status message.
 * @param {string} message
 */
export function setStatus(message) {
  const status = document.querySelector("#app-status");
  if (!status) throw new Error("A área de status não foi encontrada.");
  status.textContent = message;
}

/**
 * Updates online/offline presentation.
 */
export function updateConnectionStatus() {
  const indicator = document.querySelector("#network-status");
  if (!indicator) throw new Error("O indicador de conexão não foi encontrado.");
  const online = navigator.onLine;
  indicator.textContent = online ? "Online" : "Offline";
  indicator.classList.toggle("is-offline", !online);
  indicator.setAttribute("aria-label", online ? "Conectado" : "Sem conexão");
}

/**
 * Updates the camera helper text.
 * @param {string} message
 */
export function setCameraMessage(message) {
  const element = document.querySelector("#camera-message");
  if (!element) throw new Error("A área de mensagem da câmera não foi encontrada.");
  element.textContent = message;
}

/**
 * Sets the enabled state of the capture button.
 * @param {boolean} enabled
 */
export function setCaptureEnabled(enabled) {
  const button = document.querySelector("#capture-button");
  if (!button) throw new Error("O botão de captura não foi encontrado.");
  button.disabled = !enabled;
}

/**
 * Displays or clears the queue-limit warning.
 * @param {string} [message]
 */
export function setQueueWarning(message = "") {
  const element = document.querySelector("#queue-warning");
  if (!element) throw new Error("A área de aviso da fila não foi encontrada.");
  element.textContent = message;
  element.hidden = !message;
}

/**
 * Shows the secure-context warning when camera/PWA APIs are unavailable.
 */
export function checkSecureContext() {
  const warning = document.querySelector("#secure-context-warning");
  if (!warning) throw new Error("O aviso de contexto seguro não foi encontrado.");
  warning.hidden = Boolean(window.isSecureContext);
}
