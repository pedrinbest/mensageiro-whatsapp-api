const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');

/**
 * SessionManager e o unico ponto responsavel por criar, guardar e destruir
 * clientes whatsapp-web.js. Cada instancia (numero conectado) tem seu proprio
 * Client, com LocalAuth isolada por clientId = instanceId.
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
                throw new Error(`Instancia ${instanceId} ja esta ativa.`);
            }
            await this.destruirInstancia(instanceId).catch(() => {});
        }

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: instanceId,
                dataPath: process.env.SESSIONS_PATH || './.wwebjs_auth',
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-sync',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-features=Translate',
                    '--disable-ipc-flooding-protection',
                    '--memory-pressure-off',
                ],
            },
        });

        this.instances.set(instanceId, { client, status: 'INICIANDO' });

        client.on('qr', (qr) => {
            console.log(`[WhatsApp ${instanceId}] QR Code gerado.`);
            this._setStatus(instanceId, 'QR_PENDENTE');
            this.emit('qr', { instanceId, qr });
        });

        client.on('authenticated', () => {
            console.log(`[WhatsApp ${instanceId}] Autenticado.`);
            this.emit('authenticated', { instanceId });
        });

        client.on('ready', () => {
            const numero = client.info?.wid?.user || null;
            console.log(`[WhatsApp ${instanceId}] CONECTADO com sucesso! Número: ${numero}`);
            this._setStatus(instanceId, 'CONECTADO');
            this.emit('ready', { instanceId, numero });
        });

        client.on('auth_failure', (msg) => {
            console.error(`[WhatsApp ${instanceId}] Falha de autenticacao:`, msg);
            this._setStatus(instanceId, 'ERRO');
            this.emit('auth_failure', { instanceId, msg });
        });

        client.on('disconnected', (reason) => {
            console.warn(`[WhatsApp ${instanceId}] Desconectado:`, reason);
            this._setStatus(instanceId, 'DESCONECTADO');
            this.emit('disconnected', { instanceId, reason });
        });

        // 1. Mensagens recebidas de outros números (evento padrão oficial do whatsapp-web.js)
        client.on('message', (message) => {
            this.emit('message', { instanceId, message });
        });

        // 2. Mensagens criadas: captura apenas mensagens para si mesmo (self-test)
        client.on('message_create', (message) => {
            if (message.fromMe && message.from && message.to && (message.from === message.to || message.from.split('@')[0] === message.to.split('@')[0])) {
                this.emit('message', { instanceId, message });
            }
        });

        try {
            await client.initialize();
        } catch (err) {
            this.instances.delete(instanceId);
            throw err;
        }

        return client;
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
