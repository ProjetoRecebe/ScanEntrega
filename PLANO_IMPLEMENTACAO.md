# Plano de implementação — ScanEntrega

## Avaliação do Prompt 01

O prompt define bem o objetivo, os módulos, o fluxo offline e os critérios de aceite. É suficientemente detalhado para orientar a construção do PWA, mas algumas regras precisam ser alinhadas antes de codificar para evitar comportamentos contraditórios ou impossíveis de validar.

### Decisões e lacunas a resolver

1. **Lote versus envio — decidido:** um POST sequencial por foto; `batchId` agrupa as fotos logicamente. Se o servidor exigir um único POST com múltiplas imagens, o contrato da API deverá ser alterado.
2. **Autenticação — parcialmente decidido:** endpoint configurável e ponto de integração `setTokenProvider()`, sem JWT embutido. A origem/renovação do token e o fluxo de login continuam dependentes do sistema existente.
3. **Retry — decidido:** backoff exponencial limitado a 5 minutos; retomar por temporizador, reconexão, inicialização ou ação manual. Erros 4xx (exceto 401/408/429) não repetem automaticamente e têm ação manual **Tentar**.
4. **Concorrência — decidido:** coordenação entre abas com lease transacional no IndexedDB e expiração para recuperar processos interrompidos.
5. **Semântica de limpeza — decidida:** limpar pendentes e erros, nunca registros em envio; o botão Enviar conta somente pendentes.
6. **Retenção de imagens — esclarecida:** após sucesso, excluir do IndexedDB e revogar a URL da miniatura; não é possível controlar caches internos do navegador. A captura é feita em canvas e não grava na galeria.
7. **Compatibilidade — pendente de validação:** testar em versões suportadas de Safari iOS e Chrome Android, incluindo IndexedDB, quota, instalação e atualização do Service Worker. Background Sync não é requisito do fluxo principal.
8. **API e ambiente — bloqueio de produção:** o mock local recebe e valida o multipart; endpoint real, contrato final, CORS, HTTPS e integração de autenticação ainda precisam ser fornecidos.

## Plano por etapas

### 0. Fechar contrato e critérios

- Confirmar envio individual ou multipart com múltiplas imagens, nomes dos campos, formato da resposta e política de idempotência.
- Definir origem do token, comportamento após 401 e se a aplicação terá login ou receberá autenticação de outra camada.
- Definir política de retry, tratamento de 4xx recuperável, alcance do botão “Limpar lote” e escopo de sincronização entre abas.
- Fixar navegadores/versões mínimas de suporte e domínios de produção para API, CORS e CSP.

**Saída:** contrato de API e decisões acima documentados; bloqueios de produção identificados.

### 1. Estrutura e app shell

- **Implementado:** estrutura `pwa/`, Dexie local fixado em 4.0.11, HTML acessível, interface mobile-first, ícones placeholder, manifest, fallback offline e Service Worker versionado.
- Implementar HTML semântico, layout mobile-first, controles acessíveis, status com `aria-live` e indicador de conectividade.
- Criar manifest, offline fallback, ícones válidos (placeholders apenas para desenvolvimento) e estilos responsivos.
- Implementar Service Worker com pré-cache do app shell, estratégia de navegação offline, atualização e limpeza de caches antigos; excluir chamadas POST da API do cache.

**Verificação:** pendente — servir em `localhost`, instalar quando suportado, carregar o app shell offline e confirmar que o Service Worker não intercepta POSTs.

### 2. Câmera e qualidade

- **Implementado:** abertura/liberação da câmera, mensagens de permissão/dispositivo ocupado/ausente, ciclo de vida de visibilidade, captura em canvas para Blob JPEG e bloqueio de captura simultânea.
- **Implementado:** cálculo de luminância em imagem reduzida, limites em configuração e rejeição sem remover fotos já aceitas.

**Verificação:** sintaxe dos módulos e limites puros de luminância passaram; captura, permissão, visibilidade e dispositivos reais ainda precisam de teste manual.

### 3. Persistência e interface da fila

- **Implementado:** IndexedDB via Dexie, fotos/status/tentativas/timestamp/`batchId`, limite transacional, operações da fila e recuperação protegida por lease.
- **Implementado:** recarga de miniaturas, revogação de object URLs, contagem de pendentes, estado vazio, limite, erro, retry manual e limpeza acordada.

**Verificação:** fluxo em navegador real (offline, recarga, limite, remoção e limpeza) ainda precisa de teste manual.

### 4. Envio, autenticação e recuperação

- **Implementado:** envio sequencial multipart, timeout, progresso e resumo, sem definir `Content-Type`.
- **Implementado:** sucesso remove do IndexedDB; rede/408/429/5xx usa backoff limitado; demais 4xx ficam visíveis com retry manual; 401 pausa a fila.
- **Implementado:** lease transacional entre abas, retomada no início, reconexão, ação manual e temporizador.
- **Pendente:** integrar URL/contrato real e provedor de token; o repositório contém apenas o mock local, sem backend de produção.

**Verificação:** o sucesso multipart contra o mock local e o CORS foram exercitados; falhas HTTP, timeout, 401 e falha parcial ainda precisam de testes.

### 5. Segurança, compatibilidade e entrega

- **Implementado parcialmente:** aviso para contexto não seguro e documentação de execução local, API/token e requisitos básicos de HTTPS/CORS.
- **Pendente:** CSP/Permissions-Policy do host, domínio/hospedagem, contrato de API, testes reais Android/iOS, instalação, Lighthouse e publicação detalhada.

**Verificação final:** a sintaxe JavaScript, limites de luminosidade, manifest, ícones, caminhos pré-cacheados, whitespace e respostas HTTP locais passaram. Critérios que dependem de câmera, IndexedDB em navegador, backend, instalação e dispositivos reais permanecem pendentes.

### Mock local para integração inicial

- **Implementado:** `tools/mock-api.mjs` recebe o mesmo multipart, verifica o campo `photo`, devolve metadados/tamanho sem persistir a imagem e permite CORS para a origem local configurada.
- **Implementado:** `API_URL` aponta para o mock em desenvolvimento; o README descreve como iniciar os dois servidores e substituir a URL para produção.
- **Verificação:** requisição multipart com bytes conhecidos retornou tamanho e campos corretos; health check e preflight CORS passaram.

## Sequência recomendada

Fechar as decisões da etapa 0; implementar app shell e câmera/qualidade; adicionar fila persistente; integrar envio/autenticação; concluir compatibilidade, documentação e publicação. Não iniciar envio de produção antes de existir contrato de API e estratégia de autenticação definidos.
