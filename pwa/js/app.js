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
import {
  getAssignedCondominiums,
  getDemoLocation,
  getDeviceLocation,
  loginDemo,
  validateMockLocation,
} from "./mock-workflow.js";
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

const loginForm = document.querySelector("#login-form");
const loginSection = document.querySelector("#login-section");
const workflowSection = document.querySelector("#workflow-section");
const queueSection = document.querySelector("#queue-section");
const employeeEmail = document.querySelector("#employee-email");
const employeePassword = document.querySelector("#employee-password");
const employeeName = document.querySelector("#employee-name");
const condominiumSelect = document.querySelector("#condominium-select");
const condominiumDetail = document.querySelector("#condominium-detail");
const locationMode = document.querySelector("#location-mode");
const validateLocationButton = document.querySelector("#validate-location-button");
const locationResult = document.querySelector("#location-result");
const captureStep = document.querySelector("#capture-step");
const startCameraButton = document.querySelector("#start-camera-button");
const cameraPanel = document.querySelector("#camera-panel");
const captureControls = document.querySelector("#capture-controls");
const stopCameraButton = document.querySelector("#stop-camera-button");
const video = document.querySelector("#camera-video");
const canvas = document.querySelector("#capture-canvas");
const captureButton = document.querySelector("#capture-button");
const sendButton = document.querySelector("#send-button");
const clearButton = document.querySelector("#clear-button");
const logoutButton = document.querySelector("#logout-button");
const updateButton = document.querySelector("#update-button");
if (
  !loginForm || !loginSection || !workflowSection || !queueSection
  || !employeeEmail || !employeePassword || !employeeName || !condominiumSelect
  || !condominiumDetail || !locationMode || !validateLocationButton || !locationResult
  || !captureStep || !startCameraButton || !cameraPanel || !captureControls
  || !stopCameraButton || !video || !canvas || !captureButton || !sendButton
  || !clearButton || !logoutButton || !updateButton
) {
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
let employee = null;
let assignedCondominiums = [];
let currentCondominium = null;
let validatedLocation = null;
let locationValidationId = 0;
let cameraReady = false;
let cameraActive = false;
let serviceWorkerRegistration = null;
let reloadingForUpdate = false;
let hadServiceWorkerController = Boolean(navigator.serviceWorker?.controller);

function setCameraSessionClosed(message = "A câmera está fechada. Toque em Iniciar captura quando estiver pronto.") {
  cameraActive = false;
  cameraReady = false;
  cameraPanel.hidden = true;
  captureControls.hidden = true;
  startCameraButton.hidden = !validatedLocation;
  startCameraButton.disabled = false;
  startCameraButton.textContent = "Iniciar captura";
  stopCameraButton.disabled = false;
  setCaptureEnabled(false);
  setCameraMessage(message);
}

const camera = new CameraController(video, canvas, (message) => {
  cameraReady = message === "Câmera pronta.";
  setCameraMessage(message);
  setCaptureEnabled(cameraReady && cameraActive);
  if (!cameraReady && message.startsWith("Câmera encerrada")) {
    setCameraSessionClosed(message);
    setStatus(message);
  } else if (!cameraReady && cameraActive) {
    setStatus(message);
  }
});

function selectedCondominium() {
  const condominium = assignedCondominiums.find((item) => item.id === condominiumSelect.value);
  if (!condominium) throw new Error("Selecione um condomínio autorizado para este funcionário.");
  return condominium;
}

function showCondominium(condominium) {
  currentCondominium = condominium;
  condominiumDetail.textContent =
    `Ponto de demonstração: ${condominium.latitude.toFixed(4)}, ${condominium.longitude.toFixed(4)} · raio ${condominium.radiusMeters} m.`;
}

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
    if (navigator.onLine && employee) await syncQueue({ manual: true });
  } catch (error) {
    setStatus(`Não foi possível retomar a foto: ${error.message}`);
  }
}

function captureMetadata() {
  if (!employee || !currentCondominium || !validatedLocation?.approved) {
    throw new Error("Entre com uma conta e valide a localização antes de capturar.");
  }
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    condominiumId: currentCondominium.id,
    condominiumName: currentCondominium.name,
    latitude: validatedLocation.latitude,
    longitude: validatedLocation.longitude,
    accuracyMeters: validatedLocation.accuracyMeters,
    distanceMeters: validatedLocation.distanceMeters,
    locationValidatedAt: validatedLocation.validatedAt,
    locationSource: validatedLocation.source,
    locationIsMock: validatedLocation.isMock,
  };
}

