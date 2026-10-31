# Prompt 02 — Publicação (deploy) do ScanEntrega

Atue como Engenheiro de Software Sênior / DevOps. Considere o PWA **ScanEntrega** (pasta `pwa/`, estrutura definida no Prompt 01) e produza o material de publicação em produção.

## ENTREGAS
- Seção **"Publicação"** no `README.md` com o passo a passo abaixo.
- `nginx.conf` de exemplo (opcional).
- Se usar GitHub Pages, workflow `.github/workflows/deploy.yml`.

## CONTEÚDO

1. **Pré-requisitos**
   - Domínio próprio (ou subdomínio) e certificado HTTPS válido (Let's Encrypt/Certbot ou gerenciado pelo provedor). Sem HTTPS, câmera, Service Worker e instalação NÃO funcionam.
   - API do servidor acessível por HTTPS, com CORS liberando a origem do PWA (métodos POST/OPTIONS e header `Authorization`).

2. **Teste local antes de publicar**
   - Servir a pasta `pwa/` com `npx serve pwa` ou `python3 -m http.server 8080` (localhost é contexto seguro).
   - Para testar no celular: túnel HTTPS (ex.: `npx localtunnel --port 8080`, Cloudflare Tunnel ou ngrok), pois IP da rede local em HTTP não libera a câmera.

3. **Opções de hospedagem estática, com comandos**
   - **GitHub Pages:** publicar `pwa/` (branch ou GitHub Actions) e habilitar "Enforce HTTPS". Ajustar `start_url` e `scope` do manifest e o caminho de registro do SW se o app ficar em subcaminho (`/repositorio/`).
   - **Netlify ou Cloudflare Pages:** deploy por Git ou arrastando a pasta; HTTPS automático.
   - **Servidor próprio (Nginx):** bloco `server` com HTTPS, `root` apontando para `pwa/`, `try_files`, gzip/brotli e os cabeçalhos abaixo.

4. **Cabeçalhos HTTP**
   - `sw.js` e `index.html`: `Cache-Control: no-cache` (atualizações chegam ao usuário).
   - Estáticos versionados (css, js, ícones, vendor): `Cache-Control: public, max-age=31536000, immutable` ou, sem hash no nome, cache curto.
   - `manifest.json`: `Content-Type: application/manifest+json`.
   - Segurança: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(self)` e `Content-Security-Policy` restrita (`default-src 'self'; connect-src 'self' <API_URL>; img-src 'self' blob: data:; media-src 'self' blob:`).

5. **Configuração para produção**
   - Preencher `API_URL` de produção em `config.js` e definir como o token JWT é obtido (login; nunca embutido no código).
   - Incrementar a versão do cache no `sw.js` (ex.: `scanentrega-v2`) a cada release.
   - Conferir caminhos absolutos/relativos conforme o local de publicação.

6. **Verificação pós-deploy**
   - Abrir a URL em HTTPS e confirmar o cadeado.
   - DevTools → Application: manifest válido, SW ativo, cache do app shell preenchido.
   - Lighthouse (PWA, Performance, Acessibilidade) sem erros críticos.
   - Instalar na tela inicial no Android (Chrome) e no iOS (Safari → Adicionar à Tela de Início).
   - Modo avião: app abre; tirar fotos; religar a rede e confirmar envio e limpeza da fila.
   - Verificar no servidor o recebimento do multipart (campo `photo`) e o CORS.

7. **Atualização e rollback**
   - Nova versão: alterar arquivos → incrementar cache do SW → publicar → usuário recebe aviso "Nova versão disponível" e recarrega.
   - Rollback: republicar a versão anterior com número de cache maior, para forçar a troca nos clientes.

## CRITÉRIOS DE ACEITE
- README.md contém passo a passo de publicação em HTTPS, cabeçalhos, checklist pós-deploy e atualização/rollback.
- O app publicado passa no Lighthouse PWA e é instalável em Android e iOS.