const prisma = require('../db/prisma');

/**
 * Valida o header Authorization: Bearer <api_key> e resolve o tenant.
 * Anexa req.tenant para uso nas rotas seguintes.
 */
async function autenticarTenant(request, reply) {
    const header = request.headers['authorization'] || '';
    const apiKey = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!apiKey) {
        return reply.code(401).send({ erro: 'API key ausente. Use Authorization: Bearer <api_key>.' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { apiKey } });

    if (!tenant || !tenant.ativo) {
        return reply.code(401).send({ erro: 'API key invalida ou tenant inativo.' });
    }

    request.tenant = tenant;
}

/**
 * Garante que a instancia da URL pertence ao tenant autenticado.
 * Evita que um tenant acesse/opere a instancia de outro.
 */
async function autorizarInstanciaDoTenant(request, reply) {
    const { id } = request.params;

    const instancia = await prisma.instance.findUnique({ where: { id } });

    if (!instancia || instancia.tenantId !== request.tenant.id) {
        return reply.code(404).send({ erro: 'Instancia nao encontrada.' });
    }

    request.instancia = instancia;
}

module.exports = { autenticarTenant, autorizarInstanciaDoTenant };
