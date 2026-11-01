import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.MOCK_API_PORT ?? 3001);
const allowedOrigin = process.env.PWA_ORIGIN ?? "http://localhost:8080";
const maxRequestBytes = 25 * 1024 * 1024;
const endpoint = "/api/photos";

function sendJson(response, status, body, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin === allowedOrigin ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      Vary: "Origin",
    } : {}),
  });
  response.end(JSON.stringify(body));
}

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxRequestBytes) {
      const error = new Error("O mock aceita requisições de até 25 MB.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(request, body) {
  const contentType = request.headers["content-type"] ?? "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!contentType.toLowerCase().startsWith("multipart/form-data") || !boundaryMatch) {
    const error = new Error("Envie os dados como multipart/form-data.");
    error.statusCode = 400;
    throw error;
  }

  const boundary = Buffer.from(`--${(boundaryMatch[1] ?? boundaryMatch[2]).trim()}`);
  const fields = new Map();
  let photo = null;
  let cursor = 0;

  while (true) {
    const boundaryStart = body.indexOf(boundary, cursor);
    if (boundaryStart === -1) break;
    const partStart = boundaryStart + boundary.length;
    if (body.subarray(partStart, partStart + 2).toString() === "--") break;
    if (body.subarray(partStart, partStart + 2).toString() !== "\r\n") {
      const error = new Error("Formato multipart inválido.");
      error.statusCode = 400;
      throw error;
    }

    const headerStart = partStart + 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd === -1) break;
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;

    const headers = body.subarray(headerStart, headerEnd).toString("utf8");
    const content = body.subarray(headerEnd + 4, nextBoundary - 2);
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? "";
    const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];
    const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    if (!name) {
      const error = new Error("Um campo do multipart está sem nome.");
      error.statusCode = 400;
      throw error;
    }

    if (name === "photo") {
      if (photo) {
        const error = new Error("Envie somente uma foto por requisição.");
        error.statusCode = 400;
        throw error;
      }
      photo = {
        filename: filename ?? "foto",
        contentType: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] ?? "application/octet-stream",
        sizeBytes: content.length,
      };
    } else {
      fields.set(name, content.toString("utf8"));
    }
    cursor = nextBoundary;
  }

  if (!photo) {
    const error = new Error('Campo obrigatório "photo" não encontrado.');
    error.statusCode = 400;
    throw error;
  }
  return { photo, fields };
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;

  if (request.method === "OPTIONS" && request.url === endpoint) {
    if (origin && origin !== allowedOrigin) {
      sendJson(response, 403, { error: "Origem não autorizada pelo mock local." }, origin);
      return;
    }
    response.writeHead(204, {
      "Access-Control-Allow-Origin": origin ?? allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", mode: "mock", storesImages: false }, origin);
    return;
  }

  if (request.method !== "POST" || request.url !== endpoint) {
    sendJson(response, 404, { error: "Rota não encontrada." }, origin);
    return;
  }

  if (origin && origin !== allowedOrigin) {
    sendJson(response, 403, { error: "Origem não autorizada pelo mock local." }, origin);
    return;
  }

  try {
    const body = await readRequestBody(request);
    const { photo, fields } = parseMultipart(request, body);
    const metadata = {
      filename: photo.filename,
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      batchId: fields.get("batchId") ?? null,
      capturedAt: fields.get("capturedAt") ?? null,
      employeeId: fields.get("employeeId") ?? null,
      employeeName: fields.get("employeeName") ?? null,
      condominiumId: fields.get("condominiumId") ?? null,
      condominiumName: fields.get("condominiumName") ?? null,
      latitude: fields.get("latitude") ?? null,
      longitude: fields.get("longitude") ?? null,
      accuracyMeters: fields.get("accuracyMeters") ?? null,
      distanceMeters: fields.get("distanceMeters") ?? null,
      locationValidatedAt: fields.get("locationValidatedAt") ?? null,
      locationSource: fields.get("locationSource") ?? null,
      locationIsMock: fields.get("locationIsMock") ?? null,
      receivedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify({ received: metadata }));
    sendJson(response, 200, { ok: true, photo: metadata }, origin);
  } catch (error) {
    sendJson(response, error.statusCode ?? 400, { error: error.message }, origin);
  }
});

server.listen(port, host, () => {
  console.log(`Mock API em http://${host}:${port}${endpoint}`);
  console.log(`CORS permitido para ${allowedOrigin}`);
  console.log("As imagens são contadas em memória e descartadas; nada é gravado em disco.");
});
