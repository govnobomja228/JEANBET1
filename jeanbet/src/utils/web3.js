import { Web3Provider } from '@ethersproject/providers';
import { InjectedConnector } from '@web3-react/injected-connector';

export const injected = new InjectedConnector({
  supportedChainIds: [1], // Ethereum Mainnet
});

export const getLibrary = (provider) => {
  return new Web3Provider(provider);
};