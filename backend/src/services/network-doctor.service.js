'use strict';

const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const dns = require('node:dns').promises;
const os = require('node:os');
const { performance } = require('node:perf_hooks');

const execAsync = promisify(exec);

class NetworkDoctorService {
  async getInterfaces() {
    const interfaces = os.networkInterfaces();
    const result = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (!addr.internal && addr.family === 'IPv4') {
          result.push({
            name,
            ip: addr.address,
            netmask: addr.netmask,
            mac: addr.mac
          });
        }
      }
    }
    return result;
  }

  async pingHost(host) {
    const start = performance.now();
    try {
      // Usa ping nativo do Windows (-n 1 -w 1500)
      const { stdout } = await execAsync(`ping -n 1 -w 1500 ${host}`);
      const duration = Math.round(performance.now() - start);

      const timeMatch = stdout.match(/tempo[=<](\d+)ms|time[=<](\d+)ms/i);
      const latency = timeMatch ? parseInt(timeMatch[1] || timeMatch[2], 10) : duration;

      return {
        host,
        reachable: true,
        latency_ms: latency
      };
    } catch {
      return {
        host,
        reachable: false,
        latency_ms: -1
      };
    }
  }

  async resolveDns(domain) {
    const start = performance.now();
    try {
      const addresses = await dns.resolve4(domain);
      const latency = Math.round(performance.now() - start);
      return { domain, reachable: true, ips: addresses, latency_ms: latency };
    } catch (e) {
      return { domain, reachable: false, ips: [], error: e.message };
    }
  }

  async runFullDiagnostics() {
    const ifaces = await this.getInterfaces();

    // Hosts padrão para teste de conectividade
    const targets = [
      { name: 'Gateway / DNS Local (8.8.8.8)', host: '8.8.8.8' },
      { name: 'Cloudflare DNS (1.1.1.1)', host: '1.1.1.1' },
      { name: 'Google Public (google.com)', host: 'google.com' }
    ];

    const pings = await Promise.all(targets.map(t => this.pingHost(t.host)));
    const dnsCheck = await this.resolveDns('google.com');

    // Identifica se há internet funcional
    const hasInternet = pings.some(p => p.reachable);

    return {
      interfaces: ifaces,
      tests: targets.map((t, idx) => ({
        target: t.name,
        ...pings[idx]
      })),
      dns_resolution: dnsCheck,
      internet_active: hasInternet
    };
  }
}

const networkDoctorService = new NetworkDoctorService();

module.exports = { NetworkDoctorService, networkDoctorService };

