# Prompt 01 — Desenvolvimento da aplicação ScanEntrega

Atue como Engenheiro de Software Sênior especialista em Progressive Web Apps (PWAs). Crie o **ScanEntrega**, uma aplicação web em Vanilla (HTML, CSS e JavaScript puros com módulos ES, sem frameworks) para captura de campo de documentos/etiquetas (estilo Google Lens).

## CONTEXTO E OBJETIVO
O celular é apenas uma interface leve de captura. Um servidor próprio faz todo o pré-processamento (OpenCV) e o OCR/IA. O cliente só faz um controle de qualidade de luminosidade, para não enviar fotos inúteis. O usuário pode registrar UMA ou VÁRIAS fotos em sequência (um "lote") e enviá-las juntas ou aos poucos.

## ESTRUTURA DE ARQUIVOS (obrigatória)

```
pwa/
├── index.html
├── manifest.json
├── sw.js                  (na raiz, para ter escopo sobre todo o app)
├── offline.html           (fallback de navegação)
├── css/style.css
├── js/
│   ├── config.js          (API_URL, limites de brilho, tamanho máximo da fila, timeout, getAuthHeaders())
│   ├── app.js             (inicialização, registro do SW, ligação de eventos)
│   ├── camera.js          (getUserMedia, captura, liberação da stream)
│   ├── quality.js         (cálculo de luminosidade)
│   ├── db.js              (Dexie e operações da fila)
│   ├── sync.js            (envio, retry com backoff, lock)
│   └── ui.js              (miniaturas, status, indicador online/offline)
├── vendor/dexie.min.js    (versão fixa, servida localmente; NÃO usar CDN)
└── icons/ (icon-192.png, icon-512.png, icon-maskable-512.png)
```

Entregue cada arquivo em um bloco de código separado, identificado pelo caminho, comentado e pronto para uso, mais um README.md curto com instruções de teste local. Os ícones podem ser descritos/gerados como placeholders.

## REQUISITOS FUNCIONAIS

1. **Interface (index.html + css/style.css, mobile-first, acessível)**
   - Título/marca "ScanEntrega" visível de forma discreta.
   - `<video>` com a câmera em tela cheia (autoplay, playsinline, muted).
   - Botão de captura proeminente ("Tirar Foto"), botão "Enviar (N)" com a contagem de fotos pendentes e botão "Limpar lote".
   - Faixa de miniaturas das fotos capturadas, cada uma com botão para removê-la antes do envio.
   - Caixa de status com `aria-live="polite"` (capturada, rejeitada, enviando 2/5, erro, offline).
   - Indicador visual de online/offline.
   - Scripts carregados com `<script type="module" src="js/app.js">`; o Dexie é carregado via `vendor/dexie.min.js`.

2. **Captura em memória (camera.js)**
   - `getUserMedia` com `{ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }`.
   - Tratar permissão negada, câmera ausente e câmera em uso, com mensagens claras.
   - Desenhar o frame em `<canvas>` oculto e converter com `canvas.toBlob('image/jpeg', 0.85)`. Nada é salvo na galeria.
   - Liberar a stream (`track.stop()`) quando a aba ficar oculta (`visibilitychange`) e reabri-la ao voltar.
   - Impedir cliques duplicados durante o processamento de uma captura.

3. **Controle de qualidade (quality.js)**
   - Reduzir a imagem (ex.: 64x64) em canvas auxiliar antes de ler os pixels.
   - Luminância por pixel: `0.299R + 0.587G + 0.114B`; média na escala 0–255.
   - Rejeitar se média < 40 ("muito escura") ou > 220 ("estourada"), exibindo "Foto inadequada. Ajuste a luz/posição e tente novamente" (com detalhe do motivo). A rejeição não interrompe o lote: as fotos já aceitas permanecem.
   - Limites definidos em config.js. A função deve ser pura e exportada para facilitar testes.

