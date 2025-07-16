// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RaceBetting {
    address public owner;
    IERC20 public usdtToken;
    uint public raceId = 1;
    bool public raceFinished;
    uint public winningRacer;
    
    struct Bet {
        address bettor;
        uint amount;
        uint racer;
    }
    
    mapping(uint => Bet[]) public bets;
    mapping(address => uint) public winnings;
    
    event BetPlaced(address indexed bettor, uint amount, uint racer);
    event Payout(address indexed winner, uint amount);
    
    constructor(address _usdtAddress) {
        owner = msg.sender;
        usdtToken = IERC20(_usdtAddress);
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    function placeBet(uint racer, uint amount) external {
        require(!raceFinished, "Race finished");
        require(amount > 0, "Zero bet");
        require(racer == 1 || racer == 2, "Invalid racer");
        
        // Переводим USDT от пользователя в контракт
        require(
            usdtToken.transferFrom(msg.sender, address(this), amount),
            "USDT transfer failed"
        );
        
        bets[raceId].push(Bet({
            bettor: msg.sender,
            amount: amount,
            racer: racer
        }));
        
        emit BetPlaced(msg.sender, amount, racer);
    }
    
    // Остальные функции как в предыдущем контракте (setWinner, withdrawWinnings и т.д.)
    // Добавляем везде работу с USDT вместо ETH
}