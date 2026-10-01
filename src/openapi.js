const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Mensageiro WhatsApp API',
    version: '1.0.0',
    description: 'API multi-tenant para gerenciamento de instancias WhatsApp, envio de mensagens, lote e OTP.'
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Health' },
    { name: 'Admin' },
    { name: 'Instancias' },
    { name: 'Mensagens' },
    { name: 'OTP' }
  ],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API Key' },
      AdminKey: { type: 'apiKey', in: 'header', name: 'X-Admin-Key' }
    },
    schemas: {
      TenantCreate: {
        type: 'object', required: ['nome'],
        properties: { nome: { type: 'string', example: 'Minha Empresa' } }
      },
      InstanceCreate: {
        type: 'object', required: ['nome'],
        properties: {
          nome: { type: 'string', example: 'Suporte' },
          webhookUrl: { type: 'string', format: 'uri', example: 'https://meusistema.com/webhook' }
        }
      },
      Message: {
        type: 'object', required: ['numero','mensagem'],
        properties: {
          numero: { type: 'string', example: '556299999999' },
          mensagem: { type: 'string', example: 'Olá! Sua mensagem foi enviada pela API.' },
          tipo: { type: 'string', enum: ['TEXTO','NOTIFICACAO','TEMPLATE'], default: 'TEXTO' },
          delayMs: { type: 'integer', minimum: 0, example: 0 }
        }
      },
      Batch: {
        type: 'object', required: ['mensagemTemplate','contatos'],
        properties: {
          mensagemTemplate: { type: 'string', example: 'Olá {nome}, tudo bem?' },
          delayMs: { type: 'integer', minimum: 0, default: 3000 },
          contatos: {
            type: 'array',
            items: { type: 'object', required: ['numero'], properties: {
              numero: { type: 'string', example: '556299999999' },
              nome: { type: 'string', example: 'Pedro' }
            }}
          }
        }
      },
      OtpSend: { type: 'object', required: ['numero'], properties: { numero: { type: 'string', example: '556299999999' } } },
      OtpVerify: { type: 'object', required: ['numero','codigo'], properties: {
        numero: { type: 'string', example: '556299999999' },
        codigo: { type: 'string', example: '123456' }
      }}
    }
  },
  paths: {
    '/health': {
      get: { tags:['Health'], summary:'Verifica se a API está online', responses:{'200':{description:'OK'}} }
    },
    '/admin/tenants': {
      get: {
        tags:['Admin'], summary:'Lista tenants', security:[{AdminKey:[]}],
        responses:{'200':{description:'Lista de tenants'},'401':{description:'Chave inválida'}}
      },
      post: {
        tags:['Admin'], summary:'Cria tenant', security:[{AdminKey:[]}],
        requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/TenantCreate'}}}},
        responses:{'201':{description:'Criado'},'401':{description:'Chave inválida'}}
      }
    },
    '/admin/tenants/{id}/regenerate-key': {
      post:{tags:['Admin'],summary:'Gera nova API key do tenant',security:[{AdminKey:[]}],
        parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],
        responses:{'200':{description:'Nova chave'},'401':{description:'Chave inválida'},'404':{description:'Não encontrado'}}}
    },
    '/instances': {
      get:{tags:['Instancias'],summary:'Lista instâncias',security:[{BearerAuth:[]}],responses:{'200':{description:'Lista'}}},
      post:{tags:['Instancias'],summary:'Cria uma instância e inicia o QR',security:[{BearerAuth:[]}],
        requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/InstanceCreate'}}}},
        responses:{'201':{description:'Instância criada'},'400':{description:'Dados inválidos'}}}
    },
    '/instances/{id}/status': {
      get:{tags:['Instancias'],summary:'Consulta status',security:[{BearerAuth:[]}],
        parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],
        responses:{'200':{description:'Status'}}}
    },
    '/instances/{id}/qr': {
      get:{tags:['Instancias'],summary:'Obtém QR Code atual',security:[{BearerAuth:[]}],
        parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],
        responses:{'200':{description:'String QR para renderização'},'404':{description:'QR indisponível'}}}
    },
    '/instances/{id}': {
      put:{tags:['Instancias'],summary:'Atualiza nome/webhook',security:[{BearerAuth:[]}]},
      delete:{tags:['Instancias'],summary:'Desconecta e exclui instância',security:[{BearerAuth:[]}]}
    },
    '/instances/{id}/messages': {
      get:{tags:['Mensagens'],summary:'Histórico de mensagens',security:[{BearerAuth:[]}]},
      post:{tags:['Mensagens'],summary:'Envia mensagem',security:[{BearerAuth:[]}],
        requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/Message'}}}},
        responses:{'202':{description:'Enfileirada'},'409':{description:'Instância desconectada'}}}
    },
    '/instances/{id}/messages/batch': {
      post:{tags:['Mensagens'],summary:'Envia mensagens em lote',security:[{BearerAuth:[]}],
        requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/Batch'}}}},
        responses:{'202':{description:'Enfileirado'}}}
    },
    '/instances/{id}/otp/send': {
      post:{tags:['OTP'],summary:'Envia código OTP',security:[{BearerAuth:[]}] ,
        requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/OtpSend'}}}},
        responses:{'202':{description:'OTP enviado'}}}
    },
    '/instances/{id}/otp/verify': {
      post:{tags:['OTP'],summary:'Valida OTP',security:[{BearerAuth:[]}] ,
        requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/OtpVerify'}}}},
        responses:{'200':{description:'Resultado'}}}
    }
  }
};
module.exports = openapi;
