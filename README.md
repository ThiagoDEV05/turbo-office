# Turbo Office

Escritório virtual da Turbo Partners, no estilo Gather: cada pessoa é um avatar num mapa 2D. Ao chegar perto de alguém, o áudio e o vídeo ligam sozinhos. Nas salas fechadas, todo mundo que está dentro se ouve.

## Funcionalidades

- **Login restrito** a e-mails `@turbopartners.com.br` / `@turbopartners.com` (e-mail + senha).
- **Mapa do escritório**: recepção, open office com ilhas por time (Tráfego, Criativo, CS, Comercial, Growth, Tech, Operações, Financeiro), 3 salas de reunião, diretoria, auditório, lounge, cozinha e café.
- **Áudio e vídeo por proximidade** (WebRTC P2P): conecta num raio de ~3 tiles, e o volume cai com a distância.
- **Salas privadas**: quem está dentro se ouve independentemente da distância, e quem está fora não ouve. O resto do mapa escurece.
- **Compartilhamento de tela**, com clique para ampliar em tela cheia.
- **Chat**: canal geral (salvo no banco), "Por perto" (só para quem está conversando com você) e mensagens diretas (salvas no banco).
- **Pessoas**: lista de quem está online e offline, localização de cada um, e os botões *Ir até*, *Mensagem* e *Chamar* (toca um alerta na tela da pessoa).
- **Status**: Disponível, Ocupado (não perturbe: bloqueia conexões) e Ausente (automático depois de 10 min com a aba escondida), com mensagem de status.
- **Avatar personalizável** (pele, cabelo, cores de roupa), nome editável, escolha de microfone e câmera.
- **Reações** (teclas 1–8), indicador de quem está falando, minimapa clicável e zoom.

## Controles

| Ação | Tecla |
|---|---|
| Andar | Setas ou WASD, ou clique no mapa/minimapa |
| Reações | 1–8 |
| Abrir chat | Enter |
| Microfone / câmera | Ctrl+Shift+A / Ctrl+Shift+V |
| Zoom | Roda do mouse ou botões + / − |
| Fechar | Esc |

Clique no avatar de alguém para ir até a pessoa, mandar mensagem ou chamá-la.

## Rodar localmente

Requer Node.js 22.13 ou superior (usa o SQLite nativo do Node).

```bash
npm install
npm start
# abra http://localhost:3000
```

## Colocar no ar para o time

Câmera e microfone só funcionam em **HTTPS** (ou em localhost). As opções mais simples:

- **Railway / Render / Fly.io**: suba este repositório (o Dockerfile já está pronto) e **monte um volume persistente em `/data`**, onde fica o banco SQLite.
- **VPS própria**: `docker build -t turbo-office . && docker run -d -p 3000:3000 -v turbo-data:/data turbo-office`, com um Caddy ou Nginx na frente para o HTTPS.

### Variáveis de ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./data` | Onde ficam o banco e o segredo de sessão |
| `ALLOWED_EMAIL_DOMAINS` | `turbopartners.com.br,turbopartners.com` | Domínios que podem se cadastrar |
| `SESSION_SECRET` | gerado em `DATA_DIR/.secret` | Assinatura dos cookies de sessão |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | não definidas | Servidor TURN (veja abaixo) |

### TURN (recomendado em produção)

Por padrão só é usado STUN público, o que resolve a maioria das redes domésticas. Em redes corporativas, 4G ou firewalls restritivos, algumas conexões de vídeo podem falhar sem um servidor **TURN**. Dá para usar um serviço pronto (Cloudflare Calls TURN, Metered, Twilio) ou subir um coturn, e depois preencher as variáveis `TURN_*`. Exemplo: `TURN_URL=turn:turn.exemplo.com:3478,turns:turn.exemplo.com:5349`.

## Arquitetura

```
server.js           Express + Socket.IO + SQLite: login, presença, posições, chat e sinalização WebRTC
public/login.html   Tela de login/cadastro
public/app.html     App principal
public/js/map.js    Mapa (compartilhado entre servidor e cliente): pisos, móveis, áreas privadas
public/js/render.js Desenho procedural do mapa, dos avatares e do minimapa
public/js/rtc.js    Mídia local, conexões P2P por proximidade, tiles de vídeo, detecção de fala
public/js/ui.js     Barra lateral (pessoas/chat), popovers, notificações, configuração do avatar
public/js/app.js    Loop do jogo, movimento, cliques, atalhos e eventos do servidor
```

**Limite de escala:** o vídeo usa malha P2P, em que cada pessoa manda sua câmera diretamente para cada pessoa com quem está conversando. Funciona bem para conversas de até cerca de 8–10 pessoas ao mesmo tempo. Para all-hands com o time inteiro no auditório, o próximo passo é trocar a malha por um SFU (ex.: LiveKit), sem mudar o resto do app.

**Editar o mapa:** tudo fica em `public/js/map.js`. As funções `rect`/`hline`/`vline` desenham pisos, paredes e móveis. `AREAS` define as salas (`private: true` para salas fechadas) e `TEAMS` define as ilhas dos times.
