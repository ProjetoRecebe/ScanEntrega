import { API_URL, MAX_QUEUE_SIZE } from "./config.js";
import { CameraController } from "./camera.js";
import {
  adicionarFoto,
  limparFila,
  listarFotos,
  recuperarEnviosInterrompidos,
  removerFoto,
  tentarNovamente,
} from "./db.js";
import { assessImage } from "./quality.js";
import { configurarSincronizacao, syncQueue } from "./sync.js";
import {
  checkSecureContext,
  renderPhotos,
  setCameraMessage,
  setCaptureEnabled,
  setQueueWarning,
  setStatus,
  updateConnectionStatus,
} from "./ui.js";

const video = document.querySelector("#camera-video");
const canvas = document.querySelector("#capture-canvas");
const captureButton = document.querySelector("#capture-button");
const sendButton = document.querySelector("#send-button");
const clearButton = document.querySelector("#clear-button");
const updateButton = document.querySelector("#update-button");
if (!video || !canvas || !captureButton || !sendButton || !clearButton || !updateButton) {
  throw new Error("A interface do ScanEntrega está incompleta.");
}

function createBatchId() {
  const key = "scanentrega-batch-id";
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const id = crypto.randomUUID?.() ?? `batch-${Date.now()}-${Math.random()}`;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID?.() ?? `batch-${Date.now()}-${Math.random()}`;
  }
}

const batchId = createBatchId();
let cameraReady = false;
let serviceWorkerRegistration = null;
let reloadingForUpdate = false;
let hadServiceWorkerController = Boolean(navigator.serviceWorker?.controller);

const camera = new CameraController(video, canvas, (message) => {
  cameraReady = message === "Câmera pronta.";
  setCameraMessage(message);
  setCaptureEnabled(cameraReady);
});

async function refreshQueue() {
  const photos = await listarFotos();
  renderPhotos(photos, {
    onRemove: (id) => void handleRemove(id),
    onRetry: (id) => void handleRetry(id),
  });
  const remainingSlots = MAX_QUEUE_SIZE - photos.length;
  setQueueWarning(
    remainingSlots <= 0
      ? `Fila cheia (${MAX_QUEUE_SIZE} fotos). Envie ou remova fotos para continuar.`
      : "",
  );
}

async function handleRemove(id) {
  try {
    await removerFoto(id);
    await refreshQueue();
    setStatus("Foto removida da fila.");
  } catch (error) {
    setStatus(error.message);
  }
}

async function handleRetry(id) {
  try {
    await tentarNovamente(id);
    await refreshQueue();
    setStatus("Foto pronta para uma nova tentativa.");
    if (navigator.onLine) await syncQueue({ manual: true });
  } catch (error) {
    setStatus(`Não foi possível retomar a foto: ${error.message}`);
  }
}

async function handleCapture() {
  setCaptureEnabled(false);
  try {
    const blob = await camera.capture();
    if (!blob) return;
    const quality = await assessImage(blob);
    if (!quality.accepted) {
      setStatus(`Foto inadequada. Ajuste a luz/posição e tente novamente (${quality.reason}).`);
      return;
    }

    await adicionarFoto(blob, batchId);
    await refreshQueue();
    setStatus("Foto capturada e salva na fila.");
  } catch (error) {
    setStatus(`Não foi possível capturar a foto: ${error.message}`);
  } finally {
    setCaptureEnabled(cameraReady);
  }
}

async function handleClearQueue() {
  if (!window.confirm("Remover as fotos pendentes e com erro deste lote?")) return;
  try {
    const removed = await limparFila();
    await refreshQueue();
    setStatus(`${removed} foto(s) removida(s). Envios em andamento foram mantidos.`);
  } catch (error) {
    setStatus(`Não foi possível limpar a fila: ${error.message}`);
  }
}

function showUpdateAvailable(registration) {
  if (!registration.waiting) return;
  serviceWorkerRegistration = registration;
  updateButton.hidden = false;
  setStatus("Nova versão disponível. Atualize quando terminar as capturas.");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    setStatus("Este navegador não oferece suporte ao modo PWA offline.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    serviceWorkerRegistration = registration;
    if (registration.waiting) showUpdateAvailable(registration);
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateAvailable(registration);
        }
      });
    });
  } catch (error) {
    setStatus(`Não foi possível ativar o modo offline: ${error.message}`);
  }
}

captureButton.addEventListener("click", () => void handleCapture());
sendButton.addEventListener("click", () => {
  void syncQueue({ manual: true }).catch((error) => setStatus(`Falha no envio: ${error.message}`));
});
clearButton.addEventListener("click", () => void handleClearQueue());
updateButton.addEventListener("click", () => {
  if (!serviceWorkerRegistration?.waiting) return;
  serviceWorkerRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
});
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (!hadServiceWorkerController || reloadingForUpdate) {
    hadServiceWorkerController = true;
    return;
  }
  reloadingForUpdate = true;
  window.location.reload();
});

window.addEventListener("online", () => {
  updateConnectionStatus();
  setStatus("Conexão restabelecida. Retomando envios.");
  void syncQueue().catch((error) => setStatus(`Falha ao retomar a fila: ${error.message}`));
});
window.addEventListener("offline", () => {
  updateConnectionStatus();
  setStatus("Offline. As capturas continuarão salvas neste dispositivo.");
});
window.addEventListener("beforeunload", () => camera.destroy(), { once: true });

configurarSincronizacao({
  onChange: refreshQueue,
  onProgress: (current, total) => setStatus(`Enviando ${current} de ${total}…`),
  onStatus: setStatus,
  onAuthRequired: () => setStatus(
    "Autenticação necessária ou indisponível. Atualize o token no provedor de autenticação e tente novamente.",
  ),
});

async function initialize() {
  checkSecureContext();
  updateConnectionStatus();
  await registerServiceWorker();
  const recovered = await recuperarEnviosInterrompidos();
  await refreshQueue();

  if (!window.isSecureContext) {
    setCameraMessage("A câmera requer HTTPS. Em desenvolvimento, use localhost.");
  } else {
    await camera.start();
  }

  if (recovered > 0) setStatus(`${recovered} envio(s) interrompido(s) foram recuperados.`);
  if (!API_URL.trim()) {
    if (recovered === 0) setStatus("Modo de captura local. Configure API_URL para habilitar o envio.");
  } else if (navigator.onLine) {
    void syncQueue().catch((error) => setStatus(`Falha ao sincronizar: ${error.message}`));
  } else if (recovered === 0) {
    setStatus("Offline. As fotos serão sincronizadas quando a conexão voltar.");
  }
}

void initialize().catch((error) => {
  setStatus(`Falha ao iniciar o ScanEntrega: ${error.message}`);
});