4. **Fila offline e persistência (db.js, Dexie local)**
   - Banco "capturas", tabela "fotos": `++id, blob, timestamp, batchId, status ('pendente' | 'enviando' | 'erro'), tentativas`.
   - Toda foto aprovada é salva imediatamente no IndexedDB (sobrevive a fechar o app ou recarregar).
   - Na inicialização, recarregar pendentes e exibir miniaturas (`URL.createObjectURL`, revogando com `URL.revokeObjectURL`).
   - Limite máximo de fotos na fila (config.js, ex.: 20) com aviso ao usuário.
   - Recuperar registros presos em 'enviando' de volta para 'pendente' na inicialização.
   - Expor funções: `adicionarFoto`, `listarFotos`, `removerFoto`, `limparFila`, `atualizarStatus`.

5. **Envio de 1 ou N fotos (sync.js)**
   - Envio manual (botão "Enviar") e automático no evento 'online' e na inicialização, se online.
   - Sincronização sequencial (uma requisição por foto). Cada POST é `multipart/form-data` com o campo `photo` (binário) e, opcionalmente, `batchId` e `capturedAt` como texto.
   - Sucesso (`response.ok`): deletar o registro do IndexedDB imediatamente e atualizar a interface.
   - Falha de rede ou 5xx: manter na fila, incrementar tentativas, aplicar backoff exponencial e interromper o lote corrente. 4xx (exceto 401/408/429): marcar como 'erro', sem retentar em loop. 401: pausar e solicitar novo token.
   - Lock para impedir sincronizações concorrentes (sem envio duplicado).
   - Timeout por requisição com `AbortController` (config.js, ex.: 30 s).
   - Progresso ("Enviando 2 de 5…") e resumo final ("5 enviadas, 1 falhou").

6. **Autenticação e rede (config.js)**
   - `API_URL` e `getAuthHeaders()` com placeholder de JWT (`Authorization: Bearer <TOKEN>`). Não definir `Content-Type` manualmente (o browser gera o boundary).
   - Nenhum segredo no código; indicar onde obter o token com segurança.
   - Checar `window.isSecureContext` e avisar se não houver HTTPS (localhost é exceção).

7. **PWA (manifest.json + sw.js + offline.html)**
   - manifest.json: `name: "ScanEntrega - Captura de Campo"`, `short_name: "ScanEntrega"`, `start_url`, `scope`, `display: "standalone"`, `orientation: "portrait"`, `theme_color`, `background_color`, `lang: "pt-BR"`, ícones 192/512 (inclui maskable).
   - sw.js: pré-cache do app shell completo (index.html, offline.html, manifest, css, todos os js/, vendor/dexie.min.js, ícones), cache-first para estáticos, network-first com fallback para offline.html em navegação, nome de cache versionado (ex.: `scanentrega-v1`) e limpeza de caches antigos no `activate`. NÃO interceptar nem cachear o POST da API.
   - Registrar o SW em app.js e avisar o usuário quando houver nova versão.
   - Opcional: Background Sync (tag `sync-fotos`) como reforço, com fallback para o evento 'online'.

## REQUISITOS NÃO FUNCIONAIS
- Módulos ES com exports nomeados, funções pequenas e JSDoc; sem variáveis globais soltas.
- Tratamento de erros em todas as operações assíncronas.
- Sem dependências além do Dexie local.
- Nenhuma foto permanece no aparelho após envio bem-sucedido.
- Compatível com Chrome Android e Safari iOS.

## CRITÉRIOS DE ACEITE
- Tirar 3 fotos offline → miniaturas aparecem e persistem após recarregar.
- Foto escura/estourada é rejeitada sem entrar na fila.
- Ao voltar a conexão, as 3 fotos são enviadas em sequência e removidas do IndexedDB.
- Falha na 2ª foto mantém a 2ª e a 3ª na fila e as retenta depois.
- App instalável (nome "ScanEntrega") e abre offline (app shell completo, incluindo Dexie).
- Nenhuma foto aparece na galeria do aparelho.
