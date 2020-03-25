/**
 *  Goal
 *  - Deploy a proxy contract and exexute a tx to send erc20 token from proxy contract
 *  - Proxy contract refund fee with erc20 token
 * 
 *  Ehereum node
 *  - Using Rinkeby testnet
 * 
 *  Server
 *  - Estimate gas from relayer server
 */

const ethers = require('ethers');
const Web3 = require('web3');
const abi = require('./abi');
const bytecodes = require('./bytecodes');
const fetch = require('node-fetch');

require('dotenv').config();

/**
 * For Rinkeby
 */
const token = process.env.INFURA_TOKEN;
const providerUrl = 'https://rinkeby.infura.io/v3/' + token;
/**
 * For localhost
 * You need to run ganache with --noVMErrorsOnRPCResponse
 * e.g. ganache-cli -m "salute pony grab sound dad sister impulse guard rebel hub can aware" --noVMErrorsOnRPCResponse
 */
// const providerUrl = 'HTTP://127.0.0.1:8545';

// Create Wallet
const mnemonic = process.env.MNEMONIC;
const httpProvider = new ethers.providers.JsonRpcProvider(providerUrl);
const wallet = ethers.Wallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/0").connect(httpProvider);
console.log(wallet.address, wallet.privateKey);

// Çreate web3
const web3 = new Web3(providerUrl);
web3.eth.accounts.wallet.add(wallet.privateKey);

/**
 * Deploy master copies of GnosisSafe and ProxyFactory
 * @returns {object} { proxyFactoryAddress, gnosisSafeAddress }
 */
const deployMasterCopies = async function() {
    const ProxyFactory = new ethers.ContractFactory(abi.ProxyFactory, bytecodes.proxyFactory, wallet);
    const GnosisSafe = new ethers.ContractFactory(abi.GnosisSafe, bytecodes.GnosisSafe, wallet);
    const proxyFactory = await ProxyFactory.deploy();
    const gnosisSafe = await GnosisSafe.deploy();
    return { proxyFactoryAddress: proxyFactory.address, gnosisSafeAddress: gnosisSafe.address };
}

/**
 * Create Proxy Contract
 * @param {string} proxyFactoryAddress
 * @param {string} gnosisSafeAddress
 * @returns {string} proxy address
 */
const createProxyContract = async function(proxyFactoryAddress, gnosisSafeAddress) {
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
    const owners = await proxyContract.getOwners();
    console.log('Owners:', owners);
    return nonce.toNumber();
}

/**
 * Get gas price from relayer server
 * @param {string} proxyAddress
 * @param {string} to
 * @param {number} value
 * @param {string} data
 * @param {string} operation
 * @param {string} gasToken
 * @returns {object} e.g. { safeTxGas: '57000', baseGas: '48160', dataGas: '48160', operationalGas: '0', gasPrice: '1000000001', lastUsedNonce: 0, gasToken: '0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa' }
 */
const getGasPrice = async function(proxyAddress, to, value, data, operation, gasToken) {
    const checksumProxyAddress = web3.utils.toChecksumAddress(proxyAddress);
    const url = `https://safe-relay.rinkeby.gnosis.io/api/v2/safes/${checksumProxyAddress}/transactions/estimate/`;
    const body = {
        safe: checksumProxyAddress,
        to: web3.utils.toChecksumAddress(to),
        value,
        data,
        operation,
        gasToken: web3.utils.toChecksumAddress(gasToken)
    };
    const result = await fetch(url, {
        method: 'post',
        body: JSON.stringify(body),
        headers: {'Content-Type': 'application/json'}
    });
    const resultJson = await result.json();
    console.log('Estimated gas result:', resultJson);
    return resultJson;
}

/**
 * Execute a tx to send ETH from Proxy Contract
 * @param {string} proxyAddress proxy address
 * @param {string} to address
 * @param {string} destination address
 * @param {string} value
 * @param {number} nonce
 * @param {string} gnosisSafeAddress
 * @returns {string} tx hash
 */
