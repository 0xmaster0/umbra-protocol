/**
 * @notice Helpers for managing and displaying addresses
 */

import { CnsQueryResponse, Provider } from 'components/models';
import { utils } from '@umbra/umbra-js';
import { MAINNET_PROVIDER } from 'src/utils/constants';
import { getAddress, Web3Provider } from 'src/utils/ethers';
import { getChainById } from 'src/utils/utils';
import { i18n } from '../boot/i18n';
// ================================================== Address Helpers ==================================================

// Returns an address with the following format: 0x1234...abcd
export const formatAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(38)}`;

// Returns an ENS or CNS name if found, otherwise returns the address
export const lookupAddress = async (address: string, provider: Provider) => {
  const domainName = await lookupEnsOrCns(address, provider);
  return domainName ? domainName : address;
};

// Returns an ENS or CNS name if found, otherwise returns a formatted version of the address
export const lookupOrFormatAddress = async (address: string, provider: Provider) => {
  const domainName = await lookupAddress(address, provider);
  return domainName !== address ? domainName : formatAddress(address);
};

// Returns ENS name that address resolves to, or null if not found
export const lookupEnsName = async (address: string, provider: Provider) => {
  try {
    const name = await provider.lookupAddress(address);
    return name;
  } catch (err) {
    console.warn('Error in lookupEnsName');
    console.warn(err);
    return null;
  }
};

// Fetches all mainnet CNS names owned by an address and returns the first one
export const lookupCnsName = async (address: string) => {
  try {
    // Send request to get names
    const url = 'https://api.thegraph.com/subgraphs/name/unstoppable-domains-integrations/dot-crypto-registry';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: { owner: address.toLowerCase() },
        query: 'query domainsOfOwner($owner: String!) { domains(where: {owner: $owner}) { name } }',
      }),
    });

    // Return the first name in the array, or null if user has no CNS names
    const json = (await res.json()) as CnsQueryResponse;
    const names = json.data.domains;
    return names.length > 0 ? names[0].name : null;
  } catch (err) {
    // Scenario that prompted this try/catch was that The Graph API threw with a CORS error on localhost, blocking login
    console.warn('Error in lookupCnsName');
    console.warn(err);
    return null;
  }
};

// Returns an ENS or CNS name if found, otherwise returns null
const lookupEnsOrCns = async (address: string, provider: Provider) => {
  const ensName = await lookupEnsName(address, provider);
  if (ensName) return ensName;

  const cnsName = await lookupCnsName(address);
  if (cnsName) return cnsName;

  return null;
};

// Takes an ENS, CNS, or address, and returns the checksummed address
export const toAddress = utils.toAddress;

// =============================================== Bulk Address Helpers ================================================
// Duplicates of the above methods for operating on multiple addresses in parallel

export const formatAddresses = (addresses: string[]) => addresses.map(formatAddress);

export const lookupAddresses = async (addresses: string[], provider: Provider) => {
  const promises = addresses.map((address) => lookupAddress(address, provider));
  return Promise.all(promises);
};

export const lookupOrFormatAddresses = async (addresses: string[], provider: Provider) => {
  const promises = addresses.map((address) => lookupOrFormatAddress(address, provider));
  return Promise.all(promises);
};

// ================================================== Privacy Checks ===================================================

// Checks for any potential risks of withdrawing to the provided name or address, returns object containing
// a true/false judgement about risk, and HTML strings with details about the warnings
export const isAddressSafe = async (name: string, userAddress: string, stealthAddress: string, provider: Provider) => {
  const reasons: string[] = [];
  userAddress = getAddress(userAddress);
  stealthAddress = getAddress(stealthAddress);

  // Check if we're withdrawing to an ENS or CNS name
  const isDomain = utils.isDomain(name);
  if (isDomain) reasons.push(i18n.tc('Utils.Address.name-publicly-viewable'));

  // Get the address the provided name/address resolves to
  const destinationAddress = isDomain ? await utils.toAddress(name, provider) : getAddress(name);

  // If input was an address, check if address resolves to an ENS or CNS name
  if (!isDomain) {
    const ensName = await lookupEnsName(destinationAddress, MAINNET_PROVIDER as Web3Provider);
    if (ensName) reasons.push(`${i18n.tc('Utils.Address.name-resolves-to-ens')} ${ensName}`);

    const cnsName = await lookupCnsName(destinationAddress);
    if (cnsName) reasons.push(`${i18n.tc('Utils.Address.name-resolves-to-cns')} ${cnsName}`);
  }

  // Check if address is the wallet user is logged in with
  if (destinationAddress === userAddress) reasons.push(`${i18n.tc('Utils.Address.it')} ${isDomain ? i18n.tc('Utils.Address.resolves-to') : i18n.tc('Utils.Address.is')} ${i18n.tc('Utils.Address.same-addr-as-wallet')}`); // prettier-ignore

  // Check if the address is the stealth address that was sent funds
  if (destinationAddress === stealthAddress) reasons.push(`${i18n.tc('Utils.Address.it')} ${isDomain ? i18n.tc('Utils.Address.resolves-to') : i18n.tc('Utils.Address.is')} ${i18n.tc('Utils.Address.same-addr-as-stealth')}`); // prettier-ignore

  // Check if address owns any POAPs
  if (await hasPOAPs(destinationAddress)) reasons.push(`${isDomain ? i18n.tc('Utils.Address.address-it-resolves-to') : i18n.tc('Utils.Address.it')} ${i18n.tc('Utils.Address.has-poap-tokens')}`); // prettier-ignore

  // Check if address has contributed to Gitcoin Grants
  // TODO

  // If we're withdrawing to an ENS name, and if we're not on L1, and if the L1 address it resolves to is a contract,
  // warn that the contract may not exist or may not be the same contract on
  const { chainId } = await provider.getNetwork();
  if (isDomain && chainId !== 1) {
    const code = await MAINNET_PROVIDER.getCode(destinationAddress);
    if (code !== '0x') {
      const networkName = getChainById(chainId)?.chainName as string;
      reasons.push(`It resolves to address <span class="code">${destinationAddress}</span>. This resolution is done via mainnet, but you are withdrawing on ${networkName}. This address contains a contract on mainnet, and <span class="text-bold">that same contract may not exist on ${networkName}</span>`); // prettier-ignore
    }
  }

  return { safe: reasons.length === 0, reasons };
};

const jsonFetch = (url: string) => fetch(url).then((res) => res.json());

// Returns true if the address owns any POAP tokens
const hasPOAPs = async (address: string) => {
  try {
    const poaps = await jsonFetch(`https://api.poap.xyz/actions/scan/${address}`);
    return poaps.length > 0 ? true : false;
  } catch (err) {
    window.logger.warn('Error in hasPOAPs');
    window.logger.warn(err);
    return false;
  }
};
