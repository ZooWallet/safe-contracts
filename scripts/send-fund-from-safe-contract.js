/**
 * Send idle token from user's safe proxy through biconomy
 * 
 * 需要改 @biconomy/mexa/src/index 362 行 api = { id: 'aa83b6ca-5f45-44c3-a12b-c7589a58d093',
        name: 'Transfer',
        url: '/api/v2/meta-tx/native',
        version: 2,
        method: 'execTransaction',
        methodType: 'write',
        apiType: 'native',
        metaTxLimitStatus: 1,
        metaTxLimit: [] };
    }
 */

const ethers = require('ethers');
const Web3 = require('web3');
const abi = require('./abi');
const Biconomy = require('@biconomy/mexa');

// Create web3
const providerUrl = 'https://mainnet.infura.io/v3/' + '15a82b43433b481ea733e751da927335';
const biconomyKey = '';
const biconomyProvider = new Biconomy(new Web3.providers.HttpProvider(providerUrl), { apiKey: biconomyKey });
const web3 = new Web3(biconomyProvider);

// Addresses
const safeAddress = '0x187e0e9fc9e92d0e99e6df3dccc695d4229d4bff';
const planAddress = '0xe4dFDEE5cA95712C6aC1a53a5f8B4465d9CBFE60';
const idleUsdcAddress = '0x5274891bEC421B39D23760c04A6755eCB444797C';

// Get the private key and account
const phrase = '';
const wallet = ethers.Wallet.fromMnemonic(phrase);
console.log(wallet.address, wallet.privateKey);
const ownerAddress = wallet.address;
const ownerKey = wallet.privateKey;

// Create contract instance
const idleUsdcContract = new web3.eth.Contract(abi.idleToken, idleUsdcAddress);
const safeContract = new web3.eth.Contract(abi.GnosisSafe, safeAddress);

// Send Tx
const sendTx = async () => {
    try {
        // Get token balance and create tx
        const tokenBalance = await idleUsdcContract.methods.balanceOf(safeAddress).call();
        console.log(tokenBalance.toString());
        const tokenValue = tokenBalance.toString();

        // Get transfer token data
        const txData = idleUsdcContract.methods.transfer(planAddress, tokenValue).encodeABI(); // Encode data of token transfer()
        console.log(txData);

        // Get safe nonce
        const nonce = await safeContract.methods.nonce().call();
        console.log(nonce);

        // Get meta tx hash
        const value = web3.utils.toWei('0', 'ether'); // 0 ETH
        const operation = 0;
        const gasToken = '0x0000000000000000000000000000000000000000'; // ETH
        const txGasEstimate = 300000;
        const baseGasEstimate = 0;
        const gasPrice = 0;
        const transactionHash = await safeContract.methods.getTransactionHash(
            idleUsdcAddress, value, txData, operation, txGasEstimate, baseGasEstimate, gasPrice, gasToken, ownerAddress, nonce,
        ).call();
        console.log(transactionHash);

        // Sign tx hash
        const signature = await web3.eth.accounts.sign(transactionHash, ownerKey);
        const sig = ethers.utils.splitSignature(signature);
        const newSignature = `${sig.r}${sig.s.substring(2)}${Number(sig.v + 4).toString(16)}`;
        console.log(newSignature);

        // Send tx
        const tx = await safeContract.methods.execTransaction(
            idleUsdcAddress, value, txData, operation, txGasEstimate, baseGasEstimate, gasPrice, gasToken, ownerAddress, newSignature,
        ).encodeABI();
        const txParams = {
            "from": ownerAddress,
            "gasLimit": web3.utils.toHex(400000), // 根據推測不能低於 txGasEstimate
            "to": safeAddress,
            "value": "0x0",
            "data": tx
        };
        const signedTx = await web3.eth.accounts.signTransaction(txParams, `${ownerKey}`);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        console.log(receipt);
    } catch (e) {
        console.error(e);
    }
};

sendTx();
