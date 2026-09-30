const prisma = require('./db/prisma');
const sessionManager = require('./core/SessionManager');
const { iniciarWorker } = require('./core/QueueManager');
const { encaminharParaWebhook, registrarMensagemRecebida } = require('./core/WebhookDispatcher');
const { extrairNumero } = require('./utils/helpers');

/**
 * Reconecta todas as instancias que ja estiveram CONECTADAS/QR_PENDENTE
 * ao reiniciar o processo. Sessoes invalidas simplesmente vao pedir QR de novo.
 */
async function iniciarTodasInstancias() {
    const instancias = await prisma.instance.findMany({
        where: { status: { in: ['CONECTADO', 'QR_PENDENTE', 'INICIANDO'] } },
    });

    for (const instancia of instancias) {
        if (sessionManager.estaAtiva(instancia.id)) {
            console.log(`Instancia ${instancia.id} (${instancia.nome}) ja esta ativa, ignorando.`);
            continue;
        }

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
        const from = message.from || '';
        const to = message.to || '';
        const numFrom = extrairNumero(from);
        const numTo = extrairNumero(to);

        // Se a mensagem foi disparada pelo próprio aparelho (fromMe):
        // Só processamos se for mensagem enviada para o próprio número (conversa com você mesmo / teste)
        // Isso evita loops infinitos com clientes externos.
        if (message.fromMe && numFrom && numTo && numFrom !== numTo) {
            return;
        }

        // Ignora status do WhatsApp, canais/newsletters e grupos
        if (
            from === 'status@broadcast' ||
            from.endsWith('@broadcast') ||
            from.endsWith('@newsletter') ||
            from.endsWith('@g.us') ||
            to.endsWith('@g.us') ||
            message.isGroupMsg
        ) {
            return;
        }

        console.log(`\n📨 [MENSAGEM RECEBIDA] Instância: ${instanceId}`);
        console.log(`   └ De: ${from} (${numFrom}) | Texto: "${(message.body || '').slice(0, 50)}"`);

        try {
            await registrarMensagemRecebida(instanceId, message);
            await encaminharParaWebhook(instanceId, message);
        } catch (erro) {
            console.error(`❌ Erro processando mensagem recebida (instancia ${instanceId}):`, erro.message);
        }
    });
}

module.exports = { iniciarTodasInstancias, ligarListenerDeMensagens };
