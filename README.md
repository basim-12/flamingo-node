# Minimal Flamingo Backend

Pre-req:
- bitcoind, bitcoin-cli (Bitcoin Core) installed and on PATH
- Core Lightning: lightningd & lightning-cli installed and on PATH
- node >= 16, npm

1. Edit `env.json` if needed.
2. Start nodes + wallet + lightningd:
   ```bash
   ./scripts/start-all.sh

3. Start backend: npm run start-backend
4. Start client test: npm run start-cli
5. Stop services: ./scripts/stop-all.sh

---

## 🐳 Running with Docker (Recommended)
You can run the entire project without installing local dependencies.

* [flamingo-docker](https://github.com/basim-12/flamingo-docker)
