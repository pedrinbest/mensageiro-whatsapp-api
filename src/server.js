require('dotenv').config();

const fastify = require('fastify')({ logger: true });
const { autenticarTenant } = require('./middleware/auth');
const { iniciarTodasInstancias, ligarListenerDeMensagens } = require('./bootstrap');
const openapi = require('./openapi');

async function main() {
    // Documentação e painel não exigem API key de tenant.
    fastify.get('/openapi.json', async (req, reply) => reply.send(openapi));

    fastify.get('/docs', async (req, reply) => {
        reply.type('text/html; charset=utf-8');
        return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Swagger UI - Mensageiro WhatsApp API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head><body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
window.onload = () => SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  persistAuthorization: true,
  displayRequestDuration: true,
  tryItOutEnabled: true,
  deepLinking: true
});
</script></body></html>`;
    });

    fastify.get('/painel', async (req, reply) => {
        reply.type('text/html; charset=utf-8');
        return require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'painel.html'), 'utf8');
    });

    // Rotas administrativas
    fastify.register(require('./routes/admin'));

    // Todas as rotas abaixo exigem Authorization: Bearer <api_key>
    fastify.register(async (instance) => {
        instance.addHook('preHandler', autenticarTenant);

        instance.register(require('./routes/instances'));
        instance.register(require('./routes/messages'));
        instance.register(require('./routes/history'));
        instance.register(require('./routes/otp'));
    });

    fastify.get('/health', async () => ({ status: 'ok' }));

    ligarListenerDeMensagens();
    await iniciarTodasInstancias();

    const port = Number(process.env.PORT || 3000);
    await fastify.listen({ port, host: '0.0.0.0' });

    console.log(`API rodando na porta ${port}`);
    console.log(`Swagger: http://localhost:${port}/docs`);
    console.log(`Painel:  http://localhost:${port}/painel`);
}

process.on('unhandledRejection', (err) => fastify.log.error(err, 'unhandledRejection'));
process.on('uncaughtException', (err) => fastify.log.error(err, 'uncaughtException'));

main().catch((err) => {
    fastify.log.error(err);
    process.exit(1);
});
