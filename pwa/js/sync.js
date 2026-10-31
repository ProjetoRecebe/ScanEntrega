import {
  API_URL,
  REQUEST_TIMEOUT_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  SYNC_LOCK_HEARTBEAT_MS,
  SYNC_LOCK_TTL_MS,
  getAuthHeaders,
} from "./config.js";
import {
  adquirirLockSync,
  atualizarStatus,
  confirmarEnvio,
  liberarLockSync,
  listarFotos,
  renovarLockSync,
} from "./db.js";
import { mockUpload } from "./mock-api.js";

let running = false;
let retryTimer = null;
let handlers = {
  onChange: async () => {},
  onProgress: () => {},
  onStatus: () => {},
  onAuthRequired: () => {},
};

/**
 * Configures UI callbacks used by the sync engine.
 * @param {Partial<typeof handlers>} callbacks
 */
export function configurarSincronizacao(callbacks) {
  handlers = { ...handlers, ...callbacks };
}

function retryDelay(attempts) {
  return Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * (2 ** Math.min(Math.max(attempts - 1, 0), 16)),
  );
}

function retryAfterDelay(response) {
  const value = response.headers.get("Retry-After");
  if (!value) return null;
  const seconds = Number(value);
  const dateDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(dateDelay) || dateDelay <= 0) return null;
  return Math.min(RETRY_MAX_DELAY_MS, dateDelay);
}

function scheduleRetry(delay) {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncQueue().catch((error) => handlers.onStatus(`Falha ao retomar a fila: ${error.message}`));
  }, delay);
}

async function updatePhoto(id, status, changes = {}) {
  await atualizarStatus(id, status, changes);
  await handlers.onChange();
}

/**
 * Sends pending photos sequentially. Network/5xx failures retain the item and stop this run.
 * @param {{ manual?: boolean }} [options]
 * @returns {Promise<{ sent: number, failed: number, remaining: number, locked?: boolean }>}
 */
export async function syncQueue({ manual = false } = {}) {
  if (running) return { sent: 0, failed: 0, remaining: 0, locked: true };
  if (!API_URL.trim()) {
    handlers.onStatus("Configure API_URL em js/config.js para habilitar o envio.");
    return { sent: 0, failed: 0, remaining: 0 };
  }
  if (!navigator.onLine) {
    handlers.onStatus("Offline. As fotos continuam salvas e serão enviadas quando houver conexão.");
    return { sent: 0, failed: 0, remaining: 0 };
  }

  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  running = true;
  const owner = crypto.randomUUID?.() ?? `sync-${Date.now()}-${Math.random()}`;
  let acquired = false;
  let sent = 0;
  let failed = 0;
  let pausedForAuth = false;
  let retryScheduled = false;
  let leaseLost = false;
  let heartbeat;

  try {
    acquired = await adquirirLockSync(owner);
    if (!acquired) {
      scheduleRetry(SYNC_LOCK_TTL_MS);
      handlers.onStatus("A fila já está sendo enviada em outra aba.");
      return { sent, failed, remaining: 0, locked: true };
    }

    heartbeat = setInterval(() => {
      void renovarLockSync(owner)
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
            handlers.onStatus("A sincronização foi pausada para evitar envio duplicado.");
          }
        })
        .catch((error) => {
          leaseLost = true;
          handlers.onStatus(`Não foi possível manter o bloqueio de envio: ${error.message}`);
        });
    }, SYNC_LOCK_HEARTBEAT_MS);

    let photos = await listarFotos();
    photos = photos.filter((photo) => photo.status === "pendente");
    const total = photos.length;
    if (total === 0) {
      handlers.onStatus("Não há fotos pendentes para enviar.");
      return { sent, failed, remaining: 0 };
    }

    for (let index = 0; index < photos.length; index += 1) {
      if (leaseLost) break;
      if (!navigator.onLine) {
        handlers.onStatus("Conexão perdida. As fotos restantes continuam na fila.");
        break;
      }

      const photo = photos[index];
      if (!manual && photo.nextAttemptAt > Date.now()) {
        scheduleRetry(photo.nextAttemptAt - Date.now());
        retryScheduled = true;
        handlers.onStatus("Nova tentativa agendada. As fotos continuam salvas na fila.");
        break;
      }

      await handlers.onProgress(index + 1, total);
      await atualizarStatus(photo.id, "enviando", { lastError: null });
      await handlers.onChange();

      let headers;
      try {
        headers = await getAuthHeaders();
      } catch (error) {
        await updatePhoto(photo.id, "pendente", {
          lastError: `Falha ao obter autenticação: ${error.message}`,
          nextAttemptAt: 0,
        });
        handlers.onAuthRequired();
        pausedForAuth = true;
        break;
      }

      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
      let response;
      try {
        const formData = new FormData();
        formData.append("photo", photo.blob, `captura-${photo.id}.jpg`);
        formData.append("batchId", photo.batchId);
        formData.append("capturedAt", new Date(photo.timestamp).toISOString());
        response = API_URL.startsWith("mock:")
          ? await mockUpload(formData)
          : await fetch(API_URL, {
            method: "POST",
            headers,
            body: formData,
            signal: timeoutController.signal,
          });
      } catch (error) {
        const attempts = photo.tentativas + 1;
        const delay = retryDelay(attempts);
        const errorMessage = error.name === "AbortError"
          ? "Tempo limite de envio excedido."
          : `Falha de rede: ${error.message}`;
        await updatePhoto(photo.id, "pendente", {
          tentativas: attempts,
          nextAttemptAt: Date.now() + delay,
          lastError: errorMessage,
        });
        scheduleRetry(delay);
        retryScheduled = true;
        handlers.onStatus(`${errorMessage} Nova tentativa em ${Math.ceil(delay / 1000)} s.`);
        break;
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401) {
        await updatePhoto(photo.id, "pendente", {
          lastError: "Autenticação necessária.",
          nextAttemptAt: 0,
        });
        handlers.onAuthRequired();
        pausedForAuth = true;
        break;
      }

      if (response.ok) {
        await confirmarEnvio(photo.id);
        sent += 1;
        await handlers.onChange();
        continue;
      }

      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        const attempts = photo.tentativas + 1;
        const delay = retryAfterDelay(response) ?? retryDelay(attempts);
        await updatePhoto(photo.id, "pendente", {
          tentativas: attempts,
          nextAttemptAt: Date.now() + delay,
          lastError: `Servidor indisponível (HTTP ${response.status}).`,
        });
        scheduleRetry(delay);
        retryScheduled = true;
        handlers.onStatus(`Falha temporária (HTTP ${response.status}). Nova tentativa em ${Math.ceil(delay / 1000)} s.`);
        break;
      }

      failed += 1;
      await updatePhoto(photo.id, "erro", {
        lastError: `Falha permanente (HTTP ${response.status}).`,
        nextAttemptAt: 0,
      });
    }

    const remaining = (await listarFotos()).length;
    if (!pausedForAuth && !retryScheduled && !leaseLost) {
      handlers.onStatus(`${sent} enviada(s), ${failed} falha(s) permanente(s), ${remaining} na fila.`);
    }
    return { sent, failed, remaining };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    try {
      if (acquired) await liberarLockSync(owner);
    } finally {
      running = false;
    }
  }
}
