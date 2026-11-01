import { MAX_QUEUE_SIZE, SYNC_LOCK_TTL_MS } from "./config.js";

const Dexie = window.Dexie;
if (!Dexie) throw new Error("Dexie não foi carregado. Verifique vendor/dexie.min.js.");

const database = new Dexie("capturas");
database.version(1).stores({
  fotos: "++id, timestamp, batchId, status, nextAttemptAt",
  locks: "&name, expiresAt",
});

/**
 * Persists an approved image unless the configured queue limit has been reached.
 * @param {Blob} blob
 * @param {string} batchId
 * @param {Record<string, unknown>} captureMetadata
 * @returns {Promise<number>}
 */
export async function adicionarFoto(blob, batchId, captureMetadata) {
  if (!captureMetadata || typeof captureMetadata !== "object") {
    throw new TypeError("Os dados de funcionário e localização são obrigatórios.");
  }
  return database.transaction("rw", database.fotos, async () => {
    const count = await database.fotos.count();
    if (count >= MAX_QUEUE_SIZE) {
      throw new Error(`A fila atingiu o limite de ${MAX_QUEUE_SIZE} fotos.`);
    }
    return database.fotos.add({
      blob,
      timestamp: Date.now(),
      batchId,
      captureMetadata,
      status: "pendente",
      tentativas: 0,
      nextAttemptAt: 0,
      lastError: null,
    });
  });
}

/**
 * Lists all queued photos in capture order.
 * @returns {Promise<Array<Object>>}
 */
export async function listarFotos() {
  return database.fotos.orderBy("timestamp").toArray();
}

/**
 * Removes a queued photo unless a request currently owns it.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function removerFoto(id) {
  await database.transaction("rw", database.fotos, async () => {
    const photo = await database.fotos.get(id);
    if (!photo) return;
    if (photo.status === "enviando") {
      throw new Error("A foto está sendo enviada e não pode ser removida agora.");
    }
    await database.fotos.delete(id);
  });
}

/**
 * Deletes a photo only after its successful server response.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function confirmarEnvio(id) {
  await database.transaction("rw", database.fotos, async () => {
    const photo = await database.fotos.get(id);
    if (photo?.status === "enviando") await database.fotos.delete(id);
  });
}

/**
 * Removes pending and erro photos, leaving active uploads untouched.
 * @returns {Promise<number>} Number of removed records.
 */
export async function limparFila() {
  return database.transaction("rw", database.fotos, async () => {
    const removable = await database.fotos
      .where("status")
      .anyOf(["pendente", "erro"])
      .primaryKeys();
    if (removable.length) await database.fotos.bulkDelete(removable);
    return removable.length;
  });
}

/**
 * Updates status and optional retry/error metadata.
 * @param {number} id
 * @param {"pendente" | "enviando" | "erro"} status
 * @param {Record<string, unknown>} [changes]
 * @returns {Promise<void>}
 */
export async function atualizarStatus(id, status, changes = {}) {
  await database.fotos.update(id, { ...changes, status });
}

/**
 * Makes a permanent-error photo eligible for an explicit user-requested retry.
 * @param {number} id
 */
export async function tentarNovamente(id) {
  await database.transaction("rw", database.fotos, async () => {
    const photo = await database.fotos.get(id);
    if (!photo) return;
    if (photo.status === "enviando") {
      throw new Error("A foto já está sendo enviada.");
    }
    await database.fotos.update(id, {
      status: "pendente",
      nextAttemptAt: 0,
      lastError: null,
    });
  });
}

/**
 * Recovers interrupted uploads only when no active sync lease exists.
 * The sync lock is checked in the same transaction as the photo updates.
 * @returns {Promise<number>}
 */
export async function recuperarEnviosInterrompidos() {
  return database.transaction("rw", database.fotos, database.locks, async () => {
    const lock = await database.locks.get("sync");
    if (lock && lock.expiresAt > Date.now()) return 0;
    return database.fotos.where("status").equals("enviando").modify({
      status: "pendente",
      lastError: "Envio interrompido; será retomado.",
    });
  });
}

/**
 * Atomically claims the cross-tab lease and recovers any stale sending rows.
 * @param {string} owner
 * @returns {Promise<boolean>}
 */
export async function adquirirLockSync(owner) {
  return database.transaction("rw", database.fotos, database.locks, async () => {
    const now = Date.now();
    const lock = await database.locks.get("sync");
    if (lock && lock.expiresAt > now && lock.owner !== owner) return false;

    await database.locks.put({
      name: "sync",
      owner,
      expiresAt: now + SYNC_LOCK_TTL_MS,
    });
    await database.fotos.where("status").equals("enviando").modify({
      status: "pendente",
      lastError: "Envio anterior interrompido; retomando.",
    });
    return true;
  });
}

/**
 * Extends the lease only if the caller still owns it.
 * @param {string} owner
 * @returns {Promise<boolean>}
 */
export async function renovarLockSync(owner) {
  return database.transaction("rw", database.locks, async () => {
    const lock = await database.locks.get("sync");
    if (!lock || lock.owner !== owner) return false;
    lock.expiresAt = Date.now() + SYNC_LOCK_TTL_MS;
    await database.locks.put(lock);
    return true;
  });
}

/**
 * Releases the lease if it still belongs to the caller.
 * @param {string} owner
 * @returns {Promise<void>}
 */
export async function liberarLockSync(owner) {
  await database.transaction("rw", database.locks, async () => {
    const lock = await database.locks.get("sync");
    if (lock?.owner === owner) await database.locks.delete("sync");
  });
}
