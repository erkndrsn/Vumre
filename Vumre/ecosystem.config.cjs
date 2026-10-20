// PM2 process tanımı — production (Windows Server, C:\apps\Vumre'den çalıştırılır).
// Mutlak yollar (__dirname): PM2 hangi cwd'den çağrılırsa çağrılsın doğru çalışsın.
// Vue arayüzü, /admin ve /api tek Next process'inden 630'da sunulur.
const path = require('path')
const nextBin = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next')

module.exports = {
  apps: [
    {
      name: 'vumre',
      cwd: __dirname,
      script: nextBin,
      args: 'start -p 630',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: 'production', NODE_OPTIONS: '--no-deprecation' },
    },
  ],
}
