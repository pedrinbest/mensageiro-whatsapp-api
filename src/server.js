require('dotenv').config();

const fastify = require('fastify')({ logger: true });
const { autenticarTenant } = require('./middleware/auth');
const { iniciarTodasInstancias, ligarListenerDeMensagens } = require('./bootstrap');

async function main() {
    // Rotas administrativas (chave mestra, sem autenticacao de tenant)
    fastify.register(require('./routes/tenants'));

    // Todas as rotas abaixo exigem Authorization: Bearer <api_key>
    fastify.register(async (instance) => {
        instance.addHook('preHandler', autenticarTenant);

        instance.register(require('./routes/instances'));
        instance.register(require('./routes/messages'));
        instance.register(require('./routes/otp'));
    });

    fastify.get('/health', async () => ({ status: 'ok' }));

    ligarListenerDeMensagens();
    await iniciarTodasInstancias();

    const port = Number(process.env.PORT || 3000);
    await fastify.listen({ port, host: '0.0.0.0' });

    console.log(`API rodando na porta ${port}`);
}

process.on('unhandledRejection', (err) => {
    fastify.log.error(err, 'unhandledRejection');
});

process.on('uncaughtException', (err) => {
    fastify.log.error(err, 'uncaughtException');
});

main().catch((err) => {
    fastify.log.error(err);
    process.exit(1);
});
