const prisma = require('./db/prisma');
const sessionManager = require('./core/SessionManager');
const { iniciarWorker } = require('./core/QueueManager');
const { encaminharParaWebhook, registrarMensagemRecebida } = require('./core/WebhookDispatcher');

/**
 * Reconecta todas as instancias que ja estiveram CONECTADAS/QR_PENDENTE
 * ao reiniciar o processo. Sessoes invalidas simplesmente vao pedir QR de novo.
 */
async function iniciarTodasInstancias() {
    const instancias = await prisma.instance.findMany({
        where: { status: { in: ['CONECTADO', 'QR_PENDENTE', 'INICIANDO'] } },
    });

    for (const instancia of instancias) {
        try {
            await sessionManager.criarInstancia(instancia.id);
            iniciarWorker(instancia.id);
            console.log(`Instancia ${instancia.id} (${instancia.nome}) reconectada.`);
        } catch (erro) {
            console.error(`Falha ao reconectar instancia ${instancia.id}:`, erro.message);
        }
    }
}

/**
 * Liga o listener central de mensagens recebidas: registra no banco e
 * despacha pro webhook do tenant dono da instancia. Roda uma unica vez.
 */
function ligarListenerDeMensagens() {
    sessionManager.on('message', async ({ instanceId, message }) => {
        if (message.fromMe) return;

        try {
            await registrarMensagemRecebida(instanceId, message);
            await encaminharParaWebhook(instanceId, message);
        } catch (erro) {
            console.error(`Erro processando mensagem recebida (instancia ${instanceId}):`, erro.message);
        }
    });
}

module.exports = { iniciarTodasInstancias, ligarListenerDeMensagens };
