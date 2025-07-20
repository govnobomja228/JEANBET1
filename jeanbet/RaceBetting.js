import { useState, useEffect } from 'react';
import axios from 'axios';

export default function RaceBetting({ onBetPlaced }) {
  const [amount, setAmount] = useState(50);
  const [selectedRacer, setSelectedRacer] = useState(null);
  const [racers, setRacers] = useState([]);
  const [balance, setBalance] = useState(0);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadRacers();
    loadBalance();
  }, []);

  const loadRacers = async () => {
    try {
      const response = await axios.get('/api/racers');
      setRacers(response.data.racers);
    } catch (error) {
      setMessage('Error loading racers');
    }
  };

  const loadBalance = async () => {
    try {
      const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id;
      if (!userId) return;
      
      const response = await axios.get(`/api/balance/${userId}`);
      setBalance(response.data.balance || 0);
    } catch (error) {
      setMessage('Error loading balance');
    }
  };

  const placeBet = async () => {
    if (!validateBet()) return;
    
    setIsLoading(true);
    setMessage('');

    try {
      const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id;
      if (!userId) throw new Error('User not identified');

      await axios.post('/api/bets', {
        userId,
        amount,
        racerId: selectedRacer
      }, {
        headers: {
          'Authorization': JSON.stringify(window.Telegram.WebApp.initDataUnsafe?.user)
        }
      });

      setMessage('Bet placed successfully!');
      setBalance(balance - amount);
      setAmount(50);
      setSelectedRacer(null);
      
      if (onBetPlaced) onBetPlaced();
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to place bet');
    } finally {
      setIsLoading(false);
    }
  };

  const validateBet = () => {
    if (!selectedRacer) {
      setMessage('Select a racer');
      return false;
    }
    if (amount < 50) {
      setMessage('Minimum bet is 50');
      return false;
    }
    if (amount > balance) {
      setMessage('Insufficient balance');
      return false;
    }
    return true;
  };

  const calculateWin = () => {
    if (!selectedRacer) return 0;
    const racer = racers.find(r => r.id === selectedRacer);
    return racer ? (amount * racer.odds).toFixed(2) : 0;
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">Bet Amount (min 50)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
          min="50"
          className="w-full p-3 bg-gray-700 rounded-lg text-white"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Select Racer</label>
        <div className="grid grid-cols-2 gap-3">
          {racers.filter(r => r.is_active).map(racer => (
            <div
              key={racer.id}
              onClick={() => setSelectedRacer(racer.id)}
              className={`p-3 rounded-lg border-2 transition-all ${selectedRacer === racer.id ? 'border-blue-500 bg-gray-700' : 'border-gray-600'}`}
            >
              <div className="flex items-center">
                {racer.image_url && (
                  <img src={racer.image_url} alt={racer.name} className="w-10 h-10 rounded-full mr-3" />
                )}
                <div>
                  <div className="font-medium">{racer.name}</div>
                  <div className="text-blue-400">x{racer.odds}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 p-3 bg-gray-700 rounded-lg">
        <div className="flex justify-between">
          <span>Potential Win:</span>
          <span className="font-bold">{calculateWin()}</span>
        </div>
        <div className="flex justify-between mt-1">
          <span>Your Balance:</span>
          <span className="font-bold">{balance.toFixed(2)}</span>
        </div>
      </div>

      <button
        onClick={placeBet}
        disabled={isLoading || !selectedRacer || amount < 50 || amount > balance}
        className={`w-full py-3 rounded-lg font-bold ${isLoading || !selectedRacer || amount < 50 || amount > balance ? 'bg-gray-600 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
      >
        {isLoading ? 'Processing...' : 'Place Bet'}
      </button>

      {message && (
        <div className={`mt-3 p-2 text-center rounded-lg ${message.includes('success') ? 'bg-green-800' : 'bg-red-800'}`}>
          {message}
        </div>
      )}
    </div>
  );
}