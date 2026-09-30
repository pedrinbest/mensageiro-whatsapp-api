const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');

/**
 * SessionManager e o unico ponto responsavel por criar, guardar e destruir
 * clientes whatsapp-web.js. Cada instancia (numero conectado) tem seu proprio
 * Client, com LocalAuth isolada por clientId = instanceId.
 *
 * Regra de ouro: todo evento emitido carrega instanceId explicitamente.
 * Nenhum handler pode depender de variavel global de "qual numero e esse".
 */
class SessionManager extends EventEmitter {
    constructor() {
        super();
        this.instances = new Map(); // instanceId -> { client, status }
    }

    async criarInstancia(instanceId) {
        if (this.instances.has(instanceId)) {
            const atual = this.instances.get(instanceId);
            if (atual.status === 'CONECTADO' || atual.status === 'QR_PENDENTE' || atual.status === 'INICIANDO') {
                throw new Error(`Instancia ${instanceId} ja esta ativa com status ${atual.status}.`);
            }
            // Se estava com erro ou desconectada, destrói antes de recriar
            await this.destruirInstancia(instanceId).catch(() => {});
        }

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: instanceId,
                dataPath: process.env.SESSIONS_PATH || './.wwebjs_auth',
            }),
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1018994784-alpha.html',
            },
            puppeteer: {
                headless: true,
                protocolTimeout: 180000, // 3 minutos para permitir injeção de scripts mesmo sob carga do servidor
                timeout: 180000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-extensions',
                    '--disable-sync',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad',
                    '--disable-component-extensions-with-background-pages',
                    '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
                    '--disable-ipc-flooding-protection',
                    '--disable-renderer-backgrounding',
                    '--metrics-recording-only',
                    '--mute-audio',
                    '--no-default-browser-check',
                    '--no-first-run',
                    '--no-pings',
                    '--no-zygote',
                    '--memory-pressure-off',
                    '--js-flags=--max-old-space-size=256',
                ],
            },
        });

        this.instances.set(instanceId, { client, status: 'INICIANDO' });

        client.on('qr', (qr) => {
            console.log(`[WhatsApp -> Instância ${instanceId}] QR Code gerado.`);
            this._setStatus(instanceId, 'QR_PENDENTE');
            this.emit('qr', { instanceId, qr });
        });

        client.on('authenticated', () => {
            console.log(`[WhatsApp -> Instância ${instanceId}] Autenticado com sucesso.`);
            this.emit('authenticated', { instanceId });
        });

        client.on('ready', () => {
            const numero = client.info?.wid?.user || null;
            console.log(`[WhatsApp -> Instância ${instanceId}] CONECTADO e PRONTO! Número: ${numero}`);
            this._setStatus(instanceId, 'CONECTADO');
            this.emit('ready', { instanceId, numero });
        });

        client.on('auth_failure', (msg) => {
            console.error(`[WhatsApp -> Instância ${instanceId}] Falha de autenticação:`, msg);
            this._setStatus(instanceId, 'ERRO');
            this.emit('auth_failure', { instanceId, msg });
        });

        client.on('disconnected', (reason) => {
            console.warn(`[WhatsApp -> Instância ${instanceId}] Desconectado:`, reason);
            this._setStatus(instanceId, 'DESCONECTADO');
            this.emit('disconnected', { instanceId, reason });
        });

        // Escuta tanto 'message' quanto 'message_create' para compatibilidade total em qualquer versão
        const emitirMensagem = (message) => {
            const msgId = message.id?._serialized || message.id?.id;
            if (msgId && this._jaProcessouMensagem(msgId)) {
                return;
            }
            this.emit('message', { instanceId, message });
        };

        client.on('message', emitirMensagem);
        client.on('message_create', emitirMensagem);

        try {
            await client.initialize();
        } catch (err) {
            this.instances.delete(instanceId);
            throw err;
        }

        return client;
    }

    _jaProcessouMensagem(msgId) {
        if (!this.mensagensProcessadas) {
            this.mensagensProcessadas = new Set();
        }
        if (this.mensagensProcessadas.has(msgId)) {
            return true;
        }
        this.mensagensProcessadas.add(msgId);
        if (this.mensagensProcessadas.size > 2000) {
            const primeiro = this.mensagensProcessadas.values().next().value;
            this.mensagensProcessadas.delete(primeiro);
        }
        return false;
    }

    _setStatus(instanceId, status) {
        const instancia = this.instances.get(instanceId);
        if (instancia) {
            instancia.status = status;
        }
    }

    getClient(instanceId) {
        const instancia = this.instances.get(instanceId);

        if (!instancia) {
            throw new Error(`Instancia ${instanceId} nao esta ativa.`);
        }

        return instancia.client;
    }

    getStatus(instanceId) {
        return this.instances.get(instanceId)?.status || 'DESCONECTADO';
    }

    estaAtiva(instanceId) {
        return this.instances.has(instanceId);
    }

    async destruirInstancia(instanceId) {
        const instancia = this.instances.get(instanceId);

        if (!instancia) return;

        try {
            if (instancia.client) {
                await instancia.client.destroy().catch(() => {});
            }
        } finally {
            this.instances.delete(instanceId);
        }
    }

    listarAtivas() {
        return Array.from(this.instances.keys());
    }
}

// Singleton do processo: todas as rotas e workers usam a mesma instancia
module.exports = new SessionManager();
