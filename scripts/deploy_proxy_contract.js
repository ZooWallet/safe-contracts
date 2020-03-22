const ethers = require('ethers');
const Web3 = require('web3');
const abi = require('./abi');
const bytecodes = require('./bytecodes');

require('dotenv').config();
const mnemonic = process.env.MNEMONIC;
// const token = process.env.INFURA_TOKEN;
// const providerUrl = 'https://rinkeby.infura.io/v3/' + token;
const providerUrl = 'HTTP://127.0.0.1:8545';

// Create Wallet
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
 * Execute a tx to send ETH from Proxy Contract
 * @param {string} proxyAddress proxy address
 * @param {string} to address
 * @param {string} value
 * @param {number} nonce
 * @param {string} gnosisSafeAddress
 * @returns {string} tx hash
 */
const executeTx = async function(proxyAddress, to, value, nonce, gnosisSafeAddress) {
    const proxyContract = new ethers.Contract(proxyAddress, abi.GnosisSafe, wallet);

    // Set parameters of execTransaction()
    const valueWei = web3.utils.toWei(value, 'ether');
    const data = '0x'; // tx data payload
    const operation = 0; // CALL
    const gasPrice = web3.utils.toWei('10', 'gwei'); // TODO: how to get gasPrice if gasToken is erc20 token
    const gasToken = '0x0000000000000000000000000000000000000000'; // ETH
    const executor = wallet.address;
    // Get safe tx estimated gas: https://docs.gnosis.io/safe/docs/docs4/#safe-transaction-gas-limit-estimation
    // To avoid that this method can be used inside a transaction two security measures have been put in place:
    //     1. The method can only be called from the Safe itself
    //     2. The response is returned with a revert
    // NOTICE: If you want to run npx truffle test you need to start a ganache-cli instance. For this it is required to use the --noVMErrorsOnRPCResponse option.
    //         This option will make sure that ganache-cli behaves the same as other clients (e.g. geth and parity) when handling reverting calls to contracts. 
    let txGasEstimate = 0
    try {
        const gnosisSafeMasterCopy = new web3.eth.Contract(abi.GnosisSafe, gnosisSafeAddress);
        const estimateData = gnosisSafeMasterCopy.methods.requiredTxGas(to, valueWei, data, operation).encodeABI();
        // console.log('EstimateData:', estimateData);
        const estimateResponse = await web3.eth.call({to: proxyAddress, from: proxyAddress, data: estimateData, gasPrice: 0});
        txGasEstimate = new web3.utils.BN(estimateResponse.substring(138), 16);
        txGasEstimate = txGasEstimate.toNumber() + 10000; // Add 10k else we will fail in case of nested calls
        console.log("Safe Tx Gas estimate: " + txGasEstimate);
    } catch(e) {
        console.log("Could not estimate gas:", 3);
    }
    // Get estimated base gas (Gas costs for that are indipendent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund))
    let baseGasEstimate = 0; // If one of the owners executes this transaction it is not really required to set this (so it can be 0) TODO: if using erc20 token

    
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

    console.log('-----Execute Tx');
    // Call proxy contract
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
deployMasterCopies().then(async function (result){
    try {
        console.log('-----Deploy master copies:', result);
        const { proxyFactoryAddress, gnosisSafeAddress } = result;
    
        // Deploy proxy contract
        const proxyAddress= await createProxyContract(proxyFactoryAddress, gnosisSafeAddress);

        // Get current nonce
        const nonce = await getProxyContractNonce(proxyAddress);
        console.log('Nonce:', nonce);
    
        // Send 0.002 ETH to proxy contract
        const tx = await wallet.sendTransaction({ to: proxyAddress, value: ethers.utils.parseEther('0.01')});
        await tx.wait();
        console.log('-----Send 0.01 ETH:', tx.hash);
    
        // Execute tx to send 0.001 ETH
        console.log('-----Start Withdraw ETH');
        const txHash = await executeTx(proxyAddress, '0x4378Faec5cCfCC6B9E1A8174435eB4354398EDdd', '0.001', nonce, gnosisSafeAddress);
        console.log('-----Withdraw 0.001 ETH:', txHash);
    } catch (e) {
        console.log(e);
    }
});

/**
 * 使用 Rinkeby 測試
 */
// const proxyFactoryAddress = '0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B'; // Rinkeby
// const gnosisSafeAddress = '0x34CfAC646f301356fAa8B21e94227e3583Fe3F5F'; // Rinkeby
// createProxyContract().then(async function (proxyAddress){
//     // Get current nonce
//     const nonce = await getProxyContractNonce(proxyAddress);
//     console.log('Nonce:', nonce);

//     // Send 0.002 ETH to proxy contract
//     const tx = await wallet.sendTransaction({ to: proxyAddress, value: ethers.utils.parseEther('0.002')});
//     await tx.wait();
//     console.log('Send 0.002 ETH:', tx.hash);

//     // Execute tx to send 0.001 ETH
//     const txHash = await executeTx(proxyAddress, '0x4378Faec5cCfCC6B9E1A8174435eB4354398EDdd', '0.0015', nonce);
//     console.log('Withdraw 0.0015 ETH:', txHash);
// });
