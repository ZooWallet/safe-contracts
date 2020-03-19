const ethers = require('ethers');
const Web3 = require('web3');
const abi = require('./abi');

require('dotenv').config();
const mnemonic = process.env.MNEMONIC;
const token = process.env.INFURA_TOKEN;
const providerUrl = 'https://rinkeby.infura.io/v3/' + token;
// const providerUrl = 'HTTP://127.0.0.1:8545';
const proxyFactoryAddress = '0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B'; // Rinkeby
const gnosisSafeAddress = '0x34CfAC646f301356fAa8B21e94227e3583Fe3F5F'; // Rinkeby

// Çreate web3
const web3 = new Web3(providerUrl);

// Create Wallet
const httpProvider = new ethers.providers.JsonRpcProvider(providerUrl);
const wallet = ethers.Wallet.fromMnemonic(mnemonic).connect(httpProvider);
console.log(wallet.address);

/**
 * Create Proxy Contract
 * @returns {string} proxy address
 */
const createProxyContract = async function() {
    // Get Creation Data
    const gnosisSafeMasterCopy = new web3.eth.Contract(abi.GnosisSafe, gnosisSafeAddress);
    const creationData = gnosisSafeMasterCopy.methods.setup(
        [wallet.address],
        1,
        '0x0000000000000000000000000000000000000000',
        '0x0',
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        0,
        '0x0000000000000000000000000000000000000000',
    ).encodeABI();
    // console.log(creationData);

    // Create Proxy
    const proxyFactory = new ethers.Contract(proxyFactoryAddress, abi.ProxyFactory, wallet);
    const tx = await proxyFactory.createProxy(gnosisSafeAddress, creationData);
    console.log('Create Proxy:', tx.hash);

    // Wait until the tx is mined
    await tx.wait();

    // Get the Proxy Address
    const receipt = await web3.eth.getTransactionReceipt(tx.hash);
    // TODO: 如果 address 第一個字元是 0，會有問題
    const proxyAddress = ethers.utils.hexStripZeros(receipt.logs[0].data);
    console.log('Proxy Address:', proxyAddress);
    return proxyAddress;
}

/**
 * Get the nonce of proxy contract
 * @param {string} proxyAddress
 * @returns {number} nonce
 */
const getProxyContractNonce = async function(proxyAddress) {
    const proxyContract = new ethers.Contract(proxyAddress, abi.GnosisSafe, wallet);
    const nonce = await proxyContract.nonce();
    console.log(nonce.toNumber());
    return nonce.toNumber();
}

/**
 * Execute a tx to send ETH from Proxy Contract
 * @param {string} to address
 * @param {string} value
 * @returns {string} tx hash
 */
const executeTx = async function(to, value) {
    // Create typed data
    const typedData = {
        types: {
            EIP712Domain: [
                { type: "address", name: "verifyingContract" }
            ],
            SafeTx: [
                { type: "address", name: "to" },
                { type: "uint256", name: "value" },
                { type: "bytes", name: "data" },
                { type: "uint8", name: "operation" },
                { type: "uint256", name: "safeTxGas" },
                { type: "uint256", name: "baseGas" },
                { type: "uint256", name: "gasPrice" },
                { type: "address", name: "gasToken" },
                { type: "address", name: "refundReceiver" },
                { type: "uint256", name: "nonce" },
            ]
        },
        domain: {
            verifyingContract: gnosisSafe.address
        },
        primaryType: "SafeTx",
        message: {
            to: to,
            value: value,
            data: data, // ?
            operation: operation, // ?
            safeTxGas: txGasEstimate, // ?
            baseGas: baseGasEstimate, // ?
            gasPrice: gasPrice, // ?
            gasToken: 0, // ?
            refundReceiver: refundReceiver, // ?
            nonce: nonce.toNumber() // ?
        }
    };

    // Sign typed data

    // Call proxy contract
}

// Create proxy contract
createProxyContract().then(function (proxyAddress){
    // Get current nonce
    getProxyContractNonce(proxyAddress);
});
