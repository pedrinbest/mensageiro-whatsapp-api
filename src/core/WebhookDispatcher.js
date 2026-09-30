const crypto = require('crypto');
const prisma = require('../db/prisma');

/**
 * Encaminha uma mensagem recebida para o webhook cadastrado NAQUELA instancia.
 */
async function encaminharParaWebhook(instanceId, message) {
    const instancia = await prisma.instance.findUnique({ where: { id: instanceId } });

    if (!instancia?.webhookUrl) {
        console.log(`[Webhook Aviso] Instancia ${instanceId} nao possui webhookUrl cadastrada.`);
        return;
    }

    const textoMensagem = message.body || message.caption || '';
    const payload = {
        instanceId,
        numero: (message.from || '').replace('@c.us', '').replace('@g.us', '').replace('@lid', '').replace('@newsletter', ''),
        mensagem: textoMensagem,
        isGrupo: message.from?.endsWith('@g.us') || false,
        timestamp: message.timestamp,
    };

    const corpo = JSON.stringify(payload);
    const assinatura = crypto
        .createHmac('sha256', instancia.webhookSecret || '')
        .update(corpo)
        .digest('hex');

    try {
        console.log(`[Webhook -> ${instancia.webhookUrl}] Enviando de ${payload.numero}: "${textoMensagem.slice(0, 30)}"...`);
        const response = await fetch(instancia.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': assinatura,
            },
            body: corpo,
        });
        console.log(`[Webhook Resposta] Status: ${response.status}`);
    } catch (error) {
        console.error(`[Webhook Erro] Falha ao entregar em ${instancia.webhookUrl}:`, error.message);
    }
}

async function registrarMensagemRecebida(instanceId, message) {
    const conteudoBruto = message.body || message.caption || '';
    const conteudo = conteudoBruto.length > 5000 
        ? conteudoBruto.slice(0, 5000) + '... (truncado)' 
        : conteudoBruto;

    await prisma.message.create({
        data: {
            instanceId,
            direcao: 'RECEBIDA',
            numeroDestino: (message.from || '').replace('@c.us', '').replace('@g.us', '').replace('@lid', '').replace('@newsletter', ''),
            tipo: 'TEXTO',
            conteudo,
            status: 'ENTREGUE',
            externalId: message.id?._serialized || null,
        },
    }).catch((err) => console.error(`[Prisma DB Erro] Falha ao salvar mensagem:`, err.message));
}

module.exports = { encaminharParaWebhook, registrarMensagemRecebida };
