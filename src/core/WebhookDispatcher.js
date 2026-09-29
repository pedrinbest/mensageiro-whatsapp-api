const crypto = require('crypto');
const prisma = require('../db/prisma');

/**
 * Encaminha uma mensagem recebida para o webhook cadastrado NAQUELA instancia.
 * O payload sempre leva instanceId explicito, para o consumidor nunca precisar
 * adivinhar de qual numero a mensagem chegou.
 */
async function encaminharParaWebhook(instanceId, message) {
    const instancia = await prisma.instance.findUnique({ where: { id: instanceId } });

    if (!instancia?.webhookUrl) {
        console.log(`[Webhook Aviso] Instancia ${instanceId} nao possui webhookUrl cadastrada no banco. Ignorando dispatch.`);
        return;
    }

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
        console.log(`[Webhook -> ${instancia.webhookUrl}] Enviando mensagem recebida de ${payload.numero}...`);
        const response = await fetch(instancia.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': assinatura,
            },
            body: corpo,
        });
        console.log(`[Webhook Resposta] HTTP Status: ${response.status} de ${instancia.webhookUrl}`);
    } catch (error) {
        console.error(`[Webhook Erro] Falha ao entregar webhook da instancia ${instanceId} em ${instancia.webhookUrl}:`, error.message);
    }
}

async function registrarMensagemRecebida(instanceId, message) {
    const conteudoBruto = message.body || '';
    const conteudo = conteudoBruto.length > 5000 
        ? conteudoBruto.slice(0, 5000) + '... (truncado)' 
        : conteudoBruto;

    await prisma.message.create({
        data: {
            instanceId,
            direcao: 'RECEBIDA',
            numeroDestino: (message.from || '').replace('@c.us', '').replace('@g.us', '').replace('@newsletter', ''),
            tipo: 'TEXTO',
            conteudo,
            status: 'ENTREGUE',
            externalId: message.id?._serialized || null,
        },
    }).catch((err) => console.error(`[Message Create DB Erro] ${err.message}`));
}

module.exports = { encaminharParaWebhook, registrarMensagemRecebida };
