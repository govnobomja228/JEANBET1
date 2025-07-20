import { useState } from 'react';
import axios from 'axios';

export default function DepositWithdraw({ onSuccess }) {
  const [activeTab, setActiveTab] = useState('deposit');
  const [amount, setAmount] = useState('');
  const [cardDetails, setCardDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleDeposit = async () => {
    if (!amount || amount < 100) {
      setMessage('Minimum deposit is 100 ₽');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id;
      if (!userId) throw new Error('User not identified');

      const response = await axios.post('/api/payment/create', {
        userId,
        amount: parseFloat(amount)
      }, {
        headers: {
          'Authorization': JSON.stringify(window.Telegram.WebApp.initDataUnsafe?.user)
        }
      });

      if (response.data.url) {
        // Открываем платежную форму ЮКассы в WebApp
        window.Telegram.WebApp.openInvoice({ url: response.data.url }, (status) => {
          if (status === 'paid') {
            setMessage('Payment successful!');
            if (onSuccess) onSuccess();
          } else {
            setMessage('Payment failed or canceled');
          }
        });
      } else {
        throw new Error('Payment URL not received');
      }
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to create payment');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!amount || amount < 500) {
      setMessage('Minimum withdrawal is 500 ₽');
      return;
    }

    if (!cardDetails) {
      setMessage('Enter card details');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id;
      if (!userId) throw new Error('User not identified');

      await axios.post('/api/withdraw/create', {
        userId,
        amount: parseFloat(amount),
        cardDetails
      }, {
        headers: {
          'Authorization': JSON.stringify(window.Telegram.WebApp.initDataUnsafe?.user)
        }
      });

      setMessage('Withdrawal request created successfully!');
      if (onSuccess) onSuccess();
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to create withdrawal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <div className="flex space-x-2 mb-4">
        <button
          onClick={() => setActiveTab('deposit')}
          className={`px-4 py-2 rounded-lg flex-1 ${
            activeTab === 'deposit' ? 'bg-blue-600' : 'bg-gray-700'
          }`}
        >
          Deposit
        </button>
        <button
          onClick={() => setActiveTab('withdraw')}
          className={`px-4 py-2 rounded-lg flex-1 ${
            activeTab === 'withdraw' ? 'bg-blue-600' : 'bg-gray-700'
          }`}
        >
          Withdraw
        </button>
      </div>

      {activeTab === 'deposit' ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (min 100 ₽)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="100"
              className="w-full p-3 bg-gray-700 rounded-lg"
              placeholder="Enter amount"
            />
          </div>

          <button
            onClick={handleDeposit}
            disabled={loading || !amount || amount < 100}
            className={`w-full py-3 rounded-lg font-bold ${
              loading || !amount || amount < 100
                ? 'bg-gray-600 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {loading ? 'Processing...' : 'Deposit'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (min 500 ₽)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="500"
              className="w-full p-3 bg-gray-700 rounded-lg"
              placeholder="Enter amount"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Card Details</label>
            <input
              type="text"
              value={cardDetails}
              onChange={(e) => setCardDetails(e.target.value)}
              className="w-full p-3 bg-gray-700 rounded-lg"
              placeholder="Card number"
            />
          </div>

          <button
            onClick={handleWithdraw}
            disabled={loading || !amount || amount < 500 || !cardDetails}
            className={`w-full py-3 rounded-lg font-bold ${
              loading || !amount || amount < 500 || !cardDetails
                ? 'bg-gray-600 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {loading ? 'Processing...' : 'Withdraw'}
          </button>
        </div>
      )}

      {message && (
        <div className={`mt-4 p-3 rounded-lg text-center ${
          message.includes('success') ? 'bg-green-800' : 'bg-red-800'
        }`}>
          {message}
        </div>
      )}
    </div>
  );
}