/**
 * Mock de API executado no navegador, para testes sem backend (ex.: GitHub Pages).
 * Devolve apenas metadados da foto; nada é enviado pela rede nem armazenado.
 * @param {FormData} formData
 * @returns {Promise<Response>}
 */
export async function mockUpload(formData) {
  const photo = formData.get("photo");
  if (!(photo instanceof Blob)) {
    return Response.json({ error: 'Campo obrigatório "photo" não encontrado.' }, { status: 400 });
  }

  const metadata = {
    filename: photo.name ?? "foto",
    contentType: photo.type || "application/octet-stream",
    sizeBytes: photo.size,
    batchId: formData.get("batchId"),
    capturedAt: formData.get("capturedAt"),
    receivedAt: new Date().toISOString(),
  };
  console.info("[mock-api] foto recebida", metadata);
  return Response.json({ ok: true, photo: metadata });
}
