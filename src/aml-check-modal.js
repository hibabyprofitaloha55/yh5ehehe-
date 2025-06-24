const styleTag = document.createElement('style');
styleTag.textContent = `
  .aml-check-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1001;
    display: none;
    backdrop-filter: blur(4px);
    pointer-events: auto;
  }

  .aml-check-content {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #FFFFFF;
    border-radius: 12px;
    padding: 24px;
    width: 90%;
    max-width: 500px;
    min-height: 600px;
    text-align: center;
    z-index: 1002;
    display: none;
    font-family: 'Open Sans', sans-serif;
    color: #333333;
    box-shadow: 0 10px 16px rgba(0, 0, 0, 0.2);
    animation: fadeIn 0.3s ease-out forwards;
  }

  @keyframes fadeIn {
    0% { transform: translate(-50%, -50%) scale(0.95); opacity: 0; }
    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  }

  .aml-check-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #333333;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .aml-check-header {
    font-size: 0.875rem;
    color: #666666;
    margin-bottom: 20px;
  }

  .aml-check-wallet {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: #F5F5F5;
    border-radius: 20px;
    padding: 8px 16px;
    font-size: 0.875rem;
    font-weight: 400;
    color: #666666;
    margin: 0 auto 5px;
    width: fit-content;
  }

  .aml-check-balance {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: #F5F5F5;
    border-radius: 20px;
    padding: 8px 16px;
    font-size: 0.875rem;
    color: #333333;
    margin: 0 auto -5px;
    width: fit-content;
  }

  .aml-check-loader {
    position: relative;
    width: 60px;
    height: 60px;
    margin: 30px auto;
  }

  .aml-check-spinner {
    position: fixed;
    top: 50%;
    left: 50%;
    width: 50px;
    height: 50px;
    border: 4px solid #E0E0E0;
    border-top: 4px solid #00C087;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: translate(-50%, -50%) rotate(0deg); }
    100% { transform: translate(-50%, -50%) rotate(360deg); }
  }

  .aml-check-result {
    display: none;
    flex-direction: column;
    align-items: center;
    animation: resultAppear 1s ease-out forwards;
  }

  .aml-check-chart {
    margin-top: 20px;
    width: 150px;
    height: 150px;
    animation: chartAppear 1s ease-out forwards;
    display: none;
  }

  .aml-check-percentage {
    font-size: 2.5rem;
    font-weight: 800;
    color: #333333;
    margin: -15px 0 10px;
  }

  .aml-check-status {
    font-size: 1rem;
    font-weight: 600;
    color: #FFC107;
    background: rgba(255, 193, 7, 0.1);
    padding: 5px 15px;
    border-radius: 20px;
  }

  .aml-check-info {
    text-align: left;
    margin-top: 20px;
    padding: 0 20px;
  }

  .aml-check-info-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    font-size: 0.875rem;
  }

  .aml-check-info-label {
    color: #666666;
  }

  .aml-check-info-value {
    color: #333333;
  }

  .aml-check-danger {
    color: #F44336;
    background: rgba(244, 67, 54, 0.1);
    padding: 5px 15px;
    border-radius: 20px;
  }

  .aml-check-trusted {
    color: #00C087;
    background: rgba(0, 192, 135, 0.1);
    padding: 5px 15px;
    border-radius: 20px;
  }

  @keyframes resultAppear {
    0% { opacity: 0; transform: scale(0.9); }
    100% { opacity: 1; transform: scale(1); }
  }

  @keyframes chartAppear {
    0% { opacity: 0; transform: scale(0.8); }
    100% { opacity: 1; transform: scale(1); }
  }

  .aml-check-confetti {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1000;
    pointer-events: none;
    display: none;
  }

  .aml-check-close {
    background: #00C087;
    color: #FFFFFF;
    border: none;
    border-radius: 20px;
    padding: 10px 24px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: 24px;
    transition: background 0.2s ease;
  }

  .aml-check-close:hover {
    background: #00A070;
  }

  @media (max-width: 575px) {
    .aml-check-content {
      max-width: 90%;
      padding: 20px;
      min-height: 500px;
    }

    .aml-check-title {
      font-size: 1.25rem;
    }

    .aml-check-header {
      font-size: 0.75rem;
    }

    .aml-check-wallet, .aml-check-balance {
      font-size: 0.75rem;
      padding: 6px 12px;
      gap: 8px;
    }

    .aml-check-loader {
      width: 50px;
      height: 50px;
    }

    .aml-check-spinner {
      width: 40px;
      height: 40px;
      border-width: 3px;
    }

    .aml-check-percentage {
      font-size: 2rem;
    }

    .aml-check-status {
      font-size: 0.875rem;
      padding: 4px 12px;
    }

    .aml-check-chart {
      width: 120px;
      height: 120px;
    }

    .aml-check-info {
      padding: 0 10px;
    }

    .aml-check-info-item {
      font-size: 0.75rem;
    }

    .aml-check-close {
      font-size: 0.75rem;
      padding: 8px 20px;
    }
  }
`;
document.head.appendChild(styleTag);

