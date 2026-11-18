'use strict';

const net = require('node:net');
const tls = require('node:tls');

const TIMEOUT_MS = 10_000;

class MailAuthTesterService {
  /**
   * Testa o logon no servidor de mensagens de entrada (POP3 ou IMAP).
   */
  async testIncoming(config) {
    const {
      account_type = 'Pop3',
      incoming_server,
      incoming_port,
      incoming_use_ssl = true,
      email_address,
      password
    } = config;

    const isPop3 = (account_type.toLowerCase() === 'pop3');
    const port = Number(incoming_port) || (isPop3 ? (incoming_use_ssl ? 995 : 110) : (incoming_use_ssl ? 993 : 143));
    const host = incoming_server.trim();

    if (isPop3) {
      return this.#testPop3(host, port, incoming_use_ssl, email_address, password);
    } else {
      return this.#testImap(host, port, incoming_use_ssl, email_address, password);
    }
  }

  #testPop3(host, port, useSsl, email, password) {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        try {
          socket.write('QUIT\r\n');
          socket.end();
        } catch (_) {}
        resolve(result);
      };

      const connectOpts = { host, port, rejectUnauthorized: false };
      const socket = useSsl
        ? tls.connect(connectOpts)
        : net.connect(connectOpts);

      socket.setTimeout(TIMEOUT_MS);
      socket.setEncoding('utf8');

      let step = 0; // 0 = aguardando banner, 1 = enviou USER, 2 = enviou PASS

      socket.on('timeout', () => {
        socket.destroy();
        done({
          success: false,
          server: 'incoming',
          protocol: 'POP3',
          error: `Tempo limite esgotado ao conectar no servidor POP3 (${host}:${port}). Verifique o host e porta.`
        });
      });

      socket.on('error', (err) => {
        done({
          success: false,
          server: 'incoming',
          protocol: 'POP3',
          error: `Falha de conexão com servidor POP3 (${host}:${port}): ${err.message}`
        });
      });

      socket.on('data', (data) => {
        const text = data.toString();
        const trimmed = text.trim();

        if (step === 0) {
          if (trimmed.startsWith('+OK')) {
            step = 1;
            socket.write(`USER ${email}\r\n`);
          } else {
            done({
              success: false,
              server: 'incoming',
              protocol: 'POP3',
              error: `Resposta inesperada do servidor POP3: ${trimmed}`
            });
          }
        } else if (step === 1) {
          if (trimmed.startsWith('+OK')) {
            step = 2;
            socket.write(`PASS ${password}\r\n`);
          } else {
            done({
              success: false,
              server: 'incoming',
              protocol: 'POP3',
              error: `Usuário '${email}' rejeitado pelo servidor POP3: ${trimmed}`
            });
          }
        } else if (step === 2) {
          if (trimmed.startsWith('+OK')) {
            done({
              success: true,
              server: 'incoming',
              protocol: 'POP3',
              message: `Logon no servidor de entrada POP3 (${host}:${port}) realizado com sucesso!`
            });
          } else {
            done({
              success: false,
              server: 'incoming',
              protocol: 'POP3',
              error: `Falha na autenticação POP3: Senha ou nome de usuário incorretos (${trimmed}).`
            });
          }
        }
      });
    });
  }

  #testImap(host, port, useSsl, email, password) {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        try {
          socket.write('A002 LOGOUT\r\n');
          socket.end();
        } catch (_) {}
        resolve(result);
      };

      const connectOpts = { host, port, rejectUnauthorized: false };
      const socket = useSsl
        ? tls.connect(connectOpts)
        : net.connect(connectOpts);

      socket.setTimeout(TIMEOUT_MS);
      socket.setEncoding('utf8');

      let bannerReceived = false;

      socket.on('timeout', () => {
        socket.destroy();
        done({
          success: false,
          server: 'incoming',
          protocol: 'IMAP',
          error: `Tempo limite esgotado ao conectar no servidor IMAP (${host}:${port}). Verifique o host e porta.`
        });
      });

      socket.on('error', (err) => {
        done({
          success: false,
          server: 'incoming',
          protocol: 'IMAP',
          error: `Falha de conexão com servidor IMAP (${host}:${port}): ${err.message}`
        });
      });

      socket.on('data', (data) => {
        const text = data.toString();

        if (!bannerReceived) {
          if (text.includes('* OK')) {
            bannerReceived = true;
            // Escapa aspas e barras invertidas na senha
            const safeEmail = email.replace(/["\\]/g, '\\$&');
            const safePass = password.replace(/["\\]/g, '\\$&');
            socket.write(`A001 LOGIN "${safeEmail}" "${safePass}"\r\n`);
          }
        } else {
          if (text.includes('A001 OK')) {
            done({
              success: true,
              server: 'incoming',
              protocol: 'IMAP',
              message: `Logon no servidor de entrada IMAP (${host}:${port}) realizado com sucesso!`
            });
          } else if (text.includes('A001 NO') || text.includes('A001 BAD')) {
            done({
              success: false,
              server: 'incoming',
              protocol: 'IMAP',
              error: `Falha na autenticação IMAP: Credenciais rejeitadas pelo servidor (${text.trim()}).`
            });
          }
        }
      });
    });
  }

  /**
   * Testa a autenticação no servidor de envio (SMTP).
   */
  async testOutgoing(config) {
    const {
      outgoing_server,
      outgoing_port = 587,
      outgoing_use_ssl = true,
      outgoing_require_auth = true,
      email_address,
      password
    } = config;

    const host = outgoing_server.trim();
    const port = Number(outgoing_port) || 587;
    const isDirectSsl = (port === 465);

    return new Promise((resolve) => {
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        try {
          activeSocket.write('QUIT\r\n');
          activeSocket.end();
        } catch (_) {}
        resolve(result);
      };

      let activeSocket = null;
      let step = 0; // 0=init/banner, 1=ehlo, 2=starttls_req, 3=ehlo2, 4=auth_login, 5=user_sent, 6=pass_sent

      const onConnect = () => {
        activeSocket.setTimeout(TIMEOUT_MS);
      };

      const onError = (err) => {
        done({
          success: false,
          server: 'outgoing',
          protocol: 'SMTP',
          error: `Falha ao conectar no servidor SMTP (${host}:${port}): ${err.message}`
        });
      };

      const onTimeout = () => {
        if (activeSocket) activeSocket.destroy();
        done({
          success: false,
          server: 'outgoing',
          protocol: 'SMTP',
          error: `Tempo limite esgotado no servidor SMTP (${host}:${port}).`
        });
      };

      if (isDirectSsl) {
        activeSocket = tls.connect({ host, port, rejectUnauthorized: false }, onConnect);
      } else {
        activeSocket = net.connect({ host, port }, onConnect);
      }

      activeSocket.setTimeout(TIMEOUT_MS);
      activeSocket.setEncoding('utf8');
      activeSocket.on('error', onError);
      activeSocket.on('timeout', onTimeout);

      activeSocket.on('data', (data) => {
        const text = data.toString();
        const code = text.substring(0, 3);

        if (step === 0) {
          if (code === '220') {
            step = 1;
            activeSocket.write('EHLO localhost\r\n');
          } else {
            done({
              success: false,
              server: 'outgoing',
              protocol: 'SMTP',
              error: `Banner SMTP inválido: ${text.trim()}`
            });
          }
        } else if (step === 1) {
          if (code === '250') {
            if (!isDirectSsl && outgoing_use_ssl && text.includes('STARTTLS')) {
              step = 2;
              activeSocket.write('STARTTLS\r\n');
            } else if (outgoing_require_auth) {
              step = 4;
              activeSocket.write('AUTH LOGIN\r\n');
            } else {
              done({
                success: true,
                server: 'outgoing',
                protocol: 'SMTP',
                message: `Servidor SMTP (${host}:${port}) acessível e pronto.`
              });
            }
          }
        } else if (step === 2) {
          if (code === '220') {
            // Upgrade socket para TLS
            step = 3;
            const tlsSocket = tls.connect({
              socket: activeSocket,
              rejectUnauthorized: false
            }, () => {
              tlsSocket.write('EHLO localhost\r\n');
            });

            tlsSocket.setEncoding('utf8');
            tlsSocket.on('error', onError);
            tlsSocket.on('timeout', onTimeout);
            activeSocket = tlsSocket;

            tlsSocket.on('data', (tlsData) => {
              const tlsText = tlsData.toString();
              const tlsCode = tlsText.substring(0, 3);

              if (step === 3 && tlsCode === '250') {
                if (outgoing_require_auth) {
                  step = 4;
                  tlsSocket.write('AUTH LOGIN\r\n');
                } else {
                  done({
                    success: true,
                    server: 'outgoing',
                    protocol: 'SMTP',
                    message: `Conexão SMTP segura (STARTTLS) estabelecida com sucesso.`
                  });
                }
              } else if (step === 4 && tlsCode === '334') {
                step = 5;
                const b64User = Buffer.from(email_address).toString('base64');
                tlsSocket.write(`${b64User}\r\n`);
              } else if (step === 5 && tlsCode === '334') {
                step = 6;
                const b64Pass = Buffer.from(password).toString('base64');
                tlsSocket.write(`${b64Pass}\r\n`);
              } else if (step === 6) {
                if (tlsCode === '235') {
                  done({
                    success: true,
                    server: 'outgoing',
                    protocol: 'SMTP',
                    message: `Autenticação SMTP (${host}:${port}) concluída com sucesso!`
                  });
                } else {
                  done({
                    success: false,
                    server: 'outgoing',
                    protocol: 'SMTP',
                    error: `Falha na autenticação SMTP: Usuário ou senha incorretos (${tlsText.trim()}).`
                  });
                }
              }
            });
          } else {
            done({
              success: false,
              server: 'outgoing',
              protocol: 'SMTP',
              error: `Servidor não aceitou comando STARTTLS: ${text.trim()}`
            });
          }
        } else if (step === 4 && code === '334') {
          step = 5;
          const b64User = Buffer.from(email_address).toString('base64');
          activeSocket.write(`${b64User}\r\n`);
        } else if (step === 5 && code === '334') {
          step = 6;
          const b64Pass = Buffer.from(password).toString('base64');
          activeSocket.write(`${b64Pass}\r\n`);
        } else if (step === 6) {
          if (code === '235') {
            done({
              success: true,
              server: 'outgoing',
              protocol: 'SMTP',
              message: `Autenticação SMTP (${host}:${port}) concluída com sucesso!`
            });
          } else {
            done({
              success: false,
              server: 'outgoing',
              protocol: 'SMTP',
              error: `Falha na autenticação SMTP: Senha ou usuário rejeitados (${text.trim()}).`
            });
          }
        }
      });
    });
  }

  /**
   * Executa os testes completos de entrada e saída.
   */
  async testAll(config) {
    const incomingResult = await this.testIncoming(config);
    if (!incomingResult.success) {
      return {
        ok: false,
        failed_stage: 'incoming',
        error_message: incomingResult.error,
        incoming: incomingResult,
        outgoing: { success: false, skipped: true }
      };
    }

    const outgoingResult = await this.testOutgoing(config);
    if (!outgoingResult.success) {
      return {
        ok: false,
        failed_stage: 'outgoing',
        error_message: outgoingResult.error,
        incoming: incomingResult,
        outgoing: outgoingResult
      };
    }

    return {
      ok: true,
      message: 'Todas as tarefas de teste de autenticação foram concluídas com êxito!',
      incoming: incomingResult,
      outgoing: outgoingResult
    };
  }
}

module.exports = new MailAuthTesterService();

