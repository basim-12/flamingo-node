# Core Lightning (CLN) + Bitcoin Core (Regtest) Installation Steps (macOS)

## 1. Update Homebrew

```bash
brew update
```

## 2. Install required dependencies

```bash
brew install autoconf automake libtool python3 gmp gmake libsodium jq sqlite
```

## 3. Install Bitcoin Core

```bash
brew install bitcoin
```

## 4. Verify Bitcoin installation

```bash
bitcoind --version
```

## 5. Start Bitcoin Core in regtest mode

```bash
bitcoind -regtest -daemon
```

## 6. Verify Bitcoin is running

```bash
bitcoin-cli -regtest getblockchaininfo
```

## Install Core Lightning (CLN)

## 7. Clone Core Lightning repository

```bash
git clone https://github.com/ElementsProject/lightning.git
cd lightning
```

## 8. Bootstrap & configure

```bash
./configure
```

## 9. Build Core Lightning

```bash
make
```

## 10. Install Core Lightning

```bash
sudo make install
```

## 11. Verify CLN installation

```bash
lightningd --version
```

## Setup Lightning Node Directories (Regtest)

## 12. Create first node directory

```bash
mkdir -p /Users/a1707/.lightning/firstnode
```

## 13. Start first node

```bash
lightningd --lightning-dir=/Users/a1707/.lightning/firstnode --network=regtest --daemon
```

## 14. Create second node directory

```bash
mkdir -p /Users/a1707/.lightning/secondnode
```

## 15. Start second node

```bash
lightningd --lightning-dir=/Users/a1707/.lightning/secondnode --network=regtest --daemon
```