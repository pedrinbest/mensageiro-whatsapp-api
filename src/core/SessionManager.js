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
            throw new Error(`Instancia ${instanceId} ja esta ativa.`);
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
            this._setStatus(instanceId, 'QR_PENDENTE');
            this.emit('qr', { instanceId, qr });
        });

        client.on('authenticated', () => {
            this.emit('authenticated', { instanceId });
        });

        client.on('ready', () => {
            const numero = client.info?.wid?.user || null;
            this._setStatus(instanceId, 'CONECTADO');
            this.emit('ready', { instanceId, numero });
        });

        client.on('auth_failure', (msg) => {
            this._setStatus(instanceId, 'ERRO');
            this.emit('auth_failure', { instanceId, msg });
        });

        client.on('disconnected', (reason) => {
            this._setStatus(instanceId, 'DESCONECTADO');
            this.emit('disconnected', { instanceId, reason });
        });

        // Todo message_create ja nasce atrelado ao instanceId correto
        client.on('message_create', (message) => {
            this.emit('message', { instanceId, message });
        });

        await client.initialize();

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
            await instancia.client.destroy();
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
