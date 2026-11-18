'use strict';

const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const dns = require('node:dns').promises;
const net = require('node:net');
const os = require('node:os');
const { performance } = require('node:perf_hooks');

const execAsync = promisify(exec);

function runPs(script, timeout = 15000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
    timeout,
    maxBuffer: 1024 * 1024 * 5
  });
}

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

  async getGatewayAndDns() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $cfgs = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway -or $_.DNSServer } | ForEach-Object {
        $gw = if ($_.IPv4DefaultGateway) { $_.IPv4DefaultGateway.NextHop } else { $null }
        $dnsList = @($_.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | Select-Object -ExpandProperty ServerAddresses)
        [PSCustomObject]@{
          interface_alias = $_.InterfaceAlias
          gateway = $gw
          dns_servers = $dnsList
        }
      }
      $drives = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=4" -ErrorAction SilentlyContinue | ForEach-Object {
        [PSCustomObject]@{
          drive = $_.DeviceID
          provider_name = $_.ProviderName
          volume_name = $_.VolumeName
        }
      }
      [PSCustomObject]@{
        configs = @($cfgs)
        mapped_drives = @($drives)
      } | ConvertTo-Json -Depth 4 -Compress
    `;

    try {
      const { stdout } = await runPs(ps);
      if (!stdout || !stdout.trim()) return { configs: [], mapped_drives: [] };
      const parsed = JSON.parse(stdout.trim());
      if (!Array.isArray(parsed.configs)) parsed.configs = parsed.configs ? [parsed.configs] : [];
      if (!Array.isArray(parsed.mapped_drives)) parsed.mapped_drives = parsed.mapped_drives ? [parsed.mapped_drives] : [];
      return parsed;
    } catch {
      return { configs: [], mapped_drives: [] };
    }
  }

  async pingHost(host) {
    const start = performance.now();
    try {
      const { stdout } = await execAsync(`ping -n 1 -w 1500 ${host}`);
      const duration = Math.round(performance.now() - start);
      const timeMatch = stdout.match(/tempo[=<](\d+)ms|time[=<](\d+)ms/i);
      const latency = timeMatch ? parseInt(timeMatch[1] || timeMatch[2], 10) : duration;

      return { host, reachable: true, latency_ms: latency };
    } catch {
      return { host, reachable: false, latency_ms: -1 };
    }
  }

  testTcpPort(host, port, timeoutMs = 2000) {
    return new Promise((resolve) => {
      const start = performance.now();
      const socket = new net.Socket();
      let settled = false;

      const finish = (open) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({
          host,
          port,
          open,
          latency_ms: open ? Math.round(performance.now() - start) : -1
        });
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(port, host);
    });
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

  async renewDhcp() {
    try {
      await execAsync('ipconfig /release', { timeout: 15000 });
    } catch {}
    const { stdout } = await execAsync('ipconfig /renew', { timeout: 25000 });
    return {
      ok: true,
      message: 'Concessão DHCP liberada e renovada com sucesso.',
      output: stdout.trim()
    };
  }

  async runFullDiagnostics() {
    const [ifaces, netMeta] = await Promise.all([
      this.getInterfaces(),
      this.getGatewayAndDns()
    ]);

    const gatewayIp = netMeta.configs.find(c => c.gateway)?.gateway || null;

    const targets = [];
    if (gatewayIp) {
      targets.push({ name: `Gateway Padrão (${gatewayIp})`, host: gatewayIp });
    }
    targets.push(
      { name: 'Google DNS (8.8.8.8)', host: '8.8.8.8' },
      { name: 'Cloudflare DNS (1.1.1.1)', host: '1.1.1.1' },
      { name: 'Google Public (google.com)', host: 'google.com' }
    );

    const portTargets = [
      { label: 'HTTPS Web (443)', host: 'google.com', port: 443 },
      { label: 'SMTP TLS (587)', host: 'smtp.gmail.com', port: 587 },
      { label: 'IMAP SSL (993)', host: 'imap.gmail.com', port: 993 },
      ...(gatewayIp ? [
        { label: 'SMB Compartilhamento (445 - Gateway)', host: gatewayIp, port: 445 },
        { label: 'RDP Área Remota (3389 - Local)', host: '127.0.0.1', port: 3389 }
      ] : [])
    ];

    const [pings, dnsCheck, tcpPorts] = await Promise.all([
      Promise.all(targets.map(t => this.pingHost(t.host))),
      this.resolveDns('google.com'),
      Promise.all(portTargets.map(pt => this.testTcpPort(pt.host, pt.port).then(r => ({ label: pt.label, ...r }))))
    ]);

    const hasInternet = pings.some(p => p.reachable);

    return {
      interfaces: ifaces,
      gateway_ip: gatewayIp,
      configs: netMeta.configs,
      mapped_drives: netMeta.mapped_drives,
      tests: targets.map((t, idx) => ({
        target: t.name,
        ...pings[idx]
      })),
      tcp_ports: tcpPorts,
      dns_resolution: dnsCheck,
      internet_active: hasInternet
    };
  }
}

const networkDoctorService = new NetworkDoctorService();

module.exports = { NetworkDoctorService, networkDoctorService };
