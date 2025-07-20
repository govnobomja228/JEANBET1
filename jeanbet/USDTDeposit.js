import { useState } from 'react';
import { useWeb3React } from '@web3-react/core';
import { Contract } from '@ethersproject/contracts';
import USDT_ABI from '../contracts/USDT.json';

const USDT_ADRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // Mainnet USDT

export default function USDTDeposit() {
  const { account, library } = useWeb3React();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const depositUSDT = async () => {
    if (!account || !amount) return;
    setLoading(true);
    
    try {
      const usdtContract = new Contract(
        USDT_ADDRESS, 
        USDT_ABI, 
        library.getSigner()
      );
      
      // Проверяем allowance
      const allowance = await usdtContract.allowance(account, RACE_CONTRACT_ADDRESS);
      if (allowance.lt(ethers.utils.parseUnits(amount, 6))) {
        // Запрашиваем разрешение
        const txApprove = await usdtContract.approve(
          RACE_CONTRACT_ADDRESS,
          ethers.constants.MaxUint256
        );
        await txApprove.wait();
      }
      
      // Вызываем deposit в основном контракте
      const raceContract = new Contract(
        RACE_CONTRACT_ADDRESS,
        RACE_ABI,
        library.getSigner()
      );
      
      const txDeposit = await raceContract.depositUSDT(
        ethers.utils.parseUnits(amount, 6)
      );
      await txDeposit.wait();
      
      alert(`Успешно пополнено ${amount} USDT!`);
    } catch (error) {
      console.error("Deposit error:", error);
      alert("Ошибка при пополнении");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-xl">
      <h3 className="text-lg font-medium mb-4">Пополнение баланса USDT</h3>
      <div className="flex flex-col space-y-4">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Сумма USDT"
          className="bg-gray-700 rounded-lg px-4 py-2"
        />
        <button
          onClick={depositUSDT}
          disabled={loading}
          className={`py-2 px-4 rounded-lg ${
            loading ? 'bg-gray-600' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {loading ? 'Обработка...' : 'Пополнить'}
        </button>
      </div>
      <p className="text-sm text-gray-400 mt-2">
        Минимальная сумма: 10 USDT
      </p>
    </div>
  );
}import { useState } from 'react';
import { useWeb3React } from '@web3-react/core';
import { Contract } from '@ethersproject/contracts';
import USDT_ABI from '../contracts/USDT.json';

const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // Mainnet USDT

export default function USDTDeposit() {
  const { account, library } = useWeb3React();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const depositUSDT = async () => {
    if (!account || !amount) return;
    setLoading(true);
    
    try {
      const usdtContract = new Contract(
        USDT_ADDRESS, 
        USDT_ABI, 
        library.getSigner()
      );
      
      // Проверяем allowance
      const allowance = await usdtContract.allowance(account, RACE_CONTRACT_ADDRESS);
      if (allowance.lt(ethers.utils.parseUnits(amount, 6))) {
        // Запрашиваем разрешение
        const txApprove = await usdtContract.approve(
          RACE_CONTRACT_ADDRESS,
          ethers.constants.MaxUint256
        );
        await txApprove.wait();
      }
      
      // Вызываем deposit в основном контракте
      const raceContract = new Contract(
        RACE_CONTRACT_ADDRESS,
        RACE_ABI,
        library.getSigner()
      );
      
      const txDeposit = await raceContract.depositUSDT(
        ethers.utils.parseUnits(amount, 6)
      );
      await txDeposit.wait();
      
      alert(`Успешно пополнено ${amount} USDT!`);
    } catch (error) {
      console.error("Deposit error:", error);
      alert("Ошибка при пополнении");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-xl">
      <h3 className="text-lg font-medium mb-4">Пополнение баланса USDT</h3>
      <div className="flex flex-col space-y-4">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Сумма USDT"
          className="bg-gray-700 rounded-lg px-4 py-2"
        />
        <button
          onClick={depositUSDT}
          disabled={loading}
          className={`py-2 px-4 rounded-lg ${
            loading ? 'bg-gray-600' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {loading ? 'Обработка...' : 'Пополнить'}
        </button>
      </div>
      <p className="text-sm text-gray-400 mt-2">
        Минимальная сумма: 10 USDT
      </p>
    </div>
  );
}