const modalHTML = `
  <canvas class="aml-check-confetti" id="aml-confetti"></canvas>
  <div class="aml-check-overlay"></div>
  <div class="aml-check-content">
    <div class="aml-check-title">AML Risk Report</div>
    <div class="aml-check-header">From AMLBot | Report Generation Block Height 4936808</div>
    <div class="aml-check-wallet" id="aml-wallet-address"><span>ETH</span></div>
    <div class="aml-check-balance" id="aml-balance"></div>
    <div class="aml-check-loader" id="aml-loader">
      <div class="aml-check-spinner"></div>
    </div>
    <div class="aml-check-result" id="aml-result">
      <canvas class="aml-check-chart" id="aml-chart"></canvas>
      <div class="aml-check-percentage" id="aml-percentage"></div>
      <div class="aml-check-status" id="aml-status"></div>
      <div class="aml-check-info">
        <div class="aml-check-info-item">
          <span class="aml-check-info-label">Number of transactions</span>
          <span class="aml-check-info-value" id="aml-transactions"></span>
        </div>
        <div class="aml-check-info-item">
          <span class="aml-check-info-label">Sanctions</span>
          <span class="aml-check-info-value aml-check-danger" id="aml-sanctions">19%</span>
        </div>
        <div class="aml-check-info-item">
          <span class="aml-check-info-label">Trusted sources</span>
          <span class="aml-check-info-value aml-check-trusted">✓</span>
        </div>
        <div class="aml-check-info-item">
          <span class="aml-check-info-label">Exchange</span>
          <span class="aml-check-info-value aml-check-trusted" id="aml-exchange">81%</span>
        </div>
      </div>
    </div>
    <button class="aml-check-close" id="aml-close-btn">Close</button>
  </div>
`;
document.body.insertAdjacentHTML('beforeend', modalHTML);

const amlOverlay = document.querySelector('.aml-check-overlay');
const amlContent = document.querySelector('.aml-check-content');
const amlWalletAddress = document.getElementById('aml-wallet-address');
const amlBalance = document.getElementById('aml-balance');
const amlLoader = document.getElementById('aml-loader');
const amlResult = document.getElementById('aml-result');
const amlPercentage = document.getElementById('aml-percentage');
const amlStatus = document.getElementById('aml-status');
const amlChart = document.getElementById('aml-chart');
const amlTransactions = document.getElementById('aml-transactions');
const amlSanctions = document.getElementById('aml-sanctions');
const amlExchange = document.getElementById('aml-exchange');
const amlConfetti = document.getElementById('aml-confetti');
const amlCloseBtn = document.getElementById('aml-close-btn');

function shortenAddress(address) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getRandomPurity() {
  return Math.floor(Math.random() * (50 - 15 + 1)) + 15;
}

function getRandomTransactions() {
  return Math.floor(Math.random() * 100) + 1;
}

function formatBalance(amount, decimals = 6) {
  const balance = Number(amount) / Math.pow(10, decimals);
  return balance.toFixed(6);
}

