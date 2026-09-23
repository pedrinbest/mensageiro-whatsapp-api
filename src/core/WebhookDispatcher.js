const crypto = require('crypto');
const prisma = require('../db/prisma');

/**
 * Encaminha uma mensagem recebida para o webhook cadastrado NAQUELA instancia.
 * O payload sempre leva instanceId explicito, para o consumidor nunca precisar
 * adivinhar de qual numero a mensagem chegou.
 */
async function encaminharParaWebhook(instanceId, message) {
    const instancia = await prisma.instance.findUnique({ where: { id: instanceId } });

    if (!instancia?.webhookUrl) return;

    const payload = {
        instanceId,
        numero: (message.from || '').replace('@c.us', '').replace('@g.us', ''),
        mensagem: message.body,
        isGrupo: message.from?.endsWith('@g.us') || false,
        timestamp: message.timestamp,
    };

    const corpo = JSON.stringify(payload);
    const assinatura = crypto
        .createHmac('sha256', instancia.webhookSecret || '')
        .update(corpo)
        .digest('hex');

    try {
        await fetch(instancia.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': assinatura,
            },
            body: corpo,
        });
    } catch (error) {
        console.error(`Falha ao entregar webhook da instancia ${instanceId}:`, error.message);
    }
}

async function registrarMensagemRecebida(instanceId, message) {
    await prisma.message.create({
        data: {
            instanceId,
            direcao: 'RECEBIDA',
            numeroDestino: (message.from || '').replace('@c.us', ''),
            tipo: 'TEXTO',
            conteudo: message.body,
            status: 'ENTREGUE',
            externalId: message.id?._serialized || null,
        },
    });
}

module.exports = { encaminharParaWebhook, registrarMensagemRecebida };
