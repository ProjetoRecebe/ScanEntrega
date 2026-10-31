# ScanEntrega

Aplicação PWA de captura de campo. O app fica em `pwa/`; as fotos aprovadas são
mantidas no IndexedDB enquanto aguardam envio.

## Teste local

1. Inicie o mock de API local em um terminal:

   ```sh
   node tools/mock-api.mjs
   ```

   Ele recebe o `multipart/form-data`, devolve nome/tipo/tamanho da foto,
   `batchId` e horários, e descarta os bytes sem gravar arquivos. A origem
   permitida por padrão é `http://localhost:8080`; para outra porta, inicie com
   `PWA_ORIGIN=http://localhost:SUA_PORTA node tools/mock-api.mjs`.
2. Em outro terminal, sirva a pasta `pwa/`:

   ```sh
   python3 -m http.server 8080 --directory pwa
   ```

3. Abra <http://localhost:8080> em Chrome ou Safari e autorize o uso da câmera.
   `localhost` é um contexto seguro para desenvolvimento. Para testar em um
   celular, use um túnel HTTPS; o IP local em HTTP não libera a câmera.
4. Capture uma foto e toque em **Enviar**. O mock responde JSON com nome, tipo,
   tamanho em bytes, `batchId` e horários; os metadados recebidos também são
   impressos no terminal do mock. A foto será removida da fila após a resposta
   de sucesso.
5. Para testar a fila offline, desligue a rede pelo DevTools ou coloque o
   dispositivo em modo avião, capture fotos e recarregue o app. As miniaturas
   devem continuar na fila. Ao voltar a conexão, o envio será retomado para o
   mock local.
6. Ícones atuais são placeholders visuais e devem ser substituídos pela marca
   oficial antes da publicação.

## Configuração da API

- Para integrar o backend real, altere `API_URL` em `pwa/js/config.js` para o
  endpoint HTTPS que aceita `multipart/form-data`, incluindo o campo `photo`;
  `batchId` e `capturedAt` também são enviados como texto.
- A aplicação não embute token. Integre `setTokenProvider()` em
  `pwa/js/config.js` com o cliente de autenticação aprovado pelo sistema, por
  exemplo, chamando-o a partir de `pwa/js/app.js` para obter um access token
  vigente. Não coloque JWT no código-fonte, no manifest ou em arquivos públicos.
- O servidor precisa permitir a origem do PWA, `POST`, `OPTIONS` e o header
  `Authorization` via CORS. O cliente não define `Content-Type` para que o
  navegador gere o boundary multipart.
- Por padrão, `API_URL = "mock:"` usa o mock embutido no navegador
  (`pwa/js/mock-api.js`), que funciona também no GitHub Pages e registra os
  metadados no console. Para usar o mock Node (`tools/mock-api.mjs`), defina
  `API_URL = "http://localhost:3001/api/photos"`. Antes da integração,
  substitua pelo endpoint real e conecte o provedor de token; os mocks não
  autenticam e não representam o contrato final do backend.

## Comportamento da fila

- O envio é sequencial, com uma requisição por foto. Uma falha de rede, timeout,
  HTTP 408, 429 ou 5xx mantém a foto e interrompe a execução atual; o retry usa
  backoff exponencial limitado a 5 minutos e também pode ser retomado ao
  reconectar, reabrir o app ou tocar em Enviar.
- Respostas 4xx (exceto 401, 408 e 429) ficam como erro e não são repetidas
  automaticamente. Use **Tentar** na miniatura após corrigir a causa ou remova
  a foto. Um 401 pausa a fila até a integração de autenticação fornecer token
  válido.
- **Limpar lote** remove registros pendentes e com erro, mas não uploads em
  andamento. O botão Enviar conta somente fotos pendentes.
- O app exclui a foto do IndexedDB após sucesso e revoga a URL da miniatura.
  Navegadores controlam seus próprios caches internos; a aplicação não salva
  fotos na galeria.

## Publicação

O workflow `.github/workflows/deploy.yml` publica `pwa/` no GitHub Pages a cada
push em `main` (habilite em Settings → Pages → Source: GitHub Actions).

Publique `pwa/` em hospedagem estática com HTTPS válido. Câmera, Service Worker
e instalação exigem contexto seguro (localhost é a exceção de desenvolvimento).
Configure CORS e `API_URL` para o domínio real. Para arquivos sem hash no nome,
use cache curto ou revalidação; configure `Cache-Control: no-cache` para
`index.html` e `sw.js`. Sirva `manifest.json` como
`application/manifest+json`.

Como ponto de partida, configure também `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(self)` e uma CSP
restritiva. Substitua `https://api.example.com` pela origem real da API:

```text
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' blob: data:; media-src 'self' blob:;
connect-src 'self' https://api.example.com; worker-src 'self';
manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

Incremente `CACHE_NAME` em `pwa/sw.js` a cada release. Antes de produção,
substitua os ícones placeholder e valide instalação, modo offline, atualização
do Service Worker e envio real em Android e iOS. Para evitar duplicação se a
conexão cair depois de o servidor aceitar uma foto, o contrato de produção deve
definir uma chave de idempotência estável por foto.