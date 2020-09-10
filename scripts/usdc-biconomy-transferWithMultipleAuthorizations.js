const ethers = require('ethers');
const { ecsign, ecrecover } = require('ethereumjs-util');
const Web3 = require('web3');
const abi = require('./abi');
const crypto = require('crypto');

// Address and constant
const usdcVault = '0xBdF726e6eBA19342478415aF22ec097efc94258f'; // With USDC
const usdcVaultKey = '0x9b9f26649b3c441bfd0a020acce5952ff35508b74a95d9fa7ac453af2ae5218f';
const relayer = '0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef'; // With ETH
const relayerKey = '0x0dbbe8e4ae425a6d2687f1a7e3ba17bc98c673636790f1b8ad91193c05875ef1';
const destination = '0x64398d0cdC02D21f6c75c1c2Ea063dF2a79A6e95'; // With nothing
const TRANSFER_WITH_AUTHORIZATION_TYPEHASH = '0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267';
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

const fiatTokenUtilAddress = '0xB06B066c1E3C9C48872Cb6C27Af54400a31A5D4d';
const fiatTokenUtilContractEthers = new ethers.Contract(fiatTokenUtilAddress, abi.fiatTokenUtil, relayerWallet);

/**
 * @param {String} string 
 */
const strip0x = (string) => {
    return string.replace(/^0x/, "");
};

/**
 * @param {String} string 
 */
const prepend0x = (string) => {
    return string.replace(/^(0x)?/, "0x");
}

/**
 * @param {String} string 
 */
const bufferFromHexString = (string) => {
    return Buffer.from(strip0x(string), "hex");
};

/**
 * @param {Buffer} buffer 
 */
const hexStringFromBuffer = (buffer) => {
    return "0x" + buffer.toString("hex");
};

/**
 * @param {String} from 
 * @param {String} to 
 * @param {String} value 
 * @param {String} validAfter 
 * @param {String} validBefore 
 * @param {String} nonce 
 */
const packParams = (from, to, value, validAfter, validBefore, nonce) => {
    return (
        strip0x(from) +
        strip0x(to) +
        strip0x(
            web3.eth.abi.encodeParameters(
                ["uint256", "uint256", "uint256", "bytes32"],
                [value, validAfter, validBefore, nonce]
            )
        )
    );
};

/**
 * @param {number} v 
 * @param {string} r 
 * @param {string} s 
 */
const packSignatures = (v, r, s) => {
    return v.toString(16).padStart(2, "0") + strip0x(r) + strip0x(s);
};

const ecSign = (digest, key) => {
    const sig = ecsign(bufferFromHexString(digest), bufferFromHexString(key));
    return { v: sig.v, r: hexStringFromBuffer(sig.r), s: hexStringFromBuffer(sig.s)}
;} 

const entryPoint = async () => {
    /* Create 1 data and signature */

    // Get data
    const nonce = hexStringFromBuffer(crypto.randomBytes(32));
    const value = 100;
    const validAfter = 0;
    const validBefore = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    // Encode data
    const data = web3.eth.abi.encodeParameters(['bytes32','address','address','uint256','uint256','uint256','bytes32'], [TRANSFER_WITH_AUTHORIZATION_TYPEHASH, usdcVault, destination, value, validAfter, validBefore, nonce]);
    console.log('data', data);

    // Create digest
    const digest = web3.utils.soliditySha3('0x1901', DOMAIN_SEPARATOR, web3.utils.keccak256(data));
    console.log('digest2', digest);

    // Sign 2 (Refer https://github.com/centrehq/centre-tokens/blob/5013157edecbaf5da7fb9e3afa85992965077c88/test/helpers/index.ts#L54)
    const sig = ecSign(digest, usdcVaultKey);
    console.log('sig', sig.v, sig.r, sig.s);

    /* Create 2 data and signature */
    const nonce2 = hexStringFromBuffer(crypto.randomBytes(32));
    const value2 = 10;
    const validAfter2 = 0;
    const validBefore2 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    const data2 = web3.eth.abi.encodeParameters(['bytes32','address','address','uint256','uint256','uint256','bytes32'], [TRANSFER_WITH_AUTHORIZATION_TYPEHASH, usdcVault, relayer, value2, validAfter2, validBefore2, nonce2]);
    console.log('data', data2);

    // Create digest
    const digest2 = web3.utils.soliditySha3('0x1901', DOMAIN_SEPARATOR, web3.utils.keccak256(data2));
    console.log('digest2', digest2);

    // Sign 2 (Refer https://github.com/centrehq/centre-tokens/blob/5013157edecbaf5da7fb9e3afa85992965077c88/test/helpers/index.ts#L54)
    const sig2 = ecSign(digest2, usdcVaultKey);
    console.log('sig', sig2.v, sig2.r, sig2.s);

    /* Call transferWithAuthorization */
    // Refer: https://github.com/centrehq/centre-tokens/blob/master/test/v2/GasAbstraction/testTransferWithMultipleAuthorizations.ts
    const transferTx = await fiatTokenUtilContractEthers.transferWithMultipleAuthorizations(
        prepend0x(
            packParams(usdcVault, destination, value, validAfter, validBefore, nonce) +
            packParams(usdcVault, relayer, value2, validAfter2, validBefore2, nonce2)
        ),
        prepend0x(
            packSignatures(sig.v, sig.r, sig.s) +
            packSignatures(sig2.v, sig2.r, sig2.s)
        ),
        true,
    );
    console.log(transferTx.hash);
};

entryPoint();