const executeTokenTx = async function(proxyAddress, to, destination, value, nonce, gnosisSafeAddress) {
    const proxyContract = new ethers.Contract(proxyAddress, abi.GnosisSafe, wallet);

    // Set parameters of execTransaction()
    const valueWei = web3.utils.toWei('0', 'ether'); // 0 ETH

    // Get tx data
    const tokenContract = new web3.eth.Contract(abi.erc20Token, to);
    const data = tokenContract.methods.transfer(destination, web3.utils.toWei(value, 'ether')).encodeABI(); // Encode data of token transfer()
    // console.log('Data payload:', data);

    // Set operation and executor
    const operation = 0; // CALL
    const executor = wallet.address;

    // Set the gasToken to Dai on Rinkeby: https://rinkeby.etherscan.io/address/0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa
    const gasToken = '0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa';
    // If 0, then no refund to relayer
    // If > 0, then refund gasToken to executor
    const gasEstimatedResult = await getGasPrice(proxyAddress, to, valueWei, data, operation, gasToken);
    const { gasPrice } = gasEstimatedResult;
    console.log('Get gasPrice', gasPrice);

    // Get safe tx estimated gas: https://docs.gnosis.io/safe/docs/docs4/#safe-transaction-gas-limit-estimation
    // To avoid that this method can be used inside a transaction two security measures have been put in place:
    //      1. The method can only be called from the Safe itself
    //      2. The response is returned with a revert
    // NOTICE: If you want to run npx truffle test you need to start a ganache-cli instance. For this it is required to use the --noVMErrorsOnRPCResponse option. This option will make sure that ganache-cli behaves the same as other clients (e.g. geth and parity) when handling reverting calls to contracts. 
    let txGasEstimate = 0
    try {
        const gnosisSafeMasterCopy = new web3.eth.Contract(abi.GnosisSafe, gnosisSafeAddress);
        const estimateData = gnosisSafeMasterCopy.methods.requiredTxGas(to, valueWei, data, operation).encodeABI();
        // console.log('EstimateData:', estimateData);
        const estimateResponse = await web3.eth.call({to: proxyAddress, from: proxyAddress, data: estimateData, gasPrice: 0});
        txGasEstimate = new web3.utils.BN(estimateResponse.substring(138), 16);
        txGasEstimate = txGasEstimate.toNumber() + 10000; // Add 10k else we will fail in case of nested calls
        console.log("Safe Tx Gas estimate:", txGasEstimate);
    } catch(e) {
        console.log("Could not estimate gas:", 3);
    }
    // Get estimated base gas (Gas costs for that are indipendent of the transaction execution)
    // e.g. base transaction fee, signature check, payment of the refund
    // If one of the owners executes this transaction it is not really required to set this (so it can be 0)
    const baseGasEstimate = gasEstimatedResult.baseGas;
    console.log("Base Gas estimate:", baseGasEstimate);
    
    // Create typed data hash
    const transactionHash = await proxyContract.getTransactionHash(
        to, valueWei, data, operation, txGasEstimate, baseGasEstimate, gasPrice, gasToken, executor, nonce,
    );
    console.log('Transaction hash (typed data):', transactionHash);

    // Sign typed data, 只有在 local 執行時可以取得 smart contract return value
    // 要用 eth_signTypedData 或如果用 eth_sign v 要 +4
    const signature = await web3.eth.accounts.sign(transactionHash, wallet.privateKey);
    console.log('Signature 1:', signature.signature);
    // Try to recover my adderss
    const recovered = web3.eth.accounts.recover(transactionHash, signature.signature);
    console.log('Recover:', recovered, ';Wallet address:', wallet.address); // Should be: 0xBdF726e6eBA19342478415aF22ec097efc94258f
    // v + 4
    const sig = ethers.utils.splitSignature(signature);
    const newSignature = `${sig.r}${sig.s.substring(2)}${Number(sig.v + 4).toString(16)}`;
    console.log('Signature 2:', newSignature);

    // Call proxy contract to execute Tx
    console.log('-----Execute Tx');
    const tx = await proxyContract.execTransaction(
        to, valueWei, data, operation, txGasEstimate, baseGasEstimate, gasPrice, gasToken, executor, newSignature,
    );
    console.log('Execute tx:', tx.hash);
    await tx.wait();
    return tx.hash;
}

/**
 * 使用 localhost 測試
 */
// deployMasterCopies().then(async function (result){
//     try {
//         console.log('-----Deploy master copies:', result);
//         const { proxyFactoryAddress, gnosisSafeAddress } = result;
    
//         // Deploy proxy contract
//         const proxyAddress= await createProxyContract(proxyFactoryAddress, gnosisSafeAddress);

//         // Get current nonce
//         const nonce = await getProxyContractNonce(proxyAddress);
//         console.log('Nonce:', nonce);
    
//         // Send 0.002 ETH to proxy contract
//         const tx = await wallet.sendTransaction({ to: proxyAddress, value: ethers.utils.parseEther('0.01')});
//         await tx.wait();
//         console.log('-----Send 0.01 ETH:', tx.hash);
    
//         // Execute tx to send 0.001 ETH
//         console.log('-----Start Withdraw ETH');
//         const txHash = await executeTx(proxyAddress, '0x4378Faec5cCfCC6B9E1A8174435eB4354398EDdd', '0.001', nonce, gnosisSafeAddress);
//         console.log('-----Withdraw 0.001 ETH:', txHash);
//     } catch (e) {
//         console.log(e);
//     }
// });

/**
 * 使用 Rinkeby 測試
 */
const proxyFactoryAddress = '0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B'; // Rinkeby
const gnosisSafeAddress = '0x34CfAC646f301356fAa8B21e94227e3583Fe3F5F'; // Rinkeby
const tokenAddress = '0x68a6481263fd2270489e0d174148ceb27096e175'; // MK7 token
const gasTokenAddress = '0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa'; // Dai token
createProxyContract(proxyFactoryAddress, gnosisSafeAddress).then(async function (proxyAddress){
    // Get current nonce
    const nonce = await getProxyContractNonce(proxyAddress);
    console.log('Nonce:', nonce);

    // Send 0.5 Dai to proxy contract to pay fee
    const gasTokenContract = new ethers.Contract(gasTokenAddress, abi.erc20Token, wallet);
    const tx = await gasTokenContract.transfer(proxyAddress, web3.utils.toWei('0.5', 'ether'));
    await tx.wait();
    console.log('-----Send 0.5 Dai:', tx.hash);

    // Send 0.1 MK7 to proxy contract
    const tokenContract = new ethers.Contract(tokenAddress, abi.erc20Token, wallet);
    const tx2 = await tokenContract.transfer(proxyAddress, ethers.utils.parseEther('0.1'));
    await tx2.wait();
    console.log('-----Send 0.1 MK7:', tx2.hash);

    // Execute tx to withdraw 0.1 MK7
    const txHash = await executeTokenTx(
        proxyAddress,
        tokenAddress,
        '0x4378Faec5cCfCC6B9E1A8174435eB4354398EDdd',
        '0.1',
        nonce,
        gnosisSafeAddress,
    );
    console.log('-----Withdraw 0.1 MK7 token:', txHash);
});
