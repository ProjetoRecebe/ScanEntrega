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
    employeeId: formData.get("employeeId"),
    employeeName: formData.get("employeeName"),
    condominiumId: formData.get("condominiumId"),
    condominiumName: formData.get("condominiumName"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    accuracyMeters: formData.get("accuracyMeters"),
    distanceMeters: formData.get("distanceMeters"),
    locationValidatedAt: formData.get("locationValidatedAt"),
    locationSource: formData.get("locationSource"),
    locationIsMock: formData.get("locationIsMock"),
    receivedAt: new Date().toISOString(),
  };
  console.info("[mock-api] foto recebida", metadata);
  return Response.json({ ok: true, photo: metadata });
}
