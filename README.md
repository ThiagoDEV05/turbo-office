# Turbo Office

Salas de voz e vídeo, canais de texto e cargos para o time da Turbo Partners, no estilo Discord. Roda na **Vercel**, com o **Supabase** cuidando do login, do banco e do tempo real.

## Funcionalidades

- **Login só com e-mail da Turbo** (`@turbopartners.com.br` / `@turbopartners.com`), validado no banco.
- **Salas de voz/vídeo**: clicou, entrou. Microfone, câmera, compartilhar tela, desativar áudio (ensurdecer), volume por pessoa e indicador de quem está falando. Clique num vídeo ou numa tela para ampliar.
- **Canais de texto** (#geral, #avisos, #random…) e **mensagens diretas**, com histórico salvo, links clicáveis e opção de apagar mensagem.
- **Cargos**:
  - **Admin**: muda o cargo de qualquer pessoa, gerencia todas as salas e modera Gestores e Membros.
  - **Gestor**: cria, edita e exclui salas; muta, desmuta e remove Membros das salas de voz; apaga mensagens nos canais.
  - **Membro**: uso normal.
  - Salas podem ser restritas por cargo (ex.: Diretoria só para Gestor+) e canais podem ser "só leitura" para Membros (ex.: #avisos).
  - **A primeira pessoa a se cadastrar vira Admin.**
- **Presença**: quem está online, em qual sala, com câmera, tela ou mudo; status Disponível/Ocupado/Ausente (automático depois de 10 min fora da aba) e mensagem de status.
- **Chamar**: toca um alerta para alguém e oferece o botão "Entrar" na sua sala.

Atalhos: `Ctrl+Shift+A` microfone · `Ctrl+Shift+D` ensurdecer · `Ctrl+Shift+V` câmera · `Esc` fecha.

## Como colocar no ar

### 1. Supabase (banco, login e tempo real)

1. Na Vercel, abra o projeto → **Storage** (ou **Integrations**) → **Supabase** → *Create*. Isso cria o projeto Supabase grátis e já preenche `SUPABASE_URL` e `SUPABASE_ANON_KEY` na Vercel. Também dá para criar direto em supabase.com e copiar as duas chaves (*Project Settings → API*).
2. No painel do Supabase, abra **SQL Editor → New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Authentication → Sign In / Providers → Email**, **desligue "Confirm email"**. O e-mail padrão do Supabase só envia para membros da própria organização Supabase. Para exigir confirmação por e-mail, configure antes um SMTP próprio (ex.: Resend) em *Authentication → Emails → SMTP*.
4. Em **Authentication → URL Configuration**, coloque o domínio da Vercel em *Site URL*.

### 2. Vercel

1. **Add New → Project**, importe `turbo-office` do GitHub. Framework: **Other**. Não precisa de build.
2. Confira em **Settings → Environment Variables** se `SUPABASE_URL` e `SUPABASE_ANON_KEY` existem (a integração cria as duas sozinha).
3. Faça o deploy. **A primeira pessoa a criar conta vira Admin**, então crie a sua primeiro.

### Variáveis opcionais

| Variável | Para quê |
|---|---|
| `ALLOWED_EMAIL_DOMAINS` | Domínios aceitos na tela de login (a regra definitiva fica no `schema.sql`) |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Servidor TURN para redes corporativas ou 4G, onde o vídeo P2P pode falhar |

## Rodar localmente

```bash
cp .env.example .env   # preencha SUPABASE_URL e SUPABASE_ANON_KEY
npm run dev            # http://localhost:3000
```

## Arquitetura

```
api/config.js        Função da Vercel: entrega ao navegador a URL/chave pública do Supabase e os servidores ICE
supabase/schema.sql  Tabelas, cargos, regras de acesso (RLS), trigger de domínio e canais de tempo real
public/login.html    Login e cadastro (Supabase Auth)
public/index.html    App
public/js/app.js     Controlador: sessão, navegação, entrar/sair de salas, ações
public/js/net.js     Supabase Realtime: presença, caixa de entrada por pessoa, eventos do banco
public/js/rtc.js     WebRTC: microfone, câmera, tela, conexões P2P, palco de vídeos, detecção de fala
public/js/chat.js    Canais de texto e mensagens diretas
public/js/ui.js      Canais, membros, popovers, modais (sala, configurações, admin), notificações
dev-server.mjs       Servidor só para desenvolvimento local
```

- As permissões ficam **no banco (RLS)**, não só na tela. Um Membro não consegue criar sala, mudar cargo nem escrever em #avisos, mesmo mexendo no navegador.
- O **vídeo é P2P**: vai direto de um navegador para o outro, sem passar por servidor e sem custo. Funciona bem com até cerca de 8 pessoas com câmera na mesma sala. Para reuniões maiores com vídeo, o próximo passo é usar um SFU (ex.: LiveKit Cloud).
- Plano grátis do Supabase: até 200 conexões simultâneas e 2 milhões de mensagens de tempo real por mês. Folgado para o time, porque só trafegam entradas e saídas de sala, chat e sinalização das chamadas.
