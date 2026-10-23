// Explorer links for the network the backend is pointed at. The receipt and the
// ticket both show the transaction, so the URL is built in one place and both
// artefacts are guaranteed to link to the same explorer.
const EXPLORER_HOSTS_BY_CHAIN_ID = Object.freeze({
  56: 'https://bscscan.com',
  97: 'https://testnet.bscscan.com',
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
});

const BSC_MAINNET_CHAIN_ID = 56;
const BSC_TESTNET_CHAIN_ID = 97;

export function resolveExplorerHostForChainId(chainId) {
  return EXPLORER_HOSTS_BY_CHAIN_ID[Number(chainId)] ?? null;
}

export function resolveBscExplorerHost() {
  const configuredHost = process.env.BSC_EXPLORER_URL;
  if (configuredHost) {
    return configuredHost.replace(/\/+$/, '');
  }
  return resolveExplorerHostForChainId(BSC_MAINNET_CHAIN_ID);
}

export function resolveBscTestnetExplorerHost() {
  const configuredHost = process.env.BSC_EXPLORER_URL;
  if (configuredHost) {
    return configuredHost.replace(/\/+$/, '');
  }
  return resolveExplorerHostForChainId(BSC_TESTNET_CHAIN_ID);
}

export function buildExplorerTransactionUrl(txHash, chainId = BSC_MAINNET_CHAIN_ID) {
  if (!txHash) {
    return null;
  }
  const explorerHost = resolveExplorerHostForChainId(chainId);
  if (!explorerHost) {
    return null;
  }
  return `${explorerHost}/tx/${txHash}`;
}

export function buildExplorerAddressUrl(address, chainId = BSC_MAINNET_CHAIN_ID) {
  if (!address) {
    return null;
  }
  const explorerHost = resolveExplorerHostForChainId(chainId);
  if (!explorerHost) {
    return null;
  }
  return `${explorerHost}/address/${address}`;
}