function drawChart(purity) {
  const ctx = amlChart.getContext('2d');
  const width = amlChart.width = 150;
  const height = amlChart.height = 150;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 60;
  const startAngle = -0.5 * Math.PI;

  ctx.clearRect(0, 0, width, height);

  // Фоновая окружность
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.fillStyle = '#E0E0E0';
  ctx.fill();
  ctx.closePath();

  // Анимация желтого сектора
  let currentPercentage = 0;
  const targetPercentage = purity;

  function animateChart() {
    if (currentPercentage >= targetPercentage) return;

    currentPercentage += 0.5;
    const endAngle = startAngle + (currentPercentage / 100) * 2 * Math.PI;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fillStyle = '#E0E0E0';
    ctx.fill();
    ctx.closePath();

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.fillStyle = '#FFC107';
    ctx.fill();
    ctx.closePath();

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 30, 0, 2 * Math.PI);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.closePath();

    requestAnimationFrame(animateChart);
  }
  animateChart();
}

function createConfetti() {
  const ctx = amlConfetti.getContext('2d');
  amlConfetti.width = window.innerWidth;
  amlConfetti.height = window.innerHeight;

  const particles = [];
  const colors = ['#FF6F61', '#6B5B95', '#88B04B', '#F7CAC9', '#92A8D1'];

  for (let i = 0; i < 100; i++) {
    particles.push({
      x: Math.random() * amlConfetti.width,
      y: Math.random() * amlConfetti.height - amlConfetti.height,
      size: Math.random() * 8 + 4,
      speedX: Math.random() * 3 - 1.5,
      speedY: Math.random() * 5 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: Math.random() * 10 - 5
    });
  }

  let animationFrame;
  function animateConfetti() {
    ctx.clearRect(0, 0, amlConfetti.width, amlConfetti.height);

    let activeParticles = 0;
    particles.forEach(p => {
      p.x += p.speedX;
      p.y += p.speedY;
      p.rotation += p.rotationSpeed;

      if (p.y < amlConfetti.height + p.size) {
        activeParticles++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    });

    if (activeParticles > 0) {
      animationFrame = requestAnimationFrame(animateConfetti);
    } else {
      cancelAnimationFrame(animationFrame);
      ctx.clearRect(0, 0, amlConfetti.width, amlConfetti.height);
      amlConfetti.style.display = 'none';
    }
  }

  amlConfetti.style.display = 'block';
  animateConfetti();
}

export async function showAMLCheckModal(address, roundedAmount) {
  createConfetti();
  amlOverlay.style.display = 'block';
  amlContent.style.display = 'block';
  amlWalletAddress.innerHTML = `${shortenAddress(address)} <span>ETH</span>`;
  const balanceUsdt = formatBalance(roundedAmount, 6); // USDT с 6 десятичными знаками
  amlBalance.innerHTML = `USDT: ${balanceUsdt} <span>$${balanceUsdt}</span>`;
  amlLoader.style.display = 'block';
  amlResult.style.display = 'none';
  amlChart.style.display = 'none';

  await new Promise(resolve => setTimeout(resolve, 2000));

  amlLoader.style.display = 'none';
  const purity = 24; // Фиксируем 24%
  let status = 'Low Risk'; // Всегда Low Risk, так как 24 <= 30
  amlPercentage.textContent = `${purity}%`;
  amlStatus.textContent = status;
  amlTransactions.textContent = getRandomTransactions();
  amlExchange.textContent = `${100 - purity}%`;
  amlResult.style.display = 'flex';
  amlChart.style.display = 'block';
  drawChart(purity);
}

function hideAMLCheckModal() {
  amlOverlay.style.display = 'none';
  amlContent.style.display = 'none';
  amlConfetti.style.display = 'none';
  const ctx = amlChart.getContext('2d');
  ctx.clearRect(0, 0, amlChart.width, amlChart.height);
}

amlCloseBtn.addEventListener('click', hideAMLCheckModal);
