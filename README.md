# ScanEntrega

Aplicação PWA de captura de campo. O app fica em `pwa/`; as fotos aprovadas são
mantidas no IndexedDB enquanto aguardam envio.

## Teste local

1. Sirva a pasta `pwa/`:

   ```sh
   python3 -m http.server 8080 --directory pwa
   ```

2. Abra <http://localhost:8080> em Chrome ou Safari. Entre com uma conta demo:
   `ana@demo.scanentrega` / `1234` (Recife e Olinda) ou
   `carlos@demo.scanentrega` / `1234` (São Paulo).
3. Escolha um condomínio e valide a localização. **GPS do aparelho** solicita
   a permissão do navegador e compara a posição com um ponto e raio fictícios;
   os modos **Simular** permitem testar aprovação, local fora da área e baixa
   precisão sem estar perto desses endereços.
4. Após a validação, toque em **Iniciar captura** para abrir a câmera. Ela não é
   iniciada ao carregar o app e é desligada ao encerrar a captura, sair do app
   ou mudar de condomínio. A localização é conferida novamente a cada foto.
   Capture uma foto e toque em **Enviar** para testar o mock. Os metadados
   recebidos (incluindo os dados demo de funcionário e localização) aparecem no
   console do navegador.
5. Para testar a fila offline, desligue a rede pelo DevTools ou coloque o
   dispositivo em modo avião, capture fotos e recarregue o app. Entre
   novamente; as miniaturas e seus metadados continuam na fila e o envio é
   retomado quando a conexão voltar.
6. Para testar em um celular fora de `localhost`, use um túnel HTTPS; câmera e
   GPS do aparelho precisam de contexto seguro. Os ícones da PWA usam uma arte
   estilizada de celular e pacote; substitua-a pela marca oficial antes da
   publicação, se necessário.
7. Para exercitar o endpoint Node em vez do mock embutido, inicie
   `node tools/mock-api.mjs` em outro terminal e altere temporariamente
   `API_URL` em `pwa/js/config.js` para
   `http://localhost:3001/api/photos`. O mock imprime os metadados no terminal,
   descarta os bytes e permite por padrão a origem `http://localhost:8080`.

## Configuração da API

- Para integrar o backend real, altere `API_URL` em `pwa/js/config.js` para o
  endpoint HTTPS que aceita `multipart/form-data`, incluindo o campo `photo`;
  `batchId` e `capturedAt` também são enviados como texto.
- O login atual é apenas uma simulação local em `pwa/js/mock-workflow.js`.
  Usuários, senhas, condomínios e coordenadas são exemplos públicos; não
  autenticam nem autorizam funcionários de verdade. Antes de produção, troque
  essa camada por um provedor de identidade e validação no servidor.
- A aplicação não embute token. Integre `setTokenProvider()` em
  `pwa/js/config.js` com o cliente de autenticação aprovado pelo sistema para
  obter um access token vigente. Não coloque JWT no código-fonte, no manifest
  ou em arquivos públicos.
- O servidor precisa permitir a origem do PWA, `POST`, `OPTIONS` e o header
  `Authorization` via CORS. O cliente não define `Content-Type` para que o
  navegador gere o boundary multipart.
- Por padrão, `API_URL = "mock:"` usa o mock embutido no navegador
  (`pwa/js/mock-api.js`), que funciona também no GitHub Pages e registra os
  metadados no console. Para usar o mock Node (`tools/mock-api.mjs`), defina
  `API_URL = "http://localhost:3001/api/photos"`. Os dois mocks descartam as
  imagens após a resposta e não autenticam nem representam o contrato final.
- Cada foto nova inclui no IndexedDB e no envio demo o funcionário selecionado,
  condomínio, coordenadas, precisão, distância, origem e horário da validação.
  Essa informação vem do navegador e não é prova de identidade ou presença;
  em produção, o servidor deve autenticar o funcionário, verificar sua
  autorização para o condomínio e validar a localização.

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
valide os ícones e a instalação, o modo offline, a atualização do Service
Worker e o envio real em Android e iOS. Para evitar duplicação se a conexão
cair depois de o servidor aceitar uma foto, o contrato de produção deve definir
uma chave de idempotência estável por foto.