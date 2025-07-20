import { useState, useEffect } from 'react';
import axios from 'axios';

export default function BetHistory() {
  const [bets, setBets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadBets();
  }, []);

  const loadBets = async () => {
    try {
      const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id;
      if (!userId) return;
      
      const response = await axios.get(`/api/bets/history?userId=${userId}`);
      setBets(response.data.bets);
    } catch (error) {
      console.error('Error loading bets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'won': return 'text-green-500';
      case 'lost': return 'text-red-500';
      default: return 'text-yellow-500';
    }
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <h3 className="text-lg font-semibold mb-4">Your Bet History</h3>
      
      {isLoading ? (
        <div className="text-center py-4">Loading...</div>
      ) : bets.length === 0 ? (
        <div className="text-center py-4 text-gray-400">No bets yet</div>
      ) : (
        <div className="space-y-3">
          {bets.map(bet => (
            <div key={bet.id} className="p-3 bg-gray-700 rounded-lg fade-in">
              <div className="flex justify-between items-start">
                <div className="flex items-center">
                  {bet.racer_image && (
                    <img src={bet.racer_image} alt={bet.racer_name} className="w-10 h-10 rounded-full mr-3" />
                  )}
                  <div>
                    <div className="font-medium">{bet.racer_name || `Racer #${bet.racer_id}`}</div>
                    <div className="text-sm text-gray-400">
                      {new Date(bet.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{bet.amount.toFixed(2)}</div>
                  <div className={`text-sm ${getStatusColor(bet.status)}`}>
                    {bet.status.toUpperCase()}
                  </div>
                </div>
              </div>
              {bet.status === 'won' && (
                <div className="mt-2 pt-2 border-t border-gray-600 text-green-400">
                  Won: {(bet.amount * bet.odds).toFixed(2)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}