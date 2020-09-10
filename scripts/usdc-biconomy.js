const ethers = require('ethers');
const { ecsign, ecrecover } = require('ethereumjs-util');
const Web3 = require('web3');
const abi = require('./abi');
const { usdc } = require('./abi');

// Address and constant
const usdcVault = '0xBdF726e6eBA19342478415aF22ec097efc94258f'; // With USDC
const usdcVaultKey = '0x9b9f26649b3c441bfd0a020acce5952ff35508b74a95d9fa7ac453af2ae5218f';
const relayer = '0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef'; // With ETH
const relayerKey = '0x0dbbe8e4ae425a6d2687f1a7e3ba17bc98c673636790f1b8ad91193c05875ef1';
const destination = '0x64398d0cdC02D21f6c75c1c2Ea063dF2a79A6e95'; // With nothing
const PERMIT_TYPEHASH = '0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9';
const DOMAIN_SEPARATOR = '0x3e7f80f6881370f25d8142280356e618faf1a0c357b7c60b85b9900f9d0f48d7';

// Setup web3
const token = '15a82b43433b481ea733e751da927335';
const providerUrl = 'https://ropsten.infura.io/v3/' + token;
const web3 = new Web3(providerUrl);

// Setup ethers
const provider = new ethers.providers.JsonRpcProvider(providerUrl);
const relayerWallet = new ethers.Wallet(relayerKey, provider);

// Setup contracts
const usdcAddress = '0x07865c6E87B9F70255377e024ace6630C1Eaa37F';
const usdcAbi = abi.usdc;
const usdcContract = new web3.eth.Contract(usdcAbi, usdcAddress);
const usdcContractEthers = new ethers.Contract(usdcAddress, usdcAbi, relayerWallet);

const strip0x = (string) => {
    return string.replace(/^0x/, "");
};

const bufferFromHexString = (string) => {
    return Buffer.from(strip0x(string), "hex");
};

const hexStringFromBuffer = (buffer) => {
    return "0x" + buffer.toString("hex");
};

const ecSign = (digest, key) => {
    const sig = ecsign(bufferFromHexString(digest), bufferFromHexString(key));
    return { v: sig.v, r: hexStringFromBuffer(sig.r), s: hexStringFromBuffer(sig.s)}
;} 

const entryPoint = async () => {
    /* Call permit */

    // Get data
    const nonce = await usdcContract.methods.nonces(usdcVault).call();
    const value = 100;
    // const deadline = 1914710400; // 09/04/2030 @ 12:00am (UTC)
    const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    // Encode data
    const data = web3.eth.abi.encodeParameters(['bytes32','address','address','uint256','uint256','uint256'], [PERMIT_TYPEHASH, usdcVault, relayer, value, nonce, MAX_UINT256]);
    console.log('data', data);

    // Create digest
    // const digest = web3.utils.keccak256(
    //     '0x1901' +
    //     strip0x(DOMAIN_SEPARATOR) +
    //     strip0x(web3.utils.keccak256(data))
    // );
    // console.log('digest', digest);
    // Create digest 2 (Same as above)
    const digest2 = web3.utils.soliditySha3('0x1901', DOMAIN_SEPARATOR, web3.utils.keccak256(data));
    console.log('digest2', digest2)

    // Sign 1
    // const sig = await web3.eth.accounts.sign(digest, usdcVaultKey);
    // console.log('sig', sig);
    // Try to recover
    // const recover = web3.eth.accounts.recover(digest, sig.signature);
    // console.log(recover);
    // console.log(usdcVault === recover);

    // Sign 2 (Refer https://github.com/centrehq/centre-tokens/blob/5013157edecbaf5da7fb9e3afa85992965077c88/test/helpers/index.ts#L54)
    const sig = ecSign(digest2, usdcVaultKey);
    console.log('sig', sig.v, sig.r, sig.s);
    // Try to ecrecover (this will fail)
    // const recover2 = ecrecover(bufferFromHexString(digest), sig2.v, sig2.r, sig2.s);
    // console.log(recover2);
    // console.log(hexStringFromBuffer(recover2));
    // console.log(usdcVault === hexStringFromBuffer(recover2));

    // Call Permit
    const tx = await usdcContractEthers.permit(usdcVault, relayer, value, MAX_UINT256, sig.v, sig.r, sig.s);
    console.log(tx.hash);

    /* Call tranferFrom */
    const transferTx = await usdcContractEthers.transferFrom(usdcVault, destination, value);
    console.log(transferTx.hash);
};

entryPoint();
