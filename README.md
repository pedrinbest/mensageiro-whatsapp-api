# WhatsApp Messenger API

API multi-tenant para envio de mensagens via WhatsApp (chatbot, notificações e OTP),
com **isolamento total** entre números/instâncias conectadas.

## Arquitetura

```
Tenant (seu cliente da API)
  └── Instance (um número de WhatsApp conectado)
        ├── Client (whatsapp-web.js, sessão de auth isolada por instanceId)
        ├── Fila de envio própria (BullMQ) com rate limit próprio
        ├── Webhook de recebimento próprio
        └── Estado de conversa sempre chaveado por (instanceId, numero)
```

O ponto central é o `SessionManager` (`src/core/SessionManager.js`): cada instância
tem seu próprio `Client`, e todo evento emitido carrega `instanceId` explicitamente.
Nenhum estado global tipo "número atual" é usado — é exatamente esse tipo de
variável compartilhada que faz mensagens vazarem entre números diferentes.

## Requisitos

- Node.js 18+
- PostgreSQL
- Redis (para as filas BullMQ)

## Subindo o ambiente

```bash
# 1. Instalar dependências
npm install

# 2. Subir Postgres e Redis localmente (ou aponte para instâncias já existentes)
docker compose up -d

# 3. Configurar variáveis de ambiente
cp .env.example .env
# edite o .env com DATABASE_URL, ADMIN_KEY etc.

# 4. Rodar as migrations do Prisma
npx prisma migrate dev --name init

# 5. Iniciar a API
npm run dev
```

## Fluxo de uso

### 1. Criar um tenant (uma vez, via chave administrativa)

```bash
curl -X POST http://localhost:3000/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: <ADMIN_KEY do .env>" \
  -d '{"nome": "Minha Empresa"}'
```

Guarde o `apiKey` retornado — é ele que autentica todas as chamadas seguintes.

### 2. Criar uma instância (conectar um número)

```bash
curl -X POST http://localhost:3000/instances \
  -H "Authorization: Bearer <api_key do tenant>" \
  -H "Content-Type: application/json" \
  -d '{"nome": "Suporte", "webhookUrl": "https://meu-bot.com/webhook"}'
```

Depois, consulte o QR Code para escanear:

```bash
curl http://localhost:3000/instances/<instanceId>/qr \
  -H "Authorization: Bearer <api_key>"
```

E acompanhe o status até ficar `CONECTADO`:

```bash
curl http://localhost:3000/instances/<instanceId>/status \
  -H "Authorization: Bearer <api_key>"
```

### 3. Enviar mensagem simples

```bash
curl -X POST http://localhost:3000/instances/<instanceId>/messages \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"numero": "556299999999", "mensagem": "Olá!"}'
```

### 4. Envio em lote (notificações)

```bash
curl -X POST http://localhost:3000/instances/<instanceId>/messages/batch \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "mensagemTemplate": "Olá {nome}, sua fatura vence amanhã!",
    "delayMs": 3000,
    "contatos": [
      {"numero": "556299999999", "nome": "João"},
      {"numero": "556288888888", "nome": "Maria"}
    ]
  }'
```

### 5. OTP

Enviar:
```bash
curl -X POST http://localhost:3000/instances/<instanceId>/otp/send \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"numero": "556299999999"}'
```

Verificar:
```bash
curl -X POST http://localhost:3000/instances/<instanceId>/otp/verify \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"numero": "556299999999", "codigo": "123456"}'
```

O OTP tem expiração de 5 minutos, máximo de 5 tentativas de validação e
rate-limit de 3 envios a cada 10 minutos por número (evita abuso).

### 6. Recebendo mensagens (chatbot)

Toda mensagem recebida por uma instância CONECTADA é:
1. Salva na tabela `messages` (`direcao = RECEBIDA`);
2. Enviada via `POST` para o `webhookUrl` cadastrado na instância, com o header
   `X-Webhook-Signature` (HMAC-SHA256 usando o `webhookSecret` da instância)
   para você validar a autenticidade da chamada.

Payload do webhook:
```json
{
  "instanceId": "uuid-da-instancia",
  "numero": "556299999999",
  "mensagem": "texto recebido",
  "isGrupo": false,
  "timestamp": 1719000000
}
```

## Sobre whatsapp-web.js vs API oficial

`whatsapp-web.js` sobe um Chromium via Puppeteer por instância (150–300MB de RAM
cada) e é engenharia reversa do WhatsApp Web — sujeito a risco de bloqueio pela
Meta. Funciona bem para poucos números / chatbot conversacional. Para OTP e
notificações em escala, onde entrega confiável importa muito, vale avaliar a
**WhatsApp Cloud API oficial (Meta)** como alternativa — ela não depende de sessão
de navegador. A arquitetura deste projeto (SessionManager / fila / webhook) foi
pensada para trocar só a camada do `Client` caso você migre no futuro (inclusive
para [Baileys](https://github.com/WhiskeySockets/Baileys), que não usa Chromium).

## Escala

- Até ~15-20 instâncias: um processo Node só (como está aqui) é suficiente.
- Além disso: separe em processos/containers dedicados por grupo de instâncias,
  coordenados via Redis, com a API HTTP roteando para o worker certo.

## Estrutura de pastas

```
src/
  core/
    SessionManager.js       # isolamento das conexões WhatsApp
    QueueManager.js         # filas BullMQ isoladas por instância
    OtpService.js           # geração/validação de OTP com anti-abuso
    WebhookDispatcher.js    # encaminha mensagens recebidas
  middleware/
    auth.js                 # autenticação por API key + isolamento por tenant
  routes/
    tenants.js               # criação de tenants (admin)
    instances.js             # CRUD de instâncias + QR + status
    messages.js               # envio simples e em lote
    otp.js                    # envio/verificação de OTP
  db/
    prisma.js                # client Prisma singleton
  utils/helpers.js
  bootstrap.js               # reconecta instâncias ativas ao subir
  server.js                  # entrypoint Fastify
prisma/schema.prisma         # modelo de dados
docker-compose.yml           # Postgres + Redis para dev
```