async function handleCapture() {
  if (!cameraReady || !validatedLocation?.approved) return;
  setCaptureEnabled(false);
  try {
    const captureEmployee = employee;
    const captureCondominium = selectedCondominium();
    const captureMode = locationMode.value;
    locationResult.textContent = "Confirmando a localização desta captura…";
    let currentLocation;
    try {
      currentLocation = captureMode === "gps"
        ? await getDeviceLocation()
        : getDemoLocation(captureCondominium, captureMode);
    } catch (error) {
      if (employee !== captureEmployee) return;
      validatedLocation = null;
      captureStep.hidden = true;
      locationResult.className = "location-result is-rejected";
      locationResult.textContent = `Não foi possível confirmar a localização desta foto: ${error.message}`;
      camera.stop();
      setCameraSessionClosed();
      setStatus(`Captura bloqueada: ${error.message}`);
      return;
    }
    if (
      employee !== captureEmployee
      || !cameraActive
      || !cameraReady
      || condominiumSelect.value !== captureCondominium.id
      || locationMode.value !== captureMode
    ) return;

    const latestValidation = validateMockLocation(captureCondominium, currentLocation);
    if (!latestValidation.approved) {
      validatedLocation = null;
      captureStep.hidden = true;
      locationResult.className = "location-result is-rejected";
      locationResult.textContent = `Captura bloqueada: ${latestValidation.reason}`;
      camera.stop();
      setCameraSessionClosed();
      setStatus("Local não confirmado para esta foto. Valide novamente antes de continuar.");
      return;
    }

    validatedLocation = latestValidation;
    locationResult.className = "location-result is-approved";
    locationResult.textContent = `Local confirmado para esta foto: ${latestValidation.reason}${latestValidation.isMock ? " (local simulado)" : ""}`;
    const blob = await camera.capture();
    if (!blob) return;
    const quality = await assessImage(blob);
    if (!quality.accepted) {
      setStatus(`Foto inadequada. Ajuste a luz/posição e tente novamente (${quality.reason}).`);
      return;
    }

    await adicionarFoto(blob, batchId, captureMetadata());
    await refreshQueue();
    setStatus("Foto capturada e salva na fila com os dados do funcionário e da localização.");
  } catch (error) {
    setStatus(`Não foi possível capturar a foto: ${error.message}`);
  } finally {
    setCaptureEnabled(cameraReady && cameraActive);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    employee = await loginDemo(employeeEmail.value, employeePassword.value);
    assignedCondominiums = getAssignedCondominiums(employee.id);
    if (assignedCondominiums.length === 0) {
      throw new Error("Este funcionário não possui condomínios autorizados.");
    }
    employeeName.textContent = employee.name;
    condominiumSelect.replaceChildren(...assignedCondominiums.map((condominium) => {
      const option = document.createElement("option");
      option.value = condominium.id;
      option.textContent = condominium.name;
      return option;
    }));
    showCondominium(assignedCondominiums[0]);
    loginSection.hidden = true;
    workflowSection.hidden = false;
    queueSection.hidden = false;
    captureStep.hidden = true;
    locationResult.className = "location-result";
    locationResult.textContent = "Confirme sua presença antes de iniciar uma captura.";
    employeePassword.value = "";
    await refreshQueue();
    setStatus(`Sessão demo iniciada como ${employee.name}. Valide o local para continuar.`);
    if (navigator.onLine) {
      void syncQueue().catch((error) => setStatus(`Falha ao sincronizar: ${error.message}`));
    }
  } catch (error) {
    employee = null;
    setStatus(`Não foi possível entrar: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function handleLocationValidation() {
  if (!employee) {
    setStatus("Entre com uma conta de demonstração antes de validar o local.");
    return;
  }
  const validationId = ++locationValidationId;
  const employeeId = employee.id;
  const mode = locationMode.value;
  validateLocationButton.disabled = true;
  validatedLocation = null;
  captureStep.hidden = true;
  if (cameraActive) {
    camera.stop();
    setCameraSessionClosed();
  }
  locationResult.className = "location-result";
  locationResult.textContent = "Verificando localização…";

  try {
    const condominium = selectedCondominium();
    const location = mode === "gps"
      ? await getDeviceLocation()
      : getDemoLocation(condominium, mode);
    if (
      validationId !== locationValidationId
      || employee?.id !== employeeId
      || condominiumSelect.value !== condominium.id
      || locationMode.value !== mode
    ) return;
    const result = validateMockLocation(condominium, location);
    locationResult.textContent = `${result.approved ? "Aprovado" : "Não aprovado"}: ${result.reason}${result.isMock ? " (local simulado)" : ""}`;
    locationResult.classList.add(result.approved ? "is-approved" : "is-rejected");
    if (result.approved) {
      validatedLocation = result;
      captureStep.hidden = false;
      setCameraSessionClosed();
      startCameraButton.disabled = !window.isSecureContext;
      setStatus("Local demo confirmado. A câmera só abre quando você toca em Iniciar captura.");
    } else {
      setStatus(result.reason);
    }
  } catch (error) {
    if (validationId !== locationValidationId) return;
    locationResult.textContent = error.message;
    locationResult.classList.add("is-rejected");
    setStatus(`Não foi possível validar o local: ${error.message}`);
  } finally {
    if (validationId === locationValidationId) validateLocationButton.disabled = false;
  }
}

function handleLogout() {
  locationValidationId += 1;
  camera.stop();
  validatedLocation = null;
  employee = null;
  assignedCondominiums = [];
  currentCondominium = null;
  setCameraSessionClosed();
  workflowSection.hidden = true;
  queueSection.hidden = true;
  loginSection.hidden = false;
  locationResult.className = "location-result";
  locationResult.textContent = "Confirme sua presença antes de iniciar uma captura.";
  setStatus("Sessão encerrada. Entre novamente para continuar.");
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

async function handleStartCamera() {
  if (!validatedLocation?.approved || !window.isSecureContext) {
    setStatus("Valide o local e use HTTPS antes de abrir a câmera.");
    return;
  }
  startCameraButton.disabled = true;
  startCameraButton.textContent = "Abrindo câmera…";
  stopCameraButton.disabled = true;
  cameraPanel.hidden = false;
  captureControls.hidden = false;
  cameraActive = true;
  const started = await camera.start();
  if (started) {
    stopCameraButton.disabled = false;
    startCameraButton.hidden = true;
    setStatus("Câmera ativa. Encerre a captura quando terminar.");
  } else {
    setCameraSessionClosed();
  }
}

function handleStopCamera() {
  camera.stop();
  setCameraSessionClosed();
  setStatus("Captura encerrada. A câmera foi desligada.");
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

loginForm.addEventListener("submit", (event) => void handleLogin(event));
logoutButton.addEventListener("click", handleLogout);
condominiumSelect.addEventListener("change", () => {
  locationValidationId += 1;
  validateLocationButton.disabled = false;
  try {
    showCondominium(selectedCondominium());
    validatedLocation = null;
    captureStep.hidden = true;
    locationResult.className = "location-result";
    locationResult.textContent = "Condomínio alterado. Valide o local novamente.";
    if (cameraActive) handleStopCamera();
  } catch (error) {
    setStatus(error.message);
  }
});
locationMode.addEventListener("change", () => {
  locationValidationId += 1;
  validateLocationButton.disabled = false;
  validatedLocation = null;
  captureStep.hidden = true;
  locationResult.className = "location-result";
  locationResult.textContent = "Modo alterado. Valide o local novamente.";
  if (cameraActive) handleStopCamera();
});
validateLocationButton.addEventListener("click", () => void handleLocationValidation());
startCameraButton.addEventListener("click", () => void handleStartCamera());
stopCameraButton.addEventListener("click", handleStopCamera);
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
  if (employee) {
    void syncQueue().catch((error) => setStatus(`Falha ao retomar a fila: ${error.message}`));
  }
});
window.addEventListener("offline", () => {
  updateConnectionStatus();
  setStatus("Offline. As capturas continuarão salvas neste dispositivo.");
});
window.addEventListener("beforeunload", () => camera.destroy(), { once: true });

configurarSincronizacao({
  canSync: () => Boolean(employee),
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
    setStatus("Use HTTPS para liberar câmera e localização do aparelho. Os modos demo continuam disponíveis.");
  } else if (recovered > 0) {
    setStatus(`${recovered} envio(s) interrompido(s) foram recuperados. Entre para continuar.`);
  } else if (!API_URL.trim()) {
    setStatus("Modo de demonstração local. Entre para validar o fluxo e habilitar os envios mock.");
  } else {
    setStatus("Entre com uma conta de demonstração para iniciar.");
  }
}

void initialize().catch((error) => {
  setStatus(`Falha ao iniciar o ScanEntrega: ${error.message}`);
});
